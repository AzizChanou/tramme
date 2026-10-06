// Models of other providers than Anthropic, for the assistant: OpenAI, Gemini,
// OpenRouter, Z.AI (GLM) and the custom providers the user adds all speak the
// OpenAI chat format. The editor sends its request here, the key is added
// (settings or secret, see keys.ts) and the stream passed back; the key never
// reaches the editor. Local models are reached by the editor directly and
// never come here.
//
//   POST /api/llm/:provider/chat/completions   the request, streamed back (provider: openai… or custom:<id>)
//   GET  /api/models                           models offered by each connected provider

import { HttpError, json } from './http.ts';
import type { Keys } from './keys.ts';
import type { Reach } from './providers.ts';

type Remote = 'openai' | 'gemini' | 'openrouter' | 'zai';

const PROVIDERS: Record<Remote, { base: string; headers?: Record<string, string> }> = {
  openai: { base: 'https://api.openai.com/v1' },
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  openrouter: { base: 'https://openrouter.ai/api/v1', headers: { 'x-title': 'Tramme' } },
  zai: { base: 'https://api.z.ai/api/paas/v4' },
};

const isRemote = (p: string): p is Remote => p in PROVIDERS;
const PASS_DOWN = ['content-type', 'retry-after', 'x-request-id'];

/** which providers are connected: the built-in ones, then custom:<id> */
export function llmConfig(keys: Keys): Record<string, boolean> {
  const custom = keys.status().custom.map((c) => [`custom:${c.id}`, true]);
  return Object.fromEntries([...(Object.keys(PROVIDERS) as Remote[]).map((p) => [p, !!keys.get(p)]), ...custom]);
}

function upstream(keys: Keys, slot: string): { base: string; headers: Record<string, string> } {
  if (slot.startsWith('custom:')) {
    const c = keys.custom(slot.slice('custom:'.length));
    if (!c) throw new HttpError(404, `unknown provider: ${slot}`);
    return { base: c.base, headers: c.key ? { authorization: `Bearer ${c.key}` } : {} };
  }
  if (!isRemote(slot)) throw new HttpError(404, `unknown provider: ${slot}`);
  const key = keys.get(slot);
  if (!key) throw new HttpError(503, `no ${slot} key: ${keys.how([slot])}`);
  return { base: PROVIDERS[slot].base, headers: { authorization: `Bearer ${key}`, ...PROVIDERS[slot].headers } };
}

export async function llm(req: Request, { keys, fetch }: Reach, provider: string, rest: string) {
  if (req.method !== 'POST' || rest !== 'chat/completions') throw new HttpError(404, 'unknown route');
  const { base, headers } = upstream(keys, provider);
  const up = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: await req.arrayBuffer(), signal: req.signal });
  const down = new Headers({ 'cache-control': 'no-store' });
  for (const h of PASS_DOWN) { const v = up.headers.get(h); if (v) down.set(h, v); }
  return new Response(up.body, { status: up.status, headers: down });
}

/** effort: the model takes an effort level (OpenRouter's listing says it reasons) */
export interface ModelInfo { id: string; label: string; effort?: true }

/** the models worth offering: chat models, without dated copies, audio, images or embeddings */
function keep(provider: string, list: any[]): ModelInfo[] {
  if (provider === 'openai') {
    return list.map((m) => String(m.id))
      .filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation|-\d{4}-\d{2}-\d{2}$|-\d{4}$)/.test(id))
      .map((id) => ({ id, label: id }));
  }
  if (provider === 'gemini') {
    return list.map((m) => String(m.id).replace(/^models\//, ''))
      .filter((id) => /^gemini/.test(id) && !/(embedding|tts|image|live|audio|aqa|native|vision)/.test(id))
      .map((id) => ({ id, label: id }));
  }
  if (provider === 'zai') {
    return list.map((m) => String(m.id))
      .filter((id) => /^(glm-|chatglm)/i.test(id) && !/(embedding|cogview|cogvideo|audio|tts|image)/i.test(id))
      .map((id) => ({ id, label: id }));
  }
  // a custom provider: what it lists, it knows best
  if (provider !== 'openrouter') return list.map((m) => String(m.id ?? '')).filter(Boolean).map((id) => ({ id, label: id }));
  // OpenRouter: only the models that take tools; those that reason take an effort level
  return list.filter((m) => Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools'))
    .map((m) => ({ id: String(m.id), label: String(m.name ?? m.id), ...(m.supported_parameters.includes('reasoning') ? { effort: true as const } : {}) }));
}

/** asked again at most every 10 minutes (per instance), or as soon as the providers change */
let cache: { at: number; providers: string; data: Record<string, ModelInfo[] | { error: string }> } | null = null;

export async function models({ keys, fetch }: Reach) {
  const configured = Object.entries(llmConfig(keys)).filter(([, on]) => on).map(([p]) => p);
  // the providers and their keys: another key may give other models
  const providers = JSON.stringify(configured.map((p) => upstream(keys, p)));
  if (cache && cache.providers === providers && Date.now() - cache.at < 10 * 60_000) return json(cache.data);
  const entries = await Promise.all(configured.map(async (p) => {
    try {
      const { base, headers } = upstream(keys, p);
      const r = await fetch(`${base}/models`, { headers });
      if (!r.ok) return [p, { error: `HTTP ${r.status}` }] as const;
      const body = await r.json() as { data?: unknown[] };
      const list = keep(p, body.data ?? []).sort((a, b) => a.label.localeCompare(b.label));
      return [p, list] as const;
    } catch (e) { return [p, { error: (e as Error).message }] as const; }
  }));
  const data = Object.fromEntries(entries);
  if (entries.every(([, v]) => Array.isArray(v))) cache = { at: Date.now(), providers, data };
  return json(data);
}
