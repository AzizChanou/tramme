// Property values: kind detection, token resolution, eases and keyframe
// interpolation. Keys starting with '$' are reserved: a static object value
// (a gradient, a path) never carries $k, $expr or $link.

import { mixColor } from './color.ts';
import { cubicBezier, lerp, linear, type EaseFn } from './math.ts';
import type { Paint, PathValue, PropType } from './registry.ts';
import type { EaseSpec, ExprProp, Keyframe, KeyframedProp, LinkProp, ModifierSpec, Token, Vec2 } from './types.ts';

export type PropKind = 'static' | 'keyframes' | 'expression' | 'link';

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function propKind(p: unknown): PropKind {
  if (isPlainObject(p)) {
    if ('$link' in p) return 'link';
    if ('$k' in p) return 'keyframes';
    if ('$expr' in p) return 'expression';
  }
  return 'static';
}
/** the value of a static property, raw or in its { $v } form */
export const staticValue = (p: unknown) => (isPlainObject(p) && '$v' in p ? p.$v : p);
/** the modifier stack of a property, if any */
export const modsOf = (p: unknown): ModifierSpec[] | null =>
  isPlainObject(p) && Array.isArray(p.$mod) && p.$mod.length ? (p.$mod as ModifierSpec[]) : null;
export const asKeyframed = (p: unknown) => p as KeyframedProp;
export const asExpr = (p: unknown) => p as ExprProp;
export const asLink = (p: unknown) => p as LinkProp;

// ── tokens ───────────────────────────────────────────────────
export type Tokens = Record<string, Token>;

export function tokenValue(tokens: Tokens, ref: string, depth = 0): unknown {
  const name = ref.startsWith('@') ? ref.slice(1) : ref;
  const tk = tokens[name];
  if (!tk) throw new Error(`unknown token: @${name}`);
  // a token may alias another one
  if (typeof tk.value === 'string' && tk.value.startsWith('@') && depth < 8) return tokenValue(tokens, tk.value, depth + 1);
  return tk.value;
}

const resolveColor = (v: unknown, tokens: Tokens) =>
  typeof v === 'string' && v.startsWith('@') ? (tokenValue(tokens, v) as string) : v;

/** replace inline colour tokens ('@ink') in colour and paint values */
export function resolveTokens(type: PropType, v: unknown, tokens: Tokens): unknown {
  if (type === 'color') return resolveColor(v, tokens);
  if (type === 'paint') {
    if (typeof v === 'string') return resolveColor(v, tokens);
    if (isPlainObject(v) && Array.isArray(v.stops)) {
      return { ...v, stops: (v.stops as [number, string][]).map(([o, c]) => [o, resolveColor(c, tokens)]) };
    }
  }
  if (type === 'ease' && typeof v === 'string' && v.startsWith('@')) return tokenValue(tokens, v);
  return v;
}

// ── eases ────────────────────────────────────────────────────
const bezierCache = new Map<string, EaseFn>();

/** ease function of a segment, or 'hold' */
export function easeFn(spec: EaseSpec | undefined, tokens: Tokens): EaseFn | 'hold' {
  if (spec === undefined || spec === 'linear') return linear;
  if (spec === 'hold') return 'hold';
  if (typeof spec === 'string') return easeFn(tokenValue(tokens, spec) as EaseSpec, tokens);
  const key = spec.join(',');
  let f = bezierCache.get(key);
  if (!f) { f = cubicBezier(spec[0], spec[1], spec[2], spec[3]); bezierCache.set(key, f); }
  return f;
}

// ── interpolation ────────────────────────────────────────────
const lerpVec = (a: number[], b: number[], p: number) => a.map((x, i) => lerp(x, b[i], p));

function lerpPaint(a: Paint, b: Paint, p: number): Paint {
  if (typeof a === 'string' && typeof b === 'string') return mixColor(a, b, p);
  if (isPlainObject(a) && isPlainObject(b) && a.type === b.type && a.stops.length === b.stops.length) {
    const stops = a.stops.map(([o, c], i) => [lerp(o, b.stops[i][0], p), mixColor(c, b.stops[i][1], p)] as [number, string]);
    if (a.type === 'linear' && b.type === 'linear') return { type: 'linear', from: lerpVec(a.from, b.from, p) as Vec2, to: lerpVec(a.to, b.to, p) as Vec2, stops };
    if (a.type === 'radial' && b.type === 'radial') return { type: 'radial', center: lerpVec(a.center, b.center, p) as Vec2, radius: lerp(a.radius, b.radius, p), stops };
  }
  return p < 1 ? a : b;
}

function lerpPath(a: PathValue, b: PathValue, p: number): PathValue {
  if (a.v.length !== b.v.length) return p < 1 ? a : b;
  const mix = (x?: Vec2[], y?: Vec2[]) => (x || y ? a.v.map((_, k) => lerpVec(x?.[k] ?? [0, 0], y?.[k] ?? [0, 0], p) as Vec2) : undefined);
  return { v: a.v.map((v, k) => lerpVec(v, b.v[k], p) as Vec2), i: mix(a.i, b.i), o: mix(a.o, b.o), closed: a.closed };
}

/** value between a and b at eased progress p; types that do not interpolate hold a until the next key */
export function interpolate(type: PropType, a: unknown, b: unknown, p: number): unknown {
  switch (type) {
    case 'number': return lerp(a as number, b as number, p);
    case 'vec2': return lerpVec(a as number[], b as number[], p);
    case 'color': return mixColor(a as string, b as string, p);
    case 'paint': return lerpPaint(a as Paint, b as Paint, p);
    case 'path': return lerpPath(a as PathValue, b as PathValue, p);
    default: return p < 1 ? a : b;
  }
}

/** index i of the segment [keys[i], keys[i + 1]) holding t; keys sorted by time */
function segment(keys: Keyframe[], t: number): number {
  let lo = 0, hi = keys.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keys[mid].t <= t) lo = mid; else hi = mid;
  }
  return lo;
}

export function sampleKeyframes(type: PropType, keys: Keyframe[], t: number, tokens: Tokens): unknown {
  const first = keys[0], last = keys[keys.length - 1];
  if (t <= first.t || keys.length === 1) return resolveTokens(type, first.v, tokens);
  if (t >= last.t) return resolveTokens(type, last.v, tokens);
  const i = segment(keys, t), a = keys[i], b = keys[i + 1];
  const va = resolveTokens(type, a.v, tokens);
  const ease = easeFn(a.ease, tokens);
  if (ease === 'hold') return va;
  return interpolate(type, va, resolveTokens(type, b.v, tokens), ease((t - a.t) / (b.t - a.t)));
}
