// The tramme document, version 1. The JSON file is the source of truth:
// everything the editor, the AI and the renderer know lives here.
// Collections of things that can be edited (layers, assets, tokens,
// compositions) are maps keyed by id, so a patch path stays valid while
// other items are added, removed or reordered. Order lives in explicit arrays.

export const SCHEMA_VERSION = 'tramme/1';
/** the same format under the tool's former names (trame, before that emotion); read, then saved as tramme/1 */
export const LEGACY_SCHEMA_VERSIONS = ['trame/1', 'emotion/1'];

/** a document of a former name, brought to today's version (the content is the same) */
export function upgradeDoc<T>(raw: T): T {
  if (raw && typeof raw === 'object' && LEGACY_SCHEMA_VERSIONS.includes((raw as { schema?: string }).schema ?? '')) (raw as unknown as { schema: string }).schema = SCHEMA_VERSION;
  return raw;
}

export type Vec2 = [number, number];

/** cubic-bezier control points, CSS style: [x1, y1, x2, y2] */
export type Bezier = [number, number, number, number];

/** ease of the segment that starts at a keyframe: a preset, a curve, or an ease token ('@swift') */
export type EaseSpec = 'linear' | 'hold' | Bezier | `@${string}`;

export interface Keyframe<T = unknown> {
  /** time in seconds, composition time */
  t: number;
  v: T;
  /** ease towards the next keyframe (default linear) */
  ease?: EaseSpec;
}

/** a modifier of the stack applied after the value is computed (see modifiers.ts) */
export interface ModifierSpec { type: string; [param: string]: unknown }

/**
 * A property is one of:
 *   static      the raw JSON value, or { $v: value, $mod: [...] } when modifiers apply to it
 *   keyframes   { $k: [...] }, optionally with an expression on top ($expr reads it as `value`)
 *   expression  { $expr: 'js' }
 *   link        { $link: 'layerId.prop' | 'layerId.transform.position' | '@token' }
 * Every non-raw form may carry $mod, a stack of modifiers applied in order.
 */
export interface StaticProp<T = unknown> { $v: T; $mod?: ModifierSpec[] }
export interface KeyframedProp<T = unknown> { $k: Keyframe<T>[]; $expr?: string; $mod?: ModifierSpec[] }
export interface ExprProp { $expr: string; $mod?: ModifierSpec[] }
export interface LinkProp { $link: string; $mod?: ModifierSpec[] }
export type Prop<T = unknown> = T | StaticProp<T> | KeyframedProp<T> | ExprProp | LinkProp;

export type TokenType = 'color' | 'number' | 'ease' | 'string' | 'vec2';
export interface Token {
  type: TokenType;
  value: unknown;
  description?: string;
}

export type AssetType = 'image' | 'font' | 'audio' | 'video' | 'module' | 'json';
export interface Asset {
  type: AssetType;
  /** path relative to the document, or an absolute URL path served by the host */
  src: string;
  name?: string;
  /** font: CSS family registered for this file, weight range ('200 800'), style */
  family?: string;
  weight?: string;
  style?: string;
  /** image: region of interest in image pixels [x0, y0, x1, y1], used by fit and focus */
  box?: [number, number, number, number];
}

export interface Transform {
  /** point of the layer's local space placed at `position` (px) */
  anchor?: Prop<Vec2>;
  position?: Prop<Vec2>;
  /** factor, 1 = 100 % */
  scale?: Prop<Vec2>;
  /** degrees, clockwise */
  rotation?: Prop<number>;
  /** 0..1 */
  opacity?: Prop<number>;
  /** px behind the screen (negative: in front), for the composition camera */
  depth?: Prop<number>;
}

/** a 2.5D camera: layers at a depth move with parallax and blur away from the focus */
export interface Camera {
  pan?: Prop<Vec2>;
  zoom?: Prop<number>;
  perspective?: Prop<number>;
  focus?: Prop<number>;
  blur?: Prop<number>;
}

export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'add';

export interface Effect {
  id: string;
  type: string;
  enabled?: boolean;
  props?: Record<string, Prop>;
}

export interface Layer {
  /** node type in the registry: 'shape.rect', 'text', 'image', 'group', 'code', ... */
  type: string;
  name?: string;
  /** visible range in composition time (seconds), in inclusive, out exclusive; defaults to the whole composition */
  in?: number;
  out?: number;
  /** hidden layers are not drawn but can still serve as a clip */
  visible?: boolean;
  locked?: boolean;
  /** id of a layer whose path clips this one (in the same parent space) */
  clip?: string;
  blend?: BlendMode;
  transform?: Transform;
  props?: Record<string, Prop>;
  effects?: Effect[];
  /** container layers only (group): child ids, bottom to top */
  children?: string[];
}

export interface Marker {
  id: string;
  t: number;
  label?: string;
  /** free category; the engine knows 'cut' (motion blur never straddles it) and 'hold' (frozen grain after it) */
  kind?: string;
  duration?: number;
}

export interface MotionBlur {
  /** sub-frames per frame (1 = off) */
  samples: Prop<number>;
  /** shutter as a fraction of the frame duration */
  shutter: Prop<number>;
}

export interface Composition {
  name: string;
  width: number;
  height: number;
  fps: number;
  /** seconds */
  duration: number;
  /** plate under the layers; null for a transparent render */
  background?: Prop<string> | null;
  motionBlur?: MotionBlur;
  /** 2.5D camera; without it, depth does nothing */
  camera?: Camera;
  markers?: Marker[];
  /** finishing effects applied to the whole frame */
  effects?: Effect[];
  layers: Record<string, Layer>;
  /** root stack, bottom to top */
  order: string[];
}

export interface TrammeDoc {
  /** optional link to the JSON Schema, for editors */
  $schema?: string;
  schema: typeof SCHEMA_VERSION;
  meta: { title: string; description?: string; [k: string]: unknown };
  tokens: Record<string, Token>;
  assets: Record<string, Asset>;
  compositions: Record<string, Composition>;
  /** composition rendered by default */
  root: string;
  /**
   * module assets that extend the vocabulary: each exports `nodes` and/or
   * `effects` (arrays of NodeType / EffectType), registered before validation
   */
  plugins?: string[];
}
