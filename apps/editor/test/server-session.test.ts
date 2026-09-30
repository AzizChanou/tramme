import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServerSession } from '../src/ai/server.ts';
import type { ToolRunner } from '../src/ai/tools.ts';

/** a streamed Messages API response */
function sse(events: object[]): Response {
  const text = events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(new Blob([text]).stream(), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const first = () => sse([
  { type: 'message_start', message: { id: 'm1', role: 'assistant', content: [] } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Reading the document.' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Let me look.' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu1', name: 'evaluate', input: {} } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"address":"title.opacity",' } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"t":1}' } },
  { type: 'content_block_stop', index: 2 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
  { type: 'message_stop' },
]);
const second = () => sse([
  { type: 'message_start', message: { id: 'm2', role: 'assistant', content: [] } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Opacity: 1.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  { type: 'message_stop' },
]);

afterEach(() => { vi.unstubAllGlobals(); });

describe('assistant, server path', () => {
  it('loops over tools, sends back the signed thinking, keeps the conversation', async () => {
    const bodies: any[] = [];
    const responses = [first(), second()];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return responses.shift()!; }));
    const calls: [string, unknown][] = [];
    const runner = { events: [], run: async (name: string, input: unknown) => { calls.push([name, input]); return { content: [{ type: 'text', text: '1' }] }; } } as unknown as ToolRunner;
    const s = new ServerSession();
    const events = [];
    for await (const ev of s.turn('What opacity?', 'claude-opus-5-5', 'system prompt', runner, new AbortController().signal)) events.push(ev);

    expect(calls).toEqual([['evaluate', { address: 'title.opacity', t: 1 }]]);
    expect(events.map((e) => e.type)).toEqual(['item', 'thinking', 'thinking-done', 'item', 'text', 'item', 'tool-done', 'item', 'text']);
    expect(bodies[0].thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(bodies[0].system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(bodies[0].tools.some((t: any) => t.name === 'propose_changes' && t.input_schema.properties.ops)).toBe(true);
    // the second request carries the signed thinking back, then the tool result, cached up to it
    const [, assistant, results] = bodies[1].messages;
    expect(assistant.content[0]).toEqual({ type: 'thinking', thinking: 'Reading the document.', signature: 'sig' });
    expect(results.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu1', cache_control: { type: 'ephemeral' } });
    // what is saved with the project: no thinking
    const saved = s.toJSON();
    expect(saved.length).toBe(4);
    expect(saved[1].content.some((b) => b.type === 'thinking')).toBe(false);
  });

  it('Haiku 4.5 without adaptive thinking; an interrupted turn stays well formed', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return second(); }));
    const runner = { events: [], run: async () => ({ content: [] }) } as unknown as ToolRunner;
    const s = new ServerSession([{ role: 'user', content: [{ type: 'text', text: 'avant' }] }, { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'get_document', input: {} }] }]);
    for await (const _ of s.turn('go on', 'claude-haiku-4-5-20251001', 'system prompt', runner, new AbortController().signal)) { /* drain */ }
    expect(bodies[0].thinking).toBeUndefined();
    const repaired = bodies[0].messages[2];
    expect(repaired.role).toBe('user');
    expect(repaired.content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'x', is_error: true });
    expect(repaired.content[1]).toMatchObject({ type: 'text', text: 'go on' });
  });
});
