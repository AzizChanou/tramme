// Fills and strokes for Canvas2D: a colour string or a gradient in the
// layer's local space (pixels), and Lottie-style paths.

import type { Paint, PathValue } from '@tramme/core';

export function canvasPaint(ctx: CanvasRenderingContext2D, paint: Paint): string | CanvasGradient | null {
  if (paint === null || paint === undefined) return null;
  if (typeof paint === 'string') return paint;
  const g = paint.type === 'linear'
    ? ctx.createLinearGradient(paint.from[0], paint.from[1], paint.to[0], paint.to[1])
    : ctx.createRadialGradient(paint.center[0], paint.center[1], 0, paint.center[0], paint.center[1], paint.radius);
  for (const [offset, color] of paint.stops) g.addColorStop(Math.min(1, Math.max(0, offset)), color);
  return g;
}

/** fill then stroke a path with the node's paint props */
export function fillStroke(ctx: CanvasRenderingContext2D, path: Path2D, p: { fill: Paint; stroke: Paint; strokeWidth: number }) {
  const fill = canvasPaint(ctx, p.fill);
  if (fill) { ctx.fillStyle = fill; ctx.fill(path); }
  const stroke = canvasPaint(ctx, p.stroke);
  if (stroke && p.strokeWidth > 0) { ctx.strokeStyle = stroke; ctx.lineWidth = p.strokeWidth; ctx.stroke(path); }
}

/** Path2D of a path value: straight segments where both tangents are zero, cubic curves elsewhere */
export function toPath2D(pv: PathValue): Path2D {
  const p = new Path2D();
  const n = pv.v.length;
  if (!n) return p;
  const zero = [0, 0];
  p.moveTo(pv.v[0][0], pv.v[0][1]);
  const seg = (a: number, b: number) => {
    const o = pv.o?.[a] ?? zero, i = pv.i?.[b] ?? zero;
    const [ax, ay] = pv.v[a], [bx, by] = pv.v[b];
    if (!o[0] && !o[1] && !i[0] && !i[1]) p.lineTo(bx, by);
    else p.bezierCurveTo(ax + o[0], ay + o[1], bx + i[0], by + i[1], bx, by);
  };
  for (let k = 0; k < n - 1; k++) seg(k, k + 1);
  if (pv.closed) { if (n > 1) seg(n - 1, 0); p.closePath(); }
  return p;
}
