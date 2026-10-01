// Speech to text with Whisper on Workers AI: one chunk of audio per request
// (WAV, 16 kHz mono, about 30 s), its words with their timing. The editor cuts
// a long sound into chunks and puts the words together.

import { HttpError, json, readJson, type Env } from './http.ts';

const MODEL = '@cf/openai/whisper-large-v3-turbo';
/** a chunk of 30 s at 16 kHz in 16 bits is about 1 MB, 1.4 MB in base64 */
const MAX_BASE64 = 8 * 1024 * 1024;

interface WhisperOut {
  text?: string;
  transcription_info?: { language?: string; duration?: number };
  segments?: { start?: number; end?: number; text?: string; words?: { word?: string; start?: number; end?: number }[] }[];
}

export async function transcribe(req: Request, env: Env) {
  if (!env.AI) throw new HttpError(503, 'transcription unavailable on this server (Workers AI not configured)');
  const b = await readJson<{ audio?: string; language?: string; prompt?: string }>(req);
  if (typeof b.audio !== 'string' || !b.audio) throw new HttpError(400, 'audio expected (WAV in base64)');
  if (b.audio.length > MAX_BASE64) throw new HttpError(413, 'audio chunk too long (about 30 s expected)');
  let out: WhisperOut;
  try {
    out = (await env.AI.run(MODEL, {
      audio: b.audio,
      task: 'transcribe',
      ...(b.language ? { language: b.language } : {}),
      ...(b.prompt ? { initial_prompt: b.prompt.slice(0, 500) } : {}),
      // less invention on silences and repetitions
      condition_on_previous_text: false,
      vad_filter: true,
    } as never)) as WhisperOut;
  } catch (e) {
    throw new HttpError(502, `transcription : ${(e as Error).message}`);
  }
  const words = (out.segments ?? []).flatMap((s) => (s.words ?? []).map((w) => ({ w: String(w.word ?? '').trim(), s: Number(w.start ?? 0), e: Number(w.end ?? 0) })))
    .filter((w) => w.w && Number.isFinite(w.s) && Number.isFinite(w.e));
  return json({ words, text: out.text ?? '', language: out.transcription_info?.language, duration: out.transcription_info?.duration });
}
