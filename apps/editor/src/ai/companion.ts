// The local path: the companion (`tramme agent`) runs Claude with the
// Agent SDK on the user's machine and their Claude Code login. It streams the
// turn back as NDJSON; each tool call is run here and its result posted back.

import { SILENT, TOOLS } from '@tramme/assistant';
import type { AiEvent } from '../api.ts';
import type { ToolRunner } from './tools.ts';
import { t } from '../i18n/index.ts';

const uid = () => Math.random().toString(36).slice(2, 10);

export interface CompanionLink { url: string; token: string }

const headers = (link: CompanionLink) => ({ authorization: `Bearer ${link.token}`, 'content-type': 'application/json' });

/** 'ok', 'unpaired' (wrong or missing token), or 'absent' (not running, or refused by the browser) */
export async function probeCompanion(link: CompanionLink): Promise<'ok' | 'unpaired' | 'absent'> {
  try {
    const r = await fetch(`${link.url}/health`, { headers: headers(link), signal: AbortSignal.timeout(2500) });
    if (r.status === 401) return 'unpaired';
    return r.ok ? 'ok' : 'absent';
  } catch { return 'absent'; }
}

/** the token, given by the companion to an editor whose address it was started with (--origin); null otherwise */
export async function pairCompanion(url: string): Promise<string | null> {
  try {
    const r = await fetch(`${url}/pair`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const { token } = await r.json() as { token?: unknown };
    return typeof token === 'string' && token.length >= 32 ? token : null;
  } catch { return null; }
}

export function stopCompanion(link: CompanionLink) {
  fetch(`${link.url}/stop`, { method: 'POST', headers: headers(link) }).catch(() => {});
}

async function* ndjson(body: ReadableStream<Uint8Array<ArrayBuffer>>): AsyncGenerator<any> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buf.trim()) yield JSON.parse(buf);
}

export async function* companionTurn(
  link: CompanionLink,
  req: { prompt: string; system: string; model: string; effort?: string; sessionId?: string; images?: { mediaType: string; data: string }[] },
  runner: ToolRunner,
  signal: AbortSignal,
  onSession: (id: string) => void,
): AsyncGenerator<AiEvent> {
  const r = await fetch(`${link.url}/turn`, { method: 'POST', headers: headers(link), body: JSON.stringify(req), signal });
  if (!r.ok || !r.body) {
    let message = t('common.companionHttpStatus', { status: r.status });
    try { message = (await r.json()).error ?? message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  const texts = new Map<string, string>();
  for await (const ev of ndjson(r.body)) {
    if (ev.type === 'session') onSession(ev.id);
    else if (ev.type === 'text-start') {
      const id = uid();
      texts.set(ev.key, id);
      yield { type: 'item', item: { id, role: 'assistant', text: ev.text ?? '' } };
    } else if (ev.type === 'thinking-start') {
      const id = uid();
      texts.set(ev.key, id);
      yield { type: 'item', item: { id, role: 'assistant', thinking: { text: '', start: Date.now() } } };
    } else if (ev.type === 'thinking') {
      const id = texts.get(ev.key);
      if (id) yield { type: 'thinking', id, delta: ev.delta };
    } else if (ev.type === 'thinking-stop') {
      const id = texts.get(ev.key);
      if (id) yield { type: 'thinking-done', id };
    } else if (ev.type === 'text') {
      const id = texts.get(ev.key);
      if (id) yield { type: 'text', id, delta: ev.delta };
    } else if (ev.type === 'tool') {
      const item = SILENT.has(ev.name) ? '' : uid();
      if (item) yield { type: 'item', item: { id: item, role: 'assistant', tool: { name: ev.name, summary: TOOLS.find((t) => t.name === ev.name)?.label(ev.input ?? {}) ?? ev.name } } };
      const result = await runner.run(ev.name, ev.input ?? {}, signal);
      yield* runner.events.splice(0);
      if (item) yield { type: 'tool-done', id: item, error: !!result.isError };
      await fetch(`${link.url}/tool-result`, { method: 'POST', headers: headers(link), body: JSON.stringify({ callId: ev.callId, result }), signal });
    } else if (ev.type === 'error') yield { type: 'error', message: ev.message };
    else if (ev.type === 'done') return;
  }
}
