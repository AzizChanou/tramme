// Scalar helpers, easing curves, seeded noise and 2D matrices. Everything
// here is pure: the same input always gives the same output, on every machine.

import type { Vec2 } from './types.ts';

export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** normalized progress of t through [a, b], clamped */
export const prog = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
export const smoothstep = (a: number, b: number, x: number) => { const t = prog(x, a, b); return t * t * (3 - 2 * t); };

export type EaseFn = (x: number) => number;

/** CSS cubic-bezier(x1, y1, x2, y2): Newton steps, then bisection when the slope is flat */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x, d = dx(t);
      if (Math.abs(e) < 1e-7) return sy(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = t; else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}

export const linear: EaseFn = (x) => x;

/** the last time of a sorted list at or before t, by bisection; -1 when none */
export function lastIndex(list: number[], t: number): number {
  let lo = 0, hi = list.length - 1, at = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m] <= t + 1e-9) { at = m; lo = m + 1; } else hi = m - 1; }
  return at;
}

// ── 2D matrices ──────────────────────────────────────────────
/** an affine matrix [a, b, c, d, e, f], as canvas setTransform takes it */
export type Mat2D = [number, number, number, number, number, number];

export const matMul = (p: Mat2D, q: Mat2D): Mat2D => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];

/** a layer's own matrix: translate(position) · rotate(rotation) · scale · translate(-anchor), as the renderer draws it */
export function layerMatrix(tr: { anchor: Vec2; position: Vec2; scale: Vec2; rotation: number }): Mat2D {
  const { position: [x, y], rotation, scale: [sx, sy], anchor: [ax, ay] } = tr;
  const r = (rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return matMul([c * sx, s * sx, -s * sy, c * sy, x, y], [1, 0, 0, 1, -ax, -ay]);
}

export const applyMat = (m: Mat2D, [x, y]: Vec2): Vec2 => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** the inverse of a matrix, null when it flattens the plane (a scale of 0) */
export function invertMat(m: Mat2D): Mat2D | null {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

// ── seeded random and noise ─────────────────────────────────
/** integer hash to [0, 1) */
export function hash(n: number): number {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** mulberry32 generator */
export function rng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 3D simplex noise (Gustavson), fixed permutation: about -1..1
const GRAD3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
const PERM = new Uint8Array(512);
{
  const r = rng(1337), p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
export function noise3(x: number, y: number, z: number): number {
  const F3 = 1 / 3, G3 = 1 / 6;
  const s = (x + y + z) * F3;
  const i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
  const t = (i + j + k) * G3;
  const x0 = x - (i - t), y0 = y - (j - t), z0 = z - (k - t);
  let i1, j1, k1, i2, j2, k2;
  if (x0 >= y0) {
    if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
    else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
  } else if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
  else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
  else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
  const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
  const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
  const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
  const ii = i & 255, jj = j & 255, kk = k & 255;
  const c = (tx: number, ty: number, tz: number, g: number) => {
    let tt = 0.6 - tx * tx - ty * ty - tz * tz;
    if (tt < 0) return 0;
    tt *= tt;
    const gr = GRAD3[g % 12];
    return tt * tt * (gr[0] * tx + gr[1] * ty + gr[2] * tz);
  };
  return 32 * (
    c(x0, y0, z0, PERM[ii + PERM[jj + PERM[kk]]]) +
    c(x1, y1, z1, PERM[ii + i1 + PERM[jj + j1 + PERM[kk + k1]]]) +
    c(x2, y2, z2, PERM[ii + i2 + PERM[jj + j2 + PERM[kk + k2]]]) +
    c(x3, y3, z3, PERM[ii + 1 + PERM[jj + 1 + PERM[kk + 1]]]));
}
