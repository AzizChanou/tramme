// Vector shapes. Rectangles and ellipses are centred on the layer origin, so
// scale and rotation act around their centre with the default anchor.

import type { NodeType, Paint, PathValue, PropSchema, Vec2 } from '@tramme/core';
import { fillStroke, toPath2D } from './paint.ts';

const PAINT: PropSchema = {
  fill: { type: 'paint', default: '#FFFFFF', label: 'Fill', group: 'Appearance', nullable: true },
  stroke: { type: 'paint', default: null, label: 'Stroke', group: 'Appearance', nullable: true },
  strokeWidth: { type: 'number', default: 2, label: 'Thickness', group: 'Appearance', min: 0, unit: 'px' },
};
interface PaintProps { fill: Paint; stroke: Paint; strokeWidth: number }

interface RectProps extends PaintProps { size: Vec2; radius: number }
export const rect: NodeType<RectProps> = {
  type: 'shape.rect', title: 'Rectangle', category: 'Shapes',
  props: {
    size: { type: 'vec2', default: [200, 200], label: 'Size', unit: 'px' },
    radius: { type: 'number', default: 0, label: 'Corner radius', min: 0, unit: 'px' },
    ...PAINT,
  },
  path({ size: [w, h], radius }) {
    const p = new Path2D();
    if (radius > 0) p.roundRect(-w / 2, -h / 2, w, h, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
    else p.rect(-w / 2, -h / 2, w, h);
    return p;
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  // the corner radius, dragged along the top edge from the corner
  handles: ({ size: [w, h], radius }) => [{ prop: 'radius', kind: 'distance', at: [w / 2 - Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2), -h / 2], from: [w / 2, -h / 2] }],
  render: { canvas2d(ctx, p, host) { fillStroke(ctx, rect.path!(p, host)!, p); } },
};

interface EllipseProps extends PaintProps { size: Vec2 }
export const ellipse: NodeType<EllipseProps> = {
  type: 'shape.ellipse', title: 'Ellipse', category: 'Shapes',
  props: {
    size: { type: 'vec2', default: [200, 200], label: 'Size', unit: 'px' },
    ...PAINT,
  },
  path({ size: [w, h] }) {
    const p = new Path2D();
    p.ellipse(0, 0, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
    return p;
  },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  render: { canvas2d(ctx, p, host) { fillStroke(ctx, ellipse.path!(p, host)!, p); } },
};

interface PathProps extends PaintProps { path: PathValue; lineCap: CanvasLineCap; lineJoin: CanvasLineJoin }
export const path: NodeType<PathProps> = {
  type: 'shape.path', title: 'Path', category: 'Shapes',
  props: {
    path: { type: 'path', default: { v: [[-100, -100], [100, -100], [100, 100], [-100, 100]], closed: true }, label: 'Path' },
    ...PAINT,
    lineCap: { type: 'enum', default: 'butt', options: ['butt', 'round', 'square'], label: 'Caps', group: 'Appearance' },
    lineJoin: { type: 'enum', default: 'miter', options: ['miter', 'round', 'bevel'], label: 'Joins', group: 'Appearance' },
  },
  path: (p) => toPath2D(p.path),
  bounds({ path: { v } }) {
    if (!v.length) return null;
    const xs = v.map((q) => q[0]), ys = v.map((q) => q[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  },
  render: {
    canvas2d(ctx, p) {
      ctx.lineCap = p.lineCap; ctx.lineJoin = p.lineJoin;
      fillStroke(ctx, toPath2D(p.path), p);
    },
  },
};
