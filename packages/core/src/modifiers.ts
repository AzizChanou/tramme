// Modifiers: reusable transformations stacked on a property's value
// ("$mod": [{ "type": "wiggle", "freq": 2, "amp": 10 }]). Each one is a pure
// function of time: it may read the value under it at other instants
// (base(t)), the property's keyframes, and the layer's rank among its
// siblings. They act on numbers and vectors; other values pass through.

import { hash, noise3 } from './math.ts';
import type { PropSchema } from './registry.ts';
import type { AiNotes } from './tools.ts';
import type { Keyframe } from './types.ts';

export interface Modifier { type: string; [param: string]: unknown }

export interface ModifierContext {
  t: number;
  fps: number;
  /** the value under this modifier at another time (earlier modifiers included) */
  base(t: number): unknown;
  /** the property's keyframes, when it has some */
  keys: Keyframe[] | null;
  /** keyframe values resolved to numbers or vectors, aligned with keys */
  keyValues: unknown[] | null;
  /** rank of the layer among its siblings, bottom first, and their number */
  index: number;
  count: number;
  /** a stable number for this property (distinct noise per property) */
  seed: number;
}

export interface ModifierType {
  type: string;
  title: string;
  description: string;
  /** notes for the assistant */
  ai?: AiNotes;
  params: PropSchema;
  apply(value: unknown, params: Record<string, any>, ctx: ModifierContext): unknown;
}

// ── helpers ──────────────────────────────────────────────────
const isNum = (v: unknown): v is number => typeof v === 'number';
const isVec = (v: unknown): v is number[] => Array.isArray(v) && v.every(isNum);
/** apply f to each component of a number or a vector */
function each(v: unknown, f: (x: number, i: number) => number): unknown {
  if (isNum(v)) return f(v, 0);
  if (isVec(v)) return v.map(f);
  return v;
}
const add = (a: unknown, b: unknown): unknown => (isNum(a) && isNum(b) ? a + b : isVec(a) && isVec(b) ? a.map((x, i) => x + b[i]) : a);
const sub = (a: unknown, b: unknown): unknown => (isNum(a) && isNum(b) ? a - b : isVec(a) && isVec(b) ? a.map((x, i) => x - b[i]) : a);
const scale = (a: unknown, k: number): unknown => each(a, (x) => x * k);

/** fractal noise in about -1..1 */
function fbm(x: number, y: number, z: number, octaves: number): number {
  let s = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < Math.max(1, Math.min(6, octaves)); o++) { s += amp * noise3(x * f, y * f, z); norm += amp; amp *= 0.5; f *= 2; }
  return s / norm;
}

/** step response of a damped spring: 0 at tau = 0, settles at 1 */
export function springStep(tau: number, freq: number, damping: number): number {
  if (tau <= 0) return 0;
  const w = 2 * Math.PI * freq, z = Math.min(1, Math.max(0.02, damping));
  if (z >= 0.999) return 1 - Math.exp(-w * tau) * (1 + w * tau);
  const wd = w * Math.sqrt(1 - z * z);
  return 1 - Math.exp(-z * w * tau) * (Math.cos(wd * tau) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * tau));
}

// ── built-in modifiers ───────────────────────────────────────
export const wiggle: ModifierType = {
  type: 'wiggle', title: 'Wiggle', description: 'adds a smooth random motion',
  params: {
    freq: { type: 'number', default: 2, min: 0, step: 0.1, unit: 'x', label: 'Frequency (Hz)' },
    amp: { type: 'number', default: 10, step: 0.5, label: 'Amplitude' },
    octaves: { type: 'number', default: 1, min: 1, max: 6, step: 1, label: 'Octaves' },
    seed: { type: 'number', default: 0, step: 1, label: 'Seed' },
  },
  apply: (v, p, c) => each(v, (x, i) => x + p.amp * fbm(c.t * p.freq, i * 7.31 + p.seed * 3.17, c.seed, p.octaves)),
};

export const loop: ModifierType = {
  type: 'loop', title: 'Loop', description: "repeats the keyframe animation beyond the last one",
  params: {
    mode: { type: 'enum', default: 'cycle', options: ['cycle', 'pingpong', 'offset'], label: 'Mode' },
    start: { type: 'number', default: -1, step: 0.01, unit: 's', label: 'Start', description: '-1: first keyframe' },
    end: { type: 'number', default: -1, step: 0.01, unit: 's', label: 'End', description: '-1: last keyframe' },
  },
  apply(v, p, c) {
    const a = p.start >= 0 ? p.start : c.keys?.[0]?.t ?? 0;
    const b = p.end >= 0 ? p.end : c.keys?.at(-1)?.t ?? 0;
    const d = b - a;
    if (d <= 1e-6 || c.t <= b) return v;
    const n = Math.floor((c.t - a) / d), f = (c.t - a) - n * d;
    if (p.mode === 'pingpong') return c.base(n % 2 ? b - f : a + f);
    if (p.mode === 'offset') return add(c.base(a + f), scale(sub(c.base(b), c.base(a)), n));
    return c.base(a + f);
  },
};

export const spring: ModifierType = {
  type: 'spring', title: 'Spring', description: 'each keyframe change becomes a spring\'s response',
  params: {
    freq: { type: 'number', default: 2.5, min: 0.1, step: 0.1, label: 'Frequency (Hz)' },
    damping: { type: 'number', default: 0.45, min: 0.02, max: 1, step: 0.01, label: 'Damping' },
  },
  apply(v, p, c) {
    const ks = c.keys, vs = c.keyValues;
    if (!ks || !vs || ks.length < 2) return v;
    // superposition: each segment's change starts at its first key, as a spring step
    let out = vs[0];
    for (let i = 0; i < ks.length - 1; i++) {
      const delta = sub(vs[i + 1], vs[i]);
      out = add(out, scale(delta, ks[i].ease === 'hold' ? (c.t >= ks[i + 1].t ? 1 : 0) : springStep(c.t - ks[i].t, p.freq, p.damping)));
    }
    return out;
  },
};

export const stagger: ModifierType = {
  type: 'stagger', title: 'Offset', description: 'offsets the animation by the layer\'s rank among its siblings',
  params: {
    delay: { type: 'number', default: 0.06, step: 0.01, unit: 's', label: 'Offset' },
    from: { type: 'enum', default: 'first', options: ['first', 'last'], label: 'Starting from' },
  },
  apply(_v, p, c) {
    const rank = p.from === 'last' ? c.count - 1 - c.index : c.index;
    return c.base(c.t - rank * p.delay);
  },
};

export const noise: ModifierType = {
  type: 'noise', title: 'Variation', description: 'fixed random offset, different for each sibling layer',
  params: {
    amp: { type: 'number', default: 20, step: 0.5, label: 'Amplitude' },
    seed: { type: 'number', default: 0, step: 1, label: 'Seed' },
  },
  apply: (v, p, c) => each(v, (x, i) => x + p.amp * (hash(c.index * 977 + i * 131 + p.seed * 7919 + c.seed) * 2 - 1)),
};

export const smooth: ModifierType = {
  type: 'smooth', title: 'Smoothing', description: 'smooths the curve with a moving average',
  params: { window: { type: 'number', default: 0.2, min: 0, step: 0.01, unit: 's', label: 'Window' } },
  apply(v, p, c) {
    if (p.window <= 0 || !(isNum(v) || isVec(v))) return v;
    const n = 9;
    let acc: unknown = scale(v, 0);
    for (let i = 0; i < n; i++) acc = add(acc, c.base(c.t + ((i + 0.5) / n - 0.5) * p.window));
    return scale(acc, 1 / n);
  },
};

export const BUILTIN_MODIFIERS = [wiggle, loop, spring, stagger, noise, smooth];

/** default params filled in */
export function modifierParams(m: ModifierType, mod: Modifier): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, d] of Object.entries(m.params)) out[k] = mod[k] ?? d.default;
  return out;
}

/** a stable seed from an address string */
export function seedOf(address: string): number {
  let h = 0;
  for (let i = 0; i < address.length; i++) h = Math.imul(h ^ address.charCodeAt(i), 0x5bd1e995);
  return (hash(h) * 1000) | 0;
}
