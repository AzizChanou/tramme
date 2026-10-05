// The figures of a movement: what the numbers of an animated property say.
// How far it travels, how fast at the peak, whether the speed is even (the
// linear tell), how many times it turns around, how far it passes its end
// value and comes back, and when it settles. The assistant reads them to
// judge a movement it cannot see (a strip of frames shows the spacing, the
// figures say why it feels wrong); the quality checks read them too
// (docs/motion-roadmap.md). Pure functions of sampled series: the values come
// from the Evaluator — the same evaluation the render uses — and nothing
// here renders or keeps state.

import { modsOf, propKind } from './props.ts';
import { CAMERA_SCHEMA, TRANSFORM_SCHEMA, type PropDef, type Registry } from './registry.ts';
import type { Composition, TrammeDoc } from './types.ts';
import type { Evaluator } from './evaluate.ts';

export interface MotionFigures {
  /** the sampled span (s) */
  span: number;
  /** |last − first| in the property's units */
  change: number;
  /** everything travelled, turns included (≥ |change|) */
  travel: number;
  /** peak |speed| in units/s, and when it happens (s from the start of the span) */
  peak: number;
  peakAt: number;
  /** how even the speed is: mean |speed| / peak (1: constant speed — the linear tell) */
  evenness: number;
  /** direction changes of the movement (a bounce, an oscillation) */
  turns: number;
  /** how far it passes its end value and comes back, in units (0: never) */
  overshoot: number;
  /** when it last was away from its end value by more than 1 % of its travel (s from the start of the span) — after that it only closes in; undefined when it was still away at the end (a move that stops dead, a spring cut off) */
  settle?: number;
}

/** the figures of one scalar series, or null when nothing moves */
export function scalarFigures(times: number[], v: number[]): MotionFigures | null {
  const n = Math.min(times.length, v.length);
  if (n < 2) return null;
  const span = times[n - 1] - times[0];
  if (!(span > 0)) return null;
  const speeds: number[] = [];
  let travel = 0, peak = 0, peakAt = times[0];
  for (let i = 1; i < n; i++) {
    const dt = times[i] - times[i - 1];
    if (!(dt > 0)) { speeds.push(0); continue; }
    const d = v[i] - v[i - 1];
    travel += Math.abs(d);
    const s = d / dt;
    speeds.push(s);
    if (Math.abs(s) > peak) { peak = Math.abs(s); peakAt = times[i]; }
  }
  if (peak <= 1e-9 || travel <= 1e-9) return null;
  // a direction change under 5 % of the peak speed is noise, not a turn
  let turns = 0, sign = 0;
  for (const s of speeds) {
    if (Math.abs(s) <= 0.05 * peak) continue;
    const next = Math.sign(s);
    if (sign && next !== sign) turns++;
    sign = next;
  }
  const change = v[n - 1] - v[0];
  const hi = Math.max(...v.slice(0, n)), lo = Math.min(...v.slice(0, n));
  // how far it passes its end value and comes back (a dip below the end counts the same)
  const overshoot = change > 1e-9 ? Math.max(0, hi - v[n - 1]) : change < -1e-9 ? Math.max(0, v[n - 1] - lo) : 0;
  // when it entered the band around its end value for good: the last moment it
  // was away, plus one step; still away at the end (or only the final sample in
  // band) means it never eased into its stop
  const band = 0.01 * Math.max(Math.abs(change), 0.05 * travel);
  let away = -1;
  for (let i = 0; i < n; i++) if (Math.abs(v[i] - v[n - 1]) > band) away = i;
  return {
    span, change, travel, peak, peakAt: peakAt - times[0],
    evenness: Math.min(1, travel / span / peak), turns, overshoot,
    ...(away < 0 ? { settle: 0 } : away >= n - 2 ? {} : { settle: times[away + 1] - times[0] }),
  };
}

/** the stretches of a series that move on their own (speed over the gate, holds left out), each with its figures */
export function motionStretches(times: number[], values: (number | number[])[], gate = 0.15): { from: number; to: number; figures: MotionFigures }[] {
  const out: { from: number; to: number; figures: MotionFigures }[] = [];
  const cols = Math.max(1, ...values.map((v) => (Array.isArray(v) ? v.length : 1)));
  // the dominant component carries the judgment (a move in x while y holds, and the reverse)
  let comp = 0, best = -1;
  for (let c = 0; c < cols; c++) {
    let travel = 0;
    for (let i = 1; i < values.length; i++) {
      const a = values[i - 1], b = values[i];
      const xa = Array.isArray(a) ? a[c] : a, xb = Array.isArray(b) ? b[c] : b;
      if (typeof xa === 'number' && typeof xb === 'number') travel += Math.abs(xb - xa);
    }
    if (travel > best) { best = travel; comp = c; }
  }
  const ts: number[] = [], v: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const x = Array.isArray(values[i]) ? (values[i] as number[])[comp] : values[i] as number;
    if (typeof x === 'number') { ts.push(times[i]); v.push(x); }
  }
  const peak = Math.max(0, ...v.map((x, i) => (i && ts[i] > ts[i - 1] ? Math.abs(x - v[i - 1]) / (ts[i] - ts[i - 1]) : 0)));
  if (peak <= 1e-9) return out;
  // a run of hot steps covers the samples at its two ends, holds left out
  let start = -1;
  const close = (end: number) => {
    const f = scalarFigures(ts.slice(start, end + 1), v.slice(start, end + 1));
    if (f) out.push({ from: ts[start], to: ts[end], figures: f });
    start = -1;
  };
  for (let i = 1; i < v.length; i++) {
    const hot = ts[i] > ts[i - 1] && Math.abs(v[i] - v[i - 1]) / (ts[i] - ts[i - 1]) > gate * peak;
    if (hot && start < 0) start = i - 1;
    if (!hot && start >= 0) close(i - 1);
  }
  if (start >= 0) close(v.length - 1);
  return out;
}

/** the figures of a series of numbers or [x, y]: the component that travels most */
export function motionFigures(times: number[], values: (number | number[])[]): MotionFigures | null {
  const cols = Math.max(1, ...values.map((v) => (Array.isArray(v) ? v.length : 1)));
  let best: MotionFigures | null = null;
  for (let c = 0; c < cols; c++) {
    const ts: number[] = [], series: number[] = [];
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const x = Array.isArray(v) ? v[c] : v;
      if (typeof x === 'number') { ts.push(times[i]); series.push(x); }
    }
    const f = scalarFigures(ts, series);
    if (f && (!best || f.travel > best.travel)) best = f;
  }
  return best;
}

// ── what moves in a composition ──────────────────────────────
export interface AnimatedSlot {
  /** where the value lives: 'title.transform.position', 'title.props.size', '$comp.camera.pan'… */
  address: string;
  /** the layer it belongs to ('' for the composition's own: effects, camera) */
  layerId: string;
  def: PropDef;
  /** the property as written in the document (its kind and modifiers tell how it moves) */
  raw: unknown;
}

const NUMERIC = new Set(['number', 'vec2']);

/** the numeric properties of a composition that move on their own: keyframes, an expression, a link or a modifier */
export function animatedSlots(doc: TrammeDoc, registry: Registry, compId: string): AnimatedSlot[] {
  const comp = doc.compositions[compId];
  if (!comp) return [];
  const out: AnimatedSlot[] = [];
  const put = (address: string, layerId: string, raw: unknown, def: PropDef | undefined) => {
    if (!def || !NUMERIC.has(def.type) || raw === undefined) return;
    if (propKind(raw) !== 'static' || modsOf(raw)) out.push({ address, layerId, def, raw });
  };
  const effectSchema = (type: string): Record<string, PropDef> => (registry.hasEffect(type) ? (registry.effect(type).props as Record<string, PropDef>) : {});
  for (const [id, layer] of Object.entries(comp.layers)) {
    const tr = layer.transform as Record<string, unknown> | undefined;
    for (const [name, def] of Object.entries(TRANSFORM_SCHEMA)) put(`${id}.transform.${name}`, id, tr?.[name], def as PropDef);
    if (registry.hasNode(layer.type)) {
      for (const [name, def] of Object.entries(registry.node(layer.type).props)) put(`${id}.${name}`, id, layer.props?.[name], def as PropDef);
    }
    for (const fx of layer.effects || []) {
      for (const [name, def] of Object.entries(effectSchema(fx.type))) put(`${id}.effects.${fx.id}.${name}`, id, fx.props?.[name], def as PropDef);
    }
  }
  for (const fx of comp.effects || []) {
    for (const [name, def] of Object.entries(effectSchema(fx.type))) put(`$comp.effects.${fx.id}.${name}`, '', fx.props?.[name], def as PropDef);
  }
  if (comp.camera) {
    const cam = comp.camera as Record<string, unknown>;
    for (const [name, def] of Object.entries(CAMERA_SCHEMA)) put(`$comp.camera.${name}`, '', cam[name], def as PropDef);
  }
  return out;
}

/** the addresses only (see animatedSlots) */
export const animatedAddresses = (doc: TrammeDoc, registry: Registry, compId: string): string[] => animatedSlots(doc, registry, compId).map((s) => s.address);

/** the series of one address over a span, or null when it does not evaluate to numbers; `extra` adds instants to the grid (the keyframes', so stretches read true) */
export function sampleAddress(evaluator: Evaluator, address: string, compId: string, from: number, to: number, n = 24, extra: number[] = []): { times: number[]; values: (number | number[])[] } | null {
  if (!(to > from) || n < 2) return null;
  const grid = [...Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1)), ...extra]
    .filter((t) => t >= from - 1e-9 && t <= to + 1e-9).map((t) => +t.toFixed(6));
  const times: number[] = [], values: (number | number[])[] = [];
  for (const t of [...new Set(grid)].sort((a, b) => a - b)) {
    let v: unknown;
    try { v = evaluator.value(address, t, compId); } catch { return null; }
    if (typeof v === 'number') { times.push(t); values.push(v); }
    else if (Array.isArray(v) && v.length >= 2 && v.every((x) => typeof x === 'number')) { times.push(t); values.push(v as number[]); }
  }
  return times.length >= 2 ? { times, values } : null;
}

export interface MotionReport {
  /** the figures of the span's animated properties, the biggest travels first */
  figures: { address: string; figures: MotionFigures }[];
}

/** the figures of every animated property over a span (24 samples by default) */
export function motionReport(evaluator: Evaluator, compId: string, from: number, to: number, opts: { samples?: number; limit?: number } = {}): MotionReport {
  if (!(to > from)) return { figures: [] };
  const n = Math.max(4, Math.min(64, opts.samples ?? 24));
  const out: MotionReport['figures'] = [];
  for (const slot of animatedSlots(evaluator.doc, evaluator.registry, compId)) {
    const series = sampleAddress(evaluator, slot.address, compId, from, to, n);
    if (!series) continue;
    const f = motionFigures(series.times, series.values);
    if (f && f.travel > 1e-6) out.push({ address: slot.address, figures: f });
  }
  out.sort((a, b) => b.figures.travel - a.figures.travel);
  return { figures: out.slice(0, opts.limit ?? 8) };
}

/** the span a layer is visible for, within the composition */
export function spanOf(comp: Composition, id: string): [number, number] {
  const l = comp.layers[id];
  return [Math.max(0, l?.in ?? 0), Math.min(comp.duration, l?.out ?? comp.duration)];
}
