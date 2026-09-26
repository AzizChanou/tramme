// Canvas2D backend: draws an evaluated frame, layer by layer, each in its
// local space (translate position, rotate, scale, minus anchor).
// A layer with effects is drawn alone on an offscreen canvas of the frame's
// size, its effects applied, then composited with its opacity, blend mode and
// filters. Without effects, a group's opacity multiplies into each child (no
// offscreen pass), so overlapping children of a half-transparent group show
// through each other; give the group an effect to composite it as one.

import type { BlendMode, EvaluatedFrame, EvaluatedLayer, EvaluatedTransform, Host, Registry } from '@tramme/core';

const BLEND: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay',
  darken: 'darken', lighten: 'lighten', add: 'lighter',
};

export function localMatrix(tr: EvaluatedTransform): DOMMatrix {
  return new DOMMatrix()
    .translate(tr.position[0], tr.position[1])
    .rotate(tr.rotation)
    .scale(tr.scale[0], tr.scale[1])
    .translate(-tr.anchor[0], -tr.anchor[1]);
}

export type HostFactory = (layerId: string) => Host;

/** offscreen canvases for layer effects, reused from frame to frame */
export class CanvasPool {
  private free: HTMLCanvasElement[] = [];
  private cpu: boolean;
  constructor(cpu = true) { this.cpu = cpu; }
  get(w: number, h: number): CanvasRenderingContext2D {
    const c = this.free.pop() ?? document.createElement('canvas');
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d', { alpha: true, willReadFrequently: this.cpu })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }
  release(ctx: CanvasRenderingContext2D) { this.free.push(ctx.canvas); }
}

export interface DrawEnv {
  host: HostFactory;
  registry: Registry;
  pool: CanvasPool;
  /** canvas pixels per composition pixel (previews draw smaller); [1, 1] for exports */
  scale?: [number, number];
}

/** the node and its children, in the layer's local space (transform already applied) */
function drawContent(ctx: CanvasRenderingContext2D, L: EvaluatedLayer, env: DrawEnv) {
  const draw = L.node.render.canvas2d;
  if (draw) {
    ctx.save();
    draw(ctx, L.props, env.host(L.id));
    ctx.restore();
  }
  for (const child of L.children) drawLayer(ctx, child, env);
}

function drawLayer(ctx: CanvasRenderingContext2D, L: EvaluatedLayer, env: DrawEnv) {
  if (L.transform.opacity <= 0) return;
  if (!L.node.render.canvas2d && !L.children.length) return;
  ctx.save();
  if (L.clip?.node.path) {
    const outline = L.clip.node.path(L.clip.props, env.host(L.clip.id));
    if (outline) {
      const p = new Path2D();
      p.addPath(outline, localMatrix(L.clip.transform));
      ctx.clip(p);
    }
  }
  const m = localMatrix(L.transform);
  const fx = L.effects
    .map((e) => ({ e, type: env.registry.hasEffect(e.type) ? env.registry.effect(e.type) : null }))
    .filter((x) => x.type?.stage === 'layer' && x.type.canvas2d);
  if (fx.length) {
    const { width: w, height: h } = ctx.canvas;
    const off = env.pool.get(w, h);
    off.setTransform(ctx.getTransform());
    off.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    drawContent(off, L, env);
    // effect sizes are in composition pixels: they follow the render scale
    const k = env.scale ? (env.scale[0] + env.scale[1]) / 2 : 1;
    for (const { e, type } of fx) type!.canvas2d!.apply?.(off, e.props, k);
    const filter = fx.map(({ e, type }) => type!.canvas2d!.filter?.(e.props, k) ?? '').filter(Boolean).join(' ');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha *= L.transform.opacity;
    if (L.layer.blend && L.layer.blend !== 'normal') ctx.globalCompositeOperation = BLEND[L.layer.blend];
    if (filter) ctx.filter = filter;
    ctx.drawImage(off.canvas, 0, 0);
    env.pool.release(off);
  } else {
    ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.globalAlpha *= L.transform.opacity;
    if (L.layer.blend && L.layer.blend !== 'normal') ctx.globalCompositeOperation = BLEND[L.layer.blend];
    drawContent(ctx, L, env);
  }
  ctx.restore();
}

/** draw layers over what the context already holds (nested compositions) */
export function drawLayers(ctx: CanvasRenderingContext2D, layers: EvaluatedLayer[], env: DrawEnv) {
  for (const L of layers) drawLayer(ctx, L, env);
}

/** clear the canvas and draw the frame's layers (the background plate is the compositor's job) */
export function drawFrame(ctx: CanvasRenderingContext2D, frame: EvaluatedFrame, env: DrawEnv) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (env.scale) ctx.setTransform(env.scale[0], 0, 0, env.scale[1], 0, 0);
  drawLayers(ctx, frame.layers, env);
}
