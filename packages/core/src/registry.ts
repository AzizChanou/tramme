// The open vocabulary: every layer type is a node plugin that declares the
// schema of its properties and how to draw itself. The editor's inspector is
// generated from these schemas, the validator checks documents against them,
// and the evaluator fills in their defaults. Effects follow the same shape.
// Plugins may also bring authoring tools for the assistant (tools.ts).

import type { Asset, Layer, Vec2 } from './types.ts';
import { BUILTIN_MODIFIERS, type ModifierType } from './modifiers.ts';
import { TOOL_NAME, type AiNotes, type KitType, type PromptType, type ToolType } from './tools.ts';
import type { CheckType } from './checks.ts';

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
  | 'layer'        // id of another layer of the composition (mattes, displacement)
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
  /**
   * draw another layer of the composition at this instant, alone, as it
   * appears in the frame (its transform, effects and parents), even when it
   * is hidden: the context is in frame pixels (layer inputs of effects)
   */
  drawLayer?(ctx: CanvasRenderingContext2D, layerId: string): void;
  /** another layer of the composition at this instant: its evaluated props and transform (in its parent's space), or null */
  layer?(layerId: string): { props: Record<string, unknown>; transform: { anchor: Vec2; position: Vec2; scale: Vec2; rotation: number; opacity: number } } | null;
  /** the state of this layer's simulation at this frame (nodes with `simulate`) */
  state?<T = unknown>(): T;
}

export interface NodeType<P = any> {
  type: string;
  title: string;
  category: string;
  description?: string;
  /** notes for the assistant */
  ai?: AiNotes;
  props: PropSchema;
  /** accepts children (rendered in the node's local space) */
  container?: boolean;
  /** once per layer, before the first frame; props evaluated at the layer's in point */
  load?(props: P, host: Host): Promise<void> | void;
  /** outline of the layer in local space: makes it usable as a clip, and selectable in the viewport */
  path?(props: P, host: Host): Path2D | null;
  /**
   * A simulation: a state carried from frame to frame (springs, ropes,
   * flocks, trails), computed in order from the layer's in point at the
   * composition's frame rate, so any frame can be rendered in any order and
   * always gives the same picture. `init` gives the state at the in point,
   * `step` the next one from the previous: a new object, never the given one
   * changed (earlier states are kept). Rendering reads it with host.state().
   */
  simulate?: { init(props: P, host: Host): unknown; step(state: any, props: P, dt: number, host: Host): unknown };
  bounds?(props: P, host: Host): Rect | null;
  /**
   * Points the viewport lets the user drag, in the layer's local space, each
   * editing one property: 'point' sets a vec2 property to the point; 'distance'
   * sets a number property to the distance from `from` (the origin by
   * default), times `factor`.
   */
  handles?(props: P): Handle[];
  /** how the node goes into vector exports, where code cannot run: SVG markup in local space, Lottie shape items (static) */
  export?: { svg?(props: P): string; lottie?(props: P): unknown[] };
  render: {
    canvas2d?(ctx: CanvasRenderingContext2D, props: P, host: Host): void;
  };
}

export interface Handle {
  prop: string;
  at: Vec2;
  kind?: 'point' | 'distance';
  from?: Vec2;
  factor?: number;
}

/** a ready-made layer offered in the add menu: a node with its props, effects and transform */
export interface PresetType {
  name: string;
  title?: string;
  /** the add menu's section */
  category?: string;
  description?: string;
  /** the layer to add (centred in the composition when it has no position); its children are not supported */
  layer: Omit<Layer, 'children'>;
}

export interface EffectType<P = any> {
  type: string;
  title: string;
  category: string;
  description?: string;
  /** notes for the assistant */
  ai?: AiNotes;
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
    apply?(ctx: CanvasRenderingContext2D, props: P, scale: number, host: Host): void;
  };
  /**
   * The effect as a GLSL pass: `code` defines vec4 effect(vec2 uv), reading
   * uImage (premultiplied), uRes, uTime and u_<prop> for each property
   * (float, vec2, vec4 colour, sampler2D for a layer prop). On a layer, it
   * runs on the layer drawn alone (sRGB); as a finishing effect, on the
   * composed frame in linear light, before the glow and the grain.
   */
  gl?: { code: string };
}

/** a tool and who brought it ('tramme', or a plugin's id) */
export interface ToolEntry { tool: ToolType; from: string }

/** the version of the plugin API of this tramme: a plugin declaring a higher one is refused */
export const PLUGIN_API = 1;

/** a plugin's card: who it is and the API it was written for */
export interface PluginMeta {
  name?: string;
  version?: string;
  description?: string;
  /** the plugin API it needs (1 by default) */
  api?: number;
}

/** what a plugin module may export to extend the vocabulary */
export interface PluginModule {
  meta?: PluginMeta;
  nodes?: NodeType[];
  effects?: EffectType[];
  modifiers?: ModifierType[];
  tools?: ToolType[];
  prompts?: PromptType[];
  checks?: CheckType[];
  kits?: KitType[];
  presets?: PresetType[];
}

export class Registry {
  private nodes = new Map<string, NodeType>();
  private effects = new Map<string, EffectType>();
  private modifiers = new Map<string, ModifierType>(BUILTIN_MODIFIERS.map((m) => [m.type, m]));
  private tools = new Map<string, ToolEntry>();
  private prompts = new Map<string, { prompt: PromptType; from: string }>();
  private checks = new Map<string, { check: CheckType; from: string }>();
  private kits = new Map<string, { kit: KitType; from: string }>();
  private presets = new Map<string, { preset: PresetType; from: string }>();

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
  registerTool(...tools: ToolType[]): this {
    for (const t of tools) {
      if (this.tools.has(t.name)) throw new Error(`tool already registered: ${t.name}`);
      this.tools.set(t.name, { tool: t, from: 'tramme' });
    }
    return this;
  }
  hasTool(name: string) { return this.tools.has(name); }
  tool(name: string): ToolEntry {
    const t = this.tools.get(name);
    if (!t) throw new Error(`unknown tool: ${name}`);
    return t;
  }
  listTools() { return [...this.tools.values()]; }
  registerPrompt(...prompts: PromptType[]): this {
    for (const p of prompts) {
      if (this.prompts.has(p.name)) throw new Error(`workflow already registered: ${p.name}`);
      this.prompts.set(p.name, { prompt: p, from: 'tramme' });
    }
    return this;
  }
  /** the workflows offered in the chat (/name), and who brought them */
  listPrompts() { return [...this.prompts.values()]; }
  registerCheck(...checks: CheckType[]): this {
    for (const c of checks) {
      if (this.checks.has(c.name)) throw new Error(`check already registered: ${c.name}`);
      this.checks.set(c.name, { check: c, from: 'tramme' });
    }
    return this;
  }
  /** the quality checks, and who brought them */
  listChecks() { return [...this.checks.values()]; }
  registerKit(...kits: KitType[]): this {
    for (const k of kits) {
      if (this.kits.has(k.name)) throw new Error(`kit already registered: ${k.name}`);
      this.kits.set(k.name, { kit: k, from: 'tramme' });
    }
    return this;
  }
  /** the style kits, and who brought them */
  listKits() { return [...this.kits.values()]; }
  registerPreset(...presets: PresetType[]): this {
    for (const p of presets) {
      if (this.presets.has(p.name)) throw new Error(`preset already registered: ${p.name}`);
      this.presets.set(p.name, { preset: p, from: 'tramme' });
    }
    return this;
  }
  /** the ready-made layers of the add menu, and who brought them */
  listPresets() { return [...this.presets.values()]; }
  /** a copy that can take more plugins without touching this one */
  clone(): Registry {
    const r = new Registry();
    for (const n of this.nodes.values()) r.nodes.set(n.type, n);
    for (const e of this.effects.values()) r.effects.set(e.type, e);
    for (const m of this.modifiers.values()) r.modifiers.set(m.type, m);
    for (const [k, t] of this.tools) r.tools.set(k, t);
    for (const [k, p] of this.prompts) r.prompts.set(k, p);
    for (const [k, c] of this.checks) r.checks.set(k, c);
    for (const [k, c] of this.kits) r.kits.set(k, c);
    for (const [k, p] of this.presets) r.presets.set(k, p);
    return r;
  }
  /** register what a plugin module exports (`nodes`, `effects`, `modifiers`, `tools`, `prompts`, `checks`, `kits`, `presets`); a plugin may replace its own earlier version */
  use(mod: PluginModule, from: string): this {
    const api = mod.meta?.api ?? 1;
    if (typeof api !== 'number' || api > PLUGIN_API) throw new Error(`plugin ${from}${mod.meta?.name ? ` (${mod.meta.name})` : ''} needs the plugin API ${api}; this tramme has ${PLUGIN_API}: update tramme`);
    for (const n of mod.nodes || []) {
      if (!n || typeof n.type !== 'string' || !n.props || !n.render) throw new Error(`plugin ${from}: malformed node`);
      this.nodes.set(n.type, n);
    }
    for (const e of mod.effects || []) this.effects.set(e.type, e);
    for (const m of mod.modifiers || []) {
      if (!m || typeof m.apply !== 'function') throw new Error(`plugin ${from}: malformed modifier`);
      this.modifiers.set(m.type, m);
    }
    for (const t of mod.tools || []) {
      if (!t || typeof t.name !== 'string' || !TOOL_NAME.test(t.name) || typeof t.run !== 'function' || typeof t.description !== 'string') throw new Error(`plugin ${from}: malformed tool${t && typeof t.name === 'string' ? ` "${t.name}"` : ''}`);
      this.tools.set(t.name, { tool: t, from });
    }
    for (const p of mod.prompts || []) {
      if (!p || typeof p.name !== 'string' || !TOOL_NAME.test(p.name) || typeof p.prompt !== 'string' || typeof p.description !== 'string') throw new Error(`plugin ${from}: malformed workflow${p && typeof p.name === 'string' ? ` "${p.name}"` : ''}`);
      this.prompts.set(p.name, { prompt: p, from });
    }
    for (const c of mod.checks || []) {
      if (!c || typeof c.name !== 'string' || !TOOL_NAME.test(c.name) || typeof c.run !== 'function') throw new Error(`plugin ${from}: malformed check${c && typeof c.name === 'string' ? ` "${c.name}"` : ''}`);
      this.checks.set(c.name, { check: c, from });
    }
    for (const k of mod.kits || []) {
      if (!k || typeof k.name !== 'string' || !TOOL_NAME.test(k.name) || !k.tokens || typeof k.tokens !== 'object') throw new Error(`plugin ${from}: malformed kit${k && typeof k.name === 'string' ? ` "${k.name}"` : ''}`);
      this.kits.set(k.name, { kit: k, from });
    }
    for (const p of mod.presets || []) {
      if (!p || typeof p.name !== 'string' || !TOOL_NAME.test(p.name) || !p.layer || typeof p.layer.type !== 'string') throw new Error(`plugin ${from}: malformed preset${p && typeof p.name === 'string' ? ` "${p.name}"` : ''}`);
      this.presets.set(p.name, { preset: p, from });
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
  depth: { type: 'number', default: 0, label: 'Depth', unit: 'px', step: 10, description: 'behind the screen when positive, in front when negative: parallax and depth blur with the composition camera' },
};

/** schema of the composition camera (2.5D): what it looks at, its zoom, and the depth blur */
export const CAMERA_SCHEMA: PropSchema = {
  pan: { type: 'vec2', default: [0, 0], label: 'Pan', unit: 'px', description: 'the camera moves from the centre of the composition' },
  zoom: { type: 'number', default: 1, label: 'Zoom', min: 0.05, step: 0.01, unit: 'x' },
  perspective: { type: 'number', default: 1000, label: 'Perspective', min: 50, step: 10, unit: 'px', description: 'distance of the eye: shorter gives stronger parallax' },
  focus: { type: 'number', default: 0, label: 'Focus', step: 10, unit: 'px', description: 'the depth that stays sharp' },
  blur: { type: 'number', default: 0, label: 'Depth blur', min: 0, step: 0.5, unit: 'px', description: 'blur of a layer 1000 px away from the focus' },
};

/** schema of the composition-level animatable settings */
export const MOTION_BLUR_SCHEMA: PropSchema = {
  samples: { type: 'number', default: 1, label: 'Sub-frames', min: 1, max: 64, step: 1 },
  shutter: { type: 'number', default: 0.5, label: 'Shutter', min: 0, max: 1, step: 0.05 },
};
