// Type. The origin is the baseline of the first line; alignment is optical
// (the tracking added after the last glyph is not counted). Weight is a
// number so variable fonts animate continuously.

import type { Host, NodeType, Paint, PropSchema, Vec2 } from '@tramme/core';
import { canvasPaint, roundRect } from './paint.ts';

export const TYPE: PropSchema = {
  font: { type: 'asset', default: null, nullable: true, assetType: 'font', label: 'Font', group: 'Typography' },
  size: { type: 'number', default: 64, label: 'Font size', min: 1, unit: 'px', group: 'Typography' },
  weight: { type: 'number', default: 400, label: 'Weight', min: 1, max: 1000, step: 1, group: 'Typography' },
  italic: { type: 'bool', default: false, label: 'Italic', group: 'Typography' },
  tracking: { type: 'number', default: 0, label: 'Tracking', step: 0.005, unit: 'em', group: 'Typography' },
  color: { type: 'paint', default: '#FFFFFF', label: 'Color', group: 'Appearance' },
  align: { type: 'enum', default: 'left', options: ['left', 'center', 'right'], label: 'Alignment', group: 'Typography' },
};

export interface TypeProps { font: string | null; size: number; weight: number; italic: boolean; tracking: number; color: Paint; align: 'left' | 'center' | 'right' }

/** set font, tracking and colour on the context */
export function setType(ctx: CanvasRenderingContext2D, p: Omit<TypeProps, 'align'>, host: Host) {
  const family = p.font ? host.asset<string>(p.font) : 'sans-serif';
  ctx.font = `${p.italic ? 'italic ' : ''}${Math.round(p.weight)} ${p.size.toFixed(2)}px "${family}", sans-serif`;
  ctx.letterSpacing = `${p.tracking * p.size}px`;
  const fill = canvasPaint(ctx, p.color);
  if (fill) ctx.fillStyle = fill;
}

let measurer: CanvasRenderingContext2D | null = null;
/** a 2D context for measuring text outside of a frame */
export function measureCtx(): CanvasRenderingContext2D {
  if (!measurer) measurer = (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas')).getContext('2d') as CanvasRenderingContext2D;
  return measurer;
}

/** left edge of a run of width w for the alignment */
export const alignX = (align: TypeProps['align'], w: number) => (align === 'center' ? -w / 2 : align === 'right' ? -w : 0);

/** capitals sit on the baseline this fraction of the size below the middle of their line: type centred in a box */
export const CAP = 0.36;

/** the width of a run of text set on ctx, the tracking after its last glyph not counted */
export const runWidth = (ctx: CanvasRenderingContext2D, s: string, p: { tracking: number; size: number }) => (s ? ctx.measureText(s).width - p.tracking * p.size : 0);

/** a label and what follows it on a filled chip, measured: pad and gap in pixels, lw the label's width */
export interface Chip { label: string; value: string; pad: number; lw: number; gap: number; w: number; h: number }

/** the height of a chip of type of this size: its capitals and the padding above and below them (em) */
export const chipHeight = (size: number, padY: number) => size * (2 * CAP + padY * 2);

/** a chip measured with the type set on ctx: padding and gap in em */
export function chipOf(ctx: CanvasRenderingContext2D, p: { tracking: number; size: number }, label: string, value: string, padding: Vec2, gap: number): Chip {
  const pad = p.size * padding[0], g = label && value ? gap * p.size : 0, lw = runWidth(ctx, label, p);
  return { label, value, pad, lw, gap: g, w: pad * 2 + lw + g + runWidth(ctx, value, p), h: chipHeight(p.size, padding[1]) };
}

/**
 * A chip drawn with its top left corner at (x, y): its fill, then the label
 * and what follows it in the colour of the type, the first `letters` of them
 * (the space between them counted), what follows at `soft` opacity.
 */
export function drawChip(ctx: CanvasRenderingContext2D, c: Chip, x: number, y: number, p: { size: number; color: Paint; fill: Paint }, { radius = 0, letters = Infinity, soft = 1 } = {}) {
  const fill = canvasPaint(ctx, p.fill);
  if (fill) { ctx.fillStyle = fill; roundRect(ctx, x, y, c.w, c.h, radius); ctx.fill(); }
  const ink = canvasPaint(ctx, p.color);
  if (ink) ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const x0 = x + c.pad, base = y + c.h / 2 + p.size * CAP;
  if (c.label) ctx.fillText(c.label.slice(0, letters), x0, base);
  if (c.value && letters > c.label.length + 1) {
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * soft;
    ctx.fillText(c.value.slice(0, letters - c.label.length - 1), x0 + c.lw + c.gap, base);
    ctx.globalAlpha = alpha;
  }
}

interface TextProps extends TypeProps { text: string; lineHeight: number; baseline: CanvasTextBaseline }

export const text: NodeType<TextProps> = {
  type: 'text', title: 'Text', category: 'Text',
  props: {
    text: { type: 'text', default: 'Text', label: 'Text' },
    ...TYPE,
    lineHeight: { type: 'number', default: 1.2, label: 'Line height', step: 0.05, unit: 'em', group: 'Typography' },
    baseline: { type: 'enum', default: 'alphabetic', options: ['alphabetic', 'top', 'middle', 'bottom'], label: "Baseline", group: 'Typography' },
  },
  bounds(p, host) {
    const ctx = measureCtx();
    setType(ctx, p, host);
    const lines = (p.text || ' ').split('\n'), w = Math.max(...lines.map((l) => runWidth(ctx, l, p)));
    const top = p.baseline === 'top' ? 0 : p.baseline === 'middle' ? -p.size * 0.5 : p.baseline === 'bottom' ? -p.size : -p.size * 0.8;
    return { x: alignX(p.align, w), y: top, w, h: p.size * (1 + (lines.length - 1) * p.lineHeight) };
  },
  render: {
    canvas2d(ctx, p, host) {
      if (!p.text) return;
      setType(ctx, p, host);
      ctx.textBaseline = p.baseline;
      ctx.textAlign = 'left';
      p.text.split('\n').forEach((line, i) => ctx.fillText(line, alignX(p.align, runWidth(ctx, line, p)), i * p.lineHeight * p.size));
    },
  },
};

interface CounterProps extends TypeProps { from: string; to: string; progress: number; turns: number; direction: 'up' | 'down'; ascent: number; lineHeight: number }

/**
 * A number rolling like a counter wheel from `from` to `to` (strings of the
 * same length). Each changing digit scrolls through the digits in between
 * inside a window of `lineHeight` em, forward like an odometer, or back for
 * a value that goes down; the last digit makes `turns` extra full turns.
 * `progress` (0..1) usually carries its own ease in keyframes.
 */
/** the width of each character of a counter: digits in equal cells (the widest digit), other signs (separators, units) at their own width */
export function cells(ctx: CanvasRenderingContext2D, s: string): number[] {
  let cw = 0;
  for (const d of '0123456789') cw = Math.max(cw, ctx.measureText(d).width);
  return [...s].map((ch) => (/\d/.test(ch) ? cw : ctx.measureText(ch).width));
}

export const counter: NodeType<CounterProps> = {
  type: 'text.counter', title: 'Counter', category: 'Text',
  props: {
    from: { type: 'string', default: '00', label: 'Start value' },
    to: { type: 'string', default: '99', label: 'End value' },
    progress: { type: 'number', default: 1, label: 'Progress', min: 0, max: 1, step: 0.01 },
    turns: { type: 'number', default: 1, label: 'Extra turns', min: 0, step: 1 },
    direction: { type: 'enum', default: 'up', options: ['up', 'down'], label: 'Direction', description: 'up rolls the digits forward like an odometer; down rolls them back, for a value that goes down' },
    ...TYPE,
    tracking: { ...TYPE.tracking, default: -0.02 },
    ascent: { type: 'number', default: 0.86, label: 'Window top', step: 0.01, unit: 'em', group: 'Window' },
    lineHeight: { type: 'number', default: 1.02, label: 'Window height', step: 0.01, unit: 'em', group: 'Window' },
  },
  bounds(p, host) {
    const ctx = measureCtx();
    setType(ctx, p, host);
    const w = cells(ctx, p.to).reduce((a, b) => a + b, 0);
    return { x: alignX(p.align, w), y: -p.size * p.ascent, w, h: p.size * p.lineHeight };
  },
  render: {
    canvas2d(ctx, p, host) {
      setType(ctx, p, host);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const widths = cells(ctx, p.to), cw = Math.max(...widths, 0);
      let x = alignX(p.align, widths.reduce((s, w) => s + w, 0));
      const top = -p.size * p.ascent, h = p.size * p.lineHeight, pr = p.progress;
      for (let i = 0; i < p.to.length; i++) {
        const a = p.from[i] ?? '', b = p.to[i], cx = x + widths[i] / 2;
        x += widths[i];
        if (!/\d/.test(a) || !/\d/.test(b) || pr >= 1 || pr <= 0) { ctx.fillText(pr <= 0 ? a : b, cx, 0); continue; }
        // rolling back: the digits go down through the window, the next one comes from above
        const da = Number(a), db = Number(b), dir = p.direction === 'down' ? -1 : 1;
        const n = ((dir * (db - da) + 10) % 10) + 10 * p.turns * (i === p.to.length - 1 ? 1 : 0);
        const pos = n * pr, k = Math.floor(pos), f = pos - k, digit = (d: number) => String(((d % 10) + 10) % 10);
        ctx.save();
        ctx.beginPath(); ctx.rect(cx - cw, top, cw * 2, h); ctx.clip();
        ctx.fillText(digit(da + dir * k), cx, -dir * f * h);
        ctx.fillText(digit(da + dir * (k + 1)), cx, dir * (1 - f) * h);
        ctx.restore();
      }
    },
  },
};
