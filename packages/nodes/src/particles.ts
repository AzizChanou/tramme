// Deterministic particles. Particle i is born at i / rate (layer time, after
// an optional pre-roll), draws its randomness from hash(i, seed), and moves
// along a closed-form path (initial velocity, gravity, linear drag), so a
// frame is a pure function of t: no simulation state, any frame in any order.

import { hash, mixColor, type NodeType, type Vec2 } from '@tramme/core';

interface ParticleProps {
  rate: number; life: number; lifeVar: number; duration: number; preroll: number;
  emitter: 'point' | 'line' | 'rect' | 'circle'; emitterSize: Vec2;
  direction: number; spread: number; speed: number; speedVar: number;
  gravity: Vec2; drag: number;
  size: number; sizeEnd: number; sizeVar: number;
  shape: 'circle' | 'square' | 'streak';
  color: string; colorEnd: string | null; opacity: number; fadeIn: number; fadeOut: number;
  spin: number; seed: number; max: number;
}

const DEG = Math.PI / 180;

/** position along the closed-form path after tau seconds */
function travel(p0: number, v: number, g: number, k: number, tau: number): number {
  if (k <= 1e-6) return p0 + v * tau + 0.5 * g * tau * tau;
  const e = 1 - Math.exp(-k * tau);
  return p0 + (v * e) / k + g * (tau / k - e / (k * k));
}

export const particles: NodeType<ParticleProps> = {
  type: 'particles', title: 'Particles', category: 'Generative',
  description: 'deterministic emitter: each frame is a pure function of time',
  props: {
    rate: { type: 'number', default: 40, min: 0, step: 1, label: 'Rate (per s)', group: 'Emission' },
    life: { type: 'number', default: 1.6, min: 0.01, step: 0.05, unit: 's', label: 'Lifetime', group: 'Emission' },
    lifeVar: { type: 'number', default: 0.3, min: 0, max: 1, step: 0.05, label: 'Life variation', group: 'Emission' },
    duration: { type: 'number', default: 0, min: 0, step: 0.1, unit: 's', label: "Emission duration", description: '0: endless', group: 'Emission' },
    preroll: { type: 'number', default: 0, min: 0, step: 0.1, unit: 's', label: 'Pre-roll', description: 'particles already present at the in point', group: 'Emission' },
    emitter: { type: 'enum', default: 'point', options: ['point', 'line', 'rect', 'circle'], label: 'Emitter', group: 'Emission' },
    emitterSize: { type: 'vec2', default: [0, 0], unit: 'px', label: "Emitter size", group: 'Emission' },
    direction: { type: 'number', default: -90, step: 1, unit: 'deg', label: 'Direction', group: 'Motion' },
    spread: { type: 'number', default: 40, min: 0, max: 360, step: 1, unit: 'deg', label: 'Opening', group: 'Motion' },
    speed: { type: 'number', default: 420, min: 0, step: 5, unit: 'px', label: 'Speed (px/s)', group: 'Motion' },
    speedVar: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.05, label: 'Speed variation', group: 'Motion' },
    gravity: { type: 'vec2', default: [0, 520], unit: 'px', label: 'Gravity (px/s²)', group: 'Motion' },
    drag: { type: 'number', default: 0.6, min: 0, step: 0.05, label: 'Drag', group: 'Motion' },
    spin: { type: 'number', default: 0, step: 5, unit: 'deg', label: 'Rotation (°/s)', group: 'Motion' },
    size: { type: 'number', default: 14, min: 0, step: 0.5, unit: 'px', label: 'Size', group: 'Appearance' },
    sizeEnd: { type: 'number', default: 0, min: 0, step: 0.5, unit: 'px', label: 'End size', group: 'Appearance' },
    sizeVar: { type: 'number', default: 0.4, min: 0, max: 1, step: 0.05, label: 'Size variation', group: 'Appearance' },
    shape: { type: 'enum', default: 'circle', options: ['circle', 'square', 'streak'], label: 'Shape', group: 'Appearance' },
    color: { type: 'color', default: '#FFFFFF', label: 'Color', group: 'Appearance' },
    colorEnd: { type: 'color', default: null, nullable: true, label: 'End color', group: 'Appearance' },
    opacity: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, label: 'Opacity', group: 'Appearance' },
    fadeIn: { type: 'number', default: 0.08, min: 0, step: 0.01, unit: 's', label: 'Reveal', group: 'Appearance' },
    fadeOut: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.05, label: 'Fade out (share of life)', group: 'Appearance' },
    seed: { type: 'number', default: 1, step: 1, label: 'Seed', animatable: false, group: 'Emission' },
    max: { type: 'number', default: 4000, min: 1, step: 100, label: 'Max particles', animatable: false, group: 'Emission' },
  },
  bounds: (p) => ({ x: -Math.max(40, p.emitterSize[0] / 2), y: -Math.max(40, p.emitterSize[1] / 2), w: Math.max(80, p.emitterSize[0]), h: Math.max(80, p.emitterSize[1]) }),
  render: {
    canvas2d(ctx, p, host) {
      if (p.rate <= 0) return;
      const now = host.t - (host.layerIn ?? 0) + p.preroll;
      if (now < 0) return;
      const maxLife = p.life * (1 + p.lifeVar);
      const last = Math.floor(Math.min(now, p.duration > 0 ? p.duration : Infinity) * p.rate);
      const first = Math.max(0, Math.floor((now - maxLife) * p.rate));
      const seed = (p.seed | 0) * 7919;
      const rnd = (i: number, k: number) => hash(i * 97 + k * 7 + seed);
      let drawn = 0;
      for (let i = first; i <= last && drawn < p.max; i++) {
        const born = i / p.rate;
        const life = p.life * (1 + p.lifeVar * (rnd(i, 1) * 2 - 1));
        const tau = now - born;
        if (tau < 0 || tau >= life) continue;
        const k = tau / life;
        // emitter offset
        let ox = 0, oy = 0;
        const [ew, eh] = p.emitterSize;
        if (p.emitter === 'line') ox = (rnd(i, 2) - 0.5) * ew;
        else if (p.emitter === 'rect') { ox = (rnd(i, 2) - 0.5) * ew; oy = (rnd(i, 3) - 0.5) * eh; }
        else if (p.emitter === 'circle') { const a = rnd(i, 2) * Math.PI * 2, r = Math.sqrt(rnd(i, 3)); ox = Math.cos(a) * r * ew / 2; oy = Math.sin(a) * r * eh / 2; }
        const dir = (p.direction + (rnd(i, 4) - 0.5) * p.spread) * DEG;
        const sp = p.speed * (1 + p.speedVar * (rnd(i, 5) * 2 - 1));
        const vx = Math.cos(dir) * sp, vy = Math.sin(dir) * sp;
        const x = travel(ox, vx, p.gravity[0], p.drag, tau), y = travel(oy, vy, p.gravity[1], p.drag, tau);
        const s = (p.size + (p.sizeEnd - p.size) * k) * (1 + p.sizeVar * (rnd(i, 6) * 2 - 1));
        if (s <= 0.05) continue;
        let a = p.opacity;
        if (p.fadeIn > 0) a *= Math.min(1, tau / p.fadeIn);
        if (p.fadeOut > 0 && k > 1 - p.fadeOut) a *= (1 - k) / p.fadeOut;
        if (a <= 0.002) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = p.colorEnd ? mixColor(p.color, p.colorEnd, k) : p.color;
        if (p.shape === 'circle') { ctx.beginPath(); ctx.arc(x, y, s / 2, 0, Math.PI * 2); ctx.fill(); }
        else if (p.shape === 'square') {
          const rot = (p.spin * tau + rnd(i, 7) * 360) * DEG;
          ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillRect(-s / 2, -s / 2, s, s); ctx.restore();
        } else {
          // a streak along the velocity, as long as a twentieth of a second of travel
          const dt = 1 / 20, x2 = travel(ox, vx, p.gravity[0], p.drag, Math.max(0, tau - dt)), y2 = travel(oy, vy, p.gravity[1], p.drag, Math.max(0, tau - dt));
          ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = s / 2; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x, y); ctx.stroke();
        }
        drawn++;
      }
    },
  },
};

