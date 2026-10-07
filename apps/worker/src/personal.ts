// The personal mode: anyone uses the app without an account, and the server
// keeps nothing. The visitor's projects live in their browser (IndexedDB,
// served by the editor's service worker), their keys in the key vault: a page
// of another origin of the same site, which the editor and its plugins cannot
// read, and which calls the providers itself.
//
// The Worker answers two addresses:
//   APP_ORIGIN     the editor; /api/config says the mode, no other /api route
//   VAULT_ORIGIN   the vault's page (/ and /settings), its assets, and /relay
// Any other address of the Worker (workers.dev, previews) sends to APP_ORIGIN.

import { LIMITS, PROJECT_FORMAT } from '@tramme/project';
import { BROWSER_DIRECT, failure, HttpError, json } from '@tramme/api';
import type { Env } from './http.ts';
import { relay } from './relay.ts';

/** the vault's page: its own scripts, the providers it calls, framed by the editor only */
function vaultPolicy(app: string) {
  return [
    "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self' data:", "img-src 'self' data:",
    `connect-src 'self' ${BROWSER_DIRECT.join(' ')}`, `frame-ancestors ${app}`, "base-uri 'none'", "form-action 'none'",
  ].join('; ');
}

async function vaultHost(req: Request, env: Env, url: URL, app: string): Promise<Response> {
  if (url.pathname === '/relay') return relay(req, env);
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
  if (url.pathname === '/' || url.pathname === '/settings') {
    const page = await env.ASSETS.fetch(new Request(new URL('/vault.html', url)));
    if (!page.ok) throw new HttpError(500, 'the vault page is missing from the build');
    // the editor's address, the only one the vault answers
    const html = (await page.text()).replace('%APP_ORIGIN%', attr(app));
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'content-security-policy': vaultPolicy(app), 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
  }
  // the vault's scripts and styles; never a page of the editor at this address (its plugins would read the keys)
  if (url.pathname.startsWith('/assets/')) {
    const res = await env.ASSETS.fetch(req);
    // 304: the browser has it already (the hidden vault loaded it before the settings' one)
    if (res.status === 304 || (res.ok && !(res.headers.get('content-type') ?? '').startsWith('text/html'))) return res;
  }
  throw new HttpError(404, 'not found');
}

export async function personal(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const app = env.APP_ORIGIN, vault = env.VAULT_ORIGIN;
  try {
    if (!app || !vault) throw new HttpError(503, 'personal mode: set APP_ORIGIN and VAULT_ORIGIN (apps/worker/wrangler.jsonc)');
    if (url.origin === vault) return await vaultHost(req, env, url, app);
    if (url.origin !== app) return Response.redirect(new URL(url.pathname + url.search, app).href, 301);
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/config' && req.method === 'GET') {
        return json({ mode: 'personal', vault, format: PROJECT_FORMAT, limits: LIMITS, claude: { server: false }, transcribe: false });
      }
      throw new HttpError(404, 'this server keeps nothing: projects and keys stay in the browser (personal mode)');
    }
    if (url.pathname === '/vault.html') throw new HttpError(404, 'not found');
    return editorPage(await env.ASSETS.fetch(req), vault, app);
  } catch (e) { return failure(e); }
}

const attr = (s: string) => s.replace(/[&"<>]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The editor's page tells it the mode: where the vault is (mode.ts reads it
 * before anything). A link to it is shown with its address and the preview
 * (og.jpg, beside the page), whatever path was asked: there is one editor.
 */
async function editorPage(res: Response, vault: string, app: string): Promise<Response> {
  if (!(res.headers.get('content-type') ?? '').startsWith('text/html')) return res;
  const home = attr(`${app}/`), preview = attr(`${app}/og.jpg`);
  const html = (await res.text()).replace('<head>', `<head><meta name="tramme-vault" content="${attr(vault)}">`
    + `<link rel="canonical" href="${home}"><meta property="og:url" content="${home}"><meta property="og:image" content="${preview}"><meta name="twitter:image" content="${preview}">`);
  const headers = new Headers(res.headers);
  headers.delete('content-length');
  return new Response(html, { status: res.status, headers });
}
