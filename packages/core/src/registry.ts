// The open vocabulary: every layer type is a node plugin that declares the
// schema of its properties and how to draw itself. The editor's inspector is
// generated from these schemas, the validator checks documents against them,
// and the evaluator fills in their defaults. Effects follow the same shape.

import type { Asset, Vec2 } from './types.ts';
import { BUILTIN_MODIFIERS, type ModifierType } from './modifiers.ts';

export type PropType =
  | 'number' | 'vec2' | 'bool'
  | 'color'        // CSS colour or '@token'
  | 'paint'        // colour, gradient or null
  | 'enum' | 'string' | 'text'
  | 'ease'         // EaseSpec
  | 'path'         // PathValue
  | 'asset'        // asset id
  | 'assets'       // ordered list of asset ids (the drawings of a sequence)
  | 'comp'         // composition id (nested compositions)
  | 'json';        // free value, not interpolated

export interface PropDef {
  type: PropType;
  default: unknown;
  label?: string;
  /** inspector section */
  group?: string;
  description?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: 'px' | 'deg' | '%' | 'em' | 's' | 'x' | 'dB';
  /** enum values */
  options?: readonly string[];
  /** asset props: accepted asset type */
  assetType?: string;
  /** false: static only (no keyframes, expression or link) */
  animatable?: boolean;
  /** null accepted as a value (paint: no fill) */
  nullable?: boolean;
  /** text props: edited as code (monospace) */
  format?: 'code';
}

export type PropSchema = Record<string, PropDef>;

export type Paint =
  | string
  | { type: 'linear'; from: Vec2; to: Vec2; stops: [number, string][] }
  | { type: 'radial'; center: Vec2; radius: number; stops: [number, string][] }
  | null;

/** a path as in Lottie: vertices, in and out tangents relative to each vertex (optional: straight lines) */
export interface PathValue {
  v: Vec2[];
  i?: Vec2[];
  o?: Vec2[];
  closed?: boolean;
}

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * A video asset as the renderer loads it: frames are decoded on demand, so a
 * frame may not be ready when a layer draws. frameAt gives the nearest frame
 * already decoded (exact or not); request decodes the exact one.
 */
export interface VideoAsset {
  width: number;
  height: number;
  /** seconds */
  duration: number;
  hasAudio: boolean;
  frameAt(t: number): { image: CanvasImageSource | null; exact: boolean };
  request(t: number): Promise<void>;
}

/** what a node sees while it loads or draws */
export interface Host {
  layerId: string;
  /** in point of the layer (composition time, s) */
  layerIn?: number;
  /** composition time (s), frame index at the composition rate */
  t: number;
  frame: number;
  fps: number;
  width: number;
  height: number;
  duration: number;
  /** the loaded resource of an asset: HTMLImageElement / ImageBitmap, module namespace, JSON, FontFace family */
  asset<T = unknown>(id: string): T;
  /** the asset's entry in the document (type, src, box...) */
  assetInfo(id: string): Asset;
  /** URL of an asset file, resolved against the document */
  assetUrl(id: string): string;
  /**
   * Something this frame needs is still loading (a video frame being decoded):
   * the picture is drawn with what is there, and drawn again once it has
   * arrived. Exports wait for it; the preview redraws.
   */
  defer?(pending: Promise<unknown>): void;
  /** draw another composition of the document at its local time t, from (0, 0) (nested compositions) */
  drawComposition?(ctx: CanvasRenderingContext2D, compId: string, t: number): void;
  /** size and duration of a composition of the document */
  compositionSize?(compId: string): { width: number; height: number; duration: number } | null;
}

export interface NodeType<P = any> {
  type: string;
  title: string;
  category: string;
  description?: string;
  props: PropSchema;
  /** accepts children (rendered in the node's local space) */
  container?: boolean;
  /** once per layer, before the first frame; props evaluated at the layer's in point */
  load?(props: P, host: Host): Promise<void> | void;
  /** outline of the layer in local space: makes it usable as a clip, and selectable in the viewport */
  path?(props: P, host: Host): Path2D | null;
  bounds?(props: P, host: Host): Rect | null;
  render: {
    canvas2d?(ctx: CanvasRenderingContext2D, props: P, host: Host): void;
  };
}

export interface EffectType<P = any> {
  type: string;
  title: string;
  category: string;
  description?: string;
  props: PropSchema;
  /** 'finish': applied once to the whole composed frame (compositor); 'layer': to one layer */
  stage: 'finish' | 'layer';
  /**
   * Layer effects on Canvas2D: the layer is drawn alone on a transparent
   * canvas of the frame's size; apply() may change those pixels, then the
   * canvas is composited with the CSS filter() returns (blur, drop-shadow...).
   * Sizes are in frame pixels.
   */
  canvas2d?: {
    /** scale: canvas pixels per composition pixel (sizes in props are composition pixels) */
    filter?(props: P, scale: number): string;
    apply?(ctx: CanvasRenderingContext2D, props: P, scale: number): void;
  };
}

export class Registry {
  private nodes = new Map<string, NodeType>();
  private effects = new Map<string, EffectType>();
  private modifiers = new Map<string, ModifierType>(BUILTIN_MODIFIERS.map((m) => [m.type, m]));

  register(...nodes: NodeType[]): this {
    for (const n of nodes) {
      if (this.nodes.has(n.type)) throw new Error(`node already registered: ${n.type}`);
      if ('transform' in n.props) throw new Error(`${n.type}: "transform" is reserved for the engine`);
      this.nodes.set(n.type, n);
    }
    return this;
  }
  registerEffect(...effects: EffectType[]): this {
    for (const e of effects) {
      if (this.effects.has(e.type)) throw new Error(`effect already registered: ${e.type}`);
      this.effects.set(e.type, e);
    }
    return this;
  }
  registerModifier(...mods: ModifierType[]): this {
    for (const m of mods) this.modifiers.set(m.type, m);
    return this;
  }
  hasModifier(type: string) { return this.modifiers.has(type); }
  modifier(type: string): ModifierType {
    const m = this.modifiers.get(type);
    if (!m) throw new Error(`unknown modifier: ${type}`);
    return m;
  }
  listModifiers() { return [...this.modifiers.values()]; }
  hasNode(type: string) { return this.nodes.has(type); }
  node(type: string): NodeType {
    const n = this.nodes.get(type);
    if (!n) throw new Error(`unknown node type: ${type}`);
    return n;
  }
  hasEffect(type: string) { return this.effects.has(type); }
  effect(type: string): EffectType {
    const e = this.effects.get(type);
    if (!e) throw new Error(`unknown effect type: ${type}`);
    return e;
  }
  listNodes() { return [...this.nodes.values()]; }
  /** a copy that can take more plugins without touching this one */
  clone(): Registry {
    const r = new Registry();
    for (const n of this.nodes.values()) r.nodes.set(n.type, n);
    for (const e of this.effects.values()) r.effects.set(e.type, e);
    for (const m of this.modifiers.values()) r.modifiers.set(m.type, m);
    return r;
  }
  /** register what a plugin module exports (`nodes`, `effects`); a plugin may replace its own earlier version */
  use(mod: { nodes?: NodeType[]; effects?: EffectType[]; modifiers?: ModifierType[] }, from: string): this {
    for (const n of mod.nodes || []) {
      if (!n || typeof n.type !== 'string' || !n.props || !n.render) throw new Error(`plugin ${from}: malformed node`);
      this.nodes.set(n.type, n);
    }
    for (const e of mod.effects || []) this.effects.set(e.type, e);
    for (const m of mod.modifiers || []) {
      if (!m || typeof m.apply !== 'function') throw new Error(`plugin ${from}: malformed modifier`);
      this.modifiers.set(m.type, m);
    }
    return this;
  }
  listEffects() { return [...this.effects.values()]; }
}

/** schema of the transform shared by every layer (handled by the engine, not the nodes) */
export const TRANSFORM_SCHEMA: PropSchema = {
  anchor: { type: 'vec2', default: [0, 0], label: 'Anchor', unit: 'px' },
  position: { type: 'vec2', default: [0, 0], label: 'Position', unit: 'px' },
  scale: { type: 'vec2', default: [1, 1], label: 'Scale', unit: 'x', step: 0.01 },
  rotation: { type: 'number', default: 0, label: 'Rotation', unit: 'deg' },
  opacity: { type: 'number', default: 1, label: 'Opacity', min: 0, max: 1, step: 0.01 },
};

/** schema of the composition-level animatable settings */
export const MOTION_BLUR_SCHEMA: PropSchema = {
  samples: { type: 'number', default: 1, label: 'Sub-frames', min: 1, max: 64, step: 1 },
  shutter: { type: 'number', default: 0.5, label: 'Shutter', min: 0, max: 1, step: 0.05 },
};
