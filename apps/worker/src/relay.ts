// The relay of the personal mode: the key vault calls most providers
// directly from the visitor's browser; those that refuse calls from a
// browser (Z.AI, custom providers) are reached through here. The request goes
// on as it came, key included, and nothing of it is kept or logged (the
// Worker's invocation logs are off in this mode, see wrangler.jsonc).
//
//   GET|POST /relay   x-tramme-target: the provider's address; the other headers and the body passed on

import { HttpError, type Env } from './http.ts';

/** the headers a provider needs: the format, the keys as each provider takes them */
const PASS_UP = ['content-type', 'accept', 'authorization', 'x-api-key', 'x-goog-api-key', 'xi-api-key', 'anthropic-version', 'anthropic-beta', 'x-title', 'http-referer'];
const PASS_DOWN = ['content-type', 'retry-after', 'x-request-id', 'request-id'];
/** a conversation with its pictures, or a sound to say: well under this */
const MAX_BODY = 20 * 1024 * 1024;

export async function relay(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'POST') throw new HttpError(405, 'relay: GET or POST');
  // only the vault's own page, never another site through a visitor's browser
  if (req.headers.get('sec-fetch-site') !== 'same-origin') throw new HttpError(403, 'relay: for the key vault only');
  if (env.RELAY_LIMIT) {
    const { success } = await env.RELAY_LIMIT.limit({ key: req.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!success) throw new HttpError(429, 'relay: too many requests, wait a minute');
  }
  let target: URL;
  try { target = new URL(req.headers.get('x-tramme-target') ?? ''); } catch { throw new HttpError(400, 'relay: x-tramme-target is not an address'); }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new HttpError(400, 'relay: http(s) addresses only');
  if (req.method === 'POST') {
    const length = req.headers.get('content-length');
    if (length === null) throw new HttpError(411, 'relay: the body must say its length');
    if (Number(length) > MAX_BODY) throw new HttpError(413, 'relay: body too large');
  }
  const headers = new Headers();
  for (const h of PASS_UP) { const v = req.headers.get(h); if (v) headers.set(h, v); }
  const up = await fetch(target, { method: req.method, headers, body: req.method === 'POST' ? req.body : undefined, signal: req.signal });
  const down = new Headers({ 'cache-control': 'no-store' });
  for (const h of PASS_DOWN) { const v = up.headers.get(h); if (v) down.set(h, v); }
  return new Response(up.body, { status: up.status, headers: down });
}
