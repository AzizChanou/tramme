// Sounds made by a provider at authoring time: sound effects and music
// (ElevenLabs), a voice-over (ElevenLabs, OpenAI, Gemini). The keys (settings
// or secrets, see keys.ts) stay in the Worker; the editor saves the file in the
// project with what made it.
//
//   POST /api/generate {kind, prompt, duration?, voice?, style?, provider?}   the audio file
//     kind: 'sfx' | 'music' | 'voice'; prompt: what to make, or the text to say

import { HttpError, readJson } from './http.ts';
import type { Keys } from './keys.ts';

export type SoundKind = 'sfx' | 'music' | 'voice';
type Provider = 'elevenlabs' | 'openai' | 'gemini';

interface Ask { kind: SoundKind; prompt: string; duration?: number; voice?: string; style?: string }
interface Made { audio: ArrayBuffer; type: string; model: string; voice?: string }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** what a provider says when it refuses, in its own shape */
async function failure(provider: Provider, res: Response): Promise<never> {
  let message = `HTTP ${res.status}`;
  try {
    const j = await res.json() as { detail?: { message?: string } | string | { msg?: string }[]; error?: { message?: string } | string };
    const d = j.detail, e = j.error;
    message = (typeof d === 'string' ? d : Array.isArray(d) ? d.map((x) => x.msg).join('; ') : d?.message) ?? (typeof e === 'string' ? e : e?.message) ?? message;
  } catch { /* not JSON */ }
  throw new HttpError(res.status === 401 || res.status === 403 ? 502 : res.status >= 500 ? 502 : 400, `${provider}: ${message}`);
}

const ELEVEN = 'https://api.elevenlabs.io/v1';
const MP3 = 'output_format=mp3_44100_128';

const PROVIDERS: Record<Provider, { kinds: SoundKind[]; make(key: string, ask: Ask): Promise<Made> }> = {
  elevenlabs: {
    kinds: ['sfx', 'music', 'voice'],
    async make(key, ask) {
      const headers = { 'xi-api-key': key, 'content-type': 'application/json' };
      let url: string, body: Record<string, unknown>, model: string, voice: string | undefined;
      if (ask.kind === 'sfx') {
        model = 'eleven_text_to_sound_v2';
        url = `${ELEVEN}/sound-generation?${MP3}`;
        body = { text: ask.prompt, model_id: model, prompt_influence: 0.5, ...(ask.duration ? { duration_seconds: clamp(ask.duration, 0.5, 30) } : {}) };
      } else if (ask.kind === 'music') {
        model = 'music_v1';
        url = `${ELEVEN}/music?${MP3}`;
        body = { prompt: ask.prompt, model_id: model, force_instrumental: true, ...(ask.duration ? { music_length_ms: Math.round(clamp(ask.duration, 3, 600) * 1000) } : {}) };
      } else {
        model = 'eleven_multilingual_v2';
        voice = ask.voice || 'JBFqnCBsd6RMkjVDRZzb';
        url = `${ELEVEN}/text-to-speech/${encodeURIComponent(voice)}?${MP3}`;
        body = { text: ask.prompt, model_id: model };
      }
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) await failure('elevenlabs', res);
      return { audio: await res.arrayBuffer(), type: 'audio/mpeg', model, voice };
    },
  },
  openai: {
    kinds: ['voice'],
    async make(key, ask) {
      const model = 'gpt-4o-mini-tts', voice = ask.voice || 'alloy';
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, voice, input: ask.prompt.slice(0, 4096), response_format: 'mp3', ...(ask.style ? { instructions: ask.style } : {}) }),
      });
      if (!res.ok) await failure('openai', res);
      return { audio: await res.arrayBuffer(), type: 'audio/mpeg', model, voice };
    },
  },
  gemini: {
    kinds: ['voice'],
    async make(key, ask) {
      const model = 'gemini-3.8-flash-tts', voice = ask.voice || 'Kore';
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          input: [{ type: 'user_input', content: [{ type: 'text', text: ask.prompt, ...(ask.style ? { annotations: [{ type: 'speech_metadata', style: ask.style }] } : {}) }] }],
          response_format: { type: 'audio', mime_type: 'audio/wav' },
          generation_config: { speech_config: [{ voice }] },
        }),
      });
      if (!res.ok) await failure('gemini', res);
      const j = await res.json() as { steps?: { content?: { data?: string; mime_type?: string }[] }[] };
      const part = (j.steps ?? []).flatMap((s) => s.content ?? []).find((c) => typeof c.data === 'string');
      if (!part?.data) throw new HttpError(502, 'gemini: no audio in the answer');
      const bin = atob(part.data), audio = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) audio[i] = bin.charCodeAt(i);
      return { audio: audio.buffer, type: part.mime_type ?? 'audio/wav', model, voice };
    },
  },
};

/** the providers connected, by kind of sound (first one used when none is named) */
export function soundConfig(keys: Keys): Record<SoundKind, Provider[]> {
  const has = (Object.keys(PROVIDERS) as Provider[]).filter((p) => keys.get(p));
  return { sfx: has.filter((p) => PROVIDERS[p].kinds.includes('sfx')), music: has.filter((p) => PROVIDERS[p].kinds.includes('music')), voice: has.filter((p) => PROVIDERS[p].kinds.includes('voice')) };
}

export async function generate(req: Request, keys: Keys) {
  const b = await readJson<Partial<Ask> & { provider?: string }>(req);
  if (b.kind !== 'sfx' && b.kind !== 'music' && b.kind !== 'voice') throw new HttpError(400, 'kind: sfx, music or voice');
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) throw new HttpError(400, b.kind === 'voice' ? 'the text to say is missing' : 'say what to make (prompt)');
  if (prompt.length > 4000) throw new HttpError(413, 'prompt too long (4000 characters at most)');
  const able = soundConfig(keys)[b.kind];
  const provider = (b.provider ?? able[0]) as Provider | undefined;
  if (!provider || !PROVIDERS[provider]) {
    const secrets = (Object.keys(PROVIDERS) as Provider[]).filter((p) => PROVIDERS[p].kinds.includes(b.kind!)).map((p) => keys.secret(p));
    throw new HttpError(503, `no provider for ${b.kind}: connect one in Settings, Providers (or npx wrangler secret put ${secrets.join(' or ')})`);
  }
  if (!PROVIDERS[provider].kinds.includes(b.kind)) throw new HttpError(400, `${provider} does not make ${b.kind}`);
  const key = keys.get(provider);
  if (!key) throw new HttpError(503, `no ${provider} key: connect it in Settings, Providers (or npx wrangler secret put ${keys.secret(provider)})`);
  const ask: Ask = { kind: b.kind, prompt, duration: typeof b.duration === 'number' ? b.duration : undefined, voice: typeof b.voice === 'string' ? b.voice : undefined, style: typeof b.style === 'string' ? b.style.slice(0, 500) : undefined };
  const made = await PROVIDERS[provider].make(key, ask);
  return new Response(made.audio, {
    headers: { 'content-type': made.type, 'cache-control': 'no-store', 'x-tramme-provider': provider, 'x-tramme-model': made.model, ...(made.voice ? { 'x-tramme-voice': made.voice } : {}) },
  });
}
