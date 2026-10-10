// The moments a film's sound lands on, read from its own timing: every frame
// of the composition placed (the evaluation the render uses), each layer
// followed on screen. A cut is half the frame changing at once; a move is a
// layer at its fastest; a land, a layer coming to rest; an appear, a layer
// showing. Each cue says how much of the frame it carries, and the strongest,
// spaced, are the heroes the film is built around (about one in four
// seconds). Sound placed on them is in sync by construction; the sound checks
// read them again to see that each effect still underlines its moment.

import { sampleComposition } from './checks.ts';
import type { Evaluator } from './evaluate.ts';
import type { SoundVisual } from './audio.ts';

export interface SoundCue {
  /** composition time (s), on a frame */
  t: number;
  kind: SoundVisual;
  /** the layer that makes it (the biggest when several move together) */
  layer: string;
  /** how much of the picture it carries: the share of the frame that changes, about 0 to 1 */
  strength: number;
  weight: 'hero' | 'support';
}

/** a layer followed frame by frame: shown at all (seen), and inside the frame (on) */
interface Track { t: number[]; seen: boolean[]; on: boolean[]; cx: number[]; cy: number[]; size: number[]; share: number[] }

/** a move shorter than this is a pop, read as an appear or a land */
const MIN_MOVE = 0.15;
/** cues of one kind closer than this (frames) are one cue */
const SAME = 2;
/** a cue under this share of the strongest one within MASK seconds is drowned by it */
const DROWNED = 0.15, MASK = 0.3;
/** heroes are at least this far apart (s), about one in HERO_EVERY seconds */
const HERO_GAP = 3, HERO_EVERY = 4;

/** the cues of a composition, in time order */
/** every layer on screen, frame by frame (at most 30 a second): where it is, how big, how much of the frame it covers */
function follow(evaluator: Evaluator, compId: string): { times: number[]; tracks: Map<string, Track> } {
  const comp = evaluator.comp(compId), area = comp.width * comp.height;
  const samples = sampleComposition(evaluator, compId, 1 / Math.min(comp.fps, 30));
  const n = samples.length;
  const tracks = new Map<string, Track>();
  samples.forEach((s, i) => {
    for (const p of s.layers) {
      if (!p.box || p.layer.type === 'audio') continue;
      let tr = tracks.get(p.id);
      if (!tr) { tr = { t: samples.map((x) => x.t), seen: Array(n).fill(false), on: Array(n).fill(false), cx: Array(n).fill(0), cy: Array(n).fill(0), size: Array(n).fill(0), share: Array(n).fill(0) }; tracks.set(p.id, tr); }
      const { x, y, w, h } = p.box, visible = p.opacity > 0.05 && w > 0 && h > 0;
      // the part of the frame it covers, clipped to the frame
      const cw = Math.max(0, Math.min(comp.width, x + w) - Math.max(0, x)), ch = Math.max(0, Math.min(comp.height, y + h) - Math.max(0, y));
      tr.seen[i] = visible;
      tr.on[i] = visible && cw * ch > 0;
      tr.cx[i] = x + w / 2; tr.cy[i] = y + h / 2; tr.size[i] = Math.sqrt(w * h);
      tr.share[i] = visible ? Math.min(1, (cw * ch) / area) * Math.min(1, p.opacity) : 0;
    }
  });
  return { times: samples.map((s) => s.t), tracks };
}

/** the speed of a track on screen at each sample, in diagonals of the frame a second (0 where it is off) */
const speedOf = (tr: Track, diag: number) => tr.t.map((t, i) => (i && tr.on[i] && tr.on[i - 1] ? Math.hypot(tr.cx[i] - tr.cx[i - 1], tr.cy[i] - tr.cy[i - 1], tr.size[i] - tr.size[i - 1]) / diag / (t - tr.t[i - 1]) : 0));

/**
 * How much the picture moves at each sample (at most 30 a second): the
 * layers' speeds weighed by their size on screen, plus the share of the frame
 * that changes at once. What the picture of a mix draws under its sound.
 */
export function pictureMotion(evaluator: Evaluator, compId: string): { times: number[]; motion: number[] } {
  const comp = evaluator.comp(compId), diag = Math.hypot(comp.width, comp.height), { times, tracks } = follow(evaluator, compId);
  const motion = times.map(() => 0);
  for (const tr of tracks.values()) {
    speedOf(tr, diag).forEach((v, i) => { motion[i] += v * Math.sqrt(tr.share[i]) + (i ? Math.abs(tr.share[i] - tr.share[i - 1]) : 0); });
  }
  return { times, motion };
}

export function soundCues(evaluator: Evaluator, compId: string): SoundCue[] {
  const comp = evaluator.comp(compId), fps = comp.fps, diag = Math.hypot(comp.width, comp.height);
  const { times, tracks } = follow(evaluator, compId), n = times.length;
  if (n < 2) return [];
  const frame = (t: number) => +(Math.round(t * fps) / fps).toFixed(4);
  const raw: Omit<SoundCue, 'weight'>[] = [];
  for (const [id, tr] of tracks) {
    // appear: hidden, then shown (sliding in from outside the frame is a move)
    for (let i = 1; i < n; i++) {
      if (tr.on[i] && !tr.seen[i - 1]) {
        const reach = Math.max(...tr.share.slice(i, Math.min(n, i + Math.ceil(0.5 / (tr.t[1] - tr.t[0])))));
        raw.push({ t: frame(tr.t[i]), kind: 'appear', layer: id, strength: Math.sqrt(reach) });
      }
    }
    // moves: stretches of speed on screen (position and size, in diagonals a second)
    const speed = speedOf(tr, diag);
    const top = Math.max(...speed);
    if (top < 0.05) continue;
    const gate = Math.max(0.03, 0.15 * top);
    for (let i = 1; i < n; i++) {
      if (speed[i] <= gate || speed[i - 1] > gate) continue;
      let j = i, best = i, travel = 0;
      while (j < n && speed[j] > gate) { travel += speed[j] * (tr.t[j] - tr.t[j - 1]); if (speed[j] > speed[best]) best = j; j++; }
      const span = tr.t[j - 1] - tr.t[i - 1], weight = Math.sqrt(Math.max(...tr.share.slice(i - 1, j)));
      if (travel >= 0.03) {
        if (span >= MIN_MOVE) raw.push({ t: frame(tr.t[best]), kind: 'move', layer: id, strength: travel * weight });
        // it comes to rest on screen: a landing (an exit that leaves the frame is not one)
        if (j < n && tr.on[j]) raw.push({ t: frame(tr.t[j]), kind: 'land', layer: id, strength: travel * weight });
      }
      i = j;
    }
  }
  // cuts: half the frame changes from one frame to the next
  for (let i = 1; i < n; i++) {
    let change = 0, lead = '', most = 0;
    for (const [id, tr] of tracks) {
      const d = tr.share[i] - tr.share[i - 1];
      change += Math.abs(d);
      // named by what comes in
      if (d > most) { most = d; lead = id; }
    }
    if (change >= 0.5) raw.push({ t: frame(times[i]), kind: 'cut', layer: lead, strength: Math.min(1, change / 2) });
  }
  for (const m of comp.markers ?? []) {
    if ((m.kind === 'cut' || m.kind === 'scene') && m.t > 0 && m.t < comp.duration) raw.push({ t: frame(m.t), kind: 'cut', layer: '', strength: 0.5 });
  }
  // one cue per moment: the cut wins where it falls, then the strongest
  raw.sort((a, b) => a.t - b.t || b.strength - a.strength);
  const kept: Omit<SoundCue, 'weight'>[] = [];
  for (const c of raw) {
    const near = kept.filter((k) => Math.abs(k.t - c.t) <= SAME / fps + 1e-6);
    if (near.some((k) => k.kind === 'cut' || k.kind === c.kind)) {
      const twin = near.find((k) => k.kind === c.kind);
      if (twin && c.strength > twin.strength) Object.assign(twin, { layer: c.layer, strength: c.strength });
      continue;
    }
    if (c.kind === 'cut') for (const k of near) kept.splice(kept.indexOf(k), 1);
    kept.push({ ...c, strength: +c.strength.toFixed(3) });
  }
  // a weak cue right by a strong one is drowned by it: it gets no sound of its own
  const heard = kept.filter((c) => c.strength >= DROWNED * Math.max(...kept.filter((k) => Math.abs(k.t - c.t) <= MASK).map((k) => k.strength)));
  kept.splice(0, kept.length, ...heard);
  // the heroes: the strongest, spaced; the strongest of the last quarter (the end card, the logo) among them
  const heroes = new Set<Omit<SoundCue, 'weight'>>();
  const strongest = Math.max(0, ...kept.map((c) => c.strength)), count = Math.max(1, Math.round(comp.duration / HERO_EVERY)), floor = 0.25 * strongest;
  const rank = (c: Omit<SoundCue, 'weight'>) => c.strength * (c.kind === 'move' ? 0.7 : 1);
  const end = kept.filter((c) => c.t >= comp.duration * 0.75).sort((a, b) => rank(b) - rank(a))[0];
  // the last word of a film is small on screen (a logo) and still its hero
  if (end && end.strength >= 0.1 * strongest) heroes.add(end);
  for (const c of [...kept].sort((a, b) => rank(b) - rank(a))) {
    if (heroes.size >= count || c.strength < floor) break;
    if ([...heroes].every((h) => Math.abs(h.t - c.t) >= HERO_GAP)) heroes.add(c);
  }
  return kept.sort((a, b) => a.t - b.t).map((c) => ({ ...c, weight: heroes.has(c) ? 'hero' : 'support' }));
}
