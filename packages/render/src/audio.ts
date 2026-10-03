// The one mixer of tramme: the editor's preview plays through it (live), the
// browser exports and the command line mix with it (offline). Each clip of
// audioClips (@tramme/core) goes through its filters, its gain (curve and
// fades) and the room of the reverb. Also: the WAV encoder, and the synth
// that turns a sound's code into samples.

import { audioClips, gainAt, gainMoves, type AudioClip, type TrammeDoc } from '@tramme/core';

export const MIX_RATE = 48000;
/** samples of a moving gain per second */
const GAIN_RATE = 100;

/** a seeded random generator in [0, 1): the same sounds on every machine */
export function seeded(seed: number): () => number {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

/** the room of the reverb: a decaying noise, the same everywhere */
const rooms = new WeakMap<BaseAudioContext, AudioBuffer>();
function room(ctx: BaseAudioContext): AudioBuffer {
  let b = rooms.get(ctx);
  if (!b) {
    const n = Math.round(ctx.sampleRate * 1.8), rnd = seeded(7);
    b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (rnd() * 2 - 1) * Math.pow(1 - i / n, 3) * 0.5; }
    rooms.set(ctx, b);
  }
  return b;
}

/**
 * The chain of one clip into `out`: filters, then its gain, the reverb beside
 * it. `from` is the composition time played at `startAt` (time of the
 * context). Returns the node a source connects to.
 */
export function clipChain(ctx: BaseAudioContext, clip: AudioClip, out: AudioNode, startAt: number, from: number): AudioNode {
  const stages: AudioNode[] = [];
  if (clip.lowCut > 0) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = clip.lowCut; stages.push(f); }
  if (clip.highCut > 0) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = clip.highCut; stages.push(f); }
  const gain = ctx.createGain();
  stages.push(gain);
  stages.reduce((a, b) => a.connect(b));
  gain.connect(out);
  if (clip.reverb > 0) {
    const send = ctx.createGain(), conv = ctx.createConvolver();
    send.gain.value = clip.reverb;
    conv.buffer = room(ctx);
    gain.connect(send).connect(conv).connect(out);
  }
  const begin = Math.max(from, clip.at), end = clip.at + clip.duration;
  if (!gainMoves(clip)) gain.gain.value = gainAt(clip, begin);
  else if (end > begin) {
    const n = Math.max(2, Math.ceil((end - begin) * GAIN_RATE) + 1);
    const curve = Float32Array.from({ length: n }, (_, i) => gainAt(clip, begin + ((end - begin) * i) / (n - 1)));
    gain.gain.value = curve[0];
    gain.gain.setValueCurveAtTime(curve, startAt + (begin - from), end - begin);
  }
  return stages[0];
}

/** plays a decoded clip into `out`; null when it is over at `from` */
export function playClip(ctx: BaseAudioContext, clip: AudioClip, buffer: AudioBuffer, out: AudioNode, startAt: number, from: number): AudioBufferSourceNode | null {
  const skip = Math.max(0, from - clip.at);
  // the file goes by duration × rate
  const offset = clip.offset + skip * clip.rate, length = (clip.duration - skip) * clip.rate;
  if (length <= 0 || offset >= buffer.duration) return null;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = clip.rate;
  src.connect(clipChain(ctx, clip, out, startAt, from));
  src.start(startAt + Math.max(0, clip.at - from), offset, length);
  return src;
}

/** the composition's sound over [from, to], mixed offline at 48 kHz stereo; null when it has none */
export async function mixComposition(doc: TrammeDoc, compId: string, url: (asset: string) => string, opts: { from?: number; to?: number } = {}): Promise<AudioBuffer | null> {
  const comp = doc.compositions[compId];
  const from = opts.from ?? 0, to = opts.to ?? comp.duration;
  const clips = audioClips(doc, compId).filter((c) => c.at < to && c.at + c.duration > from);
  if (!clips.length) return null;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil((to - from) * MIX_RATE)), MIX_RATE);
  const decoded = new Map<string, Promise<AudioBuffer | null>>();
  for (const c of clips) {
    let p = decoded.get(c.asset);
    if (!p) {
      p = fetch(url(c.asset)).then((r) => r.arrayBuffer()).then((d) => ctx.decodeAudioData(d)).catch(() => null);
      decoded.set(c.asset, p);
    }
    const b = await p;
    if (b) playClip(ctx, c, b, ctx.destination, 0, from);
  }
  return ctx.startRendering();
}

/** 16-bit PCM WAV of a buffer */
export function encodeWav(buf: AudioBuffer): Uint8Array {
  const ch = buf.numberOfChannels, n = buf.length, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < ch; c++, o += 2) out.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true);
  return new Uint8Array(out.buffer);
}

// ── synthesis: a sound written as code ───────────────────────

/** what a sound's code receives besides its OfflineAudioContext */
export interface SynthKit {
  /** seconds of the sound */
  duration: number;
  seed: number;
  /** seeded random number in [0, 1) */
  random(): number;
  /** a source of seeded noise (white, pink or brown), not started */
  noise(color?: 'white' | 'pink' | 'brown', seconds?: number): AudioBufferSourceNode;
  /** sets a parameter along [time, value] points: linear ramps, or exponential ones (values above 0) */
  env(param: AudioParam, points: [number, number][], curve?: 'linear' | 'exp'): AudioParam;
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;

/** longest sound the synth makes */
export const SYNTH_MAX = 30;

/**
 * Runs a sound's code: the body of an async function (ctx, kit) building a
 * Web Audio graph on ctx (an OfflineAudioContext of `duration` seconds,
 * stereo, 48 kHz) into ctx.destination. Rendered, then brought to a peak of
 * -1 dBFS so every sound starts at the same level.
 */
export async function renderSynth(code: string, opts: { duration: number; seed?: number; signal?: AbortSignal; timeoutMs?: number }): Promise<AudioBuffer> {
  const duration = Math.min(SYNTH_MAX, Math.max(0.05, opts.duration)), seed = opts.seed ?? 1;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * MIX_RATE), MIX_RATE);
  const random = seeded(seed);
  const kit: SynthKit = {
    duration, seed, random,
    noise(color = 'white', seconds = duration) {
      const n = Math.max(1, Math.ceil(seconds * MIX_RATE)), b = ctx.createBuffer(2, n, MIX_RATE);
      for (let c = 0; c < 2; c++) {
        const d = b.getChannelData(c);
        let b0 = 0, b1 = 0, b2 = 0, last = 0;
        for (let i = 0; i < n; i++) {
          const w = random() * 2 - 1;
          if (color === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
          else if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
          else d[i] = w;
        }
      }
      const src = ctx.createBufferSource();
      src.buffer = b;
      return src;
    },
    env(param, points, curve = 'linear') {
      const [[t0, v0], ...rest] = points;
      param.setValueAtTime(v0, t0);
      for (const [t, v] of rest) {
        if (curve === 'exp' && v > 0) param.exponentialRampToValueAtTime(v, t);
        else param.linearRampToValueAtTime(v, t);
      }
      return param;
    },
  };
  await new AsyncFunction('ctx', 'kit', code)(ctx, kit);
  const timeout = opts.timeoutMs ?? 20000;
  const out = await new Promise<AudioBuffer>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the sound took more than ${timeout / 1000} s to render`)), timeout);
    opts.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('stopped')); }, { once: true });
    ctx.startRendering().then((b) => { clearTimeout(timer); resolve(b); }, (e) => { clearTimeout(timer); reject(e); });
  });
  let peak = 0;
  for (let c = 0; c < out.numberOfChannels; c++) for (const v of out.getChannelData(c)) peak = Math.max(peak, Math.abs(v));
  if (peak === 0) throw new Error('the sound is silent: connect it to ctx.destination and start its sources');
  const k = Math.pow(10, -1 / 20) / peak;
  for (let c = 0; c < out.numberOfChannels; c++) { const d = out.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
  return out;
}
