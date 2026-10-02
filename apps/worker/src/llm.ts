// Models of other providers than Anthropic, for the assistant: OpenAI, Gemini,
// OpenRouter and Z.AI (GLM) all speak the OpenAI chat format. The browser sends its
// request here, the Worker adds the key (a secret) and passes the stream back.
// The keys never leave the Worker. Local models are reached by the browser
// directly and never come here.
//
//   POST /api/llm/:provider/chat/completions   the request, streamed back
//   GET  /api/models                           models offered by each configured provider

import { HttpError, json, type Env } from './http.ts';

type Remote = 'openai' | 'gemini' | 'openrouter' | 'zai';

const PROVIDERS: Record<Remote, { base: string; key: (env: Env) => string | undefined; secret: string; headers?: Record<string, string> }> = {
  openai: { base: 'https://api.openai.com/v1', key: (e) => e.OPENAI_API_KEY, secret: 'OPENAI_API_KEY' },
  gemini: { base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: (e) => e.GEMINI_API_KEY, secret: 'GEMINI_API_KEY' },
  openrouter: { base: 'https://openrouter.ai/api/v1', key: (e) => e.OPENROUTER_API_KEY, secret: 'OPENROUTER_API_KEY', headers: { 'x-title': 'Tramme' } },
  zai: { base: 'https://api.z.ai/api/paas/v4', key: (e) => e.ZAI_API_KEY ?? e.GLM_API_KEY, secret: 'ZAI_API_KEY' },
};

const isRemote = (p: string): p is Remote => p in PROVIDERS;
const PASS_DOWN = ['content-type', 'retry-after', 'x-request-id'];

/** which providers have a key on this server */
export const llmConfig = (env: Env) => Object.fromEntries((Object.keys(PROVIDERS) as Remote[]).map((p) => [p, !!PROVIDERS[p].key(env)])) as Record<Remote, boolean>;

function upstream(env: Env, provider: Remote) {
  const p = PROVIDERS[provider];
  const key = p.key(env);
  if (!key) throw new HttpError(503, `no ${provider} key on the server (npx wrangler secret put ${p.secret})`);
  return { base: p.base, headers: { authorization: `Bearer ${key}`, ...p.headers } };
}

export async function llm(req: Request, env: Env, provider: string, rest: string) {
  if (!isRemote(provider)) throw new HttpError(404, `unknown provider: ${provider}`);
  if (req.method !== 'POST' || rest !== 'chat/completions') throw new HttpError(404, 'unknown route');
  const { base, headers } = upstream(env, provider);
  const up = await fetch(`${base}/chat/completions`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: req.body, signal: req.signal });
  const down = new Headers({ 'cache-control': 'no-store' });
  for (const h of PASS_DOWN) { const v = up.headers.get(h); if (v) down.set(h, v); }
  return new Response(up.body, { status: up.status, headers: down });
}

export interface ModelInfo { id: string; label: string }

/** the models worth offering: chat models, without dated copies, audio, images or embeddings */
function keep(provider: Remote, list: any[]): ModelInfo[] {
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
  // OpenRouter: only the models that take tools
  return list.filter((m) => Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools'))
    .map((m) => ({ id: String(m.id), label: String(m.name ?? m.id) }));
}

/** asked again at most every 10 minutes (per Worker instance) */
let cache: { at: number; data: Record<string, ModelInfo[] | { error: string }> } | null = null;

export async function models(env: Env) {
  if (cache && Date.now() - cache.at < 10 * 60_000) return json(cache.data);
  const configured = (Object.keys(PROVIDERS) as Remote[]).filter((p) => PROVIDERS[p].key(env));
  const entries = await Promise.all(configured.map(async (p) => {
    try {
      const { base, headers } = upstream(env, p);
      const r = await fetch(`${base}/models`, { headers });
      if (!r.ok) return [p, { error: `HTTP ${r.status}` }] as const;
      const body = await r.json() as { data?: unknown[] };
      const list = keep(p, body.data ?? []).sort((a, b) => a.label.localeCompare(b.label));
      return [p, list] as const;
    } catch (e) { return [p, { error: (e as Error).message }] as const; }
  }));
  const data = Object.fromEntries(entries);
  if (entries.every(([, v]) => Array.isArray(v))) cache = { at: Date.now(), data };
  return json(data);
}
