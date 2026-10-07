// Speech to text with the user's OpenAI key (Whisper): one chunk of audio per
// request (WAV, 16 kHz mono, about 30 s), its words with their timing, in the
// shape the private Worker answers with Workers AI (apps/worker/src/speech.ts).
// The editor cuts a long sound into chunks and puts the words together.
//
//   POST /api/transcribe {audio: WAV base64, language?, prompt?}   {words: [{w, s, e}], text, language?, duration?}

import { HttpError, json, readJson } from './http.ts';
import { providerFailure } from './generate.ts';
import type { Keys } from './keys.ts';
import type { Reach } from './providers.ts';

const MODEL = 'whisper-1';
/** a chunk of 30 s at 16 kHz in 16 bits is about 1 MB, 1.4 MB in base64 */
const MAX_BASE64 = 8 * 1024 * 1024;

interface WhisperOut {
  text?: string;
  language?: string;
  duration?: number;
  words?: { word?: string; start?: number; end?: number }[];
}

export const transcribeConfig = (keys: Keys) => !!keys.get('openai');

export async function transcribe(req: Request, { keys, fetch }: Reach) {
  const key = keys.get('openai');
  if (!key) throw new HttpError(503, `no OpenAI key for the transcription: ${keys.how(['openai'])}`);
  const b = await readJson<{ audio?: string; language?: string; prompt?: string }>(req);
  if (typeof b.audio !== 'string' || !b.audio) throw new HttpError(400, 'audio expected (WAV in base64)');
  if (b.audio.length > MAX_BASE64) throw new HttpError(413, 'audio chunk too long (about 30 s expected)');
  let wav: Uint8Array<ArrayBuffer>;
  try { wav = Uint8Array.from(atob(b.audio), (c) => c.charCodeAt(0)); } catch { throw new HttpError(400, 'audio expected (WAV in base64)'); }
  const form = new FormData();
  form.set('file', new Blob([wav], { type: 'audio/wav' }), 'chunk.wav');
  form.set('model', MODEL);
  form.set('response_format', 'verbose_json');
  form.set('timestamp_granularities[]', 'word');
  // Whisper names the language it heard ("english"), but takes only its code back
  if (typeof b.language === 'string' && /^[a-z]{2}$/.test(b.language)) form.set('language', b.language);
  if (typeof b.prompt === 'string' && b.prompt) form.set('prompt', b.prompt.slice(0, 500));
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form });
  if (!res.ok) await providerFailure('openai', res);
  const out = await res.json() as WhisperOut;
  const words = (out.words ?? []).map((w) => ({ w: String(w.word ?? '').trim(), s: Number(w.start ?? 0), e: Number(w.end ?? 0) }))
    .filter((w) => w.w && Number.isFinite(w.s) && Number.isFinite(w.e));
  return json({ words, text: out.text ?? '', language: out.language, duration: out.duration });
}
