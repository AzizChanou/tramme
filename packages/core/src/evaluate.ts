// eval(doc, t): the resolved scene at one instant, a pure function of t.
// One Evaluator per document version (documents are immutable: an edit makes
// a new one). Within a frame each property is computed once (memo) and
// expressions or links that read other properties record the dependency, so
// cycles are reported and the editor can show what drives what. Static
// properties are cached across frames.

import { audioReader, type AudioReader } from './analysis.ts';
import { eventsReader, type EventsReader } from './events.ts';
import { compileExpr, type ExprScope } from './expr.ts';
import { modifierParams, seedOf, type ModifierContext } from './modifiers.ts';
import { asExpr, asKeyframed, asLink, easeFn, modsOf, propKind, resolveTokens, sampleKeyframes, staticValue, tokenValue } from './props.ts';
import { CAMERA_SCHEMA, MOTION_BLUR_SCHEMA, TRANSFORM_SCHEMA, type NodeType, type PropDef, type Registry } from './registry.ts';
import type { Composition, TrammeDoc, Layer, Marker, Prop, Vec2 } from './types.ts';

export interface EvaluatedTransform {
  anchor: Vec2;
  position: Vec2;
  scale: Vec2;
  rotation: number;
  opacity: number;
  depth: number;
}

export interface EvaluatedCamera { pan: Vec2; zoom: number; perspective: number; focus: number; blur: number }

export interface EvaluatedEffect {
  id: string;
  type: string;
  props: Record<string, unknown>;
}

export interface EvaluatedLayer {
  id: string;
  layer: Layer;
  node: NodeType;
  props: Record<string, unknown>;
  transform: EvaluatedTransform;
  /** enabled layer effects with their props at this instant */
  effects: EvaluatedEffect[];
  children: EvaluatedLayer[];
  clip: EvaluatedLayer | null;
}

export interface EvaluatedFrame {
  compId: string;
  comp: Composition;
  t: number;
  frame: number;
  background: string | null;
  motionBlur: { samples: number; shutter: number };
  /** the 2.5D camera, when the composition has one */
  camera: EvaluatedCamera | null;
  effects: EvaluatedEffect[];
  /** active, visible layers of the root stack, bottom to top */
  layers: EvaluatedLayer[];
}

export class EvalError extends Error {
  readonly address: string;
  constructor(address: string, message: string) {
    super(`${address} : ${message}`);
    this.address = address;
  }
}

/** a property slot: where its value lives in the document and how to read it */
interface Slot { prop: Prop | undefined; def: PropDef }

interface FrameCtx {
  compId: string;
  comp: Composition;
  t: number;
  frame: number;
  memo: Map<string, unknown>;
  stack: string[];
}

const COMP_DEFS: Record<string, PropDef> = {
  background: { type: 'color', default: null, nullable: true },
};

export function layerActive(layer: Layer, comp: Composition, t: number): boolean {
  return t >= (layer.in ?? 0) && t < (layer.out ?? comp.duration);
}

export interface EvaluatorOptions {
  /** the loaded content of a JSON asset (analyses), when the caller has it: the renderer does */
  data?(assetId: string): unknown;
}

export class Evaluator {
  readonly doc: TrammeDoc;
  readonly registry: Registry;
  private data?: (assetId: string) => unknown;
  /** address -> addresses it read, from the last evaluations */
  readonly deps = new Map<string, Set<string>>();
  private staticCache = new Map<string, unknown>();

  constructor(doc: TrammeDoc, registry: Registry, opts: EvaluatorOptions = {}) {
    this.doc = doc;
    this.registry = registry;
    this.data = opts.data;
  }

  /**
   * The music at time t from its analysis (asset analysis-<media>). The
   * source is a sound or video layer (its own time: in point and start in
   * the file), or an asset id: the analysis itself, or the media analysed.
   */
  private audioAt(ctx: FrameCtx, source: string): AudioReader {
    const layer = ctx.comp.layers[source];
    let asset = source, t = ctx.t;
    if (layer && (layer.type === 'audio' || layer.type === 'video')) {
      asset = String(staticValue(layer.props?.[layer.type]) ?? '');
      const start = Number(staticValue(layer.props?.start) ?? 0) || 0;
      t = ctx.t - (layer.in ?? 0) + start;
    }
    const a = this.doc.assets[asset];
    const id = a && a.type !== 'json' ? `analysis-${asset}`.slice(0, 64) : asset;
    return audioReader(this.data?.(id), t);
  }

  /** an event list at time t (composition time): its asset id, or the name the events tool saved it under (events-<name>) */
  private eventsAt(ctx: FrameCtx, source: string): EventsReader {
    const id = this.doc.assets[source] || !this.doc.assets[`events-${source}`] ? source : `events-${source}`;
    return eventsReader(this.data?.(id), ctx.t);
  }

  comp(compId = this.doc.root): Composition {
    const c = this.doc.compositions[compId];
    if (!c) throw new Error(`unknown composition: ${compId}`);
    return c;
  }

  /** the resolved scene of a composition at time t (seconds) */
  frame(t: number, compId = this.doc.root): EvaluatedFrame {
    const comp = this.comp(compId);
    const ctx: FrameCtx = { compId, comp, t, frame: Math.round(t * comp.fps), memo: new Map(), stack: [] };
    const effects: EvaluatedEffect[] = (comp.effects || []).filter((e) => e.enabled !== false).map((e) => ({
      id: e.id, type: e.type, props: this.evalSchema(ctx, `$comp.effects.${e.id}`, this.effectSchema(e.type)),
    }));
    return {
      compId, comp, t, frame: ctx.frame,
      background: this.read(ctx, '$comp.background') as string | null,
      motionBlur: {
        samples: Math.max(1, Math.round(this.read(ctx, '$comp.motionBlur.samples') as number)),
        shutter: this.read(ctx, '$comp.motionBlur.shutter') as number,
      },
      camera: comp.camera ? this.evalSchema(ctx, '$comp.camera', CAMERA_SCHEMA) as unknown as EvaluatedCamera : null,
      effects,
      layers: this.stack(ctx, comp.order),
    };
  }

  /** value of one property: 'layerId.prop', 'layerId.transform.position', '$comp.background' */
  value(address: string, t: number, compId = this.doc.root): unknown {
    const comp = this.comp(compId);
    return this.read({ compId, comp, t, frame: Math.round(t * comp.fps), memo: new Map(), stack: [] }, address);
  }

  /** one layer at time t, whether or not it is active then (node loading, editor) */
  layerAt(id: string, t: number, compId = this.doc.root): EvaluatedLayer {
    const comp = this.comp(compId);
    if (!comp.layers[id]) throw new Error(`unknown layer: ${id}`);
    return this.layer({ compId, comp, t, frame: Math.round(t * comp.fps), memo: new Map(), stack: [] }, id);
  }

  // ── layers ─────────────────────────────────────────────────
  private stack(ctx: FrameCtx, ids: string[]): EvaluatedLayer[] {
    const out: EvaluatedLayer[] = [];
    for (const id of ids) {
      const layer = ctx.comp.layers[id];
      if (!layer || layer.visible === false || !layerActive(layer, ctx.comp, ctx.t)) continue;
      out.push(this.layer(ctx, id));
    }
    return out;
  }

  private layer(ctx: FrameCtx, id: string): EvaluatedLayer {
    const layer = ctx.comp.layers[id];
    const node = this.registry.node(layer.type);
    const clipLayer = layer.clip ? ctx.comp.layers[layer.clip] : null;
    return {
      id, layer, node,
      props: this.evalSchema(ctx, id, node.props),
      transform: this.evalSchema(ctx, `${id}.transform`, TRANSFORM_SCHEMA) as unknown as EvaluatedTransform,
      effects: (layer.effects || []).filter((e) => e.enabled !== false).map((e) => ({
        id: e.id, type: e.type, props: this.evalSchema(ctx, `${id}.effects.${e.id}`, this.effectSchema(e.type)),
      })),
      children: node.container ? this.stack(ctx, layer.children || []) : [],
      // a clip layer is used even when hidden; it follows its own in/out
      clip: layer.clip && clipLayer && layerActive(clipLayer, ctx.comp, ctx.t) ? this.layer(ctx, layer.clip) : null,
    };
  }

  private effectSchema(type: string) {
    return this.registry.hasEffect(type) ? this.registry.effect(type).props : {};
  }

  private evalSchema(ctx: FrameCtx, base: string, schema: Record<string, PropDef>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const name of Object.keys(schema)) out[name] = this.read(ctx, `${base}.${name}`);
    return out;
  }

  // ── addresses ──────────────────────────────────────────────
  private slot(ctx: FrameCtx, address: string): Slot {
    const parts = address.split('.');
    if (parts[0] === '$comp') {
      if (parts[1] === 'background') return { prop: ctx.comp.background ?? undefined, def: COMP_DEFS.background };
      if (parts[1] === 'motionBlur' && MOTION_BLUR_SCHEMA[parts[2]]) {
        return { prop: (ctx.comp.motionBlur as any)?.[parts[2]], def: MOTION_BLUR_SCHEMA[parts[2]] };
      }
      if (parts[1] === 'camera' && CAMERA_SCHEMA[parts[2]]) {
        return { prop: (ctx.comp.camera as any)?.[parts[2]], def: CAMERA_SCHEMA[parts[2]] };
      }
      if (parts[1] === 'effects') {
        const fx = (ctx.comp.effects || []).find((e) => e.id === parts[2]);
        const def = fx && this.effectSchema(fx.type)[parts[3]];
        if (fx && def) return { prop: fx.props?.[parts[3]], def };
      }
      throw new EvalError(address, 'unknown address');
    }
    const layer = ctx.comp.layers[parts[0]];
    if (!layer) throw new EvalError(address, `unknown layer "${parts[0]}"`);
    if (parts[1] === 'transform' && TRANSFORM_SCHEMA[parts[2]]) {
      return { prop: (layer.transform as any)?.[parts[2]], def: TRANSFORM_SCHEMA[parts[2]] };
    }
    if (parts[1] === 'effects') {
      const fx = (layer.effects || []).find((e) => e.id === parts[2]);
      const def = fx && this.effectSchema(fx.type)[parts[3]];
      if (fx && def) return { prop: fx.props?.[parts[3]], def };
      throw new EvalError(address, 'unknown effect or effect property');
    }
    const def = this.registry.node(layer.type).props[parts[1]];
    if (!def || parts.length !== 2) throw new EvalError(address, `unknown property for ${layer.type}`);
    return { prop: layer.props?.[parts[1]], def };
  }

  private read(ctx: FrameCtx, address: string): unknown {
    if (ctx.memo.has(address)) return ctx.memo.get(address);
    const cacheKey = `${ctx.compId}:${address}`;
    if (this.staticCache.has(cacheKey)) return this.staticCache.get(cacheKey);
    if (ctx.stack.includes(address)) throw new EvalError(address, `circular dependency (${[...ctx.stack, address].join(' → ')})`);
    const { prop, def } = this.slot(ctx, address);
    ctx.stack.push(address);
    let v: unknown;
    try {
      v = this.compute(ctx, address, prop, def);
    } finally {
      ctx.stack.pop();
    }
    if (prop === undefined || (propKind(prop) === 'static' && !modsOf(prop))) this.staticCache.set(cacheKey, v);
    else ctx.memo.set(address, v);
    return v;
  }

  private compute(ctx: FrameCtx, address: string, prop: Prop | undefined, def: PropDef): unknown {
    const v = this.computeRaw(ctx, address, prop, def);
    const mods = modsOf(prop);
    return mods ? this.applyMods(ctx, address, prop!, def, v, mods.length) : v;
  }

  /** apply the first `upto` modifiers of the stack to v */
  private applyMods(ctx: FrameCtx, address: string, prop: Prop, def: PropDef, v: unknown, upto: number): unknown {
    const mods = modsOf(prop)!;
    const kp = propKind(prop) === 'keyframes' ? asKeyframed(prop) : null;
    const [index, count] = this.rank(ctx.comp, address.split('.')[0]);
    for (let k = 0; k < upto; k++) {
      const spec = mods[k];
      if (!this.registry.hasModifier(spec.type)) throw new EvalError(address, `unknown modifier "${spec.type}"`);
      const m = this.registry.modifier(spec.type);
      const mc: ModifierContext = {
        t: ctx.t, fps: ctx.comp.fps, index, count, seed: seedOf(address),
        audio: (source: string) => this.audioAt(ctx, source),
        keys: kp ? kp.$k : null,
        keyValues: kp ? kp.$k.map((key) => resolveTokens(def.type, key.v, this.doc.tokens)) : null,
        base: (t2: number) => this.valueAt(ctx, address, prop, def, t2, k),
      };
      v = m.apply(v, modifierParams(m, spec), mc);
    }
    return v;
  }

  /** the property at another time, with only its first `upto` modifiers */
  private valueAt(ctx: FrameCtx, address: string, prop: Prop, def: PropDef, t: number, upto: number): unknown {
    const c2: FrameCtx = { ...ctx, t, frame: Math.round(t * ctx.comp.fps), memo: new Map(), stack: [...ctx.stack] };
    return this.applyMods(c2, address, prop, def, this.computeRaw(c2, address, prop, def), upto);
  }

  private ranks = new WeakMap<Composition, Map<string, [number, number]>>();
  /** rank of a layer among its siblings (bottom first) and their number */
  private rank(comp: Composition, id: string): [number, number] {
    let m = this.ranks.get(comp);
    if (!m) {
      m = new Map();
      const put = (ids: string[]) => ids.forEach((x, i) => m!.set(x, [i, ids.length]));
      put(comp.order);
      for (const l of Object.values(comp.layers)) if (l.children) put(l.children);
      this.ranks.set(comp, m);
    }
    return m.get(id) ?? [0, 1];
  }

  private computeRaw(ctx: FrameCtx, address: string, prop: Prop | undefined, def: PropDef): unknown {
    const tokens = this.doc.tokens;
    if (prop === undefined) return def.default;
    switch (propKind(prop)) {
      case 'static':
        return resolveTokens(def.type, staticValue(prop), tokens);
      case 'keyframes': {
        const kp = asKeyframed(prop);
        const base = sampleKeyframes(def.type, kp.$k, ctx.t, tokens);
        return kp.$expr === undefined ? base : this.runExpr(ctx, address, kp.$expr, base, def);
      }
      case 'expression':
        return this.runExpr(ctx, address, asExpr(prop).$expr, def.default, def);
      case 'link': {
        const target = asLink(prop).$link;
        if (target.startsWith('@')) return resolveTokens(def.type, tokenValue(tokens, target), tokens);
        this.depend(address, target);
        return this.read(ctx, target);
      }
    }
  }

  private depend(from: string, to: string) {
    let s = this.deps.get(from);
    if (!s) this.deps.set(from, (s = new Set()));
    s.add(to);
  }

  private runExpr(ctx: FrameCtx, address: string, src: string, value: unknown, def: PropDef): unknown {
    const { comp } = ctx;
    const tokens = this.doc.tokens;
    const scope: ExprScope = {
      t: ctx.t, frame: ctx.frame, fps: comp.fps, value,
      comp: { width: comp.width, height: comp.height, duration: comp.duration, fps: comp.fps },
      prop: (a: string) => { this.depend(address, a); return this.read(ctx, a); },
      token: (name: string) => tokenValue(tokens, name),
      marker: (q: string) => markerInfo(comp, q),
      audio: (source: string) => this.audioAt(ctx, source),
      events: (source: string) => this.eventsAt(ctx, source),
      ease: (spec: unknown, x: number) => {
        const f = easeFn(spec as any, tokens);
        return f === 'hold' ? (x >= 1 ? 1 : 0) : f(x);
      },
    };
    let v: unknown;
    try {
      v = compileExpr(src)(scope);
    } catch (e) {
      if (e instanceof EvalError) throw e;
      throw new EvalError(address, `expression : ${(e as Error).message}`);
    }
    const bad = checkShape(def, v);
    if (bad) throw new EvalError(address, `the expression returns ${JSON.stringify(v)}: ${bad}`);
    return resolveTokens(def.type, v, tokens);
  }
}

export function markerInfo(comp: Composition, q: string) {
  const m: Marker | undefined = (comp.markers || []).find((x) => x.id === q) ||
    (comp.markers || []).find((x) => x.kind === q) || (comp.markers || []).find((x) => x.label === q);
  if (!m) throw new Error(`marker not found: ${q}`);
  return { t: m.t, frame: Math.round(m.t * comp.fps), label: m.label, kind: m.kind };
}

/** minimal runtime check of an expression's result (the validator checks static values) */
function checkShape(def: PropDef, v: unknown): string | null {
  if (v === null && def.nullable) return null;
  switch (def.type) {
    case 'number': return typeof v === 'number' && Number.isFinite(v) ? null : 'number expected';
    case 'vec2': return Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? null : '[x, y] expected';
    case 'bool': return typeof v === 'boolean' ? null : 'boolean expected';
    case 'color': case 'string': case 'text': case 'enum': case 'asset': case 'comp': case 'layer': return typeof v === 'string' ? null : 'text expected';
    case 'assets': return Array.isArray(v) && v.every((x) => typeof x === 'string') ? null : 'list of asset ids expected';
    default: return null;
  }
}

/** shorthand: eval(doc, t) */
export function evaluate(doc: TrammeDoc, registry: Registry, t: number, compId?: string): EvaluatedFrame {
  return new Evaluator(doc, registry).frame(t, compId);
}
