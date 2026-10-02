import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerSession } from '../src/ai/server.ts';
import type { ToolRunner } from '../src/ai/tools.ts';

/** a streamed Messages API response */
function sse(events: object[]): Response {
  const text = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(new Blob([text]).stream(), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const refusedWith = (message: string) => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }), { status: 400 });

/** an answer: its blocks (text, thinking, tool_use with its raw JSON), then why it stopped */
function answer(blocks: ({ text: string } | { thinking: string } | { tool: string; id: string; json: string } | { fallback: true })[], stop = 'end_turn', extra: object = {}) {
  const events: object[] = [{ type: 'message_start', message: { id: 'm', role: 'assistant', content: [] } }];
  blocks.forEach((b, index) => {
    if ('text' in b) events.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index, delta: { type: 'text_delta', text: b.text } });
    else if ('thinking' in b) events.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } }, { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: b.thinking } }, { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: 'sig' } });
    else if ('tool' in b) events.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: b.id, name: b.tool, input: {} } }, { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: b.json } });
    else events.push({ type: 'content_block_start', index, content_block: { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } } });
    events.push({ type: 'content_block_stop', index });
  });
  events.push({ type: 'message_delta', delta: { stop_reason: stop, ...extra } }, { type: 'message_stop' });
  return sse(events);
}

const first = () => answer([{ thinking: 'Reading the document.' }, { text: 'Let me look.' }, { tool: 'evaluate', id: 'tu1', json: '{"address":"title.opacity","t":1}' }], 'tool_use');
const second = () => answer([{ text: 'Opacity: 1.' }]);

interface Sent { body: any; headers: Record<string, string> }
function serve(...responses: (() => Response)[]): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    sent.push({ body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    const next = responses.shift();
    if (!next) throw new Error('no more answers');
    return next();
  }));
  return sent;
}

function fakeRunner(result = (name: string): { content: { type: 'text'; text: string }[] } => ({ content: [{ type: 'text', text: name }] }), onRun?: (name: string) => void) {
  const calls: [string, unknown][] = [];
  const runner = { events: [], run: async (name: string, input: unknown) => { calls.push([name, input]); onRun?.(name); return result(name); } } as unknown as ToolRunner;
  return { runner, calls };
}

async function drain(gen: AsyncGenerator<any>) { const events: any[] = []; for await (const ev of gen) events.push(ev); return events; }
const go = (s: ServerSession, runner: ToolRunner, prompt = 'What opacity?', model = 'claude-opus-5-5', signal = new AbortController().signal) => drain(s.turn(prompt, model, 'system prompt', runner, signal));

/** the conversation as sent, without the cache marks (they move, the content does not) */
const unmarked = (messages: any[]) => JSON.parse(JSON.stringify(messages, (k, v) => (k === 'cache_control' ? undefined : v)));

afterEach(() => { vi.unstubAllGlobals(); });

describe('assistant, server path', () => {
  it('loops over tools, sends back the signed thinking, keeps the conversation', async () => {
    const sent = serve(first, second);
    const { runner, calls } = fakeRunner(() => ({ content: [{ type: 'text', text: '1' }] }));
    const s = new ServerSession();
    const events = await go(s, runner);

    expect(calls).toEqual([['evaluate', { address: 'title.opacity', t: 1 }]]);
    expect(events.map((e) => e.type)).toEqual(['item', 'thinking', 'thinking-done', 'item', 'text', 'item', 'tool-done', 'item', 'text']);
    // the second request carries the signed thinking back, then the tool result, cached up to it
    const [, assistant, results] = sent[1].body.messages;
    expect(assistant.content[0]).toEqual({ type: 'thinking', thinking: 'Reading the document.', signature: 'sig' });
    expect(results.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu1', cache_control: { type: 'ephemeral' } });
    // what is saved with the project: no thinking
    const saved = s.toJSON();
    expect(saved.length).toBe(4);
    expect(saved[1].content.some((b) => b.type === 'thinking')).toBe(false);
  });

  it('asks Opus for its effort, its thinking summarized and kept bound, the old results cleared by the API', async () => {
    const sent = serve(second);
    await go(new ServerSession(), fakeRunner().runner);
    const { body, headers } = sent[0];
    expect(body.max_tokens).toBe(64000);
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized', block_binding: { prefix_mismatch_behavior: 'drop_block' } });
    expect(body.output_config).toEqual({ effort: 'high' });
    expect(body.context_management.edits[0]).toMatchObject({ type: 'clear_tool_uses_20250919', exclude_tools: expect.arrayContaining(['propose_changes']) });
    expect(body.fallbacks).toBe('default');
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(headers['anthropic-beta'].split(',').sort()).toEqual(['context-management-2025-06-27', 'server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01']);
    expect(body.tools.some((t: any) => t.name === 'propose_changes' && t.input_schema.properties.ops)).toBe(true);
  });

  it('takes the effort chosen in the settings', async () => {
    const sent = serve(second);
    await drain(new ServerSession().turn('Hi', 'claude-sonnet-5-5', 'system prompt', fakeRunner().runner, new AbortController().signal, { effort: 'max' }));
    expect(sent[0].body.output_config).toEqual({ effort: 'max' });
  });

  it('Haiku 4.5 without adaptive thinking nor effort; an interrupted turn stays well formed', async () => {
    const sent = serve(second);
    const s = new ServerSession([{ role: 'user', content: [{ type: 'text', text: 'avant' }] }, { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'get_document', input: {} }] }]);
    await go(s, fakeRunner().runner, 'go on', 'claude-haiku-4-5-20251001');
    const { body, headers } = sent[0];
    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
    expect(body.fallbacks).toBeUndefined();
    expect(headers['anthropic-beta']).toBe('context-management-2025-06-27');
    const repaired = body.messages[2];
    expect(repaired.role).toBe('user');
    expect(repaired.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'x', is_error: true });
    expect(repaired.content[1]).toMatchObject({ type: 'text', text: 'go on' });
  });

  it('never changes what it sent: the next message carries the same history, pictures included', async () => {
    const frame = () => answer([{ thinking: 'Let me see it.' }, { tool: 'render_still', id: 'r1', json: '{"t":1}' }], 'tool_use');
    const sent = serve(frame, second, second);
    const { runner } = fakeRunner(() => ({ content: [{ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }] }) as never);
    const s = new ServerSession();
    await go(s, runner, 'Show me.');
    await go(s, runner, 'And now?');
    const before = unmarked(sent[1].body.messages), after = unmarked(sent[2].body.messages);
    expect(after.slice(0, before.length + 1)).toEqual([...before, ...unmarked(s.messages.slice(before.length, before.length + 1))]);
    expect(JSON.stringify(after)).toContain('"data":"AAAA"');
  });

  it('answers every call when the user stops in the middle of them', async () => {
    const two = () => answer([{ tool: 'evaluate', id: 'a', json: '{"address":"x","t":0}' }, { tool: 'evaluate', id: 'b', json: '{"address":"y","t":0}' }], 'tool_use');
    serve(two);
    const stop = new AbortController();
    const { runner, calls } = fakeRunner(undefined, () => stop.abort());
    const s = new ServerSession();
    await go(s, runner, 'Values?', 'claude-opus-5-5', stop.signal);
    expect(calls.length).toBe(1);
    const results = s.messages.at(-1)!.content;
    expect(results.map((b) => [b.tool_use_id, !!b.is_error])).toEqual([['a', false], ['b', true]]);
  });

  it('runs no call whose input is not valid JSON, and tells the model', async () => {
    const broken = () => answer([{ tool: 'propose_changes', id: 'p', json: '{"label":"Ti' }], 'tool_use');
    const sent = serve(broken, second);
    const { runner, calls } = fakeRunner();
    await go(new ServerSession(), runner);
    expect(calls).toEqual([]);
    expect(sent[1].body.messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'p', is_error: true, content: expect.stringContaining('not valid JSON') });
  });

  it('goes on after an answer cut off in the middle of a call, in smaller steps', async () => {
    const cut = () => answer([{ text: 'Building it.' }, { tool: 'propose_changes', id: 'p', json: '{"label":"Big","ops":[' }], 'max_tokens');
    const sent = serve(cut, second);
    const { runner, calls } = fakeRunner();
    const events = await go(new ServerSession(), runner);
    expect(calls).toEqual([]);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(sent[1].body.messages.at(-1).content[0]).toMatchObject({ tool_use_id: 'p', is_error: true, content: expect.stringContaining('smaller steps') });
  });

  it('drops a part of the request the API refuses, for the rest of the session', async () => {
    const sent = serve(() => refusedWith('context_management: Extra inputs are not permitted'), second, second);
    const s = new ServerSession();
    await go(s, fakeRunner().runner);
    await go(s, fakeRunner().runner, 'Again');
    expect(sent[0].body.context_management).toBeDefined();
    expect(sent[1].body.context_management).toBeUndefined();
    expect(sent[1].headers['anthropic-beta']).not.toContain('context-management');
    expect(sent[1].body.output_config).toEqual({ effort: 'high' });
    expect(sent[2].body.context_management).toBeUndefined();
  });

  it('sends the conversation without its thinking, once, when the API says it no longer matches', async () => {
    const sent = serve(first, () => refusedWith('messages.1.content.0: Invalid `signature` in `thinking` block. The block is bound to a different conversation.'), second);
    await go(new ServerSession(), fakeRunner().runner);
    expect(sent[1].body.messages[1].content[0].type).toBe('thinking');
    expect(JSON.stringify(sent[2].body.messages)).not.toContain('"thinking"');
    // the request itself is unchanged: still thinking, still bound
    expect(sent[2].body.thinking.block_binding).toBeDefined();
  });

  it('gives the chat-format models their effort level, in each provider\'s field, and drops it when refused', async () => {
    const said = () => new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    const chatTurn = (s: ServerSession, model: string, effort?: 'low' | 'high') => drain(s.turn('Hi', model, 'system prompt', fakeRunner().runner, new AbortController().signal, { target: { url: '/api/llm/x' }, effort }));

    let sent = serve(said);
    await chatTurn(new ServerSession(), 'openai:gpt-5', 'low');
    expect(sent[0].body.reasoning_effort).toBe('low');

    sent = serve(said);
    await chatTurn(new ServerSession(), 'openrouter:deepseek/deepseek-r1', 'high');
    expect(sent[0].body.reasoning).toEqual({ effort: 'high' });
    expect(sent[0].body.reasoning_effort).toBeUndefined();

    sent = serve(said);
    await chatTurn(new ServerSession(), 'openai:gpt-5');
    expect(sent[0].body).not.toHaveProperty('reasoning_effort');

    const s = new ServerSession();
    sent = serve(() => refusedWith("Unsupported value: 'reasoning_effort' does not support 'low' with this model."), said, said);
    await chatTurn(s, 'local:gpt-oss:20b', 'low');
    await chatTurn(s, 'local:gpt-oss:20b', 'low');
    expect(sent.map((x) => x.body.reasoning_effort)).toEqual(['low', undefined, undefined]);
  });

  it('says when Claude declines, and keeps only the text of an answer another model took over', async () => {
    serve(() => answer([{ text: 'Sorry.' }], 'refusal', { stop_details: { type: 'refusal', category: null, explanation: 'not allowed' } }));
    const events = await go(new ServerSession(), fakeRunner().runner);
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Claude declined this request (not allowed)' });

    const taken = () => answer([{ thinking: 'hm' }, { text: 'Part.' }, { tool: 'evaluate', id: 'z', json: '{"address":"x","t":0}' }, { fallback: true }, { text: 'Done.' }]);
    serve(taken);
    const s = new ServerSession();
    await go(s, fakeRunner().runner);
    expect(s.messages.at(-1)!.content).toEqual([{ type: 'text', text: 'Part.' }, { type: 'text', text: 'Done.' }]);
  });
});
