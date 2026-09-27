// Speech to text on this machine, for the companion: Whisper run locally with
// transformers.js (no account, no key). The model downloads once, on first
// use, into the user's cache. Same input and output as the Worker's route:
// a WAV chunk (16 kHz mono) in, words with their timing out.

const MODEL = process.env.TRAMME_WHISPER_MODEL ?? 'Xenova/whisper-small';

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: { text: string; timestamp: [number, number | null] }[] }>;
let asr: Promise<Asr> | null = null;

function model(): Promise<Asr> {
  asr ??= import('@huggingface/transformers').then(async ({ pipeline }) => (await pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8' } as never)) as unknown as Asr);
  return asr;
}

/** 16-bit PCM WAV (mono) as samples between -1 and 1 */
function pcm(wav: Buffer): { samples: Float32Array; rate: number } {
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('WAV expected');
  let o = 12, rate = 16000, channels = 1, bits = 16;
  while (o + 8 <= wav.length) {
    const id = wav.toString('ascii', o, o + 4), size = wav.readUInt32LE(o + 4);
    if (id === 'fmt ') { channels = wav.readUInt16LE(o + 10); rate = wav.readUInt32LE(o + 12); bits = wav.readUInt16LE(o + 22); }
    if (id === 'data') {
      if (bits !== 16) throw new Error('16-bit WAV expected');
      const n = Math.floor(size / 2 / channels), out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = wav.readInt16LE(o + 8 + i * 2 * channels) / 32768;
      return { samples: out, rate };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error('WAV without data');
}

export async function transcribeLocal(audioBase64: string, language?: string) {
  const { samples, rate } = pcm(Buffer.from(audioBase64, 'base64'));
  if (rate !== 16000) throw new Error(`16 kHz expected (got ${rate} Hz)`);
  const run = await model();
  const out = await run(samples, { return_timestamps: 'word', chunk_length_s: 30, ...(language ? { language } : {}), task: 'transcribe' });
  const words = (out.chunks ?? []).map((c) => ({ w: c.text.trim(), s: c.timestamp[0], e: c.timestamp[1] ?? c.timestamp[0] })).filter((w) => w.w);
  return { words, text: out.text.trim(), language, duration: samples.length / rate };
}
