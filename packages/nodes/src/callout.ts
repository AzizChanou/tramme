// A callout on something filmed: corner brackets around an object of a video
// and a label beside it (a line to it when asked), following the track the
// track tool saved: where the object is in the file over time. It reads the
// track through the video layer as it is placed, so it stays on the object
// when that layer moves or is cut otherwise. Drawn in the space the video
// layer sits in: keep it beside its video, its own transform at rest.

import { clamp, cubicBezier, isTrack, trackReader, type Host, type NodeType, type Paint, type Rect, type TrackReader, type Vec2 } from '@tramme/core';
import { chipOf, drawChip, measureCtx, setType, TYPE, type TypeProps } from './text.ts';

const OUT = cubicBezier(0.16, 1, 0.3, 1);
// the label's side takes the place of the text's alignment
const { align: _align, ...TYPE_PROPS } = TYPE;

type Side = 'auto' | 'right' | 'left' | 'above' | 'below';

interface CalloutProps extends Omit<TypeProps, 'align'> {
  source: string | null; track: string | null; label: string; detail: string; side: Side; line: boolean;
  brackets: 'corners' | 'box' | 'none'; padding: number; smooth: number; uppercase: boolean; fill: Paint; stroke: string; strokeWidth: number;
}

/** where the object is now, on screen: its track read through the video layer, as the renderer places that layer */
function objectAt(p: CalloutProps, host: Host): TrackReader | null {
  const v = p.source ? host.layer?.(p.source) : null;
  if (!v || !p.track || host.t < v.in || host.t >= v.out) return null;
  let track: unknown;
  try { track = host.asset(p.track); } catch { return null; }
  if (!isTrack(track)) return null;
  const r = trackReader(track, (Number(v.props.start) || 0) + host.t - v.in, { size: v.props.size as Vec2, fit: String(v.props.fit ?? 'cover'), transform: v.transform }, p.smooth);
  return r.found > 0 ? r : null;
}

/**
 * Where the label goes beside the object's box: on the side asked, or the
 * first one with room (right of an object on the left, left of one on the
 * right, then above, then below). A line leaves room between them and rises
 * from the box's corner. The label stays in the frame.
 */
export function calloutLayout(box: Rect, chip: { w: number; h: number }, side: Side, frame: { width: number; height: number }, line: boolean, gap: number) {
  const reach = line ? Math.max(gap * 4, box.h * 0.35) : gap;
  const room = {
    right: box.x + box.w + reach + chip.w <= frame.width - gap, left: box.x - reach - chip.w >= gap,
    above: box.y - reach - chip.h >= gap, below: box.y + box.h + reach + chip.h <= frame.height - gap,
  };
  const order: Exclude<Side, 'auto'>[] = box.x + box.w / 2 < frame.width / 2 ? ['right', 'left', 'above', 'below'] : ['left', 'right', 'above', 'below'];
  const s = side === 'auto' ? order.find((k) => room[k]) ?? 'above' : side;
  let x = s === 'right' ? box.x + box.w + reach : s === 'left' ? box.x - reach - chip.w : box.x;
  let y = s === 'above' ? box.y - reach - chip.h : s === 'below' ? box.y + box.h + reach : box.y - (line ? reach * 0.5 : 0);
  x = Math.min(frame.width - gap - chip.w, Math.max(gap, x));
  y = Math.min(frame.height - gap - chip.h, Math.max(gap, y));
  const anchor: Vec2 = s === 'right' ? [box.x + box.w, box.y] : s === 'below' ? [box.x, box.y + box.h] : [box.x, box.y];
  const end: Vec2 = s === 'right' ? [x, y + chip.h / 2] : s === 'left' ? [x + chip.w, y + chip.h / 2] : s === 'above' ? [x, y + chip.h] : [x, y];
  return { side: s, chip: { x, y, w: chip.w, h: chip.h }, anchor, end };
}

/** the label and its detail on a chip, measured with the type set on ctx */
function labelOf(ctx: CanvasRenderingContext2D, p: CalloutProps) {
  const up = (s: string) => (p.uppercase ? s.toUpperCase() : s);
  return chipOf(ctx, p, up(p.label), up(p.detail), [0.5, 0.3], 0.8);
}

/** the object's box with its padding, and the label laid out beside it */
function placed(ctx: CanvasRenderingContext2D, p: CalloutProps, host: Host, r: TrackReader) {
  const t = labelOf(ctx, p), pad = p.padding, box = { x: r.box[0] - pad, y: r.box[1] - pad, w: r.box[2] + 2 * pad, h: r.box[3] + 2 * pad };
  return { t, box, L: calloutLayout(box, t, p.side, host, p.line, p.size * 0.5) };
}

export const callout: NodeType<CalloutProps> = {
  type: 'callout', title: 'Callout', category: 'Text',
  description: 'brackets and a label that follow something filmed, from a track of its video',
  props: {
    source: { type: 'layer', default: null, nullable: true, label: 'Video', animatable: false, description: 'the video layer the object is filmed in' },
    track: { type: 'asset', default: null, nullable: true, assetType: 'json', label: 'Track', animatable: false, description: 'where the object is in that video over time (the track tool)' },
    label: { type: 'string', default: 'Label', label: 'Label' },
    detail: { type: 'string', default: '', label: 'Detail', description: 'after the label, lighter' },
    side: { type: 'enum', default: 'auto', options: ['auto', 'right', 'left', 'above', 'below'], label: 'Side', animatable: false },
    line: { type: 'bool', default: false, label: 'Line', animatable: false, description: 'a line from the object to its label' },
    brackets: { type: 'enum', default: 'corners', options: ['corners', 'box', 'none'], label: 'Brackets', animatable: false },
    padding: { type: 'number', default: 10, min: 0, unit: 'px', label: 'Padding', description: 'room between the object and its brackets' },
    smooth: { type: 'number', default: 0.2, min: 0, max: 2, step: 0.05, unit: 's', label: 'Smoothing', animatable: false, description: 'the track averaged over this span, steadier' },
    ...TYPE_PROPS,
    size: { ...TYPE.size, default: 24 },
    weight: { ...TYPE.weight, default: 700 },
    tracking: { ...TYPE.tracking, default: 0.06 },
    color: { ...TYPE.color, default: '#111111' },
    uppercase: { type: 'bool', default: true, label: 'Uppercase', group: 'Typography' },
    fill: { type: 'paint', default: '#FFFFFF', label: 'Label background', group: 'Appearance' },
    stroke: { type: 'color', default: '#FFFFFF', label: 'Lines', group: 'Appearance', description: 'the brackets and the line' },
    strokeWidth: { type: 'number', default: 3, min: 0, unit: 'px', label: 'Line width', group: 'Appearance' },
  },
  // the brackets and the label where they are now
  bounds(p, host) {
    const r = objectAt(p, host);
    if (!r) return null;
    const ctx = measureCtx();
    setType(ctx, p, host);
    const { box, L } = placed(ctx, p, host, r), x = Math.min(box.x, L.chip.x), y = Math.min(box.y, L.chip.y);
    return { x, y, w: Math.max(box.x + box.w, L.chip.x + L.chip.w) - x, h: Math.max(box.y + box.h, L.chip.y + L.chip.h) - y };
  },
  render: {
    canvas2d(ctx, p, host) {
      const r = objectAt(p, host);
      if (!r) return;
      const age = host.t - (host.layerIn ?? 0), k = OUT(clamp(age / 0.35)), alpha = r.found * clamp(age / 0.12);
      if (alpha <= 0) return;
      setType(ctx, p, host);
      const { t, box, L } = placed(ctx, p, host, r);
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = p.strokeWidth;
      ctx.lineCap = 'square';
      // the brackets close in on the object
      const g = 1 + 0.25 * (1 - k), w = box.w * g, h = box.h * g, x = box.x + (box.w - w) / 2, y = box.y + (box.h - h) / 2;
      if (p.strokeWidth > 0 && p.brackets === 'box') ctx.strokeRect(x, y, w, h);
      else if (p.strokeWidth > 0 && p.brackets === 'corners') {
        const a = Math.max(6, Math.min(w, h) * 0.22);
        ctx.beginPath();
        for (const [cx, cy, sx, sy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) {
          ctx.moveTo(cx + sx * a, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * a);
        }
        ctx.stroke();
      }
      if (p.line && p.strokeWidth > 0) {
        const [ax, ay] = L.anchor, [ex, ey] = L.end;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + (ex - ax) * k, ay + (ey - ay) * k); ctx.stroke();
      }
      // the label, typed in once the brackets are there, its detail lighter
      const n = Math.floor(clamp((age - 0.15) / 0.4) * (t.label.length + 1 + t.value.length) + 1e-6);
      if (n > 0) drawChip(ctx, t, L.chip.x, L.chip.y, p, { letters: n, soft: 0.62 });
      ctx.restore();
    },
  },
};
