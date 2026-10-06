// Recipes: tools that lay out a whole animated piece in one move (kinetic
// title, bar chart, rolling figure, transition) as ordinary layers and
// keyframes, editable afterwards. They read the style kit's tokens (plate,
// ink, accent, enter, exit, pace, stagger) so a film keeps one motion
// language; the kit tool applies a kit. All of it is a tool of the editor's
// vocabulary: the assistant runs it (use_tool), the user too (/ menu).

import type { EaseSpec, KitType, Op, ToolContext, ToolType, TrammeDoc, Vec2 } from '@tramme/core';
import { pointer } from '@tramme/core';
import { adder } from './templates.ts';
import { clip } from './model.ts';

// ── the look of the document ─────────────────────────────────
type Bezier = [number, number, number, number];
const ENTER: Bezier = [0.16, 1, 0.3, 1], EXIT: Bezier = [0.7, 0, 0.84, 0], POP: Bezier = [0.34, 1.56, 0.64, 1];
const STANDARD: Bezier = [0.4, 0, 0.2, 1], EMPHASIZED: Bezier = [0.2, 0, 0, 1];

/** a token when the document has one of that type, a fallback otherwise */
export function style(doc: TrammeDoc) {
  const has = (n: string, type: string) => doc.tokens?.[n]?.type === type;
  const num = (n: string, d: number) => (has(n, 'number') ? Number(doc.tokens[n].value) || d : d);
  const firstColor = Object.entries(doc.tokens ?? {}).find(([n, t]) => t.type === 'color' && !/plate|bg|back|ink|night|paper/i.test(n))?.[0];
  return {
    accent: has('accent', 'color') ? '@accent' : firstColor ? `@${firstColor}` : '#2EC4B6',
    accent2: has('accent2', 'color') ? '@accent2' : has('accent', 'color') ? '@accent' : '#F4B860',
    ink: has('ink', 'color') ? '@ink' : '#FFFFFF',
    enter: (has('enter', 'ease') ? '@enter' : ENTER) as EaseSpec,
    exit: (has('exit', 'ease') ? '@exit' : EXIT) as EaseSpec,
    standard: (has('standard', 'ease') ? '@standard' : STANDARD) as EaseSpec,
    emphasized: (has('emphasized', 'ease') ? '@emphasized' : EMPHASIZED) as EaseSpec,
    pace: num('pace', 0.6),
    stagger: num('stagger', 0.06),
    font: Object.entries(doc.assets).find(([, a]) => a.type === 'font')?.[0] ?? null,
  };
}

/** the width of a text, measured with the document's font when a canvas is there, estimated otherwise */
export function measure(doc: TrammeDoc, text: string, size: number, weight: number, font: string | null): number {
  try {
    const g = document.createElement('canvas').getContext('2d')!;
    const family = font ? doc.assets[font]?.family || font : 'sans-serif';
    g.font = `${weight} ${size}px "${family}", sans-serif`;
    return g.measureText(text).width;
  } catch { return text.length * size * (weight >= 700 ? 0.64 : 0.56); }
}

/** the width of a counter: digits in equal cells (the widest digit), other signs at their own width, as the node draws it */
export function counterWidth(doc: TrammeDoc, text: string, size: number, weight: number, font: string | null): number {
  const cell = Math.max(...'0123456789'.split('').map((d) => measure(doc, d, size, weight, font)));
  return [...text].reduce((w, ch) => w + (/\d/.test(ch) ? cell : measure(doc, ch, size, weight, font)), 0);
}

export const r = (x: number) => Math.round(x * 100) / 100;
export const compOf = (ctx: ToolContext) => ctx.doc.compositions[ctx.compId];
const atOf = (ctx: ToolContext, at?: number) => r(at ?? ctx.time);

// ── kinetic title ────────────────────────────────────────────
interface TitleArgs { text: string; at?: number; duration?: number; style?: 'rise' | 'pop' | 'slide' | 'blur'; place?: 'top' | 'center' | 'bottom'; emphasis?: number; size?: number }

const kineticTitle: ToolType<TitleArgs> = {
  name: 'kinetic-title', title: 'Kinetic title', description: 'a title whose words enter one after the other (rise, pop, slide or blur), one word in the accent colour',
  input: {
    type: 'object',
    properties: {
      text: { type: 'string', title: 'Text' },
      style: { enum: ['rise', 'pop', 'slide', 'blur'], title: 'Style' },
      emphasis: { type: 'integer', minimum: 1, title: 'Word in colour', description: 'its rank in the title (1: the first)' },
      at: { type: 'number', minimum: 0, title: 'Start (s)' },
      duration: { type: 'number', minimum: 0.5, title: 'Duration (s)' },
      place: { enum: ['top', 'center', 'bottom'], title: 'Place' },
      size: { type: 'number', minimum: 8, title: 'Size (px)' },
    },
    required: ['text'],
  },
  ai: { when: 'titles and key phrases that deserve energy: rise for a calm tone, pop for a punchy one, blur for a cinematic one; 2 to 7 words', avoid: 'whole sentences of more than 10 words' },
  run(a, ctx) {
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), at = atOf(ctx, a.at), end = r(at + (a.duration ?? 3));
    const u = Math.min(c.width, c.height), size = a.size ?? Math.round(u * (c.height > c.width ? 0.1 : 0.085)), weight = 800;
    const words = a.text.split(/\s+/).filter(Boolean);
    if (!words.length) throw new Error('kinetic-title: text is empty');
    // lines within 84 % of the width
    const space = measure(doc, ' ', size, weight, s.font), max = c.width * 0.84;
    const lines: { word: string; w: number; i: number }[][] = [[]];
    let lineW = 0;
    words.forEach((word, i) => {
      const w = measure(doc, word, size, weight, s.font);
      if (lines.at(-1)!.length && lineW + space + w > max) { lines.push([]); lineW = 0; }
      lineW += (lines.at(-1)!.length ? space : 0) + w;
      lines.at(-1)!.push({ word, w, i });
    });
    const lh = size * 1.12, y = a.place === 'top' ? c.height * 0.22 : a.place === 'bottom' ? c.height * 0.74 : c.height * 0.48;
    const { add, done } = adder(doc, ctx.compId);
    const children: string[] = [];
    const kind = a.style ?? 'rise';
    lines.forEach((line, li) => {
      const total = line.reduce((t, x, k) => t + x.w + (k ? space : 0), 0);
      let x = -total / 2;
      for (const { word, w, i } of line) {
        const t0 = r(at + i * s.stagger), t1 = r(t0 + s.pace), cx = r(x + w / 2), cy = r(li * lh - ((lines.length - 1) * lh) / 2);
        const pos: Vec2 = [cx, cy];
        const transform: Record<string, unknown> = {
          anchor: [r(w / 2), 0],
          opacity: { $k: [{ t: t0, v: 0, ease: s.enter }, { t: r(t0 + s.pace * 0.6), v: 1 }] },
        };
        const effects: unknown[] = [];
        if (kind === 'rise') transform.position = { $k: [{ t: t0, v: [cx, r(cy + size * 0.55)], ease: s.enter }, { t: t1, v: pos }] };
        else if (kind === 'slide') transform.position = { $k: [{ t: t0, v: [r(cx - size * 0.6), cy], ease: s.enter }, { t: t1, v: pos }] };
        else transform.position = pos;
        if (kind === 'pop') transform.scale = { $k: [{ t: t0, v: [0.45, 0.45], ease: POP }, { t: t1, v: [1, 1] }] };
        if (kind === 'blur') effects.push({ id: 'blur', type: 'fx.blur', props: { radius: { $k: [{ t: t0, v: Math.round(size * 0.25), ease: s.enter }, { t: r(t1 + 0.1), v: 0 }] } } });
        children.push(add(`word-${i + 1}`, {
          type: 'text', name: word, transform, ...(effects.length ? { effects } : {}),
          props: { text: word, size, weight, align: 'left', baseline: 'middle', tracking: -0.01, color: a.emphasis === i + 1 ? s.accent : s.ink, ...(s.font ? { font: s.font } : {}) },
        }, false));
        x += w + space;
      }
    });
    // the whole title leaves together
    add('kinetic-title', {
      type: 'group', name: clip(a.text, 39), in: at, out: end,
      transform: { position: [r(c.width / 2), r(y)], opacity: { $k: [{ t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] } },
      children,
    });
    return { ops: done(), label: `Kinetic title "${a.text}"`, text: `Kinetic title (${kind}), ${words.length} word(s) on ${lines.length} line(s), from ${at} to ${end} s.` };
  },
};

// ── bar chart ────────────────────────────────────────────────
/** "Label: 12, Other: 30" or "12, 30, 45" */
export function parseData(data: string): { label: string; value: number }[] {
  return data.split(/[,;\n]/).map((part, i) => {
    const m = /^\s*(?:(.*?)\s*[:=]\s*)?(-?\d+(?:[.,]\d+)?)\s*$/.exec(part);
    return m ? { label: (m[1] ?? '').trim() || String(i + 1), value: Number(m[2].replace(',', '.')) } : null;
  }).filter((x): x is { label: string; value: number } => !!x && Number.isFinite(x.value));
}

interface ChartArgs { data: string; title?: string; unit?: string; at?: number; duration?: number }

const barChart: ToolType<ChartArgs> = {
  name: 'bar-chart', title: 'Bar chart', description: 'animated bars that grow one after the other, with their values rolling up and their labels',
  input: {
    type: 'object',
    properties: {
      data: { type: 'string', title: 'Data', description: '"Label: value" separated by commas, e.g. "2022: 12, 2023: 30, 2024: 45"' },
      title: { type: 'string', title: 'Title' },
      unit: { type: 'string', title: 'Unit', description: 'after each value, e.g. "%" or " k€"' },
      at: { type: 'number', minimum: 0, title: 'Start (s)' },
      duration: { type: 'number', minimum: 1, title: 'Duration (s)' },
    },
    required: ['data'],
  },
  ai: { when: 'comparing 2 to 8 values; the highest bar in the accent colour draws the eye', avoid: 'more than 8 bars, or values that need decimals to differ' },
  run(a, ctx) {
    const rows = parseData(a.data);
    if (rows.length < 1) throw new Error('bar-chart: no value in data (expected "Label: 12, Other: 30")');
    if (rows.length > 12) throw new Error('bar-chart: 12 bars at most');
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), at = atOf(ctx, a.at), end = r(at + (a.duration ?? 5));
    const u = Math.min(c.width, c.height), top = Math.max(...rows.map((x) => x.value), 1e-9);
    const boxW = c.width * 0.8, boxH = c.height * (c.height > c.width ? 0.36 : 0.46), base = r(c.height * (a.title ? 0.74 : 0.7));
    const slot = boxW / rows.length, bw = r(slot * 0.62), labelSize = Math.round(u * 0.034), valueSize = Math.round(u * 0.052);
    const { add, done } = adder(doc, ctx.compId);
    const fadeOut = { $k: [{ t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] };
    if (a.title) add('chart-title', { type: 'text', name: a.title, in: at, out: end, transform: { position: { $k: [{ t: at, v: [r(c.width / 2), r(base - boxH - u * 0.1 + u * 0.03)], ease: s.enter }, { t: r(at + s.pace), v: [r(c.width / 2), r(base - boxH - u * 0.1)] }] }, opacity: { $k: [{ t: at, v: 0, ease: s.enter }, { t: r(at + s.pace), v: 1 }, { t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] } }, props: { text: a.title, size: Math.round(u * 0.055), weight: 800, align: 'center', baseline: 'middle', color: s.ink, ...(s.font ? { font: s.font } : {}) } });
    add('chart-axis', { type: 'shape.rect', name: 'Axis', in: at, out: end, transform: { position: [r(c.width / 2), base], scale: { $k: [{ t: at, v: [0, 1], ease: s.enter }, { t: r(at + s.pace), v: [1, 1] }] }, opacity: fadeOut }, props: { size: [r(boxW), Math.max(2, Math.round(u * 0.004))], fill: s.ink } });
    const best = rows.reduce((b, x, i) => (x.value > rows[b].value ? i : b), 0);
    rows.forEach((row, i) => {
      const x = r(c.width / 2 - boxW / 2 + slot * (i + 0.5)), h = r(Math.max(2, (Math.max(0, row.value) / top) * boxH));
      const t0 = r(at + 0.2 + i * Math.max(s.stagger, 0.08)), t1 = r(t0 + s.pace * 1.6);
      add(`bar-${i + 1}`, { type: 'shape.rect', name: `${row.label} · bar`, in: at, out: end, transform: { anchor: [0, r(h / 2)], position: [x, base], scale: { $k: [{ t: t0, v: [1, 0], ease: s.enter }, { t: t1, v: [1, 1] }] }, opacity: fadeOut }, props: { size: [bw, h], radius: Math.round(bw * 0.08), fill: i === best ? s.accent : s.ink } });
      const shown = `${Number.isInteger(row.value) ? row.value : row.value.toFixed(1)}`;
      add(`bar-value-${i + 1}`, { type: 'text.counter', name: `${row.label} · value`, in: t0, out: end, transform: { position: { $k: [{ t: t0, v: [x, r(base - u * 0.02)], ease: s.enter }, { t: t1, v: [x, r(base - h - u * 0.025)] }] }, opacity: { $k: [{ t: t0, v: 0, ease: s.enter }, { t: r(t0 + 0.2), v: 1 }, { t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] } }, props: { from: shown.replace(/\d/g, '0'), to: shown, progress: { $k: [{ t: t0, v: 0, ease: s.enter }, { t: t1, v: 1 }] }, turns: 0, size: valueSize, weight: 800, align: 'center', color: s.ink, ...(s.font ? { font: s.font } : {}) } });
      if (a.unit) add(`bar-unit-${i + 1}`, { type: 'text', name: `${row.label} · unit`, in: t1, out: end, transform: { position: [r(x + counterWidth(doc, shown, valueSize, 800, s.font) / 2 + valueSize * 0.08), r(base - h - u * 0.025)], opacity: { $k: [{ t: t1, v: 0, ease: s.enter }, { t: r(t1 + 0.25), v: 1 }, { t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] } }, props: { text: a.unit, size: Math.round(valueSize * 0.7), weight: 600, align: 'left', color: s.ink, ...(s.font ? { font: s.font } : {}) } });
      add(`bar-label-${i + 1}`, { type: 'text', name: `${row.label} · label`, in: at, out: end, transform: { position: [x, r(base + labelSize * 1.4)], opacity: { $k: [{ t: t0, v: 0, ease: s.enter }, { t: r(t0 + s.pace), v: 1 }, { t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] } }, props: { text: row.label, size: labelSize, weight: 500, align: 'center', baseline: 'middle', color: s.ink, ...(s.font ? { font: s.font } : {}) } });
    });
    return { ops: done(), label: `Bar chart${a.title ? ` "${a.title}"` : ''}`, text: `Bar chart of ${rows.length} value(s) (highest: ${rows[best].label}, in the accent colour), from ${at} to ${end} s.` };
  },
};

// ── a figure that rolls up ───────────────────────────────────
interface StatArgs { value: string; label?: string; at?: number; duration?: number; place?: 'top' | 'center' | 'bottom' }

const stat: ToolType<StatArgs> = {
  name: 'stat', title: 'Key figure', description: 'a big number rolling up like a counter, with a line of text below it',
  input: {
    type: 'object',
    properties: {
      value: { type: 'string', title: 'Value', description: 'as shown, e.g. "1,250", "98%", "$3.2M"' },
      label: { type: 'string', title: 'Label' },
      at: { type: 'number', minimum: 0, title: 'Start (s)' },
      duration: { type: 'number', minimum: 1, title: 'Duration (s)' },
      place: { enum: ['top', 'center', 'bottom'], title: 'Place' },
    },
    required: ['value'],
  },
  ai: { when: 'one striking number said in the voice-over or the key result of a story' },
  run(a, ctx) {
    if (!/\d/.test(a.value)) throw new Error('stat: the value needs digits');
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), at = atOf(ctx, a.at), end = r(at + (a.duration ?? 3));
    const u = Math.min(c.width, c.height), size = Math.round(u * 0.22), y = a.place === 'top' ? c.height * 0.3 : a.place === 'bottom' ? c.height * 0.66 : c.height * 0.46;
    const roll = r(Math.max(0.9, s.pace * 2.2));
    const { add, done } = adder(doc, ctx.compId);
    const fade = (t0: number) => ({ $k: [{ t: t0, v: 0, ease: s.enter }, { t: r(t0 + s.pace * 0.6), v: 1 }, { t: r(end - 0.35), v: 1, ease: s.exit }, { t: end, v: 0 }] });
    add('stat-value', { type: 'text.counter', name: a.value, in: at, out: end, transform: { position: { $k: [{ t: at, v: [r(c.width / 2), r(y + size * 0.15)], ease: s.enter }, { t: r(at + s.pace), v: [r(c.width / 2), r(y)] }] }, opacity: fade(at) }, props: { from: a.value.replace(/\d/g, '0'), to: a.value, progress: { $k: [{ t: at, v: 0, ease: s.enter }, { t: r(at + roll), v: 1 }] }, turns: 1, size, weight: 900, align: 'center', color: s.accent, ...(s.font ? { font: s.font } : {}) } });
    if (a.label) add('stat-label', { type: 'text', name: a.label, in: at, out: end, transform: { position: { $k: [{ t: r(at + roll * 0.6), v: [r(c.width / 2), r(y + size * 0.42)], ease: s.enter }, { t: r(at + roll * 0.6 + s.pace), v: [r(c.width / 2), r(y + size * 0.36)] }] }, opacity: fade(r(at + roll * 0.6)) }, props: { text: a.label, size: Math.round(u * 0.05), weight: 600, align: 'center', baseline: 'top', color: s.ink, ...(s.font ? { font: s.font } : {}) } });
    return { ops: done(), label: `Key figure ${a.value}`, text: `Key figure ${a.value} rolling up from ${at} s for ${roll} s, on screen until ${end} s.` };
  },
};

// ── transition ───────────────────────────────────────────────
interface TransitionArgs { at?: number; style?: 'wipe' | 'circle' | 'bars' | 'flash'; duration?: number }

const transition: ToolType<TransitionArgs> = {
  name: 'transition', title: 'Transition', description: 'a shape that covers the frame at a cut and uncovers the next scene: wipe, circle, bars or flash',
  input: {
    type: 'object',
    properties: {
      at: { type: 'number', minimum: 0, title: 'Cut (s)', description: 'the moment the frame is fully covered' },
      style: { enum: ['wipe', 'circle', 'bars', 'flash'], title: 'Style' },
      duration: { type: 'number', minimum: 0.2, maximum: 3, title: 'Duration (s)' },
    },
  },
  ai: { when: 'between two scenes or sections; place the cut of the scenes exactly at `at`; one style per film', avoid: 'more than one transition every 4 s' },
  run(a, ctx) {
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), cut = atOf(ctx, a.at), d = a.duration ?? 0.8;
    const t0 = r(Math.max(0, cut - d / 2)), t1 = r(Math.min(c.duration, cut + d / 2)), W = c.width, H = c.height;
    const { add, done } = adder(doc, ctx.compId);
    const kind = a.style ?? 'wipe';
    if (kind === 'wipe') {
      add('transition', { type: 'shape.rect', name: 'Transition · wipe', in: t0, out: t1, transform: { position: { $k: [{ t: t0, v: [r(-W * 0.6), r(H / 2)], ease: s.enter }, { t: cut, v: [r(W / 2), r(H / 2)], ease: s.exit }, { t: t1, v: [r(W * 1.6), r(H / 2)] }] }, rotation: 0 }, props: { size: [r(W * 1.2), r(H * 1.1)], fill: s.accent } });
    } else if (kind === 'circle') {
      const D = r(Math.hypot(W, H) * 1.05);
      add('transition', { type: 'shape.ellipse', name: 'Transition · circle', in: t0, out: t1, transform: { position: [r(W / 2), r(H / 2)], scale: { $k: [{ t: t0, v: [0, 0], ease: s.enter }, { t: cut, v: [1, 1], ease: s.exit }, { t: t1, v: [0, 0] }] } }, props: { size: [D, D], fill: s.accent } });
    } else if (kind === 'bars') {
      const n = 5, bh = r(H / n + 2);
      for (let i = 0; i < n; i++) {
        const k = r(i * Math.min(0.05, d / 12));
        add(`transition-bar-${i + 1}`, { type: 'shape.rect', name: `Transition · bar ${i + 1}`, in: t0, out: t1, transform: { position: { $k: [{ t: r(t0 + k), v: [r(-W * 0.55), r(bh * (i + 0.5))], ease: s.enter }, { t: r(cut - (n - 1) * Math.min(0.05, d / 12) + k), v: [r(W / 2), r(bh * (i + 0.5))], ease: s.exit }, { t: r(Math.min(t1, cut + k + d / 2 - (n - 1) * Math.min(0.05, d / 12))), v: [r(W * 1.55), r(bh * (i + 0.5))] }] } }, props: { size: [r(W * 1.1), bh], fill: i % 2 ? s.accent2 : s.accent } });
      }
    } else {
      add('transition', { type: 'shape.rect', name: 'Transition · flash', in: t0, out: t1, transform: { position: [r(W / 2), r(H / 2)], opacity: { $k: [{ t: t0, v: 0, ease: [0.5, 0, 1, 1] }, { t: cut, v: 1, ease: [0, 0, 0.3, 1] }, { t: t1, v: 0 }] } }, props: { size: [W, H], fill: '#FFFFFF' } });
    }
    return { ops: done(), label: `Transition (${kind}) at ${cut} s`, text: `Transition ${kind} from ${t0} to ${t1} s, the frame fully covered at ${cut} s: cut the scenes there.` };
  },
};

// ── style kits ───────────────────────────────────────────────
const tok = (type: 'color' | 'ease' | 'number', value: unknown, description?: string) => ({ type, value, ...(description ? { description } : {}) });

export const BUILTIN_KITS: KitType[] = [
  { name: 'editorial', title: 'Editorial', description: 'paper and ink, a burnt orange accent, unhurried curves', tokens: { plate: tok('color', '#F4EFE6'), ink: tok('color', '#1B1A17'), accent: tok('color', '#C2410C'), accent2: tok('color', '#1E3A8A'), enter: tok('ease', [0.22, 1, 0.36, 1]), exit: tok('ease', [0.64, 0, 0.78, 0]), standard: tok('ease', [0.42, 0, 0.24, 1]), emphasized: tok('ease', [0.2, 0.8, 0.16, 1]), pace: tok('number', 0.7, 'seconds of an entrance'), stagger: tok('number', 0.07, 'seconds between siblings') } },
  { name: 'hairline', title: 'Hairline', description: 'technical line drawings on paper: thin strokes, one accent, figures that answer the pointer', tokens: { plate: tok('color', '#F7F5F0'), ink: tok('color', '#24241F'), accent: tok('color', '#0F62FE'), accent2: tok('color', '#9A968C'), enter: tok('ease', [0.16, 1, 0.3, 1]), exit: tok('ease', [0.7, 0, 0.84, 0]), standard: tok('ease', [0.4, 0, 0.2, 1]), emphasized: tok('ease', [0.2, 0, 0, 1]), pace: tok('number', 0.5, 'seconds of an entrance'), stagger: tok('number', 0.05, 'seconds between siblings') } },
  { name: 'punchy', title: 'Punchy', description: 'black and white with a yellow accent, fast entrances that overshoot', tokens: { plate: tok('color', '#0E0E10'), ink: tok('color', '#FFFFFF'), accent: tok('color', '#FFD400'), accent2: tok('color', '#FF4D6D'), enter: tok('ease', [0.34, 1.56, 0.64, 1]), exit: tok('ease', [0.7, 0, 0.84, 0]), standard: tok('ease', [0.3, 0, 0.15, 1]), emphasized: tok('ease', [0.34, 1.3, 0.5, 1]), pace: tok('number', 0.4, 'seconds of an entrance'), stagger: tok('number', 0.04, 'seconds between siblings') } },
  { name: 'calm', title: 'Calm', description: 'soft blue-grey, slow and smooth movements', tokens: { plate: tok('color', '#E8EEF2'), ink: tok('color', '#23313B'), accent: tok('color', '#5B8DB8'), accent2: tok('color', '#8FB89A'), enter: tok('ease', [0.45, 0, 0.2, 1]), exit: tok('ease', [0.55, 0, 0.55, 1]), standard: tok('ease', [0.45, 0, 0.25, 1]), emphasized: tok('ease', [0.25, 0.3, 0.2, 1]), pace: tok('number', 1, 'seconds of an entrance'), stagger: tok('number', 0.1, 'seconds between siblings') } },
  { name: 'neon', title: 'Neon', description: 'a night plate, cyan and pink accents, sharp curves', tokens: { plate: tok('color', '#07060F'), ink: tok('color', '#F2F0FF'), accent: tok('color', '#22D3EE'), accent2: tok('color', '#F0ABFC'), enter: tok('ease', [0.16, 1, 0.3, 1]), exit: tok('ease', [0.7, 0, 0.84, 0]), standard: tok('ease', [0.3, 0, 0.1, 1]), emphasized: tok('ease', [0.18, 0.9, 0.2, 1]), pace: tok('number', 0.5, 'seconds of an entrance'), stagger: tok('number', 0.05, 'seconds between siblings') } },
];

const kit: ToolType<{ kit: string; background?: boolean }> = {
  name: 'kit', title: 'Style kit', description: 'applies a motion language (colours, curves, pace) as the design tokens that recipes and dressings follow',
  input: {
    type: 'object',
    properties: {
      kit: { type: 'string', format: 'kit', title: 'Kit' },
      background: { type: 'boolean', title: 'Background', description: 'the composition takes the kit\'s plate' },
    },
    required: ['kit'],
  },
  ai: { when: 'at the start of a project or when the user asks for a style; apply it before recipes so they pick it up' },
  run(a, ctx) {
    const found = ctx.registry.listKits().find((k) => k.kit.name === a.kit);
    if (!found) throw new Error(`unknown kit: ${a.kit} (${ctx.registry.listKits().map((k) => k.kit.name).join(', ')})`);
    const ops: Op[] = Object.entries(found.kit.tokens).map(([n, value]) => ({ op: 'add', path: pointer('tokens', n), value }));
    if (a.background !== false && found.kit.tokens.plate) ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'background'), value: '@plate' });
    return { ops, label: `Style kit ${found.kit.title ?? found.kit.name}`, text: `Kit ${found.kit.name}: tokens ${Object.keys(found.kit.tokens).join(', ')} set${a.background !== false && found.kit.tokens.plate ? ', background @plate' : ''}. Existing layers keep their colours unless they use these tokens.` };
  },
};

export const RECIPE_TOOLS: ToolType[] = [kineticTitle, barChart, stat, transition, kit];
