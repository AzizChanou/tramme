// The server path: the Messages API through the Worker (/api/claude), which
// adds the key. The conversation loop runs here: Claude asks for tools, the
// editor runs them, sends the results, until Claude answers. The same loop
// drives the models in the OpenAI chat format (other providers through the
// Worker, local models directly): see compat.ts.

import { z } from 'zod';
import { ADAPTIVE, modelName, providerOf, SILENT, TOOLS, type ToolResult } from '@tramme/assistant';
import { ChatReader, chatTools, toChat } from './compat.ts';
import type { AiEvent } from '../api.ts';
import type { ToolRunner } from './tools.ts';
import { t } from '../i18n/index.ts';

type Block = { type: string; [k: string]: any };
export interface Message { role: 'user' | 'assistant'; content: Block[] }

const MAX_STEPS = 40;
const uid = () => Math.random().toString(36).slice(2, 10);

const TOOL_SPECS = TOOLS.map((t) => {
  const { $schema: _, ...schema } = z.toJSONSchema(t.schema) as Record<string, unknown>;
  return { name: t.name, description: t.description, input_schema: schema };
});

const CHAT_TOOLS = chatTools(TOOL_SPECS);

class ApiFailure extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

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

/** images already seen in earlier turns are not sent again */
function forgetImages(messages: Message[]) {
  for (const m of messages) {
    if (m.role !== 'user') continue;
    for (const b of m.content) {
      if (b.type === 'tool_result' && Array.isArray(b.content) && b.content.some((c: Block) => c.type === 'image')) {
        b.content = b.content.map((c: Block) => (c.type === 'image' ? { type: 'text', text: '[frame rendered earlier in the conversation]' } : c));
      }
    }
    // images joined to earlier messages
    m.content = m.content.map((b) => (b.type === 'image' ? { type: 'text', text: '[image attached earlier in the conversation]' } : b));
  }
}

/** where a model of the chat format answers: /api/llm/<provider> (the Worker adds the key) or a local server */
export interface ChatTarget { url: string }

export class ServerSession {
  messages: Message[] = [];
  /** chat models that refused images: they get a note instead */
  private noVision = new Set<string>();
  /** 2: adaptive thinking with its summary shown, 1: without the summary, 0: none (the API refused the richer ones) */
  private thinkingLevel = 2;

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
    if (calls.length) this.pushUser(calls.map((b) => ({ type: 'tool_result', tool_use_id: b.id, content: 'Interrupted by the user.', is_error: true })));
  }

  async *turn(prompt: string, model: string, system: string, runner: ToolRunner, signal: AbortSignal, images: { mediaType: string; data: string }[] = [], target?: ChatTarget): AsyncGenerator<AiEvent> {
    this.repair();
    forgetImages(this.messages);
    this.pushUser([...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.data } })), { type: 'text', text: prompt }]);
    for (let step = 0; step < MAX_STEPS; step++) {
      const { content, stop } = providerOf(model) === 'anthropic' ? yield* this.request(model, system, signal) : yield* this.chat(model, system, signal, target!);
      // empty text blocks are refused when sent back
      const kept = content.filter((b) => !(b.type === 'text' && !b.text));
      this.messages.push({ role: 'assistant', content: kept.length ? kept : [{ type: 'text', text: '…' }] });
      if (stop === 'max_tokens') yield { type: 'error', message: t('ai.answerCutOffLength') };
      if (stop !== 'tool_use') return;
      const results: Block[] = [];
      for (const call of content.filter((b) => b.type === 'tool_use')) {
        const item = SILENT.has(call.name) ? '' : uid();
        if (item) yield { type: 'item', item: { id: item, role: 'assistant', tool: { name: call.name, summary: TOOLS.find((t) => t.name === call.name)?.label(call.input ?? {}) ?? call.name } } };
        const r = await runner.run(call.name, call.input ?? {}, signal);
        yield* runner.events.splice(0);
        if (item) yield { type: 'tool-done', id: item, error: !!r.isError };
        results.push({ type: 'tool_result', tool_use_id: call.id, content: toApi(r), ...(r.isError ? { is_error: true } : {}) });
        if (signal.aborted) break;
      }
      this.pushUser(results);
      if (signal.aborted) return;
    }
    yield { type: 'error', message: t('ai.stoppedAfterNSteps', { n: MAX_STEPS }) };
  }

  /** one streamed request to a model of the chat format; yields the text as it comes, returns the content blocks */
  private async *chat(model: string, system: string, signal: AbortSignal, target: ChatTarget): AsyncGenerator<AiEvent, { content: Block[]; stop: string }> {
    let res: Response | null = null;
    for (let attempt = 0; ; attempt++) {
      const body = { model: modelName(model), stream: true, messages: toChat(this.messages, system, !this.noVision.has(model), providerOf(model) === 'gemini'), tools: CHAT_TOOLS };
      try {
        res = await fetch(`${target.url}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        throw new ApiFailure(0, t('ai.urlDoesNotAnswer', { url: target.url, error: (e as Error).message }));
      }
      if (res.ok) break;
      let message = `HTTP ${res.status}`;
      try { const j = await res.json(); const err = Array.isArray(j) ? j[0]?.error : j.error; message = err?.message ?? (typeof err === 'string' ? err : message); } catch { /* not JSON */ }
      // a model without vision: once more, the images replaced by a note
      if (res.status === 400 && !this.noVision.has(model) && /image|vision|multimodal/i.test(message)) { this.noVision.add(model); continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) ** 2)); continue; }
      throw new ApiFailure(res.status, message);
    }
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

  /** one streamed request; yields the text as it comes, returns the content blocks */
  private async *request(model: string, system: string, signal: AbortSignal): AsyncGenerator<AiEvent, { content: Block[]; stop: string }> {
    // the Messages API refuses fields of its own blocks it does not know (Gemini's signatures)
    const clean = (b: Block) => (b.type === 'tool_use' && 'extra_content' in b ? { type: b.type, id: b.id, name: b.name, input: b.input } : b);
    // the cache covers the tools, the system prompt and the conversation so far
    const messages = this.messages.map((m) => ({ ...m, content: m.content.map(clean) })).map((m, i) => (i === this.messages.length - 1
      ? { ...m, content: m.content.map((b, j) => (j === m.content.length - 1 ? { ...b, cache_control: { type: 'ephemeral' } } : b)) }
      : m));
    const level = ADAPTIVE.has(model) ? this.thinkingLevel : 0;
    const body = {
      model, max_tokens: 16000, stream: true,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      tools: TOOL_SPECS, messages,
      ...(level === 2 ? { thinking: { type: 'adaptive', display: 'summarized' } } : level === 1 ? { thinking: { type: 'adaptive' } } : {}),
    };
    let res: Response | null = null;
    for (let attempt = 0; ; attempt++) {
      res = await fetch('/api/claude/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body), signal });
      if (res.ok) break;
      let message = `HTTP ${res.status}`;
      try { const j = await res.json(); message = j.error?.message ?? j.error ?? message; } catch { /* not JSON */ }
      if (res.status === 400 && level > 0 && /thinking|display/i.test(message)) { this.thinkingLevel = level - 1; return yield* this.request(model, system, signal); }
      if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 2) { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1) ** 2)); continue; }
      throw new ApiFailure(res.status, message);
    }
    const blocks: Block[] = [];
    const json: string[] = [];
    const items: string[] = [];
    let stop = 'end_turn';
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
        if (b?.type === 'tool_use') { try { b.input = json[ev.index] ? JSON.parse(json[ev.index]) : {}; } catch { b.input = {}; } }
        if (/thinking/.test(b?.type ?? '')) yield { type: 'thinking-done', id: items[ev.index] };
      } else if (ev.type === 'message_delta') {
        if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
      } else if (ev.type === 'error') {
        throw new ApiFailure(500, ev.error?.message ?? t('ai.serviceError'));
      }
    }
    return { content: blocks.filter(Boolean), stop };
  }
}
