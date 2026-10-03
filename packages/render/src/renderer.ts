// The frame pipeline, the same for the editor preview and the export:
// evaluate the document at each sub-frame time inside the shutter, draw it
// with the Canvas2D backend, accumulate in linear light, then finish
// (background plate, finishing effects, grain) in the compositor.

import { assertValid, DocSchema, Evaluator, parseColor, type Composition, type TrammeDoc, type EvaluatedEffect, type EvaluatedFrame, type Host, type Registry } from '@tramme/core';
import { AssetStore } from './assets.ts';
import { CanvasPool, drawComposed, drawFrame, drawLayers, type DrawEnv, type HostFactory } from './canvas2d.ts';
import { Compositor, type Finish, type FinishPass, type Look } from './compositor.ts';

export interface RenderOptions {
  /** sub-frames: overrides the composition's motion blur (1 for a fast preview) */
  samples?: number;
  shutter?: number;
  /** render into the float target for readYUV / readRGBA instead of the visible canvas */
  toFbo?: boolean;
  /** overlay drawn over the frame (safe zones, grid), straight alpha */
  hud?: TexImageSource | null;
  /** checkerboard behind transparency (preview) */
  checker?: boolean;
}

/** sample times inside the shutter, never straddling a cut marker or the ends */
export function subTimes(t: number, n: number, shutter: number, comp: Composition): number[] {
  if (n <= 1 || shutter <= 0) return [t];
  const span = shutter / comp.fps;
  let lo = 0, hi = comp.duration;
  const cuts = (comp.markers || []).filter((m) => m.kind === 'cut').map((m) => m.t).sort((a, b) => a - b);
  for (const c of cuts) {
    if (c <= t + 1e-9) lo = Math.max(lo, c);
    else { hi = Math.min(hi, c); break; }
  }
  const ts: number[] = [];
  for (let i = 0; i < n; i++) ts.push(Math.min(hi - 1e-5, Math.max(lo, t + ((i + 0.5) / n - 0.5) * span)));
  return ts;
}

/** compositor settings from the composition's finishing effects */
export function finishOf(effects: EvaluatedEffect[], frame: number): { fx: Finish; seed: number } {
  const fx: Finish = { bloom: 0, bloomThreshold: 0.85, vignette: 0, grain: 0, exposure: 1 };
  let seed = frame + 1;
  for (const e of effects) {
    const p = e.props as Record<string, number>;
    if (e.type === 'look.vignette') fx.vignette = p.amount;
    else if (e.type === 'look.grain') { fx.grain = p.amount; seed = p.seed; }
    else if (e.type === 'look.bloom') { fx.bloom = p.amount; fx.bloomThreshold = p.threshold; }
    else if (e.type === 'look.exposure') fx.exposure = p.value;
  }
  return { fx, seed };
}

const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export interface RendererOptions {
  compId?: string;
  /** 'cpu' (default): exact analytic anti-aliasing; 'gpu': faster, less precise on paths */
  raster?: 'cpu' | 'gpu';
  /** render size as a fraction of the composition (previews); 1 for exports */
  scale?: number;
  /** false: the picture is read right after drawing, never later (preview): one copy less per frame */
  preserve?: boolean;
  /** true (the editor's preview): a layer or effect that fails is drawn as a red frame and listed in `errors`, the rest renders; exports keep failing */
  isolate?: boolean;
}

export class Renderer {
  doc!: TrammeDoc;
  compId!: string;
  comp!: Composition;
  /** the base vocabulary plus the document's plugins */
  registry!: Registry;
  evaluator!: Evaluator;
  readonly assets: AssetStore;
  compositor!: Compositor;
  readonly scene: HTMLCanvasElement;
  readonly out: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private pool: CanvasPool;
  private base: Registry;
  /** layer objects already prepared: documents share unchanged layers between versions */
  private loadedLayers = new WeakSet<object>();
  /** requested render scale, and the one applied per axis (sizes rounded for the compositor) */
  /** render size as a fraction of the composition (see setScale) */
  scale = 1;
  private sx = 1;
  private sy = 1;
  /** seed of the last finished frame (for the YUV / RGBA dither) */
  lastSeed = 0;
  /** what the last frame drawn was missing (video frames being decoded) */
  private pending: Promise<unknown>[] = [];
  private preserve = true;
  private isolate = false;
  /** what failed in the last frame drawn (isolate mode): layer id -> message */
  readonly errors = new Map<string, string>();
  /** simulations: a state every CHECKPOINT frames from the in point, and the last one computed */
  private sims = new Map<string, { checkpoints: Map<number, unknown>; last: { frame: number; state: unknown } | null }>();

  private constructor(base: Registry, docUrl: string, out: HTMLCanvasElement, raster: 'cpu' | 'gpu', doc: TrammeDoc) {
    this.base = base;
    this.out = out;
    this.assets = new AssetStore(doc, docUrl);
    this.scene = document.createElement('canvas');
    this.sctx = this.scene.getContext('2d', { alpha: true, willReadFrequently: raster === 'cpu' })!;
    this.pool = new CanvasPool(raster === 'cpu');
  }

  /** a renderer ready for its first frame: assets and plugins loaded, document validated */
  static async open(doc: TrammeDoc, base: Registry, docUrl: string, out: HTMLCanvasElement, opts: RendererOptions = {}): Promise<Renderer> {
    const r = new Renderer(base, docUrl, out, opts.raster ?? 'cpu', doc);
    r.scale = opts.scale ?? 1;
    r.preserve = opts.preserve ?? true;
    r.isolate = opts.isolate ?? false;
    await r.setDoc(doc, { compId: opts.compId });
    return r;
  }

  /**
   * Switch to another version of the document: loads new or changed assets
   * (and `reload` ones), re-registers plugins, validates, prepares new layers.
   * Throws on an invalid document and keeps the previous state.
   * trusted: the caller already validated it (an editor's drafts): no validation.
   */
  async setDoc(doc: TrammeDoc, { compId, reload = [], trusted = false }: { compId?: string; reload?: string[]; trusted?: boolean } = {}): Promise<void> {
    if (!trusted) {
      const parsed = DocSchema.safeParse(doc);
      if (!parsed.success) throw new Error(`invalid document: ${parsed.error.issues[0]?.message}`);
    }
    await this.assets.sync(doc, reload);
    const samePlugins = this.registry && !reload.length && doc.plugins === this.doc?.plugins && (doc.plugins || []).every((id) => doc.assets[id] === this.doc.assets[id]);
    const registry = samePlugins ? this.registry : this.base.clone();
    if (!samePlugins) for (const id of doc.plugins || []) registry.use(this.assets.get(id), id);
    if (!trusted) assertValid(doc, registry);
    this.doc = doc;
    this.registry = registry;
    // analyses (JSON assets) reach the expressions and modifiers that follow the music
    this.evaluator = new Evaluator(doc, registry, { data: (id) => (this.assets.has(id) ? this.assets.get(id) : undefined) });
    this.compId = compId ?? (doc.compositions[this.compId] ? this.compId : doc.root);
    const comp = this.evaluator.comp(this.compId);
    const resized = !this.comp || comp.width !== this.comp.width || comp.height !== this.comp.height;
    this.comp = comp;
    if (resized) this.resize();
    if (reload.length) this.loadedLayers = new WeakSet();
    // a simulation may read anything of the document: computed again after any change
    this.sims.clear();
    await this.loadLayers();
  }

  /** render at a fraction of the composition size (previews); exports keep 1 */
  setScale(scale: number) {
    if (Math.abs(scale - this.scale) < 1e-6) return;
    this.scale = scale;
    this.resize();
  }

  /** free the GPU resources (an export's renderer, once done) */
  dispose() { this.compositor?.dispose(); }

  /** canvases and compositor at the render size (width multiple of 8, even height) */
  private resize() {
    const { width: W, height: H } = this.comp;
    const w = Math.max(8, Math.round((W * this.scale) / 8) * 8), h = Math.max(2, Math.round((H * this.scale) / 2) * 2);
    this.sx = w / W; this.sy = h / H;
    if (this.scene.width === w && this.scene.height === h && this.compositor) return;
    this.scene.width = w; this.scene.height = h;
    this.out.width = w; this.out.height = h;
    if (this.compositor) this.compositor.resize(w, h);
    else this.compositor = new Compositor(this.out, w, h, { preserve: this.preserve });
  }

  /** let each node prepare once per layer state (code modules run their init), in every composition */
  private async loadLayers() {
    for (const [compId, comp] of Object.entries(this.doc.compositions)) {
      for (const [id, layer] of Object.entries(comp.layers)) {
        if (this.loadedLayers.has(layer)) continue;
        const node = this.registry.node(layer.type);
        if (node.load) {
          const t = layer.in ?? 0;
          const L = this.evaluator.layerAt(id, t, compId);
          await node.load(L.props, this.hostFactory({ t, frame: Math.round(t * comp.fps) }, compId)(id));
        }
        this.loadedLayers.add(layer);
      }
    }
  }

  hostFactory(f: { t: number; frame: number }, compId = this.compId): HostFactory {
    const { assets } = this;
    const comp = this.evaluator.comp(compId);
    return (layerId: string): Host => ({
      layerId, layerIn: comp.layers[layerId]?.in ?? 0,
      t: f.t, frame: f.frame, fps: comp.fps, width: comp.width, height: comp.height, duration: comp.duration,
      asset: <T>(id: string) => assets.get<T>(id),
      assetInfo: (id: string) => assets.info(id),
      assetUrl: (id: string) => assets.url(id),
      compositionSize: (id: string) => { const c = this.doc.compositions[id]; return c ? { width: c.width, height: c.height, duration: c.duration } : null; },
      drawComposition: (ctx: CanvasRenderingContext2D, id: string, t: number) => this.drawNested(ctx, id, t),
      drawLayer: (ctx: CanvasRenderingContext2D, id: string) => { const L = this.layerOf(id, f.t, compId); if (L) drawLayers(ctx, [{ ...L, layer: { ...L.layer, visible: true } }], this.env(f, compId)); },
      layer: (id: string) => { const L = this.layerOf(id, f.t, compId); return L ? { props: L.props, transform: L.transform } : null; },
      state: <T>() => this.simState(compId, layerId, f.t) as T,
      defer: (p: Promise<unknown>) => { this.pending.push(p); },
    });
  }

  /**
   * The state of a layer's simulation at the frame nearest t: stepped in
   * order from its in point, from the closest checkpoint or the last frame
   * computed, so playing forward costs one step a frame and a jump at most
   * CHECKPOINT steps once the way there was computed.
   */
  private simState(compId: string, id: string, t: number): unknown {
    const comp = this.doc.compositions[compId], layer = comp?.layers[id];
    const sim = layer && this.registry.hasNode(layer.type) ? this.registry.node(layer.type).simulate : undefined;
    if (!sim) return undefined;
    const CHECKPOINT = 10, fps = comp.fps, start = layer.in ?? 0;
    const target = Math.max(0, Math.round((t - start) * fps));
    const key = `${compId}/${id}`;
    let c = this.sims.get(key);
    if (!c) { c = { checkpoints: new Map(), last: null }; this.sims.set(key, c); }
    const at = (frame: number) => {
      const time = start + frame / fps;
      return { props: this.evaluator.layerAt(id, time, compId).props, host: this.hostFactory({ t: time, frame: Math.round(time * fps) }, compId)(id) };
    };
    if (c.last?.frame === target) return c.last.state;
    // where to start: the last frame computed if it is just behind, else the highest checkpoint at or before the target
    let frame = -1, state: unknown;
    if (c.last && c.last.frame < target && target - c.last.frame <= CHECKPOINT) ({ frame, state } = c.last);
    else {
      for (let k = Math.floor(target / CHECKPOINT) * CHECKPOINT; k >= 0; k -= CHECKPOINT) if (c.checkpoints.has(k)) { frame = k; state = c.checkpoints.get(k); break; }
      // checkpoints are made in order: the highest one may lie before an older last frame
      if (c.last && c.last.frame < target && c.last.frame > frame) ({ frame, state } = c.last);
    }
    if (frame < 0) {
      const { props, host } = at(0);
      frame = 0; state = sim.init(props, host);
      c.checkpoints.set(0, state);
    }
    while (frame < target) {
      const { props, host } = at(frame + 1);
      state = sim.step(state, props, 1 / fps, host);
      frame++;
      if (frame % CHECKPOINT === 0) c.checkpoints.set(frame, state);
    }
    c.last = { frame, state };
    return state;
  }

  /** a layer at time t even when hidden or out of its range (layer inputs), or null */
  private layerOf(id: string, t: number, compId: string) {
    try { return this.doc.compositions[compId]?.layers[id] ? this.evaluator.layerAt(id, t, compId) : null; } catch { return null; }
  }

  private env(frame: { t: number; frame: number }, compId = this.compId): DrawEnv {
    return {
      host: this.hostFactory(frame, compId), registry: this.registry, pool: this.pool, scale: [this.sx, this.sy], t: frame.t,
      layerAt: (id) => this.layerOf(id, frame.t, compId),
      ...(this.isolate ? { onError: (id: string, e: Error) => { this.errors.set(id, e.message); } } : {}),
    };
  }

  /** a nested composition at its local time: background plate, then its layers (through its own camera) */
  private drawNested(ctx: CanvasRenderingContext2D, compId: string, t: number) {
    const f = this.evaluator.frame(t, compId);
    if (f.background) { ctx.fillStyle = f.background; ctx.fillRect(0, 0, f.comp.width, f.comp.height); }
    drawComposed(ctx, f, this.env(f, compId));
  }

  /** draw the layers of one instant on the scene canvas (no motion blur, no finish) */
  drawScene(frame: EvaluatedFrame) {
    drawFrame(this.sctx, frame, this.env(frame));
  }

  /** the last frame drawn lacked something still loading (a video frame): draw it again once settled */
  get incomplete() { return this.pending.length > 0; }

  /** waits for what the last frame lacked; true when there was something (the frame should be drawn again) */
  async settle(): Promise<boolean> {
    const p = this.pending;
    this.pending = [];
    if (!p.length) return false;
    await Promise.all(p);
    return true;
  }

  /** a frame with nothing missing: drawn again until every video frame it shows is the exact one (exports, stills) */
  async renderComplete(t: number, opts: RenderOptions = {}): Promise<EvaluatedFrame> {
    let frame = this.render(t, opts);
    for (let i = 0; i < 30 && (await this.settle()); i++) frame = this.render(t, opts);
    return frame;
  }

  /** a finished frame at time t */
  render(t: number, opts: RenderOptions = {}): EvaluatedFrame {
    const step = this.renderSteps(t, opts);
    let frame: EvaluatedFrame | null = null;
    while (!frame) frame = step();
    return frame;
  }

  /**
   * The same frame in steps, one sub-frame per call, so a preview can spread
   * a heavy frame over several animation frames: each call returns null until
   * the last one, which finishes the picture and returns the frame. Any other
   * render in between starts over.
   */
  renderSteps(t: number, opts: RenderOptions = {}): () => EvaluatedFrame | null {
    const frame = this.evaluator.frame(t, this.compId);
    const n = opts.samples ?? frame.motionBlur.samples;
    const times = subTimes(t, n, opts.shutter ?? frame.motionBlur.shutter, this.comp);
    let i = 0;
    return () => {
      if (i === 0) { this.compositor.begin(); this.pending = []; this.errors.clear(); }
      if (i < times.length) {
        const ts = times[i++];
        this.drawScene(ts === t ? frame : this.evaluator.frame(ts, this.compId));
        this.compositor.add(this.scene, 1 / times.length);
        if (i < times.length) return null;
      }
      return this.finishFrame(frame, opts);
    };
  }

  private finishFrame(frame: EvaluatedFrame, opts: RenderOptions): EvaluatedFrame {
    const { fx, seed } = finishOf(frame.effects, frame.frame);
    const bg = frame.background ? parseColor(frame.background) : null;
    const look: Look = { bg: bg ? [toLin(bg[0] / 255), toLin(bg[1] / 255), toLin(bg[2] / 255)] : null, checker: opts.checker };
    // finishing effects of plugins written in GLSL
    const passes: FinishPass[] = frame.effects.flatMap((e) => {
      const type = this.registry.hasEffect(e.type) ? this.registry.effect(e.type) : null;
      return type?.stage === 'finish' && type.gl ? [{ code: type.gl.code, schema: type.props, props: e.props }] : [];
    });
    const onError = this.isolate ? (e: Error) => { this.errors.set('$comp.effects', e.message); } : (e: Error) => { throw e; };
    this.compositor.finish(fx, look, seed, { hud: opts.hud ?? null, toFbo: opts.toFbo, passes, t: frame.t, scale: (this.sx + this.sy) / 2, onError });
    this.lastSeed = seed;
    return frame;
  }
}
