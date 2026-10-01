// The server side of the assistant: the browser talks to the Messages API
// through this route, which adds the key. The key never leaves the Worker.
// The conversation loop and the tools run in the editor.

import { HttpError, type Env } from './http.ts';

const ROUTES = new Set(['v1/messages', 'v1/messages/count_tokens']);
const PASS_UP = ['content-type', 'anthropic-version', 'anthropic-beta'];
const PASS_DOWN = ['content-type', 'request-id', 'retry-after', 'anthropic-ratelimit-requests-remaining', 'anthropic-ratelimit-tokens-remaining'];

export async function claude(req: Request, env: Env, rest: string) {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'no Anthropic key on the server (wrangler secret put ANTHROPIC_API_KEY)');
  if (req.method !== 'POST' || !ROUTES.has(rest)) throw new HttpError(404, 'unknown Claude route');
  const headers = new Headers({ 'x-api-key': env.ANTHROPIC_API_KEY });
  for (const h of PASS_UP) { const v = req.headers.get(h); if (v) headers.set(h, v); }
  if (!headers.has('anthropic-version')) headers.set('anthropic-version', '2023-06-01');
  const up = await fetch(`https://api.anthropic.com/${rest}`, { method: 'POST', headers, body: req.body, signal: req.signal });
  const down = new Headers({ 'cache-control': 'no-store' });
  for (const h of PASS_DOWN) { const v = up.headers.get(h); if (v) down.set(h, v); }
  return new Response(up.body, { status: up.status, headers: down });
}

export const claudeConfig = (env: Env) => ({ server: !!env.ANTHROPIC_API_KEY });

