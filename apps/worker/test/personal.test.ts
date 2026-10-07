import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index.ts';
import type { Env } from '../src/http.ts';

const APP = 'https://tramme.example.com', VAULT = 'https://cles.tramme.example.com';

/** the static build: the vault's page, a script, and the editor's page for anything else (single-page app) */
const ASSETS = {
  async fetch(req: Request) {
    const path = new URL(req.url).pathname;
    if (path === '/vault.html') return new Response('<html><head><meta name="tramme-app" content="%APP_ORIGIN%"></head></html>', { headers: { 'content-type': 'text/html' } });
    if (path === '/assets/vault-1.js') {
      // the browser's copy is still good
      if (req.headers.get('if-none-match') === '"v1"') return new Response(null, { status: 304, headers: { etag: '"v1"' } });
      return new Response('/* vault */', { headers: { 'content-type': 'text/javascript', etag: '"v1"' } });
    }
    return new Response('<!doctype html><html><head><title>tramme</title></head></html>', { headers: { 'content-type': 'text/html' } });
  },
};

function setup(vars: Partial<Env> = {}) {
  const env = { MODE: 'personal', APP_ORIGIN: APP, VAULT_ORIGIN: VAULT, ASSETS, ...vars } as unknown as Env;
  return (url: string, init: RequestInit = {}) => worker.fetch(new Request(url, init) as never, env);
}

afterEach(() => vi.unstubAllGlobals());

describe('personal mode: the editor\'s address', () => {
  it('says the mode and where the vault is, and keeps nothing', async () => {
    const call = setup();
    const config = await (await call(`${APP}/api/config`)).json() as Record<string, unknown>;
    expect(config).toMatchObject({ mode: 'personal', vault: VAULT, transcribe: false, claude: { server: false } });
    for (const path of ['/api/projects', '/api/keys/anthropic', '/api/claude/v1/messages', '/api/transcribe']) {
      expect((await call(`${APP}${path}`, { method: 'POST', body: '{}' })).status).toBe(404);
    }
  });

  it('tells the editor\'s page where the vault is; never serves the vault\'s page here', async () => {
    const call = setup();
    const page = await (await call(`${APP}/p/trip-abc123`)).text();
    expect(page).toContain(`<head><meta name="tramme-vault" content="${VAULT}">`);
    expect((await call(`${APP}/vault.html`)).status).toBe(404);
  });

  it('shows a link to any of its pages as the editor, with its address and preview', async () => {
    const page = await (await setup()(`${APP}/p/trip-abc123`)).text();
    expect(page).toContain(`<link rel="canonical" href="${APP}/">`);
    expect(page).toContain(`<meta property="og:url" content="${APP}/">`);
    expect(page).toContain(`<meta property="og:image" content="${APP}/og.jpg">`);
    expect(page).toContain(`<meta name="twitter:image" content="${APP}/og.jpg">`);
  });

  it('sends any other address of the Worker to the editor\'s', async () => {
    const res = await setup()('https://tramme-personal.someone.workers.dev/p/x?y=1');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${APP}/p/x?y=1`);
  });

  it('is closed until both addresses are set', async () => {
    expect((await setup({ VAULT_ORIGIN: '' })(`${APP}/`)).status).toBe(503);
  });
});

describe('personal mode: the vault\'s address', () => {
  it('serves its page with the editor\'s address, framed by the editor only, reaching the direct providers only', async () => {
    const call = setup();
    for (const path of ['/', '/settings']) {
      const res = await call(`${VAULT}${path}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(`content="${APP}"`);
      const csp = res.headers.get('content-security-policy')!;
      expect(csp).toContain(`frame-ancestors ${APP}`);
      expect(csp).toContain('https://api.anthropic.com');
      expect(csp).not.toContain('api.z.ai');
    }
    expect((await call(`${VAULT}/assets/vault-1.js`)).status).toBe(200);
    // the second frame of the vault finds the script in the browser's cache
    expect((await call(`${VAULT}/assets/vault-1.js`, { headers: { 'if-none-match': '"v1"' } })).status).toBe(304);
  });

  it('serves nothing of the editor at this address (its plugins would read the keys)', async () => {
    const call = setup();
    expect((await call(`${VAULT}/p/trip-abc123`)).status).toBe(404);
    // an asset that does not exist falls back to the editor's page: refused
    expect((await call(`${VAULT}/assets/main-1.js`)).status).toBe(404);
    expect((await call(`${VAULT}/api/config`)).status).toBe(404);
  });
});

describe('personal mode: the relay', () => {
  const relay = (headers: Record<string, string>, init: RequestInit = { method: 'POST', body: '{"model":"glm"}' }) =>
    setup()(`${VAULT}/relay`, { ...init, headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...(init.body ? { 'content-length': String(String(init.body).length) } : {}), ...headers } });

  it('passes the request on with the provider\'s headers only, keeps the answer\'s format', async () => {
    const calls: { url: string; method: string; headers: Headers; body: string }[] = [];
    vi.stubGlobal('fetch', async (url: URL, init: RequestInit & { body: ReadableStream }) => {
      calls.push({ url: String(url), method: init.method!, headers: new Headers(init.headers), body: await new Response(init.body).text() });
      return new Response('data: {}\n\n', { headers: { 'content-type': 'text/event-stream', 'set-cookie': 'a=b' } });
    });
    const res = await relay({ 'x-tramme-target': 'https://api.z.ai/api/paas/v4/chat/completions', authorization: 'Bearer z', cookie: 'session=1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.has('set-cookie')).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: 'https://api.z.ai/api/paas/v4/chat/completions', method: 'POST', body: '{"model":"glm"}' });
    expect(calls[0].headers.get('authorization')).toBe('Bearer z');
    expect(calls[0].headers.has('cookie')).toBe(false);
    expect(calls[0].headers.has('x-tramme-target')).toBe(false);
  });

  it('serves the vault\'s page only, at an address of the web, within the visitor\'s quota', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}'));
    const target = { 'x-tramme-target': 'https://api.z.ai/x' };
    expect((await relay({ ...target, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await relay({ 'x-tramme-target': 'file:///etc/passwd' })).status).toBe(400);
    expect((await relay({ 'x-tramme-target': 'not an address' })).status).toBe(400);
    const limited = setup({ RELAY_LIMIT: { limit: async () => ({ success: false }) } as unknown as RateLimit });
    const res = await limited(`${VAULT}/relay`, { headers: { 'sec-fetch-site': 'same-origin', ...target } });
    expect(res.status).toBe(429);
  });
});
