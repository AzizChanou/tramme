// Expressions: short JavaScript evaluated for a property at time t.
//   "value + Math.sin(t * 2.4) * 6"                 a single expression
//   "const k = prog(t, 8, 8.5); return [540, 960 * k];"   a body with return
// The function only sees the names listed below. Browser and Node globals
// (window, document, fetch, Date, Math.random, timers, Function, eval...)
// are shadowed, so an expression stays a pure function of t. This keeps
// honest code deterministic; it is not a security boundary against hostile
// code (a document from an untrusted source must run in a worker).

import type { AudioReader } from './analysis.ts';
import type { EventsReader } from './events.ts';
import { clamp, hash, lerp, noise3, prog, smoothstep } from './math.ts';

export interface ExprScope {
  t: number;
  frame: number;
  fps: number;
  /** keyframed value under the expression, or the property default */
  value: unknown;
  comp: { width: number; height: number; duration: number; fps: number };
  /** value of another property at the same time: 'layerId.prop', 'layerId.transform.position' */
  prop(address: string): unknown;
  /** value of a token */
  token(name: string): unknown;
  /** marker by id, kind or label: { t, frame, label, kind } */
  marker(query: string): { t: number; frame: number; label?: string; kind?: string };
  /** ease spec ('@swift', [x1,y1,x2,y2], 'linear') applied to x in 0..1 */
  ease(spec: unknown, x: number): number;
  /** the music or sound at this instant, from its analysis: a sound or video layer id, or an asset id */
  audio(source: string): AudioReader;
  /** an event list at this instant (running totals, the latest event): its asset id */
  events(source: string): EventsReader;
}

const SAFE_MATH: Math = Object.freeze(Object.assign(
  Object.create(null),
  Object.fromEntries(Object.getOwnPropertyNames(Math).map((k) => [k, (Math as any)[k]])),
  { random() { throw new Error('Math.random is not allowed in an expression: use random(seed)'); } },
));

/** pure helpers available in every expression */
const HELPERS = {
  Math: SAFE_MATH,
  clamp, lerp, prog, smoothstep,
  /** linear(t, t0, t1, v0, v1): v0 before t0, v1 after t1, linear between (numbers or vectors) */
  linear(t: number, t0: number, t1: number, v0: number | number[], v1: number | number[]) {
    const p = prog(t, t0, t1);
    return Array.isArray(v0) ? v0.map((x, i) => lerp(x, (v1 as number[])[i], p)) : lerp(v0, v1 as number, p);
  },
  /** seeded random in [0, 1) */
  random: (seed: number) => hash(Math.floor(seed * 9973)),
  noise: (x: number, y = 0, z = 0) => noise3(x, y, z),
  add: (a: number[], b: number[]) => a.map((x, i) => x + b[i]),
  sub: (a: number[], b: number[]) => a.map((x, i) => x - b[i]),
  mul: (a: number[], k: number) => a.map((x) => x * k),
};

const SCOPE = ['t', 'time', 'frame', 'fps', 'value', 'comp', 'prop', 'token', 'marker', 'ease', 'audio', 'events'] as const;
const HELPER_NAMES = Object.keys(HELPERS);
const HELPER_VALUES = Object.values(HELPERS);
const BLOCKED = [
  'window', 'self', 'globalThis', 'document', 'navigator', 'location', 'fetch', 'XMLHttpRequest', 'WebSocket',
  'Function', 'eval', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask', 'Date', 'performance',
  'process', 'require', 'module', 'importScripts', 'localStorage', 'sessionStorage', 'indexedDB', 'crypto',
];

export type CompiledExpr = (scope: ExprScope) => unknown;

const cache = new Map<string, CompiledExpr>();

/** compile once per source text; throws SyntaxError with the expression in the message */
export function compileExpr(src: string): CompiledExpr {
  const hit = cache.get(src);
  if (hit) return hit;
  const body = /(^|[\s;{])return[\s(;[]/.test(src) ? src : `return (${src}\n);`;
  // The outer function (sloppy mode, so it may bind `eval`) shadows the
  // globals once; the inner one is strict: no implicit globals, no `this`.
  let fn: Function;
  try {
    const outer = new Function(...HELPER_NAMES, ...BLOCKED, `return function (${SCOPE.join(', ')}) {\n"use strict";\n${body}\n};`);
    fn = outer(...HELPER_VALUES, ...BLOCKED.map(() => undefined));
  } catch (e) {
    throw new SyntaxError(`invalid expression (${(e as Error).message}): ${src}`);
  }
  const compiled: CompiledExpr = (s) => fn(s.t, s.t, s.frame, s.fps, s.value, s.comp, s.prop, s.token, s.marker, s.ease, s.audio, s.events);
  cache.set(src, compiled);
  return compiled;
}

/** names an expression can use, for the editor's completion and the AI's documentation */
export const EXPRESSION_NAMES = [...SCOPE, ...HELPER_NAMES];
