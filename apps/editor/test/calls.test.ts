import { describe, expect, it } from 'vitest';
import type { AiEvent } from '../src/api.ts';
import { runCall } from '../src/ai/calls.ts';
import type { ToolRunner } from '../src/ai/tools.ts';

/** a runner whose tool reports its progress three times, then answers */
function runner() {
  const r = {
    events: [] as AiEvent[],
    onProgress: null as ToolRunner['onProgress'],
    async run() {
      for (let k = 1; k <= 3; k++) { await new Promise((ok) => setTimeout(ok, 5)); r.onProgress?.(k, 3, 'step'); }
      return { content: [{ type: 'text', text: 'done' }] };
    },
  };
  return r;
}

describe('a tool call', () => {
  it('shows the progress of the tool while it runs, then its end', async () => {
    const r = runner(), seen: AiEvent[] = [];
    const calls = runCall(r as unknown as ToolRunner, 'use_tool', { name: 'cutout' });
    for (;;) { const n = await calls.next(); if (n.done) { expect(n.value).toMatchObject({ content: [{ text: 'done' }] }); break; } seen.push(n.value); }
    expect(seen.map((e) => e.type)).toEqual(['item', 'tool-progress', 'tool-progress', 'tool-progress', 'tool-done']);
    expect(seen[3]).toMatchObject({ progress: { done: 3, total: 3, step: 'step' } });
    expect(r.onProgress).toBeNull();
  });
});
