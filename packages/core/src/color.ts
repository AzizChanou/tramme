// Colours: CSS strings in the document ('#1C1917', '#1C191780', 'rgba(...)'),
// or a token reference ('@ink'). Interpolation happens on straight sRGB
// components, as CSS transitions do.

import { clamp, lerp } from './math.ts';

/** [r, g, b] in 0..255, a in 0..1 */
export type RGBA = [number, number, number, number];

const cache = new Map<string, RGBA>();

export function parseColor(css: string): RGBA {
  const hit = cache.get(css);
  if (hit) return hit;
  const s = css.trim().toLowerCase();
  let out: RGBA | null = null;
  if (s === 'transparent') out = [0, 0, 0, 0];
  else if (s[0] === '#') {
    const h = s.slice(1);
    if (/^[0-9a-f]{3,4}$/.test(h)) {
      const v = [...h].map((c) => parseInt(c + c, 16));
      out = [v[0], v[1], v[2], h.length === 4 ? v[3] / 255 : 1];
    } else if (/^[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) {
      const v = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
      out = [v[0], v[1], v[2], h.length === 8 ? v[3] / 255 : 1];
    }
  } else {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
    if (m) {
      const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      out = [Number(m[1]), Number(m[2]), Number(m[3]), a];
    }
  }
  if (!out) throw new Error(`unreadable color: ${css}`);
  cache.set(css, out);
  return out;
}

export function isColor(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  try { parseColor(v); return true; } catch { return false; }
}

const hex2 = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');

export function toCss([r, g, b, a]: RGBA): string {
  if (a >= 1) return '#' + hex2(r) + hex2(g) + hex2(b);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+clamp(a).toFixed(4)})`;
}

export function mixColor(a: string, b: string, t: number): string {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const A = parseColor(a), B = parseColor(b);
  return toCss([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t), lerp(A[3], B[3], t)]);
}
