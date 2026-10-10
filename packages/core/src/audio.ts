// The sounds of a composition, each where it plays: audio layers, and the
// sound of video layers not muted. A layer plays its file from `start`, from
// its in point to its out point: several layers of one file make the cuts of
// an edit. How each one sounds (gain and its curve, fades, speed, filters,
// reverb) is read here once; the preview, the exports and the command line
// mix the same clips with one mixer (@tramme/render, audio.ts).

import { propKind, sampleKeyframes, staticValue } from './props.ts';
import type { Composition, Keyframe, TrammeDoc } from './types.ts';

/** what a sound is in the mix: effects share the room, music and ambience are the bed, the voice leads */
export type SoundRole = 'effect' | 'music' | 'voice' | 'ambience';
export const SOUND_ROLES: SoundRole[] = ['effect', 'music', 'voice', 'ambience'];
/** what an effect underlines in the picture: a cut, a move at its fastest, a landing, an appearance */
export type SoundVisual = 'cut' | 'move' | 'land' | 'appear';
export const SOUND_VISUALS: SoundVisual[] = ['cut', 'move', 'land', 'appear'];

export interface AudioClip {
  layerId: string;
  role: SoundRole;
  /** a hero sound is one of the few moments the film is built around (a logo, a reveal); the others support */
  weight: 'hero' | 'support';
  /** what it underlines in the picture, when it says so */
  visual?: SoundVisual;
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
  /** the low cut over time when it is animated (a build thinning the music out): [composition time, Hz] */
  lowCutCurve: [number, number][] | null;
  highCut: number;
  /** share of reverb, 0 (dry) to 1 */
  reverb: number;
}

/** what a sound's names say it is, when its layer does not say its role (a layer's length says nothing: an effect often runs to the end) */
const NAMED: [RegExp, SoundRole][] = [[/voice|narrat|speech|dialog|\bvo\b/i, 'voice'], [/ambien|room.?tone|atmos/i, 'ambience'], [/music|song|score|\bbed\b/i, 'music']];

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
  const parent = new Map<string, string>();
  for (const [id, l] of Object.entries(comp.layers)) for (const k of l.children ?? []) parent.set(k, id);
  for (const [layerId, layer] of Object.entries(comp.layers)) {
    if (layer.visible === false || (layer.type !== 'audio' && layer.type !== 'video')) continue;
    const props = layer.props ?? {};
    if (layer.type === 'video' && staticValue(props.muted) === true) continue;
    const asset = staticValue(layer.type === 'audio' ? props.audio : props.video);
    if (typeof asset !== 'string' || !doc.assets[asset]) continue;
    // it plays where its groups let it, as the timeline shows it; a hidden group silences it
    let at = layer.in ?? 0, end = Math.min(layer.out ?? comp.duration, comp.duration), hidden = false;
    for (let p = parent.get(layerId); p; p = parent.get(p)) {
      const g = comp.layers[p];
      hidden ||= g.visible === false;
      at = Math.max(at, g.in ?? 0); end = Math.min(end, g.out ?? comp.duration);
    }
    if (hidden || end <= at) continue;
    const duration = end - at, rate = layer.type === 'audio' ? clamp(num(staticValue(props.rate), 1), 0.25, 4) : 1;
    const envelope = envelopeOf(props.gain, at, end, doc), lowCutCurve = envelopeOf(props.lowCut, at, end, doc);
    const role = staticValue(props.role), visual = staticValue(props.visual);
    clips.push({
      layerId, asset, at, duration,
      // unsaid: a video's sound is someone speaking; a sound is what its names say, an effect otherwise
      role: SOUND_ROLES.includes(role as SoundRole) ? role as SoundRole : layer.type === 'video' ? 'voice' : NAMED.find(([re]) => re.test(`${layerId} ${layer.name ?? ''} ${asset} ${doc.assets[asset].name ?? ''}`))?.[1] ?? 'effect',
      weight: staticValue(props.weight) === 'hero' ? 'hero' : 'support',
      ...(SOUND_VISUALS.includes(visual as SoundVisual) ? { visual: visual as SoundVisual } : {}),
      // a group starting after the layer skips the beginning of its file
      offset: Math.max(0, num(staticValue(props.start), 0)) + (at - (layer.in ?? 0)) * rate,
      gainDb: envelope ? envelope[0][1] : num(staticValue(props.gain), 0),
      envelope,
      fadeIn: clamp(num(staticValue(props.fadeIn), 0), 0, duration),
      fadeOut: clamp(num(staticValue(props.fadeOut), 0), 0, duration),
      rate,
      lowCut: Math.max(0, lowCutCurve ? lowCutCurve[0][1] : num(staticValue(props.lowCut), 0)),
      lowCutCurve,
      highCut: Math.max(0, num(staticValue(props.highCut), 0)),
      reverb: clamp(num(staticValue(props.reverb), 0), 0, 1),
    });
  }
  return clips.sort((a, b) => a.at - b.at);
}

/** how a composition's sound is finished (its `sound` settings): the loudness of the master, null as mixed; the share of the room the effects have in common */
export interface SoundMix { loudness: number | null; room: number }
export const DEFAULT_LOUDNESS = -14;
export const DEFAULT_ROOM = 0.15;

export function soundMix(comp: Composition): SoundMix {
  const s = comp.sound;
  const loudness = s?.loudness === null ? null : num(staticValue(s?.loudness), DEFAULT_LOUDNESS);
  return { loudness: loudness === null ? null : clamp(loudness, -31, -6), room: clamp(num(staticValue(s?.room), DEFAULT_ROOM), 0, 1) };
}

/** a sampled curve's value at t, straight between its points, held past its ends */
export function curveAt(e: [number, number][], t: number): number {
  let i = 0;
  while (i < e.length - 2 && e[i + 1][0] <= t) i++;
  const [t0, v0] = e[i], [t1, v1] = e[Math.min(i + 1, e.length - 1)];
  return t <= t0 ? v0 : t >= t1 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
}

/** the clip's gain (linear, 1 = as recorded) at composition time t: its curve or its level, times its fades */
export function gainAt(c: AudioClip, t: number): number {
  const dB = c.envelope ? curveAt(c.envelope, t) : c.gainDb;
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
