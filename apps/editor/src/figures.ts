// Pointer figures, after hairline (hairline.lucasmarkes.com): technical
// drawings at rest whose shapes answer a pointer — pillars that rise, keys
// that sink, cards that lift and lean. The pointer is an ordinary layer
// travelling on keyframes; the shapes around it answer with the `near`
// modifier (a proximity falloff on a spring). Everything stays ordinary
// layers, editable and deterministic: the rest pose is the picture, the
// pointer is the bonus. The figure and its pointer sit in the same space
// (a group at the origin, children placed in composition coordinates).

import type { ToolType, ToolContext, Vec2 } from '@tramme/core';
import { adder } from './templates.ts';
import { compOf, r, style } from './recipes.ts';
import { t } from './i18n/index.ts';

/** keys of a pointer's travel around (cx, cy), cycled for as long as the layer lives */
function travelKeys(path: string, at: number, dur: number, cx: number, cy: number, w: number, h: number) {
  const k = (f: number, v: Vec2) => ({ t: r(at + f * dur), v: [r(cx + v[0]), r(cy + v[1])] as Vec2 });
  if (path === 'hold') return [{ t: at, v: [r(cx), r(cy)] as Vec2 }];
  if (path === 'circle') {
    const keys = [];
    for (let i = 0; i <= 8; i++) {
      const a = ((i % 8) / 8) * Math.PI * 2;
      keys.push(k(i / 8, [(Math.cos(a) * w) / 2, (Math.sin(a) * h) / 2]));
    }
    return keys;
  }
  if (path === 'figure8') {
    const keys = [];
    for (let i = 0; i <= 12; i++) {
      const a = ((i % 12) / 12) * Math.PI * 2;
      keys.push(k(i / 12, [(Math.sin(a) * w) / 2, (Math.sin(a) * Math.cos(a) * h) / 2]));
    }
    return keys;
  }
  return [k(0, [-w / 2, -h * 0.16]), k(0.5, [w / 2, h * 0.16]), k(1, [-w / 2, -h * 0.16])];
}

interface PointerArgs { path?: 'sweep' | 'circle' | 'figure8' | 'hold'; duration?: number; show?: boolean; at?: number }

/** the pointer a figure answers: the named layer, the one called "Pointer", or a hidden sweep (added through the caller's adder) */
function ensurePointer(ctx: ToolContext, name: string | undefined, a: PointerArgs, add: (base: string, layer: Record<string, unknown>, top?: boolean) => string): string {
  const c = compOf(ctx);
  if (name) {
    if (!c.layers[name]) throw new Error(`unknown layer: ${name}`);
    return name;
  }
  const there = Object.keys(c.layers).find((id) => c.layers[id].name === 'Pointer');
  if (there) return there;
  const doc = ctx.doc;
  const at = r(Math.min(a.at ?? ctx.time, Math.max(0, c.duration - 0.5)));
  const dur = r(Math.min(a.duration ?? 6, c.duration - at));
  return add('pointer', {
    type: 'shape.ellipse', name: 'Pointer', in: 0, out: c.duration,
    transform: {
      position: { $k: travelKeys(a.path ?? 'sweep', at, dur, c.width / 2, c.height / 2, c.width * 0.9, c.height * 0.7), ...(a.path === 'hold' ? {} : { $mod: [{ type: 'loop', mode: 'cycle' }] }) },
      ...(a.show === false ? { opacity: 0 } : {}),
    },
    props: { size: [Math.round(Math.min(c.width, c.height) * 0.02), Math.round(Math.min(c.width, c.height) * 0.02)], fill: style(doc).accent },
  }, false);
}

// ── pointer ──────────────────────────────────────────────────
const pointer: ToolType<PointerArgs> = {
  name: 'pointer', title: 'Pointer',
  description: 'a small layer travelling across the composition: the moving layer that near figures answer',
  input: {
    type: 'object',
    properties: {
      path: { enum: ['sweep', 'circle', 'figure8', 'hold'], title: 'Path', description: 'sweep: left to right and back; circle; figure8; hold: parked at the centre' },
      duration: { type: 'number', minimum: 0.5, title: 'Duration (s)', description: 'of one loop of the path' },
      show: { type: 'boolean', title: 'Show the dot', description: 'the pointer is a visible dot unless hidden' },
      at: { type: 'number', minimum: 0, title: 'Start (s)' },
    },
  },
  ai: { when: 'the mover of every pointer figure: one small layer travelling across the frame; the shapes answer it with the near modifier (one pointer for the whole composition)', avoid: 'more than one pointer at once, or a loop faster than 4 s (the figures barely settle)' },
  run(a, ctx) {
    const doc = ctx.doc, c = compOf(ctx), s = style(doc);
    const at = r(Math.min(a.at ?? ctx.time, Math.max(0, c.duration - 0.5)));
    const dur = r(Math.min(a.duration ?? 6, c.duration - at));
    const d = Math.round(Math.min(c.width, c.height) * 0.022);
    const { add, done } = adder(doc, ctx.compId);
    const id = add('pointer', {
      type: 'shape.ellipse', name: 'Pointer', in: 0, out: c.duration,
      transform: {
        position: { $k: travelKeys(a.path ?? 'sweep', at, dur, c.width / 2, c.height / 2, c.width * 0.9, c.height * 0.7), ...(a.path === 'hold' ? {} : { $mod: [{ type: 'loop', mode: 'cycle' }] }) },
        ...(a.show === false ? { opacity: 0 } : {}),
      },
      props: { size: [d, d], fill: s.accent },
    });
    return { ops: done(), label: t('figures.pointer'), text: t('figures.pointerText', { at: String(at), end: String(r(at + dur)), name: id }) };
  },
};

// ── terrain ──────────────────────────────────────────────────
interface TerrainArgs { n?: number; rise?: number; radius?: number; pointer?: string }

const terrain: ToolType<TerrainArgs> = {
  name: 'terrain', title: 'Terrain',
  description: 'a grid of pillars whose height answers the pointer: each pillar rises as it comes near, on a spring',
  input: {
    type: 'object',
    properties: {
      n: { type: 'integer', minimum: 4, maximum: 14, title: 'Grid', description: 'pillars per side (n × n)' },
      rise: { type: 'number', minimum: 0.2, title: 'Rise', description: 'how tall a pillar grows at the closest (× its rest height)' },
      radius: { type: 'number', minimum: 10, title: 'Radius (px)', description: 'how far the pointer is still answered' },
      pointer: { type: 'string', title: 'Pointer layer', description: 'the layer id to answer; a pointer is added when there is none' },
    },
  },
  ai: { when: 'an opener or an empty state that answers the pointer: 6 to 10 pillars per side, the pointer sweeping slowly above', avoid: 'more than 12 × 12 pillars (a hundred layers), or a rise past 2.5 (the field stops reading)' },
  run(a, ctx) {
    const doc = ctx.doc, c = compOf(ctx), s = style(doc);
    const n = Math.max(4, Math.min(14, Math.round(a.n ?? 9)));
    const span = Math.min(c.width, c.height) * 0.88, cell = span / n;
    const bw = r(cell * 0.42), bh = r(cell * 0.55), lw = Math.max(2, Math.round(Math.min(c.width, c.height) * 0.003));
    const radius = r(a.radius ?? cell * 2.4), rise = a.rise ?? 1.6;
    const plate = doc.tokens?.plate?.type === 'color' ? '@plate' : null;
    const { add, done } = adder(doc, ctx.compId);
    const pid = ensurePointer(ctx, a.pointer, { show: false }, add);
    const children: string[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        children.push(add(`pillar-${i}-${j}`, {
          type: 'shape.rect', name: `Pillar ${i + 1}.${j + 1}`, in: 0, out: c.duration,
          transform: {
            anchor: [0, r(bh / 2)],
            position: [r(c.width / 2 + (i - (n - 1) / 2) * cell), r(c.height / 2 + (j - (n - 1) / 2) * cell)],
            scale: { $v: [1, 1], $mod: [{ type: 'noise', amp: 0.1 }, { type: 'near', source: pid, radius, amount: rise, axis: 'y', freq: 2.4, damping: 0.55 }] },
          },
          props: { size: [bw, bh], radius: r(bw * 0.18), ...(plate ? { fill: plate, stroke: s.ink, strokeWidth: lw } : { fill: s.ink }) },
        }, false));
      }
    }
    add('terrain', { type: 'group', name: t('figures.terrain'), in: 0, out: c.duration, transform: { position: [0, 0] }, children });
    return { ops: done(), label: t('figures.terrain'), text: t('figures.terrainText', { n: String(n), at: '0', end: String(c.duration), name: pid }) };
  },
};

// ── keys ─────────────────────────────────────────────────────
interface KeysArgs { keys?: number; sink?: number; radius?: number; label?: string; pointer?: string }

const keys: ToolType<KeysArgs> = {
  name: 'keys', title: 'Keys',
  description: 'a row of keys that sink under the pointer, their neighbours following',
  input: {
    type: 'object',
    properties: {
      keys: { type: 'integer', minimum: 3, maximum: 24, title: 'Keys' },
      sink: { type: 'number', minimum: 1, title: 'Sink (px)', description: 'how deep the closest key goes' },
      radius: { type: 'number', minimum: 10, title: 'Radius (px)', description: 'how far the pointer is still answered' },
      label: { type: 'string', title: 'Label', description: 'a line under the keys' },
      pointer: { type: 'string', title: 'Pointer layer', description: 'the layer id to answer; a pointer is added when there is none' },
    },
  },
  ai: { when: 'an interface moment: a row of keys the pointer presses, one line under it', avoid: 'sinks deeper than a third of a key (the row falls apart)' },
  run(a, ctx) {
    const doc = ctx.doc, c = compOf(ctx), s = style(doc);
    const n = Math.max(3, Math.min(24, Math.round(a.keys ?? 12)));
    const u = Math.min(c.width, c.height);
    const kw = Math.min((c.width * 0.78) / n, u * 0.13), kh = kw * 1.05, gap = kw * 0.14;
    const lw = Math.max(2, Math.round(u * 0.003));
    const y = r(c.height * 0.58), x0 = c.width / 2 - ((n - 1) * (kw + gap)) / 2;
    const radius = r(a.radius ?? kw * 1.8), sink = r(a.sink ?? kh * 0.22);
    const plate = doc.tokens?.plate?.type === 'color' ? '@plate' : null;
    const { add, done } = adder(doc, ctx.compId);
    const pid = ensurePointer(ctx, a.pointer, { show: false }, add);
    const children: string[] = [];
    for (let i = 0; i < n; i++) {
      children.push(add(`key-${i + 1}`, {
        type: 'shape.rect', name: `Key ${i + 1}`, in: 0, out: c.duration,
        transform: {
          position: { $v: [r(x0 + i * (kw + gap)), y], $mod: [{ type: 'near', source: pid, radius, amount: sink, axis: 'y', freq: 2.6, damping: 0.5 }] },
        },
        props: { size: [r(kw), r(kh)], radius: r(kw * 0.16), ...(plate ? { fill: plate, stroke: s.ink, strokeWidth: lw } : { fill: s.ink }) },
      }, false));
    }
    if (a.label) {
      children.push(add('keys-label', {
        type: 'text', name: 'Label', in: 0, out: c.duration,
        transform: { position: [r(c.width / 2), r(y + kh * 1.6)] },
        props: { text: a.label, size: Math.round(u * 0.042), weight: 500, align: 'center', baseline: 'middle', color: s.ink, ...(s.font ? { font: s.font } : {}) },
      }, false));
    }
    add('keys', { type: 'group', name: t('figures.keys'), in: 0, out: c.duration, transform: { position: [0, 0] }, children });
    return { ops: done(), label: t('figures.keys'), text: t('figures.keysText', { n: String(n), at: '0', end: String(c.duration), name: pid }) };
  },
};

// ── riffle ───────────────────────────────────────────────────
interface RiffleArgs { cards?: number; lift?: number; lean?: number; radius?: number; pointer?: string }

const riffle: ToolType<RiffleArgs> = {
  name: 'riffle', title: 'Riffle',
  description: 'a fan of cards that lift and lean as the pointer passes, a wave through the deck',
  input: {
    type: 'object',
    properties: {
      cards: { type: 'integer', minimum: 3, maximum: 16, title: 'Cards' },
      lift: { type: 'number', minimum: 1, title: 'Lift (px)', description: 'how high the closest card rises' },
      lean: { type: 'number', title: 'Lean (deg)', description: 'how far the closest card leans' },
      radius: { type: 'number', minimum: 10, title: 'Radius (px)', description: 'how far the pointer is still answered' },
      pointer: { type: 'string', title: 'Pointer layer', description: 'the layer id to answer; a pointer is added when there is none' },
    },
  },
  ai: { when: 'a light interlude: a deck the pointer plays with, cards rising in a wave', avoid: 'more than 12 cards, or leans past 10° (the fan breaks)' },
  run(a, ctx) {
    const doc = ctx.doc, c = compOf(ctx), s = style(doc);
    const n = Math.max(3, Math.min(16, Math.round(a.cards ?? 8)));
    const u = Math.min(c.width, c.height);
    const spread = 0.42;
    const cw = Math.min((c.width * 0.72) / (1 + (n - 1) * spread), u * 0.24), ch = cw * 1.3;
    const lw = Math.max(2, Math.round(u * 0.003));
    const y = r(c.height * 0.52);
    const radius = r(a.radius ?? cw * 2), lift = r(a.lift ?? ch * 0.14), lean = a.lean ?? 6;
    const plate = doc.tokens?.plate?.type === 'color' ? '@plate' : null;
    const { add, done } = adder(doc, ctx.compId);
    const pid = ensurePointer(ctx, a.pointer, { show: false }, add);
    const children: string[] = [];
    for (let i = 0; i < n; i++) {
      const off = i - (n - 1) / 2;
      children.push(add(`card-${i + 1}`, {
        type: 'shape.rect', name: `Card ${i + 1}`, in: 0, out: c.duration,
        transform: {
          position: { $v: [r(c.width / 2 + off * cw * spread), y], $mod: [{ type: 'near', source: pid, radius, amount: -lift, axis: 'y', freq: 2.4, damping: 0.5 }] },
          rotation: { $v: r(off * 2.2), $mod: [{ type: 'near', source: pid, radius, amount: lean, freq: 2.2, damping: 0.55 }] },
        },
        props: { size: [r(cw), r(ch)], radius: r(cw * 0.08), ...(plate ? { fill: plate, stroke: s.ink, strokeWidth: lw } : { fill: s.ink }) },
      }, false));
    }
    add('riffle', { type: 'group', name: t('figures.riffle'), in: 0, out: c.duration, transform: { position: [0, 0] }, children });
    return { ops: done(), label: t('figures.riffle'), text: t('figures.riffleText', { n: String(n), at: '0', end: String(c.duration), name: pid }) };
  },
};

export const FIGURE_TOOLS: ToolType[] = [pointer, terrain, keys, riffle];
