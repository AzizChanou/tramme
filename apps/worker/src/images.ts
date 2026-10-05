// Pictures made by a provider at authoring time: OpenAI (gpt-image-1),
// Gemini (its image model), Z.AI (CogView). The keys (settings or secrets,
// see keys.ts) stay in the Worker; the editor saves the file in the project
// with what made it (see docs/generation-roadmap.md).
//
//   POST /api/generate-image {prompt, ratio?, quality?, provider?}   the picture file
//     ratio: the proportions asked for, named as Gemini does ('1:1', '16:9',
//     '9:16'…; '1:1' when the composition's is not in the list)

import { HttpError, readJson } from './http.ts';
import { providerFailure } from './generate.ts';
import type { Keys } from './keys.ts';

export type ImageProvider = 'openai' | 'gemini' | 'zai';

interface Ask { prompt: string; ratio: string; quality?: 'low' | 'medium' | 'high' }
interface Made { image: ArrayBuffer; type: string; model: string }

/** the proportions each provider takes: OpenAI three sizes, Z.AI the sizes CogView takes, Gemini as asked */
export const RATIOS = ['21:9', '16:9', '9:16', '5:4', '4:5', '3:2', '2:3', '4:3', '3:4', '1:1'] as const;
const WIDE = ['21:9', '16:9', '3:2', '5:4'], TALL = ['9:16', '2:3', '4:5', '3:4'];

const b64 = (s: string): ArrayBuffer => {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
};

const OPENAI_MODEL = 'gpt-image-1', GEMINI_MODEL = 'gemini-3.8-flash-image', ZAI_MODEL = 'cogview-4';

export const IMAGE_PROVIDERS: Record<ImageProvider, { make(key: string, ask: Ask): Promise<Made> }> = {
  openai: {
    async make(key, ask) {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: OPENAI_MODEL, prompt: ask.prompt, size: WIDE.includes(ask.ratio) ? '1536x1024' : TALL.includes(ask.ratio) ? '1024x1536' : '1024x1024', ...(ask.quality ? { quality: ask.quality } : {}) }),
      });
      if (!res.ok) await providerFailure('openai', res);
      const j = await res.json() as { data?: { b64_json?: string }[] };
      const d = j.data?.[0];
      if (!d?.b64_json) throw new HttpError(502, 'openai: no picture in the answer');
      return { image: b64(d.b64_json), type: 'image/png', model: OPENAI_MODEL };
    },
  },
  gemini: {
    async make(key, ask) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
        method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: ask.prompt }] }],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ask.ratio } },
        }),
      });
      if (!res.ok) await providerFailure('gemini', res);
      const j = await res.json() as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
      const part = (j.candidates?.[0]?.content?.parts ?? []).find((p) => typeof p.inlineData?.data === 'string');
      if (!part?.inlineData?.data) throw new HttpError(502, 'gemini: no picture in the answer');
      return { image: b64(part.inlineData.data), type: part.inlineData.mimeType ?? 'image/png', model: GEMINI_MODEL };
    },
  },
  zai: {
    async make(key, ask) {
      const res = await fetch('https://api.z.ai/api/paas/v4/images/generations', {
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: ZAI_MODEL, prompt: ask.prompt, size: WIDE.includes(ask.ratio) ? '1280x720' : TALL.includes(ask.ratio) ? '720x1280' : '1024x1024' }),
      });
      if (!res.ok) await providerFailure('zai', res);
      const j = await res.json() as { data?: { url?: string; b64_json?: string }[] };
      const d = j.data?.[0];
      if (d?.b64_json) return { image: b64(d.b64_json), type: 'image/png', model: ZAI_MODEL };
      if (!d?.url) throw new HttpError(502, 'zai: no picture in the answer');
      const got = await fetch(d.url);
      if (!got.ok) throw new HttpError(502, `zai: the picture it names could not be read (HTTP ${got.status})`);
      const type = (got.headers.get('content-type') ?? 'image/png').split(';')[0];
      return { image: await got.arrayBuffer(), type: type.startsWith('image/') ? type : 'image/png', model: ZAI_MODEL };
    },
  },
};

/** the providers connected, the first one used when none is named */
export function imageConfig(keys: Keys): ImageProvider[] {
  return (Object.keys(IMAGE_PROVIDERS) as ImageProvider[]).filter((p) => keys.get(p));
}

export async function generateImage(req: Request, keys: Keys) {
  const b = await readJson<Partial<Ask> & { provider?: string }>(req);
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) throw new HttpError(400, 'say what to draw (prompt)');
  if (prompt.length > 4000) throw new HttpError(413, 'prompt too long (4000 characters at most)');
  const ratio = RATIOS.includes(String(b.ratio) as typeof RATIOS[number]) ? String(b.ratio) : '1:1';
  const quality = ['low', 'medium', 'high'].includes(String(b.quality)) ? String(b.quality) as Ask['quality'] : undefined;
  const provider = (b.provider ?? imageConfig(keys)[0]) as ImageProvider | undefined;
  if (!provider || !IMAGE_PROVIDERS[provider]) {
    const secrets = (Object.keys(IMAGE_PROVIDERS) as ImageProvider[]).map((p) => keys.secret(p));
    throw new HttpError(503, `no provider for pictures: connect one in Settings, Providers (or npx wrangler secret put ${secrets.join(' or ')})`);
  }
  const key = keys.get(provider);
  if (!key) throw new HttpError(503, `no ${provider} key: connect it in Settings, Providers (or npx wrangler secret put ${keys.secret(provider)})`);
  const made = await IMAGE_PROVIDERS[provider].make(key, { prompt, ratio, quality });
  return new Response(made.image, {
    headers: { 'content-type': made.type, 'cache-control': 'no-store', 'x-tramme-provider': provider, 'x-tramme-model': made.model },
  });
}
