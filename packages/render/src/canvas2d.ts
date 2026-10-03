// Canvas2D backend: draws an evaluated frame, layer by layer, each in its
// local space (translate position, rotate, scale, minus anchor).
// A layer with effects is drawn alone on an offscreen canvas of the frame's
// size, its effects applied, then composited with its opacity, blend mode and
// filters. Without effects, a group's opacity multiplies into each child (no
// offscreen pass), so overlapping children of a half-transparent group show
// through each other; give the group an effect to composite it as one.
// Effects written in GLSL run on the layer's pixels through the GPU, with
// the layers their props name drawn alone beside it (mattes, displacement).
// When the environment isolates errors (the editor's preview), a layer that
// fails is drawn as a red frame and reported; the rest of the frame renders.

import type { BlendMode, EvaluatedFrame, EvaluatedLayer, EvaluatedTransform, Host, Registry } from '@tramme/core';
import { glPass } from './gpu.ts';

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
  /** set: a layer that fails is drawn as a red frame and reported here instead of failing the frame */
  onError?: (layerId: string, error: Error) => void;
  /** a layer of the composition evaluated at this instant, even hidden (layer inputs of effects) */
  layerAt?: (layerId: string) => EvaluatedLayer | null;
  /** the composition time of the frame (GLSL effects' uTime) */
  t?: number;
}

/** a layer that failed: its outline in red, hatched, so the problem shows where it is */
function drawFailure(ctx: CanvasRenderingContext2D, L: EvaluatedLayer, env: DrawEnv) {
  let b: { x: number; y: number; w: number; h: number } | null = null;
  try { b = L.node.bounds?.(L.props, env.host(L.id)) ?? null; } catch { b = null; }
  b ??= { x: -60, y: -60, w: 120, h: 120 };
  ctx.save();
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.strokeStyle = '#FF3B30'; ctx.fillStyle = 'rgba(255,59,48,0.18)'; ctx.lineWidth = 4;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.w, b.y + b.h); ctx.moveTo(b.x + b.w, b.y); ctx.lineTo(b.x, b.y + b.h); ctx.stroke();
  ctx.restore();
}

/** the node and its children, in the layer's local space (transform already applied) */
function drawContent(ctx: CanvasRenderingContext2D, L: EvaluatedLayer, env: DrawEnv) {
  const draw = L.node.render.canvas2d;
  if (draw) {
    ctx.save();
    try { draw(ctx, L.props, env.host(L.id)); }
    catch (e) {
      if (!env.onError) throw e;
      ctx.restore(); ctx.save();
      drawFailure(ctx, L, env);
      env.onError(L.id, e as Error);
    }
    ctx.restore();
  }
  for (const child of L.children) drawLayer(ctx, child, env);
}

/** another layer drawn alone on a canvas of the frame's size, as it shows in the frame (an effect's layer input) */
function layerPicture(like: CanvasRenderingContext2D, id: string, env: DrawEnv): CanvasRenderingContext2D | null {
  const L = env.layerAt?.(id);
  if (!L) return null;
  const off = env.pool.get(like.canvas.width, like.canvas.height);
  if (env.scale) off.setTransform(env.scale[0], 0, 0, env.scale[1], 0, 0);
  // drawn even when hidden: a matte layer is usually hidden
  drawLayer(off, { ...L, layer: { ...L.layer, visible: true } }, env);
  return off;
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
    .filter((x) => x.type?.stage === 'layer' && (x.type.canvas2d || x.type.gl));
  if (fx.length) {
    const { width: w, height: h } = ctx.canvas;
    const off = env.pool.get(w, h);
    off.setTransform(ctx.getTransform());
    off.transform(m.a, m.b, m.c, m.d, m.e, m.f);
    drawContent(off, L, env);
    // effect sizes are in composition pixels: they follow the render scale
    const k = env.scale ? (env.scale[0] + env.scale[1]) / 2 : 1;
    for (const { e, type } of fx) {
      try {
        if (type!.gl) {
          // the layers named by the effect's layer props, drawn alone beside it
          const inputs: Record<string, CanvasRenderingContext2D | null> = {};
          for (const [name, d] of Object.entries(type!.props)) if (d.type === 'layer' && typeof e.props[name] === 'string' && e.props[name] !== L.id) inputs[name] = layerPicture(off, e.props[name] as string, env);
          glPass(off, type!.gl.code, type!.props, e.props, env.t ?? 0, k, Object.fromEntries(Object.entries(inputs).map(([n, c]) => [n, c?.canvas ?? null])));
          for (const c of Object.values(inputs)) if (c) env.pool.release(c);
        } else type!.canvas2d?.apply?.(off, e.props, k, env.host(L.id));
      } catch (err) {
        if (!env.onError) throw err;
        env.onError(L.id, new Error(`effect ${e.type}: ${(err as Error).message}`));
      }
    }
    const filter = fx.map(({ e, type }) => type!.canvas2d?.filter?.(e.props, k) ?? '').filter(Boolean).join(' ');
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

/**
 * The layers through the composition's 2.5D camera: each root layer at its
 * depth d is scaled by zoom · p / (p + d) around the point the camera looks
 * at, so far layers move less (parallax), and blurred by its distance to the
 * focus. Children follow their parent.
 */
function drawThroughCamera(ctx: CanvasRenderingContext2D, frame: EvaluatedFrame, env: DrawEnv) {
  const cam = frame.camera!, { width: W, height: H } = frame.comp;
  const k = env.scale ? (env.scale[0] + env.scale[1]) / 2 : 1;
  for (const L of frame.layers) {
    const d = L.transform.depth ?? 0;
    // a layer at or behind the eye is not drawn
    if (cam.perspective + d <= 1) continue;
    const s = (cam.zoom * cam.perspective) / (cam.perspective + d);
    const [x, y] = L.transform.position, [sx, sy] = L.transform.scale;
    const placed = { ...L, transform: { ...L.transform, position: [W / 2 + (x - W / 2 - cam.pan[0]) * s, H / 2 + (y - H / 2 - cam.pan[1]) * s] as [number, number], scale: [sx * s, sy * s] as [number, number] } };
    const blur = cam.blur > 0 ? (cam.blur * Math.abs(d - cam.focus)) / 1000 : 0;
    ctx.filter = blur > 0.25 ? `blur(${blur * k}px)` : 'none';
    drawLayer(ctx, placed, env);
  }
  ctx.filter = 'none';
}

/** the layers of a frame over what the context holds, through its composition's camera when it has one (nested compositions too) */
export function drawComposed(ctx: CanvasRenderingContext2D, frame: EvaluatedFrame, env: DrawEnv) {
  if (frame.camera) drawThroughCamera(ctx, frame, env);
  else drawLayers(ctx, frame.layers, env);
}

/** clear the canvas and draw the frame's layers (the background plate is the compositor's job) */
export function drawFrame(ctx: CanvasRenderingContext2D, frame: EvaluatedFrame, env: DrawEnv) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (env.scale) ctx.setTransform(env.scale[0], 0, 0, env.scale[1], 0, 0);
  drawComposed(ctx, frame, env);
}
