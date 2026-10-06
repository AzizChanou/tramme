// The server path: the Messages API through /api/claude, where the key is
// added (by the Worker, or in personal mode by the key vault: api.reach). The conversation loop runs here: Claude asks for tools, the
// editor runs them, sends the results, until Claude answers. The same loop
// drives the models in the OpenAI chat format (other providers through the
// Worker, local models directly): see compat.ts.
//
// The history is append-only: what was sent once is sent again byte for byte.
// The prompt cache stays warm, and Claude's thinking stays valid (Opus and
// Sonnet 5.5 refuse thinking replayed after an edited history). Old tool
// results are cleared by the API itself (context editing), not here.

import { z } from 'zod';
import { ADAPTIVE, DEFAULT_EFFORT, modelName, providerOf, TOOLS, type Effort, type ToolResult } from '@tramme/assistant';
import { ChatReader, chatTools, toChat } from './compat.ts';
import { reach, type AiEvent } from '../api.ts';
import type { ToolRunner } from './tools.ts';
import { runCall, uid } from './calls.ts';
import { t } from '../i18n/index.ts';

type Block = { type: string; [k: string]: any };
export interface Message { role: 'user' | 'assistant'; content: Block[] }

const MAX_STEPS = 40;
/** streamed, so a long answer (thinking, a large proposal) does not time out */
const MAX_TOKENS = 64_000;
const INTERRUPTED = 'Interrupted by the user.';

const TOOL_SPECS = TOOLS.map((t) => {
  const { $schema: _, ...schema } = z.toJSONSchema(t.schema) as Record<string, unknown>;
  return { name: t.name, description: t.description, input_schema: schema };
});

const CHAT_TOOLS = chatTools(TOOL_SPECS);

/** the oldest tool results are cleared by the API once the conversation grows; proposals and writes stay */
const CLEAR_OLD_RESULTS = {
  type: 'clear_tool_uses_20250919',
  trigger: { type: 'input_tokens', value: 80_000 },
  keep: { type: 'tool_uses', value: 6 },
  // enough at once to be worth the cache it restarts
  clear_at_least: { type: 'input_tokens', value: 20_000 },
  exclude_tools: ['propose_changes', 'discard_proposal', 'write_file', 'cut_media', 'apply_template'],
};

/**
 * Parts of a request a provider, an account or a model may refuse. A 400
 * naming one the request carried drops it for that model for the rest of the
 * session, and the request goes again; the most specific patterns come first.
 */
type Part = 'context' | 'hour' | 'binding' | 'fallbacks' | 'effort' | 'vision' | 'display' | 'thinking';
const REFUSED: [Part, RegExp][] = [
  ['context', /context_management|context-management|clear_tool_uses/i],
  ['hour', /\bttl\b/i],
  ['binding', /block_binding|thinking-binding/i],
  ['fallbacks', /fallback/i],
  ['effort', /effort|output_config|reasoning/i],
  ['vision', /image|vision|multimodal/i],
  ['display', /display/i],
  ['thinking', /thinking/i],
];

class ApiFailure extends Error {
  status: number;
  /** already tried again as many times as allowed */
  final: boolean;
  constructor(status: number, message: string, final = false) { super(message); this.status = status; this.final = final; }
}

/** the error a provider answered, in the Messages API's shape or the chat format's ({ error } or [{ error }]) */
async function errorMessage(res: Response): Promise<string> {
  try {
    const j = await res.json();
    const err = Array.isArray(j) ? j[0]?.error : j.error;
    return err?.message ?? (typeof err === 'string' ? err : `HTTP ${res.status}`);
  } catch { return `HTTP ${res.status}`; }
}

/** a request as built for one attempt: what it carries of the parts a model may refuse */
interface Attempt { headers?: Record<string, string>; body: unknown; parts: Part[] }

/** tries after the first one, for a busy server, a dropped connection or a broken stream */
const RETRIES = 2;

/** waits before trying again: what the server asks (retry-after), or longer each time */
function backoff(attempt: number, res?: Response): Promise<void> {
  const asked = Number(res?.headers.get('retry-after'));
  const ms = Number.isFinite(asked) && asked > 0 ? Math.min(30, asked) * 1000 : 1500 * (attempt + 1) ** 2;
  return new Promise((r) => setTimeout(r, ms));
}

/** a failure worth trying again: a busy or failing server, no answer, a stream cut short */
const transient = (status: number) => status === 0 || status === 429 || status === 529 || status >= 500;
const retryable = (e: unknown) => (e instanceof ApiFailure ? !e.final && transient(e.status) : (e as Error).name !== 'AbortError');

/** the status of an error sent inside a stream (the Messages API's error types) */
const STREAM_STATUS: Record<string, number> = { overloaded_error: 529, rate_limit_error: 429, api_error: 500, timeout_error: 504 };

/** server-sent events of a response, as parsed JSON */
async function* sse(body: ReadableStream<Uint8Array<ArrayBuffer>>): AsyncGenerator<any> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value.replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      // the chat format ends its stream with [DONE]
      if (data && data !== '[DONE]') yield JSON.parse(data);
    }
  }
}

const toApi = (r: ToolResult) => r.content.map((c) => (c.type === 'image'
  ? { type: 'image', source: { type: 'base64', media_type: c.mimeType, data: c.data } }
  : { type: 'text', text: c.text || '(empty)' }));

const failed = (id: string, text: string): Block => ({ type: 'tool_result', tool_use_id: id, content: text, is_error: true });

/**
 * An answer where another model took over after a refusal (fallbacks): what
 * came before the last switch is not sent back but its text, the switch marks
 * are dropped.
 */
function afterFallback(blocks: Block[]): Block[] {
  const last = blocks.map((b) => b.type).lastIndexOf('fallback');
  if (last < 0) return blocks;
  return blocks.filter((b, i) => b.type !== 'fallback' && (i > last || b.type === 'text'));
}

/** one model's answer: its content blocks, why it stopped, the tool calls whose input could not be read */
interface Answer { content: Block[]; stop: string; invalid: Set<string>; declined?: string }

/** where a model of the chat format answers: /api/llm/<provider> (the key added on the way) or a local server */
export interface ChatTarget { url: string }

export interface TurnOptions {
  images?: { mediaType: string; data: string }[];
  target?: ChatTarget;
  effort?: Effort;
}

export class ServerSession {
  messages: Message[] = [];
  /** the parts each model refused in this session ("model part") */
  private refused = new Set<string>();

  constructor(saved?: Message[]) { if (saved) this.messages = saved; }

  /** what is kept with the project: no thinking, no images */
  toJSON(): Message[] {
    const out = this.messages.map((m) => ({
      role: m.role,
      content: m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking').map((b) => (b.type === 'tool_result' && Array.isArray(b.content)
        ? { ...b, content: b.content.map((c: Block) => (c.type === 'image' ? { type: 'text', text: '[image]' } : c)) }
        : b)),
    }));
    return out.filter((m) => m.content.length);
  }

  private pushUser(blocks: Block[]) {
    const last = this.messages.at(-1);
    if (last?.role === 'user') last.content.push(...blocks);
    else this.messages.push({ role: 'user', content: blocks });
  }

  /** a turn interrupted while tools were pending: answer them so the conversation stays well formed */
  private repair() {
    const last = this.messages.at(-1);
    if (last?.role !== 'assistant') return;
    const calls = last.content.filter((b) => b.type === 'tool_use');
    if (calls.length) this.pushUser(calls.map((b) => failed(b.id, INTERRUPTED)));
  }

  /**
   * An answer read from the start again when its stream breaks before
   * anything was shown (a server overloaded mid-way, a dropped connection).
   * Once the user saw part of it, the error is theirs to read.
   */
  private async *streamed(signal: AbortSignal, read: () => AsyncGenerator<AiEvent, Answer>): AsyncGenerator<AiEvent, Answer> {
    for (let attempt = 0; ; attempt++) {
      const answer = read();
      let shown = false;
      try {
        for (let r = await answer.next(); ; r = await answer.next()) {
          if (r.done) return r.value;
          shown = true;
          yield r.value;
        }
      } catch (e) {
        if (shown || signal.aborted || attempt >= RETRIES || !retryable(e)) throw e;
        await backoff(attempt);
      }
    }
  }

  /** whether the model still takes this part of a request */
  private takes(model: string, part: Part) { return !this.refused.has(`${model} ${part}`); }

  /**
   * Posts until the request goes through: a part the model refuses is dropped
   * and the request built again without it, a busy server is waited for.
   * `recover`: a last chance for a 400 (true: send again), tried first.
   */
  private async post(model: string, url: string, build: () => Attempt, signal: AbortSignal, recover?: (message: string) => boolean): Promise<Response> {
    for (let attempt = 0; ;) {
      const { headers, body, parts } = build();
      let res: Response;
      try {
        // a provider route gets the user's key on its way; a local model is called as it is
        res = await (url.startsWith('/api/') ? reach : fetch)(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        // no answer (network, server starting): tried again like a busy server
        if (attempt < RETRIES) { await backoff(attempt++); continue; }
        throw new ApiFailure(0, t('ai.urlDoesNotAnswer', { url, error: (e as Error).message }), true);
      }
      if (res.ok) return res;
      const message = await errorMessage(res);
      if (res.status === 400) {
        if (recover?.(message)) continue;
        const part = REFUSED.find(([p, re]) => parts.includes(p) && this.takes(model, p) && re.test(message))?.[0];
        if (part) { this.refused.add(`${model} ${part}`); continue; }
      }
      if (transient(res.status) && attempt < RETRIES) { await backoff(attempt++, res); continue; }
      throw new ApiFailure(res.status, message, true);
    }
  }

  async *turn(prompt: string, model: string, system: string, runner: ToolRunner, signal: AbortSignal, opts: TurnOptions = {}): AsyncGenerator<AiEvent> {
    this.repair();
    this.pushUser([...(opts.images ?? []).map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } })), { type: 'text', text: prompt }]);
    // chat models: the pictures of earlier turns are not sent again (they have no context editing)
    const turnStart = this.messages.length - 1;
    for (let step = 0; step < MAX_STEPS; step++) {
      const { content, stop, invalid, declined } = yield* this.streamed(signal, () => (providerOf(model) === 'anthropic'
        ? this.request(model, system, opts.effort ?? DEFAULT_EFFORT, signal)
        : this.chat(model, system, signal, opts.target!, turnStart, opts.effort)));
      // empty text blocks are refused when sent back
      const kept = content.filter((b) => !(b.type === 'text' && !b.text));
      this.messages.push({ role: 'assistant', content: kept.length ? kept : [{ type: 'text', text: '…' }] });
      const calls = kept.filter((b) => b.type === 'tool_use');
      if (stop === 'refusal') { yield { type: 'error', message: declined ? `${t('ai.declined')} (${declined})` : t('ai.declined') }; return; }
      if (!calls.length) {
        if (stop === 'max_tokens') yield { type: 'error', message: t('ai.answerCutOffLength') };
        return;
      }
      // cut off in the middle of its calls: none is run, the model hears why and goes on in smaller steps
      if (stop === 'max_tokens') {
        this.pushUser(calls.map((b) => failed(b.id, 'Your answer reached the length limit before this call was complete: nothing was run. Call again, in smaller steps (several propose_changes rather than one large one).')));
        continue;
      }
      const results: Block[] = [];
      for (const call of calls) {
        if (signal.aborted) { results.push(failed(call.id, INTERRUPTED)); continue; }
        if (invalid.has(call.id)) { results.push(failed(call.id, 'The input of this call was not valid JSON: nothing was run. Call again.')); continue; }
        const r = yield* runCall(runner, call.name, call.input ?? {}, signal);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: toApi(r), ...(r.isError ? { is_error: true } : {}) });
      }
      this.pushUser(results);
      if (signal.aborted) return;
    }
    yield { type: 'error', message: t('ai.stoppedAfterNSteps', { n: MAX_STEPS }) };
  }

  /** one streamed request to a model of the chat format; yields the text as it comes, returns the content blocks */
  private async *chat(model: string, system: string, signal: AbortSignal, target: ChatTarget, turnStart: number, effort?: Effort): AsyncGenerator<AiEvent, Answer> {
    const res = await this.post(model, `${target.url}/chat/completions`, () => {
      const vision = this.takes(model, 'vision'), level = effort && this.takes(model, 'effort') ? effort : undefined;
      return {
        // a model without vision gets a note instead of the images; one without levels runs at its own
        parts: ['vision', ...(level ? ['effort' as const] : [])],
        body: {
          model: modelName(model), stream: true, tools: CHAT_TOOLS,
          messages: toChat(this.messages, system, { vision, gemini: providerOf(model) === 'gemini', imagesFrom: turnStart }),
          // the effort level: reasoning_effort, or OpenRouter's own field
          ...(level ? (providerOf(model) === 'openrouter' ? { reasoning: { effort: level } } : { reasoning_effort: level }) : {}),
        },
      };
    }, signal);
    const reader = new ChatReader();
    let textId = '', thinkId = '';
    for await (const ev of sse(res.body!)) {
      const { text, reasoning } = reader.push(ev);
      if (reasoning) {
        if (!thinkId) { thinkId = uid(); yield { type: 'item', item: { id: thinkId, role: 'assistant', thinking: { text: '', start: Date.now() } } }; }
        yield { type: 'thinking', id: thinkId, delta: reasoning };
      }
      if (text) {
        if (thinkId) { yield { type: 'thinking-done', id: thinkId }; thinkId = ''; }
        if (!textId) { textId = uid(); yield { type: 'item', item: { id: textId, role: 'assistant', text: '' } }; }
        yield { type: 'text', id: textId, delta: text };
      }
    }
    if (thinkId) yield { type: 'thinking-done', id: thinkId };
    return reader.result();
  }

  /** a Messages API request: the conversation as it was sent before, plus the parts the model still takes */
  private attempt(model: string, system: string, effort: Effort): Attempt {
    const parts: Part[] = [];
    // a part is sent while the model takes it, and noted as sent
    const on = (part: Part) => this.takes(model, part) && !!parts.push(part);
    const adaptive = ADAPTIVE.has(model);
    // the Messages API refuses fields of its own blocks it does not know (Gemini's signatures)
    const clean = (b: Block) => (b.type === 'tool_use' && 'extra_content' in b ? { type: b.type, id: b.id, name: b.name, input: b.input } : b);
    // the cache covers the tools, the system prompt and the conversation so far
    const messages = this.messages.map((m) => ({ ...m, content: m.content.map(clean) })).map((m, i) => (i === this.messages.length - 1
      ? { ...m, content: m.content.map((b, j) => (j === m.content.length - 1 ? { ...b, cache_control: { type: 'ephemeral' } } : b)) }
      : m));
    const betas: string[] = [];
    let thinking: Record<string, unknown> | undefined;
    if (adaptive && on('thinking')) {
      thinking = { type: 'adaptive', ...(on('display') ? { display: 'summarized' } : {}) };
      // a block that would not match its history any more is dropped rather than failing the request
      if (on('binding')) { thinking.block_binding = { prefix_mismatch_behavior: 'drop_block' }; betas.push('thinking-binding-controls-2026-08-01'); }
    }
    const context = on('context');
    if (context) betas.push('context-management-2025-06-27');
    // a request Claude declines is run again by another model, on the server
    const fallbacks = adaptive && on('fallbacks');
    if (fallbacks) betas.push('server-side-fallback-2026-07-01');
    return {
      parts,
      headers: { 'anthropic-version': '2023-06-01', ...(betas.length ? { 'anthropic-beta': betas.join(',') } : {}) },
      body: {
        model, max_tokens: MAX_TOKENS, stream: true,
        // the system prompt is cached an hour: the user often takes longer than 5 minutes between two messages
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ...(on('hour') ? { ttl: '1h' } : {}) } }],
        tools: TOOL_SPECS, messages,
        ...(thinking ? { thinking } : {}),
        ...(adaptive && on('effort') ? { output_config: { effort } } : {}),
        ...(context ? { context_management: { edits: [CLEAR_OLD_RESULTS] } } : {}),
        ...(fallbacks ? { fallbacks: 'default' } : {}),
      },
    };
  }

  /** one streamed request; yields the text as it comes, returns the content blocks */
  private async *request(model: string, system: string, effort: Effort, signal: AbortSignal): AsyncGenerator<AiEvent, Answer> {
    let stripped = false;
    // thinking that no longer matches its history (the conversation was changed elsewhere): sent without it, once
    const recover = (message: string) => !stripped && /signature/i.test(message) && (stripped = true, this.stripThinking(), true);
    const res = await this.post(model, '/api/claude/v1/messages', () => this.attempt(model, system, effort), signal, recover);
    const blocks: Block[] = [];
    const json: string[] = [];
    const items: string[] = [];
    const invalid = new Set<string>();
    let stop = 'end_turn', declined: string | undefined;
    for await (const ev of sse(res.body!)) {
      if (ev.type === 'content_block_start') {
        blocks[ev.index] = { ...ev.content_block };
        if (ev.content_block.type === 'tool_use') { json[ev.index] = ''; blocks[ev.index].input = {}; }
        if (/thinking/.test(ev.content_block.type)) {
          items[ev.index] = uid();
          yield { type: 'item', item: { id: items[ev.index], role: 'assistant', thinking: { text: '', start: Date.now() } } };
        }
        if (ev.content_block.type === 'text') {
          items[ev.index] = uid();
          yield { type: 'item', item: { id: items[ev.index], role: 'assistant', text: ev.content_block.text ?? '' } };
        }
      } else if (ev.type === 'content_block_delta') {
        const b = blocks[ev.index], d = ev.delta;
        if (d.type === 'text_delta') { b.text = (b.text ?? '') + d.text; yield { type: 'text', id: items[ev.index], delta: d.text }; }
        else if (d.type === 'input_json_delta') json[ev.index] += d.partial_json;
        else if (d.type === 'thinking_delta') { b.thinking = (b.thinking ?? '') + d.thinking; yield { type: 'thinking', id: items[ev.index], delta: d.thinking }; }
        else if (d.type === 'signature_delta') b.signature = d.signature;
      } else if (ev.type === 'content_block_stop') {
        const b = blocks[ev.index];
        if (b?.type === 'tool_use') { try { b.input = json[ev.index] ? JSON.parse(json[ev.index]) : {}; } catch { b.input = {}; invalid.add(b.id); } }
        if (/thinking/.test(b?.type ?? '')) yield { type: 'thinking-done', id: items[ev.index] };
      } else if (ev.type === 'message_delta') {
        if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
        const details = ev.delta?.stop_details ?? ev.stop_details;
        if (details) declined = details.explanation || details.category || undefined;
      } else if (ev.type === 'error') {
        throw new ApiFailure(STREAM_STATUS[ev.error?.type] ?? 400, ev.error?.message ?? t('ai.serviceError'));
      }
    }
    return { content: afterFallback(blocks.filter(Boolean)), stop, invalid, declined };
  }

  /** the recovery when Claude's thinking no longer matches the conversation: the turns go on without it */
  private stripThinking() {
    for (const m of this.messages) {
      if (m.role !== 'assistant') continue;
      const rest = m.content.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking');
      m.content = rest.length ? rest : [{ type: 'text', text: '…' }];
    }
  }
}
