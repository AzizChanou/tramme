// The providers' keys, typed in the editor's settings: kept in R2 (behind
// Cloudflare Access like everything else) and never sent back to the browser,
// which only learns which providers are connected. A Worker secret of the same
// provider (wrangler secret put) still works; a key from the settings comes
// first. Custom providers speak the OpenAI chat format at their own address.
//
//   PUT    /api/keys/:provider        {key}                 connect a provider (or change its key)
//   DELETE /api/keys/:provider                              disconnect it
//   PUT    /api/keys/custom/:id       {label, base, key?}   add or change a custom provider (key kept when absent)
//   DELETE /api/keys/custom/:id                             remove it
// What is connected comes with GET /api/config (keys).

import { HttpError, json, readJson, type Env } from './http.ts';

export const PROVIDERS = ['anthropic', 'openai', 'gemini', 'openrouter', 'zai', 'elevenlabs'] as const;
export type KeyedProvider = typeof PROVIDERS[number];

/** the Worker secret of each provider, used when the settings hold no key */
const SECRET: Record<KeyedProvider, { name: string; read(env: Env): string | undefined }> = {
  anthropic: { name: 'ANTHROPIC_API_KEY', read: (e) => e.ANTHROPIC_API_KEY },
  openai: { name: 'OPENAI_API_KEY', read: (e) => e.OPENAI_API_KEY },
  gemini: { name: 'GEMINI_API_KEY', read: (e) => e.GEMINI_API_KEY },
  openrouter: { name: 'OPENROUTER_API_KEY', read: (e) => e.OPENROUTER_API_KEY },
  zai: { name: 'ZAI_API_KEY', read: (e) => e.ZAI_API_KEY ?? e.GLM_API_KEY },
  elevenlabs: { name: 'ELEVENLABS_API_KEY', read: (e) => e.ELEVENLABS_API_KEY },
};

/** a provider of the OpenAI chat format added by the user: its name, its address (…/v1) and its key, if it takes one */
export interface Custom { id: string; label: string; base: string; key?: string }
interface Stored { keys: Partial<Record<KeyedProvider, string>>; custom: Custom[] }

/** where the key of a provider comes from: the settings, a Worker secret, or nowhere */
export type KeySource = 'settings' | 'server' | null;
/** what the browser may know: no key, only where each comes from */
export interface KeyStatus { providers: Record<KeyedProvider, KeySource>; custom: { id: string; label: string; base: string; key: boolean }[] }

const OBJECT = 'config/keys.json';
const CUSTOM_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const isProvider = (p: string): p is KeyedProvider => (PROVIDERS as readonly string[]).includes(p);

async function stored(env: Env): Promise<Stored> {
  const o = await env.FILES.get(OBJECT);
  if (!o) return { keys: {}, custom: [] };
  try {
    const j = await o.json<Partial<Stored>>();
    return { keys: j.keys && typeof j.keys === 'object' ? j.keys : {}, custom: Array.isArray(j.custom) ? j.custom : [] };
  } catch { return { keys: {}, custom: [] }; }
}

const store = (env: Env, s: Stored) => env.FILES.put(OBJECT, JSON.stringify(s), { httpMetadata: { contentType: 'application/json' } });

/** the keys of a request: read once, then asked by provider */
export interface Keys {
  get(p: KeyedProvider): string | undefined;
  /** the secret to name when a provider has no key */
  secret(p: KeyedProvider): string;
  custom(id: string): Custom | undefined;
  status(): KeyStatus;
}

export async function loadKeys(env: Env): Promise<Keys> {
  const s = await stored(env);
  const source = (p: KeyedProvider): KeySource => (s.keys[p] ? 'settings' : SECRET[p].read(env) ? 'server' : null);
  return {
    get: (p) => s.keys[p] || SECRET[p].read(env),
    secret: (p) => SECRET[p].name,
    custom: (id) => s.custom.find((c) => c.id === id),
    status: () => ({
      providers: Object.fromEntries(PROVIDERS.map((p) => [p, source(p)])) as KeyStatus['providers'],
      custom: s.custom.map(({ id, label, base, key }) => ({ id, label, base, key: !!key })),
    }),
  };
}

/** a key as typed: one line, without spaces around it */
function keyOf(v: unknown, required: boolean): string | undefined {
  const k = typeof v === 'string' ? v.trim() : '';
  if (!k) { if (required) throw new HttpError(400, 'the key is missing'); return undefined; }
  if (k.length > 1000 || /\s/.test(k)) throw new HttpError(400, 'this does not look like a key (one word, without spaces)');
  return k;
}

/** an address of the chat format, without its trailing slash */
function baseOf(v: unknown): string {
  const raw = typeof v === 'string' ? v.trim().replace(/\/+$/, '') : '';
  let url: URL;
  try { url = new URL(raw); } catch { throw new HttpError(400, 'the address is not a URL (https://…/v1)'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HttpError(400, 'the address must start with https://');
  return raw;
}

export async function keysRoute(req: Request, env: Env, parts: string[]): Promise<Response> {
  const m = req.method;
  const s = await stored(env);
  if (parts[0] === 'custom' && parts[1]) {
    const id = parts[1];
    if (!CUSTOM_ID.test(id)) throw new HttpError(400, 'custom provider id: lower case letters, digits and -');
    const before = s.custom.find((c) => c.id === id);
    if (m === 'DELETE') {
      await store(env, { ...s, custom: s.custom.filter((c) => c.id !== id) });
      return json({ deleted: id });
    }
    if (m === 'PUT') {
      const b = await readJson<{ label?: unknown; base?: unknown; key?: unknown }>(req);
      const label = typeof b.label === 'string' ? b.label.trim().slice(0, 40) : '';
      if (!label) throw new HttpError(400, 'the provider needs a name');
      const custom: Custom = { id, label, base: baseOf(b.base), key: keyOf(b.key, false) ?? before?.key };
      if (!custom.key) delete custom.key;
      await store(env, { ...s, custom: before ? s.custom.map((c) => (c.id === id ? custom : c)) : [...s.custom, custom] });
      return json({ id, label: custom.label, base: custom.base, key: !!custom.key });
    }
  } else if (parts[0] && !parts[1]) {
    const p = parts[0];
    if (!isProvider(p)) throw new HttpError(404, `unknown provider: ${p}`);
    if (m === 'DELETE') {
      const { [p]: _, ...rest } = s.keys;
      await store(env, { ...s, keys: rest });
      return json({ deleted: p });
    }
    if (m === 'PUT') {
      const b = await readJson<{ key?: unknown }>(req);
      await store(env, { ...s, keys: { ...s.keys, [p]: keyOf(b.key, true) } });
      return json({ provider: p });
    }
  }
  throw new HttpError(404, 'unknown keys route');
}
