// A composition inside another one. Its frame is centred on the layer
// origin; its own time runs from `start` at the layer's in point, at `speed`,
// optionally looping; `remap` (often an expression) gives the local time
// directly.

import type { NodeType } from '@tramme/core';

interface CompProps { comp: string | null; start: number; speed: number; loop: boolean; remap: number | null; crop: boolean }

/** local time of the nested composition */
export function localTime(p: CompProps, t: number, layerIn: number, duration: number): number {
  let lt = p.remap ?? p.start + (t - layerIn) * p.speed;
  if (p.loop && duration > 0) lt = ((lt % duration) + duration) % duration;
  return lt;
}

export const comp: NodeType<CompProps> = {
  type: 'comp', title: 'Composition', category: 'Structure',
  description: 'another composition of the document, with its own time',
  props: {
    comp: { type: 'comp', default: null, nullable: true, label: 'Composition', animatable: false },
    start: { type: 'number', default: 0, step: 0.01, unit: 's', label: 'Start', description: 'local time at the layer\'s in point' },
    speed: { type: 'number', default: 1, step: 0.05, unit: 'x', label: 'Speed' },
    loop: { type: 'bool', default: false, label: 'Loop' },
    remap: { type: 'number', default: null, nullable: true, step: 0.01, unit: 's', label: 'Time override', description: 'overrides start and speed (often an expression)' },
    crop: { type: 'bool', default: true, label: 'Crop to frame' },
  },
  path(p, host) {
    const s = p.comp ? host.compositionSize?.(p.comp) : null;
    if (!s) return null;
    const r = new Path2D();
    r.rect(-s.width / 2, -s.height / 2, s.width, s.height);
    return r;
  },
  bounds(p, host) {
    const s = p.comp ? host.compositionSize?.(p.comp) : null;
    return s ? { x: -s.width / 2, y: -s.height / 2, w: s.width, h: s.height } : null;
  },
  render: {
    canvas2d(ctx, p, host) {
      if (!p.comp || !host.drawComposition || !host.compositionSize) return;
      const s = host.compositionSize(p.comp);
      if (!s) return;
      ctx.translate(-s.width / 2, -s.height / 2);
      if (p.crop) { ctx.beginPath(); ctx.rect(0, 0, s.width, s.height); ctx.clip(); }
      host.drawComposition(ctx, p.comp, localTime(p, host.t, host.layerIn ?? 0, s.duration));
    },
  },
};

