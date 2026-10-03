// The sounds of a composition, each where it plays: audio layers, and the
// sound of video layers not muted. A layer plays its file from `start`, from
// its in point to its out point: several layers of one file make the cuts of
// an edit. How each one sounds (gain and its curve, fades, speed, filters,
// reverb) is read here once; the preview, the exports and the command line
// mix the same clips with one mixer (@tramme/render, audio.ts).

import { propKind, sampleKeyframes, staticValue } from './props.ts';
import type { Keyframe, TrammeDoc } from './types.ts';

export interface AudioClip {
  layerId: string;
  /** asset id of the file */
  asset: string;
  /** composition time (s) where the clip starts */
  at: number;
  /** time in the file (s) played at `at` */
  offset: number;
  /** composition seconds played (the file goes by `duration × rate`) */
  duration: number;
  /** gain when it does not move (dB) */
  gainDb: number;
  /** gain over time when it is animated: [composition time, dB] from `at` to `at + duration` */
  envelope: [number, number][] | null;
  /** seconds of fade at each end */
  fadeIn: number;
  fadeOut: number;
  /** playback speed, pitch with it: 1 as recorded */
  rate: number;
  /** filters (Hz): sound under lowCut and over highCut removed, 0 for none */
  lowCut: number;
  highCut: number;
  /** share of reverb, 0 (dry) to 1 */
  reverb: number;
}

/** samples a second of an animated gain: enough for fades and ducking, light for every mixer */
const ENVELOPE_RATE = 50;

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** the gain of a layer over [at, end]: null when it does not move */
function envelopeOf(prop: unknown, at: number, end: number, doc: TrammeDoc): [number, number][] | null {
  if (propKind(prop) !== 'keyframes') return null;
  const keys = (prop as { $k: Keyframe[] }).$k;
  if (!keys?.length) return null;
  // every key inside the clip, and samples in between for the eases
  const times = new Set<number>([at, end, ...keys.map((k) => k.t).filter((t) => t > at && t < end)]);
  for (let t = at; t < end; t += 1 / ENVELOPE_RATE) times.add(+t.toFixed(4));
  return [...times].sort((a, b) => a - b).map((t) => [t, num(sampleKeyframes('number', keys, t, doc.tokens ?? {}), 0)]);
}

export function audioClips(doc: TrammeDoc, compId: string): AudioClip[] {
  const comp = doc.compositions[compId];
  if (!comp) return [];
  const clips: AudioClip[] = [];
  for (const [layerId, layer] of Object.entries(comp.layers)) {
    if (layer.visible === false || (layer.type !== 'audio' && layer.type !== 'video')) continue;
    const props = layer.props ?? {};
    if (layer.type === 'video' && staticValue(props.muted) === true) continue;
    const asset = staticValue(layer.type === 'audio' ? props.audio : props.video);
    if (typeof asset !== 'string' || !doc.assets[asset]) continue;
    const at = layer.in ?? 0, end = Math.min(layer.out ?? comp.duration, comp.duration);
    if (end <= at) continue;
    const duration = end - at;
    const envelope = envelopeOf(props.gain, at, end, doc);
    clips.push({
      layerId, asset, at, duration,
      offset: Math.max(0, num(staticValue(props.start), 0)),
      gainDb: envelope ? envelope[0][1] : num(staticValue(props.gain), 0),
      envelope,
      fadeIn: clamp(num(staticValue(props.fadeIn), 0), 0, duration),
      fadeOut: clamp(num(staticValue(props.fadeOut), 0), 0, duration),
      rate: layer.type === 'audio' ? clamp(num(staticValue(props.rate), 1), 0.25, 4) : 1,
      lowCut: Math.max(0, num(staticValue(props.lowCut), 0)),
      highCut: Math.max(0, num(staticValue(props.highCut), 0)),
      reverb: clamp(num(staticValue(props.reverb), 0), 0, 1),
    });
  }
  return clips.sort((a, b) => a.at - b.at);
}

/** the clip's gain (linear, 1 = as recorded) at composition time t: its curve or its level, times its fades */
export function gainAt(c: AudioClip, t: number): number {
  let dB = c.gainDb;
  const e = c.envelope;
  if (e) {
    let i = 0;
    while (i < e.length - 2 && e[i + 1][0] <= t) i++;
    const [t0, v0] = e[i], [t1, v1] = e[Math.min(i + 1, e.length - 1)];
    dB = t <= t0 ? v0 : t >= t1 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
  }
  const end = c.at + c.duration;
  const fade = Math.min(1, c.fadeIn > 0 ? (t - c.at) / c.fadeIn : 1, c.fadeOut > 0 ? (end - t) / c.fadeOut : 1);
  return Math.pow(10, dB / 20) * Math.max(0, fade);
}

/** whether the clip's gain moves (a curve or fades): it is then sampled over time */
export const gainMoves = (c: AudioClip) => !!c.envelope || c.fadeIn > 0 || c.fadeOut > 0;

// ── what a sound is like ─────────────────────────────────────
export interface SoundFigures {
  /** seconds */
  duration: number;
  /** loudest sample, dBFS (0 = the top) */
  peakDb: number;
  /** average level over the sound, dBFS */
  rmsDb: number;
  /** loudest 400 ms, dBFS: how loud it sounds */
  loudDb: number;
  /** time of its loudest 10 ms: the moment it lands on (the hit, the pass of a whoosh, the top of a riser) */
  peakAt: number;
  /** where its sound starts and ends (40 dB under its loudest moment) */
  start: number;
  end: number;
}

const db = (x: number) => (x > 0 ? +(20 * Math.log10(x)).toFixed(1) : -120);

/** peak, levels, the moment it lands on, where it starts and ends: what the assistant reads of a sound it cannot hear */
export function soundFigures(channels: Float32Array[], sampleRate: number): SoundFigures {
  const n = channels[0]?.length ?? 0;
  const win = Math.max(1, Math.round(sampleRate / 100));
  const energy: number[] = [];
  let peak = 0, sum = 0;
  for (let i = 0; i < n; i += win) {
    let e = 0;
    const to = Math.min(n, i + win);
    for (let j = i; j < to; j++) {
      let s = 0;
      for (const c of channels) { const v = c[j]; s += v * v; const a = Math.abs(v); if (a > peak) peak = a; }
      e += s / channels.length;
    }
    sum += e;
    energy.push(e / (to - i));
  }
  const loudest = energy.reduce((best, e, i) => (e > energy[best] ? i : best), 0);
  const floor = (energy[loudest] ?? 0) * 1e-4;
  const first = energy.findIndex((e) => e > floor), last = energy.length - 1 - [...energy].reverse().findIndex((e) => e > floor);
  // 400 ms windows: 40 of 10 ms
  let loud = 0, run = 0;
  for (let i = 0; i < energy.length; i++) { run += energy[i]; if (i >= 40) run -= energy[i - 40]; loud = Math.max(loud, run / Math.min(40, i + 1)); }
  const sec = (i: number) => +(Math.min(n, i * win) / sampleRate).toFixed(3);
  return {
    duration: +(n / sampleRate).toFixed(3),
    peakDb: db(peak),
    rmsDb: db(Math.sqrt(sum / Math.max(1, n))),
    loudDb: db(Math.sqrt(loud)),
    // the middle of its loudest window (the last one may be shorter)
    peakAt: +((sec(loudest) + sec(loudest + 1)) / 2).toFixed(3),
    start: first < 0 ? 0 : sec(first),
    end: first < 0 ? 0 : sec(last + 1),
  };
}
