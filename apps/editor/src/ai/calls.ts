// One tool call as the conversation shows it, whichever path asked for it
// (the server's loop, the local companion, the / menu): its activity line,
// what the tool adds to the conversation (pictures, proposals, reloads), then
// its result. A long tool's progress is shown on its line while it runs.

import { SILENT, TOOLS, type ToolResult } from '@tramme/assistant';
import type { AiEvent, ToolProgress } from '../api.ts';
import type { ToolRunner } from './tools.ts';

/** a short random id, for the conversation's items */
export const uid = () => Math.random().toString(36).slice(2, 10);

/** the activity line of a call, as the user reads it */
export const activity = (name: string, input: Record<string, unknown>) => TOOLS.find((x) => x.name === name)?.label(input) ?? name;

/** runs the call; yields its activity (none for the proposals, shown as a card) and what the tool added, returns its result */
export async function* runCall(runner: ToolRunner, name: string, input: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<AiEvent, ToolResult> {
  const item = SILENT.has(name) ? '' : uid();
  if (item) yield { type: 'item', item: { id: item, role: 'assistant', tool: { name, summary: activity(name, input) } } };
  // the tool runs while its progress, the last reported, is yielded as it comes
  const state: { latest: ToolProgress | null; done: boolean; wake: (() => void) | null } = { latest: null, done: false, wake: null };
  runner.onProgress = (done, total, step) => { state.latest = { done, total, step }; state.wake?.(); };
  const running = runner.run(name, input, signal).finally(() => { state.done = true; state.wake?.(); });
  try {
    while (!state.done || state.latest) {
      await new Promise<void>((resolve) => { state.wake = resolve; if (state.done || state.latest) resolve(); });
      state.wake = null;
      if (state.latest && item) yield { type: 'tool-progress', id: item, progress: state.latest };
      state.latest = null;
    }
  } finally {
    runner.onProgress = null;
  }
  const r = await running;
  yield* runner.events.splice(0);
  if (item) yield { type: 'tool-done', id: item, error: !!r.isError };
  return r;
}
