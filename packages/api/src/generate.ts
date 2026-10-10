// Sounds made by a provider at authoring time: sound effects and music
// (ElevenLabs), a voice-over (ElevenLabs, OpenAI, Gemini). The keys (settings
// or secrets, see keys.ts) never reach the editor, which saves the file in the
// project with what made it.
//
//   POST /api/generate {kind, prompt, duration?, voice?, style?, model?, provider?}   the audio file
//     kind: 'sfx' | 'music' | 'voice'; prompt: what to make, or the text to say
//   GET  /api/voices?provider=&search=&language=&accent=&gender=   the voices a voice-over can take

import { HttpError, json, readJson } from './http.ts';
import type { Keys } from './keys.ts';
import type { Reach } from './providers.ts';

export type SoundKind = 'sfx' | 'music' | 'voice';
type Provider = 'elevenlabs' | 'openai' | 'gemini';

interface Ask { kind: SoundKind; prompt: string; duration?: number; voice?: string; style?: string; model?: string }
interface Made { audio: ArrayBuffer; type: string; model: string; voice?: string }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** what a provider says when it refuses, in its own shape (shared with the pictures, images.ts) */
export async function providerFailure(provider: string, res: Response): Promise<never> {
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

/** the voice models of ElevenLabs and their names, the default first; v4 and v3 read audio tags ([whispers], [said warmly in a French accent]) */
export const ELEVEN_VOICE_MODELS: Record<string, string> = { eleven_v4: 'Eleven v4', eleven_v4_turbo: 'Eleven v4 Turbo', eleven_v3: 'Eleven v3', eleven_multilingual_v2: 'Multilingual v2', eleven_flash_v2_5: 'Flash v2.5' };
const ELEVEN_VOICE_DEFAULT = Object.keys(ELEVEN_VOICE_MODELS)[0];
const TAGGED = new Set(['eleven_v4', 'eleven_v4_turbo', 'eleven_v3']);
const ELEVEN_DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb';

const PROVIDERS: Record<Provider, { kinds: SoundKind[]; make(key: string, ask: Ask, fetch: Reach['fetch']): Promise<Made> }> = {
  elevenlabs: {
    kinds: ['sfx', 'music', 'voice'],
    async make(key, ask, fetch) {
      const headers = { 'xi-api-key': key, 'content-type': 'application/json' };
      const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      let res: Response, model: string, voice: string | undefined;
      if (ask.kind === 'sfx') {
        model = 'eleven_text_to_sound_v2';
        res = await post(`${ELEVEN}/sound-generation?${MP3}`, { text: ask.prompt, model_id: model, prompt_influence: 0.5, ...(ask.duration ? { duration_seconds: clamp(ask.duration, 0.5, 30) } : {}) });
      } else if (ask.kind === 'music') {
        model = 'music_v2_5';
        res = await post(`${ELEVEN}/music?${MP3}`, { prompt: ask.prompt, model_id: model, force_instrumental: true, ...(ask.duration ? { music_length_ms: Math.round(clamp(ask.duration, 3, 600) * 1000) } : {}) });
      } else {
        model = ask.model && ask.model in ELEVEN_VOICE_MODELS ? ask.model : ELEVEN_VOICE_DEFAULT;
        // a voice of the shared library comes as owner/voice: it is added to the account when the provider does not know it yet
        const [owner, id] = (ask.voice || ELEVEN_DEFAULT_VOICE).includes('/') ? ask.voice!.split('/', 2) : [null, ask.voice || ELEVEN_DEFAULT_VOICE];
        // the way it is said: an audio tag where the model reads them
        const body = { text: ask.style && TAGGED.has(model) ? `[${ask.style}] ${ask.prompt}` : ask.prompt, model_id: model };
        const say = (v: string) => post(`${ELEVEN}/text-to-speech/${encodeURIComponent(v)}?${MP3}`, body);
        voice = id;
        res = await say(voice);
        if (!res.ok && owner && (res.status === 400 || res.status === 404)) {
          const added = await post(`${ELEVEN}/voices/add/${encodeURIComponent(owner)}/${encodeURIComponent(id)}`, { new_name: `tramme ${id}` });
          if (!added.ok) await providerFailure('elevenlabs', added);
          voice = ((await added.json()) as { voice_id?: string }).voice_id ?? id;
          res = await say(voice);
        }
      }
      if (!res.ok) await providerFailure('elevenlabs', res);
      return { audio: await res.arrayBuffer(), type: 'audio/mpeg', model, voice };
    },
  },
  openai: {
    kinds: ['voice'],
    async make(key, ask, fetch) {
      const model = 'gpt-4o-mini-tts', voice = ask.voice || 'alloy';
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, voice, input: ask.prompt.slice(0, 4096), response_format: 'mp3', ...(ask.style ? { instructions: ask.style } : {}) }),
      });
      if (!res.ok) await providerFailure('openai', res);
      return { audio: await res.arrayBuffer(), type: 'audio/mpeg', model, voice };
    },
  },
  gemini: {
    kinds: ['voice'],
    async make(key, ask, fetch) {
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
      if (!res.ok) await providerFailure('gemini', res);
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

export async function generate(req: Request, { keys, fetch }: Reach) {
  const b = await readJson<Partial<Ask> & { provider?: string }>(req);
  if (b.kind !== 'sfx' && b.kind !== 'music' && b.kind !== 'voice') throw new HttpError(400, 'kind: sfx, music or voice');
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) throw new HttpError(400, b.kind === 'voice' ? 'the text to say is missing' : 'say what to make (prompt)');
  if (prompt.length > 4000) throw new HttpError(413, 'prompt too long (4000 characters at most)');
  const able = soundConfig(keys)[b.kind];
  const provider = (b.provider ?? able[0]) as Provider | undefined;
  if (!provider || !PROVIDERS[provider]) {
    const makers = (Object.keys(PROVIDERS) as Provider[]).filter((p) => PROVIDERS[p].kinds.includes(b.kind!));
    throw new HttpError(503, `no provider for ${b.kind}: ${keys.how(makers, 'one')}`);
  }
  if (!PROVIDERS[provider].kinds.includes(b.kind)) throw new HttpError(400, `${provider} does not make ${b.kind}`);
  const key = keys.get(provider);
  if (!key) throw new HttpError(503, `no ${provider} key: ${keys.how([provider])}`);
  const ask: Ask = { kind: b.kind, prompt, duration: typeof b.duration === 'number' ? b.duration : undefined, voice: typeof b.voice === 'string' ? b.voice : undefined, style: typeof b.style === 'string' ? b.style.slice(0, 500) : undefined, model: typeof b.model === 'string' ? b.model : undefined };
  const made = await PROVIDERS[provider].make(key, ask, fetch);
  return new Response(made.audio, {
    headers: { 'content-type': made.type, 'cache-control': 'no-store', 'x-tramme-provider': provider, 'x-tramme-model': made.model, ...(made.voice ? { 'x-tramme-voice': made.voice } : {}) },
  });
}

// ── the voices ───────────────────────────────────────────────
export interface Voice {
  /** what generate takes as voice: an id, a name, or owner/id for a voice of the ElevenLabs library */
  id: string;
  name: string;
  provider: Provider;
  /** the account's own voices, the provider's shared library, or the provider's fixed set */
  source: 'account' | 'library' | 'built-in';
  accent?: string;
  gender?: string;
  age?: string;
  language?: string;
  description?: string;
  /** a sample to listen to */
  preview?: string;
}

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
const GEMINI_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];

type Labels = { accent?: string; gender?: string; age?: string; language?: string; description?: string };
const FILTERS = ['search', 'language', 'accent', 'gender', 'age'] as const;

/** the voices a voice-over can take: ElevenLabs' (the account's, then its library, filtered), OpenAI's and Gemini's fixed sets */
export async function voices(req: Request, { keys, fetch }: Reach) {
  const q = new URL(req.url).searchParams;
  const provider = (q.get('provider') || soundConfig(keys).voice[0]) as Provider | undefined;
  if (!provider || !PROVIDERS[provider]?.kinds.includes('voice')) throw new HttpError(provider ? 400 : 503, provider ? `${provider} makes no voice-over` : `no provider for voice: ${keys.how(['elevenlabs', 'openai', 'gemini'], 'one')}`);
  const search = (q.get('search') ?? '').toLowerCase();
  if (provider !== 'elevenlabs') {
    const names = provider === 'openai' ? OPENAI_VOICES : GEMINI_VOICES;
    return json({ voices: names.filter((n) => !search || n.toLowerCase().includes(search)).map((name): Voice => ({ id: name, name, provider, source: 'built-in' })) });
  }
  const key = keys.get('elevenlabs');
  if (!key) throw new HttpError(503, `no elevenlabs key: ${keys.how(['elevenlabs'])}`);
  const headers = { 'xi-api-key': key };
  const filters = Object.fromEntries(FILTERS.flatMap((f) => (q.get(f) ? [[f, q.get(f)!]] : [])));
  const mine = await fetch(`https://api.elevenlabs.io/v2/voices?page_size=100${filters.search ? `&search=${encodeURIComponent(filters.search)}` : ''}`, { headers });
  if (!mine.ok) await providerFailure('elevenlabs', mine);
  const shared = await fetch(`${ELEVEN}/shared-voices?${new URLSearchParams({ page_size: '40', ...filters })}`, { headers });
  // the account's voices are filtered here, the library filters its own
  const fits = (l: Labels) => (['language', 'accent', 'gender', 'age'] as const).every((f) => !filters[f] || (l[f] ?? '').toLowerCase().includes(filters[f].toLowerCase()));
  const own = ((await mine.json()) as { voices?: { voice_id: string; name: string; labels?: Labels; description?: string; preview_url?: string }[] }).voices ?? [];
  const lib = shared.ok ? ((await shared.json()) as { voices?: ({ public_owner_id: string; voice_id: string; name: string; preview_url?: string } & Labels)[] }).voices ?? [] : [];
  const list: Voice[] = [
    ...own.filter((v) => fits(v.labels ?? {})).map((v): Voice => ({ id: v.voice_id, name: v.name, provider, source: 'account', ...pick(v.labels ?? {}), description: v.description ?? v.labels?.description, preview: v.preview_url })),
    ...lib.map((v): Voice => ({ id: `${v.public_owner_id}/${v.voice_id}`, name: v.name, provider, source: 'library', ...pick(v), preview: v.preview_url })),
  ];
  return json({ voices: list });
}

const pick = (l: Labels) => Object.fromEntries((['accent', 'gender', 'age', 'language', 'description'] as const).flatMap((k) => (l[k] ? [[k, String(l[k]).slice(0, 200)]] : [])));
