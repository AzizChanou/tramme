// Captions from a transcript: the words said, a few at a time, at the moment
// they are said, the word being spoken set apart. Groups break at pauses and
// sentence ends. The layer's in point reads the transcript from `start`, like
// a video layer: a transcript in the time of an uncut video lines up with it,
// a transcript remapped after cuts starts at 0.

import { captionGroups, isTranscript, type CaptionGroup, type NodeType, type Paint, type Transcript, type Vec2 } from '@tramme/core';
import { canvasPaint } from './paint.ts';

interface CaptionProps {
  transcript: string | null;
  start: number;
  maxWords: number;
  maxChars: number;
  font: string | null;
  size: number;
  weight: number;
  uppercase: boolean;
  width: number;
  lineHeight: number;
  color: string;
  activeColor: string;
  highlight: 'color' | 'box' | 'scale' | 'none';
  animation: 'pop' | 'rise' | 'fade' | 'none';
  box: Paint;
  boxPadding: Vec2;
  boxRadius: number;
  stroke: string | null;
  strokeWidth: number;
}

const groupsCache = new WeakMap<object, Map<string, CaptionGroup[]>>();
function groupsOf(t: Transcript, maxWords: number, maxChars: number): CaptionGroup[] {
  let byKey = groupsCache.get(t);
  if (!byKey) { byKey = new Map(); groupsCache.set(t, byKey); }
  const key = `${maxWords}|${maxChars}`;
  let g = byKey.get(key);
  if (!g) { g = captionGroups(t.words, { maxWords, maxChars }); byKey.set(key, g); }
  return g;
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const back = (x: number) => { const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
}

export const captions: NodeType<CaptionProps> = {
  type: 'captions', title: 'Captions', category: 'Text',
  description: 'the words of a transcript, when they are spoken',
  props: {
    transcript: { type: 'asset', default: null, nullable: true, assetType: 'json', label: 'Transcript', animatable: false },
    start: { type: 'number', default: 0, step: 0.01, unit: 's', label: 'Start in the transcript', animatable: false, description: "the transcript time at the layer's in point" },
    maxWords: { type: 'number', default: 4, min: 1, max: 12, step: 1, label: 'Words at a time', animatable: false, group: 'Rhythm' },
    maxChars: { type: 'number', default: 28, min: 6, max: 80, step: 1, label: 'Letters at a time', animatable: false, group: 'Rhythm' },
    font: { type: 'asset', default: null, nullable: true, assetType: 'font', label: 'Font', group: 'Typography' },
    size: { type: 'number', default: 72, min: 8, unit: 'px', label: 'Font size', group: 'Typography' },
    weight: { type: 'number', default: 800, min: 100, max: 1000, step: 100, label: 'Weight', group: 'Typography' },
    uppercase: { type: 'bool', default: false, label: 'Uppercase', group: 'Typography' },
    width: { type: 'number', default: 900, min: 100, unit: 'px', label: 'Width', group: 'Typography' },
    lineHeight: { type: 'number', default: 1.15, min: 0.8, max: 2, step: 0.05, label: 'Line height', group: 'Typography' },
    color: { type: 'color', default: '#FFFFFF', label: 'Color', group: 'Appearance' },
    activeColor: { type: 'color', default: '#2EC4B6', label: 'Spoken word', group: 'Appearance' },
    highlight: { type: 'enum', default: 'color', options: ['color', 'box', 'scale', 'none'], label: 'Highlight', group: 'Appearance' },
    animation: { type: 'enum', default: 'pop', options: ['pop', 'rise', 'fade', 'none'], label: 'In', group: 'Appearance' },
    box: { type: 'paint', default: null, nullable: true, label: 'Background', group: 'Appearance' },
    boxPadding: { type: 'vec2', default: [28, 14], unit: 'px', label: 'Background padding', group: 'Appearance' },
    boxRadius: { type: 'number', default: 16, min: 0, unit: 'px', label: 'Background radius', group: 'Appearance' },
    stroke: { type: 'color', default: null, nullable: true, label: 'Stroke', group: 'Appearance' },
    strokeWidth: { type: 'number', default: 0, min: 0, unit: 'px', label: 'Stroke width', group: 'Appearance' },
  },
  bounds: (p) => ({ x: -p.width / 2, y: -p.size * 1.2, w: p.width, h: p.size * p.lineHeight * 2 + p.size * 0.4 }),
  render: {
    canvas2d(ctx, p, host) {
      if (!p.transcript) return;
      const t = host.asset<unknown>(p.transcript);
      if (!isTranscript(t)) return;
      const T = p.start + (host.t - (host.layerIn ?? 0));
      const groups = groupsOf(t, Math.round(p.maxWords), Math.round(p.maxChars));
      const g = groups.find((x) => T >= x.s - 0.05 && T < x.e);
      if (!g) return;

      const family = p.font ? host.asset<string>(p.font) : null;
      ctx.font = `${Math.round(p.weight)} ${p.size}px ${family ? `"${family}", ` : ''}Inter, "Segoe UI", system-ui, sans-serif`;
      ctx.textBaseline = 'alphabetic';
      const text = (w: string) => (p.uppercase ? w.toLocaleUpperCase('fr') : w);
      const space = ctx.measureText(' ').width;
      // lines: words wrapped to the width
      const lines: { i: number; w: string; width: number }[][] = [[]];
      let lineW = 0;
      g.words.forEach((word, i) => {
        const w = text(word.w), width = ctx.measureText(w).width;
        if (lines[lines.length - 1].length && lineW + space + width > p.width) { lines.push([]); lineW = 0; }
        lines[lines.length - 1].push({ i, w, width });
        lineW += (lineW ? space : 0) + width;
      });
      const lh = p.size * p.lineHeight, total = lh * (lines.length - 1);

      // entrance of the group, short fade at its end
      const k = clamp((T - g.s + 0.05) / 0.22), out = clamp((g.e - T) / 0.08);
      let scale = 1, dy = 0, alpha = Math.min(1, out);
      if (p.animation === 'pop') { scale = 0.82 + 0.18 * back(k); alpha *= clamp(k * 3); }
      else if (p.animation === 'rise') { dy = (1 - easeOut(k)) * p.size * 0.5; alpha *= easeOut(k); }
      else if (p.animation === 'fade') alpha *= easeOut(k);
      if (alpha <= 0) return;

      // the word being said: the last one started
      let active = -1;
      g.words.forEach((w, i) => { if (T >= w.s) active = i; });

      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.translate(0, dy);
      ctx.scale(scale, scale);
      lines.forEach((line, li) => {
        const width = line.reduce((n, x) => n + x.width, 0) + space * (line.length - 1);
        const y = li * lh - total / 2 + p.size * 0.35;
        if (p.box) {
          const [px, py] = p.boxPadding;
          ctx.fillStyle = canvasPaint(ctx, p.box) as string;
          roundRect(ctx, -width / 2 - px, y - p.size * 0.82 - py, width + 2 * px, p.size + 2 * py, p.boxRadius);
          ctx.fill();
        }
        let x = -width / 2;
        for (const word of line) {
          const on = word.i === active && p.highlight !== 'none';
          ctx.save();
          if (on && p.highlight === 'scale') {
            const grow = 1 + 0.12 * easeOut(clamp((T - g.words[word.i].s) / 0.12));
            ctx.translate(x + word.width / 2, y - p.size * 0.3);
            ctx.scale(grow, grow);
            ctx.translate(-(x + word.width / 2), -(y - p.size * 0.3));
          }
          if (on && p.highlight === 'box') {
            ctx.fillStyle = p.activeColor;
            roundRect(ctx, x - p.size * 0.14, y - p.size * 0.86, word.width + p.size * 0.28, p.size * 1.08, p.size * 0.18);
            ctx.fill();
          }
          if (p.stroke && p.strokeWidth > 0) {
            ctx.lineJoin = 'round';
            ctx.lineWidth = p.strokeWidth * 2;
            ctx.strokeStyle = p.stroke;
            ctx.strokeText(word.w, x, y);
          }
          // the word said: in the accent colour, or dark on its accent box
          ctx.fillStyle = !on ? p.color : p.highlight === 'color' ? p.activeColor : p.highlight === 'box' ? '#0B0F12' : p.color;
          ctx.fillText(word.w, x, y);
          ctx.restore();
          x += word.width + space;
        }
      });
      ctx.restore();
    },
  },
};
