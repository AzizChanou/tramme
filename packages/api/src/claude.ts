// The Messages API with the Anthropic key added (settings or secret, see
// keys.ts): the editor sends its request here, and the key never reaches it.
// The conversation loop and the tools run in the editor.

import { HttpError } from './http.ts';
import type { Keys } from './keys.ts';
import type { Reach } from './providers.ts';

const ROUTES = new Set(['v1/messages', 'v1/messages/count_tokens']);
const PASS_UP = ['content-type', 'anthropic-version', 'anthropic-beta'];
const PASS_DOWN = ['content-type', 'request-id', 'retry-after', 'anthropic-ratelimit-requests-remaining', 'anthropic-ratelimit-tokens-remaining'];

export async function claude(req: Request, { keys, fetch }: Reach, rest: string) {
  const key = keys.get('anthropic');
  if (!key) throw new HttpError(503, `no Anthropic key: ${keys.how(['anthropic'])}`);
  if (req.method !== 'POST' || !ROUTES.has(rest)) throw new HttpError(404, 'unknown Claude route');
  const headers = new Headers({ 'x-api-key': key });
  for (const h of PASS_UP) { const v = req.headers.get(h); if (v) headers.set(h, v); }
  if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01');
  // read whole: a browser cannot send a streamed body everywhere (the key vault)
  const up = await fetch(`https://api.anthropic.com/${rest}`, { method: 'POST', headers, body: await req.arrayBuffer(), signal: req.signal });
  const down = new Headers({ 'cache-control': 'no-store' });
  for (const h of PASS_DOWN) { const v = up.headers.get(h); if (v) down.set(h, v); }
  return new Response(up.body, { status: up.status, headers: down });
}

export const claudeConfig = (keys: Keys) => ({ server: !!keys.get('anthropic') });
