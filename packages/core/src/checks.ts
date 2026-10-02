// Quality checks: what makes a video hard to read or clumsy, found from the
// document itself. The composition is sampled a few times a second, each
// layer placed in composition space (box, cumulative opacity, effective text
// size); each check reads those samples and reports issues with the times and
// layers involved. The assistant runs them before summing up its work, the
// user from the / menu. Plugins add their own (`checks` export).

import { Evaluator, type EvaluatedLayer } from './evaluate.ts';
import type { Host, NodeType, Rect, Registry } from './registry.ts';
import type { Composition, Layer, TrammeDoc } from './types.ts';

export interface QualityIssue {
  /** the check that found it */
  check: string;
  severity: 'warning' | 'info';
  /** in English, for the assistant */
  message: string;
  /** the same message for the interface: an English template ({name} placeholders) and its values, translated where shown */
  say?: { text: string; params?: Record<string, string | number> };
  /** when it happens (s) */
  t?: number;
  layers?: string[];
}

/** a layer at one instant, in composition space */
export interface PlacedLayer {
  id: string;
  layer: Layer;
  node: NodeType;
  props: Record<string, unknown>;
  /** opacity times its parents' */
  opacity: number;
  /** axis-aligned box in composition pixels, or null when the node has no bounds */
  box: Rect | null;
  /** text layers: their text and the height of their type on screen (px) */
  text?: string;
  textSize?: number;
}

export interface Sample { t: number; layers: PlacedLayer[] }

export interface CheckContext {
  doc: TrammeDoc;
  compId: string;
  comp: Composition;
  registry: Registry;
  evaluator: Evaluator;
  /** the composition every `step` seconds */
  samples: Sample[];
  step: number;
  /** the content of a JSON asset (analyses such as subjects-<media>), when loaded */
  data(assetId: string): unknown;
}

export interface CheckType {
  name: string;
  title?: string;
  description: string;
  /** the message templates it reports (translations of the interface) */
  texts?: string[];
  run(ctx: CheckContext): QualityIssue[] | Promise<QualityIssue[]>;
}

// ── placing layers ───────────────────────────────────────────
type M = [number, number, number, number, number, number];
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
function local(L: EvaluatedLayer): M {
  const { position: [x, y], rotation, scale: [sx, sy], anchor: [ax, ay] } = L.transform;
  const r = (rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  // translate(position) · rotate · scale · translate(-anchor), as the renderer does
  return mul([c * sx, s * sx, -s * sy, c * sy, x, y], [1, 0, 0, 1, -ax, -ay]);
}
function boxOf(m: M, r: Rect): Rect {
  const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

const TEXT_NODES = new Set(['text', 'text.counter', 'captions']);
export const isTextLayer = (L: { node: NodeType }) => TEXT_NODES.has(L.node.type);

/** a host good enough to measure: fonts by their family, as the asset store registers them */
function measureHost(doc: TrammeDoc, comp: Composition, t: number, layerId: string): Host {
  return {
    layerId, t, frame: Math.round(t * comp.fps), fps: comp.fps, width: comp.width, height: comp.height, duration: comp.duration,
    asset: <T>(id: string) => (doc.assets[id]?.type === 'font' ? (doc.assets[id].family || id) : null) as T,
    assetInfo: (id: string) => doc.assets[id],
    assetUrl: (id: string) => doc.assets[id]?.src ?? '',
  };
}

/** a text's box without a canvas to measure it (command line, tests): average glyph widths */
function estimateText(p: Record<string, unknown>): Rect {
  const size = Number(p.size) || 64, lines = String(p.text ?? '').split('\n');
  const w = Math.max(...lines.map((l) => l.length)) * size * 0.56, h = size * (1 + (lines.length - 1) * (Number(p.lineHeight) || 1.2));
  const x = p.align === 'center' ? -w / 2 : p.align === 'right' ? -w : 0;
  const y = p.baseline === 'top' ? 0 : p.baseline === 'middle' ? -size / 2 : p.baseline === 'bottom' ? -size : -size * 0.8;
  return { x, y, w, h };
}

function place(doc: TrammeDoc, comp: Composition, t: number, layers: EvaluatedLayer[], parent: M, alpha: number, out: PlacedLayer[]) {
  for (const L of layers) {
    const m = mul(parent, local(L)), opacity = alpha * L.transform.opacity;
    let r: Rect | null = null;
    try { r = L.node.bounds?.(L.props, measureHost(doc, comp, t, L.id)) ?? null; } catch { r = null; }
    const text = isTextLayer(L);
    if (!r && L.node.type === 'text') r = estimateText(L.props);
    // the height of the type on screen: its size times the vertical scale of the layer
    const textSize = text ? Math.abs(Number(L.props.size) || 0) * Math.hypot(m[2], m[3]) : undefined;
    out.push({ id: L.id, layer: L.layer, node: L.node, props: L.props, opacity, box: r ? boxOf(m, r) : null, ...(text ? { text: String(L.props.text ?? ''), textSize } : {}) });
    place(doc, comp, t, L.children, m, opacity, out);
  }
}

/** the composition every `step` seconds, its layers placed */
export function sampleComposition(evaluator: Evaluator, compId: string, step = 0.25): Sample[] {
  const comp = evaluator.comp(compId), out: Sample[] = [];
  for (let t = 0; t < comp.duration - 1e-6; t += step) {
    const f = evaluator.frame(t, compId), layers: PlacedLayer[] = [];
    place(evaluator.doc, comp, t, f.layers, [1, 0, 0, 1, 0, 0], 1, layers);
    out.push({ t: +t.toFixed(4), layers });
  }
  return out;
}

// ── the built-in checks ──────────────────────────────────────
const u = (c: Composition) => Math.min(c.width, c.height);
const name = (p: PlacedLayer) => p.layer.name ?? p.id;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const s2 = (t: number) => +t.toFixed(2);

const textSize: CheckType = {
  name: 'text-size', title: 'Text size', description: 'text too small to read on a phone',
  texts: ['"{name}" is about {px} px high: too small to read on a phone (at least {min} px)'],
  run({ comp, samples }) {
    const min = Math.round(u(comp) * 0.03), seen = new Map<string, { px: number; t: number; p: PlacedLayer }>();
    for (const s of samples) for (const p of s.layers) {
      if (p.textSize === undefined || p.opacity < 0.5 || !p.text?.trim() || p.textSize >= min) continue;
      if (!seen.has(p.id) || seen.get(p.id)!.px > p.textSize) seen.set(p.id, { px: p.textSize, t: s.t, p });
    }
    return [...seen.values()].map(({ px, t, p }) => ({
      check: 'text-size', severity: 'warning', t, layers: [p.id],
      message: `"${name(p)}" is about ${Math.round(px)} px high at ${s2(t)} s: too small to read on a phone (at least ${min} px).`,
      say: { text: '"{name}" is about {px} px high: too small to read on a phone (at least {min} px)', params: { name: name(p), px: Math.round(px), min } },
    }));
  },
};

const textTime: CheckType = {
  name: 'text-time', title: 'Reading time', description: 'text on screen too briefly to be read',
  texts: ['"{name}" is readable for {time} s: {need} s are needed for {words} word(s)'],
  run({ samples, step }) {
    const shown = new Map<string, { time: number; first: number; p: PlacedLayer }>();
    for (const s of samples) for (const p of s.layers) {
      if (p.node.type !== 'text' || p.opacity < 0.6 || !p.text?.trim()) continue;
      const e = shown.get(p.id) ?? { time: 0, first: s.t, p };
      e.time += step;
      shown.set(p.id, e);
    }
    const out: QualityIssue[] = [];
    for (const { time, first, p } of shown.values()) {
      const n = words(p.text!), need = 0.5 + 0.25 * n;
      if (time + step / 2 >= need) continue;
      out.push({
        check: 'text-time', severity: 'warning', t: first, layers: [p.id],
        message: `"${name(p)}" is readable for about ${s2(time)} s from ${s2(first)} s: ${s2(need)} s are needed for ${n} word(s).`,
        say: { text: '"{name}" is readable for {time} s: {need} s are needed for {words} word(s)', params: { name: name(p), time: s2(time), need: s2(need), words: n } },
      });
    }
    return out;
  },
};

const safeZone: CheckType = {
  name: 'safe-zone', title: 'Safe zone', description: 'text too close to the edges of the frame',
  texts: ['"{name}" goes past the safe zone (5 % from the edges) at {t} s'],
  run({ comp, samples }) {
    const mx = comp.width * 0.05, my = comp.height * 0.05, out = new Map<string, QualityIssue>();
    for (const s of samples) for (const p of s.layers) {
      if (!p.box || p.textSize === undefined || p.node.type === 'captions' || p.opacity < 0.5 || out.has(p.id)) continue;
      const b = p.box;
      if (b.x >= mx && b.y >= my && b.x + b.w <= comp.width - mx && b.y + b.h <= comp.height - my) continue;
      out.set(p.id, {
        check: 'safe-zone', severity: 'warning', t: s.t, layers: [p.id],
        message: `"${name(p)}" goes past the safe zone (5 % from the edges) at ${s2(s.t)} s: box x ${Math.round(b.x)}..${Math.round(b.x + b.w)}, y ${Math.round(b.y)}..${Math.round(b.y + b.h)} in a ${comp.width}x${comp.height} frame.`,
        say: { text: '"{name}" goes past the safe zone (5 % from the edges) at {t} s', params: { name: name(p), t: s2(s.t) } },
      });
    }
    return [...out.values()];
  },
};

const overlap: CheckType = {
  name: 'text-overlap', title: 'Overlapping text', description: 'two texts on top of each other',
  texts: ['"{a}" and "{b}" overlap at {t} s'],
  run({ samples }) {
    const out = new Map<string, QualityIssue>();
    for (const s of samples) {
      const texts = s.layers.filter((p) => p.box && p.textSize !== undefined && p.opacity > 0.5 && p.text?.trim());
      for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i].box!, b = texts[j].box!, key = `${texts[i].id}|${texts[j].id}`;
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ix <= 0 || iy <= 0 || out.has(key) || ix * iy < 0.15 * Math.min(a.w * a.h, b.w * b.h)) continue;
        out.set(key, {
          check: 'text-overlap', severity: 'warning', t: s.t, layers: [texts[i].id, texts[j].id],
          message: `"${name(texts[i])}" and "${name(texts[j])}" overlap at ${s2(s.t)} s.`,
          say: { text: '"{a}" and "{b}" overlap at {t} s', params: { a: name(texts[i]), b: name(texts[j]), t: s2(s.t) } },
        });
      }
    }
    return [...out.values()];
  },
};

const crossing: CheckType = {
  name: 'text-crossing', title: 'Text crossing', description: 'text passing over another element, which may hurt its reading',
  texts: ['"{name}" passes over "{other}" around {t} s: check that it stays readable'],
  run({ comp, samples }) {
    // a background (half the frame or more) is not an element to avoid
    const frame = comp.width * comp.height, out = new Map<string, QualityIssue>();
    for (const s of samples) {
      for (const p of s.layers) {
        if (!p.box || p.textSize === undefined || p.opacity < 0.5 || !p.text?.trim()) continue;
        for (const q of s.layers) {
          if (q === p || !q.box || q.textSize !== undefined || q.opacity < 0.3 || q.box.w * q.box.h > frame * 0.5 || q.node.container) continue;
          const a = p.box, b = q.box, key = `${p.id}|${q.id}`;
          const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          if (ix <= 0 || iy <= 0 || out.has(key) || ix * iy < 0.1 * a.w * a.h) continue;
          out.set(key, {
            check: 'text-crossing', severity: 'info', t: s.t, layers: [p.id, q.id],
            message: `"${name(p)}" passes over "${name(q)}" around ${s2(s.t)} s: check that it stays readable, or move one of them.`,
            say: { text: '"{name}" passes over "{other}" around {t} s: check that it stays readable', params: { name: name(p), other: name(q), t: s2(s.t) } },
          });
        }
      }
    }
    return [...out.values()];
  },
};

/** people found in a video or an image (the subjects tool), boxes 0..1 of the picture */
export interface Subjects {
  version: 1;
  kind: 'subjects';
  source?: string;
  width: number;
  height: number;
  frames: { t: number; boxes: { x: number; y: number; w: number; h: number; label: string; score: number }[] }[];
}
export const isSubjects = (x: unknown): x is Subjects => !!x && typeof x === 'object' && (x as Subjects).kind === 'subjects' && Array.isArray((x as Subjects).frames);

/** the people of a media layer at one instant, in composition space: their box and their head (the top quarter) */
export function subjectsOn(p: PlacedLayer, t: number, data: (id: string) => unknown): { box: Rect; head: Rect }[] {
  if ((p.node.type !== 'video' && p.node.type !== 'image') || !p.box) return [];
  const asset = String(p.props[p.node.type] ?? ''), s = data(`subjects-${asset}`.slice(0, 64));
  if (!isSubjects(s) || !s.frames.length) return [];
  const ft = p.node.type === 'video' ? t - (p.layer.in ?? 0) + (Number(p.props.start) || 0) : 0;
  const frame = s.frames.reduce((a, b) => (Math.abs(b.t - ft) < Math.abs(a.t - ft) ? b : a));
  // the picture in its frame: cover crops, contain fits, fill stretches (focus and zoom left aside)
  const f = p.box, fit = String(p.props.fit ?? 'cover');
  const k = fit === 'contain' ? Math.min(f.w / s.width, f.h / s.height) : Math.max(f.w / s.width, f.h / s.height);
  const sx = fit === 'fill' ? f.w : s.width * k, sy = fit === 'fill' ? f.h : s.height * k;
  const ox = f.x + (f.w - sx) / 2, oy = f.y + (f.h - sy) / 2;
  return frame.boxes.filter((b) => b.label === 'person').map((b) => {
    const box = { x: ox + b.x * sx, y: oy + b.y * sy, w: b.w * sx, h: b.h * sy };
    return { box, head: { x: box.x + box.w * 0.15, y: box.y, w: box.w * 0.7, h: Math.min(box.h, box.w * 1.1) * 0.9 } };
  });
}

const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

const overSubject: CheckType = {
  name: 'text-over-subject', title: 'Text over a person', description: 'text covering the face or the body of someone filmed (after the subjects tool)',
  texts: ['"{name}" covers a face at {t} s', '"{name}" covers someone at {t} s'],
  run({ samples, data }) {
    const out = new Map<string, QualityIssue>();
    for (const s of samples) {
      const people = s.layers.flatMap((p) => subjectsOn(p, s.t, data));
      if (!people.length) continue;
      for (const p of s.layers) {
        if (!p.box || p.textSize === undefined || p.opacity < 0.5 || !p.text?.trim() || out.has(p.id)) continue;
        const area = p.box.w * p.box.h;
        const face = people.find((x) => overlapArea(p.box!, x.head) > 0.12 * Math.min(area, x.head.w * x.head.h));
        const body = !face && people.find((x) => overlapArea(p.box!, x.box) > 0.35 * area);
        if (!face && !body) continue;
        out.set(p.id, {
          check: 'text-over-subject', severity: face ? 'warning' : 'info', t: s.t, layers: [p.id],
          message: face ? `"${name(p)}" covers a face at ${s2(s.t)} s: move it above or below the head, or to the free side of the frame.` : `"${name(p)}" covers someone at ${s2(s.t)} s: the free side of the frame would read better.`,
          say: { text: face ? '"{name}" covers a face at {t} s' : '"{name}" covers someone at {t} s', params: { name: name(p), t: s2(s.t) } },
        });
      }
    }
    return [...out.values()];
  },
};

const crowd: CheckType = {
  name: 'crowd', title: 'Crowded entrances', description: 'many elements appearing at the same moment',
  texts: ['{n} elements appear together around {t} s: stagger them so the eye can follow'],
  run({ samples }) {
    // when each layer appears: its first sample with some opacity
    const first = new Map<string, number>();
    for (const s of samples) for (const p of s.layers) if (p.opacity > 0.05 && p.box && !first.has(p.id)) first.set(p.id, s.t);
    const times = [...first.entries()].filter(([, t]) => t > 0).sort((a, b) => a[1] - b[1]);
    const out: QualityIssue[] = [];
    for (let i = 0; i < times.length;) {
      let j = i;
      while (j + 1 < times.length && times[j + 1][1] - times[i][1] <= 0.25) j++;
      const group = times.slice(i, j + 1);
      if (group.length >= 4) out.push({
        check: 'crowd', severity: 'info', t: group[0][1], layers: group.map(([id]) => id),
        message: `${group.length} elements appear together around ${s2(group[0][1])} s (${group.map(([id]) => id).slice(0, 6).join(', ')}${group.length > 6 ? '…' : ''}): stagger them so the eye can follow.`,
        say: { text: '{n} elements appear together around {t} s: stagger them so the eye can follow', params: { n: group.length, t: s2(group[0][1]) } },
      });
      i = j + 1;
    }
    return out;
  },
};

const stillness: CheckType = {
  name: 'stillness', title: 'Still stretches', description: 'long moments where nothing moves',
  texts: ['nothing moves from {from} to {to} s'],
  run({ samples, comp, step }) {
    // a video or a sequence moves by itself; otherwise compare the placed layers between samples
    const sig = (s: Sample) => s.layers.map((p) => (p.node.type === 'video' || p.node.type === 'sequence' || p.node.type === 'particles' || p.node.type === 'shader' ? `${p.id}:${s.t}` : `${p.id}:${p.opacity.toFixed(2)}:${p.box ? [p.box.x, p.box.y, p.box.w, p.box.h].map((v) => v.toFixed(0)).join(',') : ''}:${JSON.stringify(p.props)}`)).join('|');
    const out: QualityIssue[] = [];
    let from = 0;
    for (let i = 1; i <= samples.length; i++) {
      const same = i < samples.length && sig(samples[i]) === sig(samples[i - 1]);
      if (same) continue;
      const to = i < samples.length ? samples[i].t : comp.duration;
      if (to - from >= Math.max(2.5, step * 4) && from < comp.duration - 0.5) out.push({
        check: 'stillness', severity: 'info', t: s2(from),
        message: `Nothing moves from ${s2(from)} to ${s2(to)} s: a slow drift, a scale breathing or a new element would keep the eye busy.`,
        say: { text: 'nothing moves from {from} to {to} s', params: { from: s2(from), to: s2(to) } },
      });
      from = i < samples.length ? samples[i].t : comp.duration;
    }
    return out;
  },
};

export const BUILTIN_CHECKS: CheckType[] = [textSize, textTime, safeZone, overlap, crossing, overSubject, crowd, stillness];

/** every check of the registry on one composition, the failures of a check reported as issues */
export async function runChecks(doc: TrammeDoc, registry: Registry, compId = doc.root, { step = 0.25, only, data = () => undefined }: { step?: number; only?: string[]; data?: (assetId: string) => unknown } = {}): Promise<QualityIssue[]> {
  const evaluator = new Evaluator(doc, registry, { data });
  const comp = evaluator.comp(compId);
  const ctx: CheckContext = { doc, compId, comp, registry, evaluator, samples: sampleComposition(evaluator, compId, step), step, data };
  const out: QualityIssue[] = [];
  for (const { check } of registry.listChecks()) {
    if (only && !only.includes(check.name)) continue;
    try { out.push(...(await check.run(ctx)).map((i) => ({ ...i, check: i.check || check.name }))); }
    catch (e) { out.push({ check: check.name, severity: 'info', message: `the check "${check.name}" failed: ${(e as Error).message}` }); }
  }
  return out.sort((a, b) => (a.severity === b.severity ? (a.t ?? 0) - (b.t ?? 0) : a.severity === 'warning' ? -1 : 1));
}

