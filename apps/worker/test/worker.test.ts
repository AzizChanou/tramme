import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { DOCUMENT, MANIFEST, newProject, type Manifest } from '@tramme/project';
import worker from '../src/index.ts';
import type { Env } from '../src/http.ts';

/** just enough of an R2 bucket, in memory */
function memoryBucket() {
  const store = new Map<string, { data: Uint8Array; etag: string; type?: string; uploaded: Date; custom?: Record<string, string> }>();
  let n = 0;
  const uploadsMap = new Map<string, { key: string; parts: Map<number, Uint8Array>; type?: string }>();
  const meta = (key: string) => {
    const o = store.get(key)!;
    return { key, size: o.data.byteLength, etag: o.etag, httpEtag: `"${o.etag}"`, uploaded: o.uploaded, httpMetadata: { contentType: o.type }, customMetadata: o.custom };
  };
  const body = (key: string) => {
    const o = store.get(key)!;
    return { ...meta(key), body: new Blob([o.data]).stream(), arrayBuffer: async () => o.data.slice().buffer, json: async () => JSON.parse(new TextDecoder().decode(o.data)) };
  };
  return {
    store,
    async head(key: string) { return store.has(key) ? meta(key) : null; },
    async get(key: string) { return store.has(key) ? body(key) : null; },
    async put(key: string, value: ArrayBuffer | string, opts?: { httpMetadata?: { contentType?: string }; onlyIf?: Headers; customMetadata?: Record<string, string> }) {
      const want = opts?.onlyIf?.get('if-match');
      if (want && (!store.has(key) || `"${store.get(key)!.etag}"` !== want)) return null;
      const data = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
      store.set(key, { data, etag: `e${++n}`, type: opts?.httpMetadata?.contentType, uploaded: new Date(), custom: opts?.customMetadata });
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

  it('keeps sounds in a library too, each with its description', async () => {
    const { call } = setup();
    const entry = { id: 'brand-sting', title: 'Brand sting', kind: 'sting', tags: ['logo'], source: 'library', duration: 1.2, peakAt: 0.1 };
    const wav = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]);
    expect((await call('/api/sounds/brand-sting.wav', { method: 'PUT', body: wav, headers: { 'x-tramme-entry': JSON.stringify(entry) } })).status).toBe(200);
    const list = (await (await call('/api/sounds')).json()) as { name: string; entry: unknown }[];
    expect(list).toMatchObject([{ name: 'brand-sting.wav', entry }]);
    const got = await call('/api/sounds/brand-sting.wav');
    expect(got.headers.get('content-type')).toBe('audio/wav');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(wav);
    // not a sound, not a description, too long a description
    expect((await call('/api/sounds/brand.js', { method: 'PUT', body: wav })).status).toBe(400);
    expect((await call('/api/sounds/a.wav', { method: 'PUT', body: wav, headers: { 'x-tramme-entry': '{nope' } })).status).toBe(400);
    expect((await call('/api/sounds/a.wav', { method: 'PUT', body: wav, headers: { 'x-tramme-entry': JSON.stringify({ prompt: 'x'.repeat(2000) }) } })).status).toBe(413);
    // the plugin library is apart
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

describe('keys connected from the settings', () => {
  const put = (body: unknown): RequestInit => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const config = async (call: ReturnType<typeof setup>['call']) => (await (await call('/api/config')).json()) as { claude: { server: boolean }; llm: Record<string, boolean>; keys: { providers: Record<string, string | null>; custom: unknown[] } };

  it('keeps a key, says where it comes from, never sends it back, and goes back to the secret once removed', async () => {
    const { call, bucket } = setup({ OPENAI_API_KEY: 'sk-secret' });
    expect((await config(call)).keys.providers).toMatchObject({ anthropic: null, openai: 'server' });

    expect((await call('/api/keys/anthropic', put({ key: '  sk-ant-typed  ' }))).status).toBe(200);
    expect((await call('/api/keys/openai', put({ key: 'sk-typed' }))).status).toBe(200);
    const c = await config(call);
    expect(c.claude.server).toBe(true);
    expect(c.keys.providers).toMatchObject({ anthropic: 'settings', openai: 'settings', gemini: null });
    expect(JSON.stringify(c)).not.toContain('sk-');
    expect(new TextDecoder().decode(bucket.store.get('config/keys.json')!.data)).toContain('sk-ant-typed');

    const seen: { url: string; headers: Headers }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { seen.push({ url: String(input), headers: new Headers(init?.headers) }); return new Response('{}'); }) as typeof fetch;
    try {
      await call('/api/claude/v1/messages', post({ model: 'claude-opus-5-5', max_tokens: 10, messages: [] }));
      await call('/api/llm/openai/chat/completions', post({ model: 'gpt-5', messages: [] }));
      expect(seen[0].headers.get('x-api-key')).toBe('sk-ant-typed');
      // the key from the settings comes before the secret
      expect(seen[1].headers.get('authorization')).toBe('Bearer sk-typed');
    } finally { globalThis.fetch = real; }

    expect((await call('/api/keys/openai', { method: 'DELETE' })).status).toBe(200);
    expect((await config(call)).keys.providers.openai).toBe('server');
  });

  it('refuses what is not a key or a provider', async () => {
    const { call } = setup();
    expect((await call('/api/keys/openai', put({ key: '' }))).status).toBe(400);
    expect((await call('/api/keys/openai', put({ key: 'two words' }))).status).toBe(400);
    expect((await call('/api/keys/nobody', put({ key: 'k' }))).status).toBe(404);
    expect((await call('/api/keys/custom/Bad_Id', put({ label: 'x', base: 'https://x.test/v1' }))).status).toBe(400);
    expect((await call('/api/keys/custom/x', put({ label: 'x', base: 'not a url' }))).status).toBe(400);
    expect((await call('/api/keys/custom/x', put({ label: '', base: 'https://x.test/v1' }))).status).toBe(400);
  });

  it('relays to a custom provider of the chat format, lists its models, keeps its key when it is edited', async () => {
    const { call } = setup();
    expect((await call('/api/keys/custom/deepseek', put({ label: 'DeepSeek', base: 'https://api.deepseek.com/v1/', key: 'ds-key' }))).status).toBe(200);
    let c = await config(call);
    expect(c.llm['custom:deepseek']).toBe(true);
    expect(c.keys.custom).toEqual([{ id: 'deepseek', label: 'DeepSeek', base: 'https://api.deepseek.com/v1', key: true }]);

    const seen: { url: string; auth: string | null }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') });
      return String(input).endsWith('/models') ? Response.json({ data: [{ id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }] }) : new Response('data: [DONE]\n\n');
    }) as typeof fetch;
    try {
      expect((await call(`/api/llm/${encodeURIComponent('custom:deepseek')}/chat/completions`, post({ model: 'deepseek-chat', messages: [] }))).status).toBe(200);
      expect(seen[0]).toEqual({ url: 'https://api.deepseek.com/v1/chat/completions', auth: 'Bearer ds-key' });
      const models = await (await call('/api/models')).json() as Record<string, { id: string }[]>;
      expect(models['custom:deepseek'].map((m) => m.id)).toEqual(['deepseek-chat', 'deepseek-reasoner']);

      // renamed without a key: the one it had stays
      await call('/api/keys/custom/deepseek', put({ label: 'DeepSeek API', base: 'https://api.deepseek.com/v1' }));
      await call(`/api/llm/${encodeURIComponent('custom:deepseek')}/chat/completions`, post({ model: 'deepseek-chat', messages: [] }));
      expect(seen.at(-1)!.auth).toBe('Bearer ds-key');
      expect((await call(`/api/llm/${encodeURIComponent('custom:other')}/chat/completions`, post({}))).status).toBe(404);
    } finally { globalThis.fetch = real; }

    await call('/api/keys/custom/deepseek', { method: 'DELETE' });
    c = await config(call);
    expect(c.keys.custom).toEqual([]);
    expect(c.llm['custom:deepseek']).toBeUndefined();
  });
});

describe('sounds made by a provider', () => {
  /** the providers answered by fake ones: what each was asked, and its audio */
  function providers() {
    const seen: { url: string; headers: Headers; body: any }[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, headers: new Headers(init?.headers), body: JSON.parse(String(init?.body ?? '{}')) });
      if (url.includes('generativelanguage')) return Response.json({ steps: [{ content: [{ type: 'audio', mime_type: 'audio/wav', data: btoa('RIFFwav') }] }] });
      if (url.includes('/sound-generation') && seen.at(-1)!.body.text === 'refused') return Response.json({ detail: { message: 'quota exceeded' } }, { status: 401 });
      return new Response(new Uint8Array([0xff, 0xfb, 1, 2]), { headers: { 'content-type': 'audio/mpeg' } });
    }) as typeof fetch;
    return { seen, restore: () => { globalThis.fetch = real; } };
  }
  const ask = (body: object) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('says which providers make what, and that none can without a key', async () => {
    const { call } = setup({ GEMINI_API_KEY: 'g', ELEVENLABS_API_KEY: 'el' });
    const config = await (await call('/api/config')).json() as { sound: Record<string, string[]> };
    expect(config.sound).toEqual({ sfx: ['elevenlabs'], music: ['elevenlabs'], voice: ['elevenlabs', 'gemini'] });
    const none = await setup().call('/api/generate', ask({ kind: 'music', prompt: 'calm piano' }));
    expect(none.status).toBe(503);
    expect(((await none.json()) as { error: string }).error).toContain('ELEVENLABS_API_KEY');
  });

  it('makes a sound effect and music with ElevenLabs, a voice with Gemini, the key added by the server', async () => {
    const { call } = setup({ GEMINI_API_KEY: 'g-key', ELEVENLABS_API_KEY: 'el-key' });
    const p = providers();
    try {
      const sfx = await call('/api/generate', ask({ kind: 'sfx', prompt: 'a deep whoosh', duration: 99 }));
      expect(sfx.headers.get('content-type')).toBe('audio/mpeg');
      expect(sfx.headers.get('x-tramme-provider')).toBe('elevenlabs');
      expect(p.seen[0].url).toBe('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128');
      expect(p.seen[0].headers.get('xi-api-key')).toBe('el-key');
      expect(p.seen[0].body).toMatchObject({ text: 'a deep whoosh', duration_seconds: 30 });

      await call('/api/generate', ask({ kind: 'music', prompt: 'calm piano bed', duration: 20 }));
      expect(p.seen[1].url).toContain('/v1/music');
      expect(p.seen[1].body).toMatchObject({ prompt: 'calm piano bed', music_length_ms: 20000, force_instrumental: true });

      const voice = await call('/api/generate', ask({ kind: 'voice', prompt: 'Bonjour à tous', provider: 'gemini', voice: 'Puck', style: 'warm' }));
      expect(voice.headers.get('content-type')).toBe('audio/wav');
      expect(await voice.text()).toBe('RIFFwav');
      expect(p.seen[2].headers.get('x-goog-api-key')).toBe('g-key');
      expect(p.seen[2].body.generation_config.speech_config[0].voice).toBe('Puck');
      expect(p.seen[2].body.input[0].content[0]).toMatchObject({ text: 'Bonjour à tous', annotations: [{ style: 'warm' }] });
    } finally { p.restore(); }
  });

  it('passes on what a provider refuses, and what is asked wrong', async () => {
    const { call } = setup({ ELEVENLABS_API_KEY: 'el-key' });
    const p = providers();
    try {
      const refused = await call('/api/generate', ask({ kind: 'sfx', prompt: 'refused' }));
      expect(refused.status).toBe(502);
      expect(((await refused.json()) as { error: string }).error).toBe('elevenlabs: quota exceeded');
      expect((await call('/api/generate', ask({ kind: 'song', prompt: 'x' }))).status).toBe(400);
      expect((await call('/api/generate', ask({ kind: 'voice', prompt: '' }))).status).toBe(400);
      expect((await call('/api/generate', ask({ kind: 'sfx', prompt: 'x', provider: 'openai' }))).status).toBe(400);
    } finally { p.restore(); }
  });
});
