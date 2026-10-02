// Secondary motion: a dot that follows another layer on a spring, lagging,
// overshooting and settling, with a fading trail of where it has been. A
// simulation (see NodeType.simulate): the state is stepped frame by frame
// from the layer's in point, so the picture stays a function of time.
// Drawn in composition space: leave the layer's own transform at rest.

import type { NodeType, Vec2 } from '@tramme/core';

interface FollowProps { target: string | null; frequency: number; damping: number; size: number; color: string; trail: number }
interface FollowState { p: Vec2; v: Vec2; trail: Vec2[] }

export const follow: NodeType<FollowProps> = {
  type: 'follow', title: 'Follower', category: 'Generative',
  description: 'a dot that follows another layer on a spring, with a trail',
  props: {
    target: { type: 'layer', default: null, nullable: true, label: 'Follows', animatable: false },
    frequency: { type: 'number', default: 2.2, min: 0.1, max: 20, step: 0.1, unit: 'x', label: 'Spring (Hz)' },
    damping: { type: 'number', default: 0.35, min: 0.02, max: 1, step: 0.01, label: 'Damping' },
    size: { type: 'number', default: 28, min: 1, unit: 'px', label: 'Size' },
    color: { type: 'color', default: '#FFFFFF', label: 'Color' },
    trail: { type: 'number', default: 12, min: 0, max: 120, step: 1, label: 'Trail (frames)' },
  },
  simulate: {
    init(p, host) {
      const at = (p.target && host.layer?.(p.target)?.transform.position) || [0, 0];
      return { p: [...at] as Vec2, v: [0, 0], trail: [] } satisfies FollowState;
    },
    step(s: FollowState, p, dt, host) {
      const goal = (p.target && host.layer?.(p.target)?.transform.position) || s.p;
      // a damped spring, integrated in small sub-steps so stiff springs stay stable
      const w = 2 * Math.PI * p.frequency, n = Math.max(1, Math.ceil(dt * w * 2)), h = dt / n;
      let [x, y] = s.p, [vx, vy] = s.v;
      for (let i = 0; i < n; i++) {
        vx += (w * w * (goal[0] - x) - 2 * p.damping * w * vx) * h;
        vy += (w * w * (goal[1] - y) - 2 * p.damping * w * vy) * h;
        x += vx * h; y += vy * h;
      }
      const trail = p.trail > 0 ? [...s.trail, s.p].slice(-Math.round(p.trail)) : [];
      return { p: [x, y], v: [vx, vy], trail } satisfies FollowState;
    },
  },
  bounds: (p) => ({ x: -p.size, y: -p.size, w: p.size * 2, h: p.size * 2 }),
  render: {
    canvas2d(ctx, p, host) {
      const s = host.state?.<FollowState>();
      if (!s) return;
      ctx.fillStyle = p.color;
      s.trail.forEach((q, i) => {
        const k = (i + 1) / (s.trail.length + 1);
        ctx.globalAlpha = k * 0.5;
        ctx.beginPath(); ctx.arc(q[0], q[1], (p.size / 2) * (0.35 + 0.65 * k), 0, Math.PI * 2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(s.p[0], s.p[1], p.size / 2, 0, Math.PI * 2); ctx.fill();
    },
  },
};
