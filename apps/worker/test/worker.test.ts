import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { DOCUMENT, MANIFEST, newProject, type Manifest } from '@tramme/project';
import worker from '../src/index.ts';
import type { Env } from '../src/http.ts';

/** just enough of an R2 bucket, in memory */
function memoryBucket() {
  const store = new Map<string, { data: Uint8Array; etag: string; type?: string; uploaded: Date }>();
  let n = 0;
  const uploadsMap = new Map<string, { key: string; parts: Map<number, Uint8Array>; type?: string }>();
  const meta = (key: string) => {
    const o = store.get(key)!;
    return { key, size: o.data.byteLength, etag: o.etag, httpEtag: `"${o.etag}"`, uploaded: o.uploaded, httpMetadata: { contentType: o.type } };
  };
  const body = (key: string) => {
    const o = store.get(key)!;
    return { ...meta(key), body: new Blob([o.data]).stream(), arrayBuffer: async () => o.data.slice().buffer, json: async () => JSON.parse(new TextDecoder().decode(o.data)) };
  };
  return {
    store,
    async head(key: string) { return store.has(key) ? meta(key) : null; },
    async get(key: string) { return store.has(key) ? body(key) : null; },
    async put(key: string, value: ArrayBuffer | string, opts?: { httpMetadata?: { contentType?: string }; onlyIf?: Headers }) {
      const want = opts?.onlyIf?.get('if-match');
      if (want && (!store.has(key) || `"${store.get(key)!.etag}"` !== want)) return null;
      const data = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
      store.set(key, { data, etag: `e${++n}`, type: opts?.httpMetadata?.contentType, uploaded: new Date() });
      return meta(key);
    },
    async delete(keys: string | string[]) { for (const k of [keys].flat()) store.delete(k); },
    // multipart: parts kept apart, put together on complete
    async createMultipartUpload(key: string, opts?: { httpMetadata?: { contentType?: string } }) { const uploadId = `u${++n}`; uploadsMap.set(uploadId, { key, parts: new Map(), type: opts?.httpMetadata?.contentType }); return { uploadId, key }; },
    resumeMultipartUpload(key: string, uploadId: string) {
      const u = uploadsMap.get(uploadId)!;
      return {
        async uploadPart(partNumber: number, data: ArrayBuffer) { u.parts.set(partNumber, new Uint8Array(data)); return { partNumber, etag: `p${partNumber}` }; },
        async complete(parts: { partNumber: number }[]) {
          const chunks = parts.map((p) => u.parts.get(p.partNumber)!), size = chunks.reduce((a, c) => a + c.length, 0);
          const data = new Uint8Array(size); let o = 0; for (const c of chunks) { data.set(c, o); o += c.length; }
          store.set(key, { data, etag: `e${++n}`, type: u.type, uploaded: new Date() }); uploadsMap.delete(uploadId);
          return meta(key);
        },
        async abort() { uploadsMap.delete(uploadId); },
      };
    },
    async list(opts: { prefix: string; delimiter?: string }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(opts.prefix)).sort();
      if (!opts.delimiter) return { objects: keys.map(meta), delimitedPrefixes: [], truncated: false };
      const prefixes = new Set(keys.map((k) => k.slice(opts.prefix.length)).filter((r) => r.includes('/')).map((r) => opts.prefix + r.split('/')[0] + '/'));
      return { objects: [], delimitedPrefixes: [...prefixes], truncated: false };
    },
  };
}

function setup(vars: Partial<Env> = {}) {
  const bucket = memoryBucket();
  const env = { FILES: bucket, ASSETS: { fetch: async () => new Response('page') }, DEV_OPEN: '1', ...vars } as unknown as Env;
  const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`http://localhost:8787${path}`, init) as never, env);
  return { bucket, env, call };
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('worker: projects in R2', () => {
  it('creates, lists, reads, writes, exports, duplicates and deletes', async () => {
    const { call } = setup();
    const created = await call('/api/projects', post({ name: 'First', width: 1080, height: 1920, fps: 30, duration: 4 }));
    expect(created.status).toBe(201);
    const m = (await created.json()) as Manifest;
    expect(m.id).toMatch(/^first-/);

    const list = (await (await call('/api/projects')).json()) as Manifest[];
    expect(list.map((x) => x.id)).toEqual([m.id]);

    const doc = await (await call(`/api/projects/${m.id}/files/${DOCUMENT}`)).json() as { compositions: Record<string, { duration: number }> };
    doc.compositions.main.duration = 7;
    const put = await call(`/api/projects/${m.id}/files/${DOCUMENT}`, { method: 'PUT', body: JSON.stringify(doc) });
    expect(put.status).toBe(200);
    const after = (await (await call(`/api/projects/${m.id}`)).json()) as { manifest: Manifest; files: { path: string }[] };
    expect(after.manifest.duration).toBe(7);
    expect(after.files.map((f) => f.path).sort()).toEqual([DOCUMENT, MANIFEST]);

    // a stale version cannot overwrite a newer one
    const stale = await call(`/api/projects/${m.id}/files/${DOCUMENT}`, { method: 'PUT', headers: { 'if-match': '"e1"' }, body: JSON.stringify(doc) });
    expect(stale.status).toBe(412);
    const fresh = await call(`/api/projects/${m.id}/files/${DOCUMENT}`, { method: 'PUT', headers: { 'if-match': put.headers.get('etag')! }, body: JSON.stringify(doc) });
    expect(fresh.status).toBe(200);

    expect((await call(`/api/projects/${m.id}/files/assets/a.png`, { method: 'PUT', body: new Uint8Array([1, 2, 3]) })).status).toBe(200);
    const img = await call(`/api/projects/${m.id}/files/assets/a.png`);
    expect(img.headers.get('content-type')).toBe('image/png');
    expect([...new Uint8Array(await img.arrayBuffer())]).toEqual([1, 2, 3]);

    const zip = unzipSync(new Uint8Array(await (await call(`/api/projects/${m.id}/export`)).arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(['assets/a.png', DOCUMENT, MANIFEST]);

    const dup = (await (await call(`/api/projects/${m.id}/duplicate`, post({}))).json()) as Manifest;
    expect(dup.name).toBe('First (copy)');
    expect((await call(`/api/projects/${dup.id}/files/assets/a.png`)).status).toBe(200);

    expect((await call(`/api/projects/${m.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(`/api/projects/${m.id}`)).status).toBe(404);
    expect(((await (await call('/api/projects')).json()) as Manifest[]).length).toBe(1);
  });

  it('refuses paths outside the format, the manifest, an invalid document', async () => {
    const { call } = setup();
    const m = (await (await call('/api/projects', post({ name: 'Essai' }))).json()) as Manifest;
    const put = (p: string, body: BodyInit) => call(`/api/projects/${m.id}/files/${p}`, { method: 'PUT', body });
    expect((await put('assets/virus.exe', 'x')).status).toBe(400);
    expect((await put('..%2F..%2Fsecret.json', 'x')).status).toBe(400);
    expect((await put('ailleurs/a.png', 'x')).status).toBe(400);
    expect((await put(MANIFEST, '{}')).status).toBe(403);
    expect((await put(DOCUMENT, '{"schema":"autre"}')).status).toBe(422);
    expect((await call('/api/projects/A%20B/files/assets/a.png')).status).toBe(400);
    expect((await call(`/api/projects/${m.id}/files/${DOCUMENT}`, { method: 'DELETE' })).status).toBe(403);
  });

  it('without Cloudflare Access configured, the API is closed; another origin is refused', async () => {
    const closed = setup({ DEV_OPEN: undefined });
    expect((await closed.call('/api/projects')).status).toBe(503);
    const open = setup();
    expect((await open.call('/api/projects', { method: 'POST', headers: { origin: 'https://ailleurs.example' }, body: '{}' })).status).toBe(403);
    expect(await (await open.call('/p/abc')).text()).toBe('page');
    // DEV_OPEN only counts on this machine
    const remote = setup();
    expect((await worker.fetch(new Request('https://tramme.example.workers.dev/api/projects') as never, remote.env)).status).toBe(503);
  });

  for (const name of ['trame', 'emotion']) {
    it(`a project stored under a former name (${name}) is converted on its first read`, async () => {
      const { bucket, call } = setup();
      const { manifest, doc } = newProject({ name: 'Old', width: 640, height: 360, fps: 24, duration: 2, id: 'old-abc123' });
      await bucket.put(`projects/old-abc123/${name}.json`, JSON.stringify({ ...manifest, format: `${name}-project/1` }));
      await bucket.put(`projects/old-abc123/document.${name}.json`, JSON.stringify({ ...doc, schema: `${name}/1` }));
      await bucket.put(`projects/old-abc123/.${name}/chats/index.json`, '[]');
      const list = (await (await call('/api/projects')).json()) as Manifest[];
      expect(list.map((m) => [m.id, m.format])).toEqual([['old-abc123', 'tramme-project/1']]);
      expect([...bucket.store.keys()].sort()).toEqual(['projects/old-abc123/.tramme/chats/index.json', 'projects/old-abc123/document.tramme.json', 'projects/old-abc123/tramme.json']);
      const d = await (await call('/api/projects/old-abc123/files/document.tramme.json')).json() as { schema: string };
      expect(d.schema).toBe('tramme/1');
    });
  }

  it('keeps plugins in a library shared by the projects', async () => {
    const { call } = setup();
    expect(await (await call('/api/library')).json()).toEqual([]);
    const code = "export const meta = { name: 'brand', api: 1 };";
    expect((await call('/api/library/brand.js', { method: 'PUT', body: code })).status).toBe(200);
    expect((await call('/api/library')).ok).toBe(true);
    const list = (await (await call('/api/library')).json()) as { name: string; size: number }[];
    expect(list.map((x) => `${x.name}:${x.size}`)).toEqual([`brand.js:${code.length}`]);
    const got = await call('/api/library/brand.js');
    expect(got.headers.get('content-type')).toMatch(/javascript/);
    expect(await got.text()).toBe(code);
    expect((await call('/api/library/Bad%20Name.js', { method: 'PUT', body: code })).status).toBe(400);
    expect((await call('/api/library/missing.js')).status).toBe(404);
    expect((await call('/api/library/brand.js', { method: 'DELETE' })).status).toBe(200);
    expect(await (await call('/api/library')).json()).toEqual([]);
  });

  it('a large file (video) arrives in parts', async () => {
    const { call } = setup();
    const m = (await (await call('/api/projects', post({ name: 'Video' }))).json()) as Manifest;
    const started = (await (await call(`/api/projects/${m.id}/uploads`, post({ path: 'assets/take.mp4', size: 300 * 1024 * 1024 }))).json()) as { uploadId: string; partSize: number };
    expect(started.partSize).toBe(32 * 1024 * 1024);
    const parts = [];
    for (const [i, bytes] of [[1, [1, 2, 3]], [2, [4, 5]]] as const) {
      parts.push(await (await call(`/api/projects/${m.id}/uploads/${started.uploadId}?path=assets/take.mp4&part=${i}`, { method: 'PUT', body: new Uint8Array(bytes) })).json());
    }
    const done = await call(`/api/projects/${m.id}/uploads/${started.uploadId}/complete`, post({ path: 'assets/take.mp4', parts }));
    expect(done.status).toBe(200);
    expect([...new Uint8Array(await (await call(`/api/projects/${m.id}/files/assets/take.mp4`)).arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
    // only sounds and videos, within the size admitted
    expect((await call(`/api/projects/${m.id}/uploads`, post({ path: 'assets/photo.png', size: 200 * 1024 * 1024 }))).status).toBe(400);
    expect((await call(`/api/projects/${m.id}/uploads`, post({ path: 'assets/x.mp4', size: 5 * 1024 ** 4 }))).status).toBe(413);
  });

  it('without a key, the Claude relay says so', async () => {
    const { call } = setup();
    const r = await call('/api/claude/v1/messages', post({ model: 'claude-opus-5-5', max_tokens: 10, messages: [] }));
    expect(r.status).toBe(503);
    expect(((await (await call('/api/config')).json()) as { claude: { server: boolean } }).claude.server).toBe(false);
  });
});

describe('other model providers', () => {
  it('relays a chat request with the key added, and lists the models worth offering', async () => {
    const { call } = setup({ OPENAI_API_KEY: 'sk-test', OPENROUTER_API_KEY: 'or-test', ZAI_API_KEY: 'zai-test' });
    const seen: { url: string; auth: string | null; body?: string }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), auth = new Headers(init?.headers).get('authorization');
      seen.push({ url, auth, body: init?.body ? await new Response(init.body).text() : undefined });
      if (url.endsWith('/chat/completions')) return new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
      if (url.startsWith('https://api.openai.com')) return Response.json({ data: [{ id: 'gpt-5' }, { id: 'gpt-5-2025-08-07' }, { id: 'gpt-4o-realtime-preview' }, { id: 'text-embedding-3-large' }, { id: 'o4-mini' }] });
      if (url.startsWith('https://api.z.ai')) return Response.json({ data: [{ id: 'glm-4-plus' }, { id: 'glm-4-flash' }, { id: 'embedding-3' }, { id: 'cogvideox' }] });
      return Response.json({ data: [{ id: 'deepseek/deepseek-chat', name: 'DeepSeek: Chat', supported_parameters: ['tools'] }, { id: 'deepseek/deepseek-r1', name: 'DeepSeek: R1', supported_parameters: ['tools', 'reasoning'] }, { id: 'some/no-tools', name: 'No tools', supported_parameters: [] }] });
    }) as typeof fetch;
    try {
      const config = await (await call('/api/config')).json() as { llm: Record<string, boolean> };
      expect(config.llm).toEqual({ openai: true, gemini: false, openrouter: true, zai: true });

      const r = await call('/api/llm/openai/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-5', stream: true, messages: [] }) });
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('"content":"ok"');
      expect(seen[0]).toMatchObject({ url: 'https://api.openai.com/v1/chat/completions', auth: 'Bearer sk-test' });
      expect(JSON.parse(seen[0].body!).model).toBe('gpt-5');

      const rZai = await call('/api/llm/zai/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'glm-4-plus', stream: true, messages: [] }) });
      expect(rZai.status).toBe(200);
      expect(await rZai.text()).toContain('"content":"ok"');
      expect(seen.find((s) => s.url.includes('api.z.ai'))).toMatchObject({ url: 'https://api.z.ai/api/paas/v4/chat/completions', auth: 'Bearer zai-test' });

      const missing = await call('/api/llm/gemini/chat/completions', { method: 'POST', body: '{}' });
      expect(missing.status).toBe(503);
      expect(((await missing.json()) as { error: string }).error).toContain('GEMINI_API_KEY');

      const models = await (await call('/api/models')).json() as Record<string, { id: string; effort?: true }[]>;
      expect(models.openai.map((m) => m.id)).toEqual(['gpt-5', 'o4-mini']);
      // the models that reason say so: they take an effort level
      expect(models.openrouter.map((m) => [m.id, !!m.effort])).toEqual([['deepseek/deepseek-chat', false], ['deepseek/deepseek-r1', true]]);
      expect(models.zai.map((m) => m.id)).toEqual(['glm-4-flash', 'glm-4-plus']);
      expect(models.gemini).toBeUndefined();
    } finally { globalThis.fetch = real; }
  });
});
