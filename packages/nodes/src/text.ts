// Type. The origin is the baseline of the first line; alignment is optical
// (the tracking added after the last glyph is not counted). Weight is a
// number so variable fonts animate continuously.

import type { Host, NodeType, Paint, PropSchema } from '@tramme/core';
import { canvasPaint } from './paint.ts';

const TYPE: PropSchema = {
  font: { type: 'asset', default: null, nullable: true, assetType: 'font', label: 'Font', group: 'Typography' },
  size: { type: 'number', default: 64, label: 'Font size', min: 1, unit: 'px', group: 'Typography' },
  weight: { type: 'number', default: 400, label: 'Weight', min: 1, max: 1000, step: 1, group: 'Typography' },
  italic: { type: 'bool', default: false, label: 'Italic', group: 'Typography' },
  tracking: { type: 'number', default: 0, label: 'Tracking', step: 0.005, unit: 'em', group: 'Typography' },
  color: { type: 'paint', default: '#FFFFFF', label: 'Color', group: 'Appearance' },
  align: { type: 'enum', default: 'left', options: ['left', 'center', 'right'], label: 'Alignment', group: 'Typography' },
};

interface TypeProps { font: string | null; size: number; weight: number; italic: boolean; tracking: number; color: Paint; align: 'left' | 'center' | 'right' }

/** set font, tracking and colour on the context */
export function setType(ctx: CanvasRenderingContext2D, p: TypeProps, host: Host) {
  const family = p.font ? host.asset<string>(p.font) : 'sans-serif';
  ctx.font = `${p.italic ? 'italic ' : ''}${Math.round(p.weight)} ${p.size.toFixed(2)}px "${family}", sans-serif`;
  ctx.letterSpacing = `${p.tracking * p.size}px`;
  const fill = canvasPaint(ctx, p.color);
  if (fill) ctx.fillStyle = fill;
}

let measurer: CanvasRenderingContext2D | null = null;
/** a 2D context for measuring text outside of a frame */
function measureCtx(): CanvasRenderingContext2D {
  if (!measurer) measurer = (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas')).getContext('2d') as CanvasRenderingContext2D;
  return measurer;
}

/** left edge of a run of width w for the alignment */
export const alignX = (align: TypeProps['align'], w: number) => (align === 'center' ? -w / 2 : align === 'right' ? -w : 0);

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
    const lines = (p.text || ' ').split('\n'), trail = p.tracking * p.size;
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width - (l.length ? trail : 0)));
    const top = p.baseline === 'top' ? 0 : p.baseline === 'middle' ? -p.size * 0.5 : p.baseline === 'bottom' ? -p.size : -p.size * 0.8;
    return { x: alignX(p.align, w), y: top, w, h: p.size * (1 + (lines.length - 1) * p.lineHeight) };
  },
  render: {
    canvas2d(ctx, p, host) {
      if (!p.text) return;
      setType(ctx, p, host);
      ctx.textBaseline = p.baseline;
      ctx.textAlign = 'left';
      const trail = p.tracking * p.size;
      p.text.split('\n').forEach((line, i) => {
        const w = ctx.measureText(line).width - (line.length ? trail : 0);
        ctx.fillText(line, alignX(p.align, w), i * p.lineHeight * p.size);
      });
    },
  },
};

interface CounterProps extends TypeProps { from: string; to: string; progress: number; turns: number; ascent: number; lineHeight: number }

/**
 * A number rolling like a counter wheel from `from` to `to` (strings of the
 * same length). Each changing digit scrolls through the digits in between
 * inside a window of `lineHeight` em; the last digit makes `turns` extra
 * full turns. `progress` (0..1) usually carries its own ease in keyframes.
 */
export const counter: NodeType<CounterProps> = {
  type: 'text.counter', title: 'Counter', category: 'Text',
  props: {
    from: { type: 'string', default: '00', label: 'Start value' },
    to: { type: 'string', default: '99', label: 'End value' },
    progress: { type: 'number', default: 1, label: 'Progress', min: 0, max: 1, step: 0.01 },
    turns: { type: 'number', default: 1, label: 'Extra turns', min: 0, step: 1 },
    ...TYPE,
    tracking: { ...TYPE.tracking, default: -0.02 },
    ascent: { type: 'number', default: 0.86, label: 'Window top', step: 0.01, unit: 'em', group: 'Window' },
    lineHeight: { type: 'number', default: 1.02, label: 'Window height', step: 0.01, unit: 'em', group: 'Window' },
  },
  bounds(p, host) {
    const ctx = measureCtx();
    setType(ctx, p, host);
    let cw = 0;
    for (const d of '0123456789') cw = Math.max(cw, ctx.measureText(d).width);
    const w = cw * p.to.length;
    return { x: alignX(p.align, w), y: -p.size * p.ascent, w, h: p.size * p.lineHeight };
  },
  render: {
    canvas2d(ctx, p, host) {
      setType(ctx, p, host);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      let cw = 0;
      for (const d of '0123456789') cw = Math.max(cw, ctx.measureText(d).width);
      const x0 = alignX(p.align, cw * p.to.length);
      const top = -p.size * p.ascent, h = p.size * p.lineHeight, pr = p.progress;
      for (let i = 0; i < p.to.length; i++) {
        const a = p.from[i] ?? '', b = p.to[i], cx = x0 + cw * (i + 0.5);
        if (!/\d/.test(a) || !/\d/.test(b) || pr >= 1 || pr <= 0) { ctx.fillText(pr <= 0 ? a : b, cx, 0); continue; }
        const da = Number(a), db = Number(b);
        const n = ((db - da + 10) % 10) + 10 * p.turns * (i === p.to.length - 1 ? 1 : 0);
        const pos = n * pr, k = Math.floor(pos), f = pos - k;
        ctx.save();
        ctx.beginPath(); ctx.rect(cx - cw, top, cw * 2, h); ctx.clip();
        ctx.fillText(String((da + k) % 10), cx, -f * h);
        ctx.fillText(String((da + k + 1) % 10), cx, (1 - f) * h);
        ctx.restore();
      }
    },
  },
};
