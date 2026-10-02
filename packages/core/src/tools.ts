// Authoring tools: what a plugin offers the assistant besides render-time
// nodes. A tool runs at authoring time, in the editor, never during a render:
// it may analyse media, run a model or lay out a whole dressing, and saves
// what it computes as project files the render reads. It changes the document
// only by returning operations, which join the assistant's pending proposal
// (validated, previewed, undoable).

import type { Op } from './ops.ts';
import type { Registry } from './registry.ts';
import type { Transcript } from './transcript.ts';
import type { Token, TrammeDoc } from './types.ts';

/** notes for the assistant on a node, effect, modifier or tool: when to reach for it */
export interface AiNotes {
  /** what it is good for, when to use it */
  when?: string;
  /** misuses, values that look bad */
  avoid?: string;
  /** an example: props, an input, a layer */
  example?: unknown;
}

/** a JSON Schema (draft 2020-12), as tools declare their input */
export type JsonSchema = Record<string, unknown>;

/** what a tool sees and can use while it runs */
export interface ToolContext {
  /** the document as the assistant sees it: the user's, with the pending proposal applied (read only) */
  doc: TrammeDoc;
  /** the composition the user is on */
  compId: string;
  /** the editor's current time (s) */
  time: number;
  /** ids of the selected layers */
  selection: string[];
  /** the document's vocabulary: built-in nodes and its plugins */
  registry: Registry;
  /** absolute URL of an asset's file */
  assetUrl(id: string): string;
  /** a text file of the project, or null when there is none */
  readText(path: string): Promise<string | null>;
  /** writes a file under assets/ (data the tool computed) or a plugin under plugins/ (.js, .mjs) and returns its path; a new file is declared as an asset by the tool's operations */
  writeFile(path: string, data: Blob | string): Promise<string>;
  /** a still of a composition at time t (pending proposal included), as a JPEG data URL */
  renderStill(t: number, compId?: string): Promise<string>;
  /** the transcript of a sound or video asset (made when missing), or of a transcript asset */
  transcript(assetId: string): Promise<Transcript>;
  /** aborted when the user stops the turn: a long analysis should stop too */
  signal: AbortSignal;
}

export interface ToolOutput {
  /** what the tool found or did, for the assistant */
  text?: string;
  /** what the user reads when they run it from the / menu, in their language (text by default) */
  notice?: string;
  /** pictures shown to the assistant and the user (data URLs) */
  images?: { url: string; caption?: string }[];
  /** changes to the document, added to the pending proposal */
  ops?: Op[];
  /** title of those changes (the tool's title by default) */
  label?: string;
  /** assets whose files the tool rewrote: loaded again */
  reload?: string[];
}

export interface ToolType<I = any> {
  /** unique in the project: letters, digits, '_', '-', '.' */
  name: string;
  title?: string;
  /** what it does, for the assistant */
  description: string;
  /** JSON Schema of the input object */
  input?: JsonSchema;
  ai?: AiNotes;
  run(input: I, ctx: ToolContext): ToolOutput | string | void | Promise<ToolOutput | string | void>;
}

/**
 * A workflow: instructions the assistant follows when the user picks it in
 * the chat (/name). It brings know-how rather than a function: the steps,
 * tools and taste for one kind of result.
 */
export interface PromptType {
  /** unique in the project, same rule as tools */
  name: string;
  title?: string;
  /** what it produces, shown in the menu */
  description: string;
  /** the instructions given to the assistant, with what the user wrote after the command */
  prompt: string;
}

/**
 * A style kit: a motion language as design tokens (colours, curves, pace),
 * applied to a document by the kit tool. Recipes and dressings read these
 * tokens, so a film keeps one look. Usual names: plate (background), ink
 * (text), accent, accent2 (colours); enter, exit (curves); pace (seconds of
 * an entrance), stagger (seconds between siblings).
 */
export interface KitType {
  name: string;
  title?: string;
  description: string;
  tokens: Record<string, Token>;
}

export const TOOL_NAME = /^[A-Za-z][\w.-]{0,63}$/;

/** a tool's result in one shape (a string is its text) */
export function toolOutput(r: unknown): ToolOutput {
  if (r === undefined || r === null) return {};
  if (typeof r === 'string') return { text: r };
  if (typeof r !== 'object') return { text: String(r) };
  const o = r as Record<string, unknown>;
  const out: ToolOutput = {};
  if (typeof o.text === 'string') out.text = o.text;
  if (typeof o.notice === 'string') out.notice = o.notice;
  if (typeof o.label === 'string') out.label = o.label;
  if (Array.isArray(o.ops)) out.ops = o.ops as Op[];
  if (Array.isArray(o.reload)) out.reload = o.reload.filter((x): x is string => typeof x === 'string');
  if (Array.isArray(o.images)) {
    out.images = o.images
      .filter((i): i is { url: string; caption?: unknown } => !!i && typeof (i as { url?: unknown }).url === 'string')
      .map((i) => ({ url: i.url, ...(typeof i.caption === 'string' ? { caption: i.caption } : {}) }));
  }
  return out;
}

const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const fits = (v: unknown, type: string) => { const t = typeOf(v); return t === type || (type === 'number' && t === 'integer'); };

/**
 * What is wrong with an input, against the tool's schema: required keys,
 * types, enums and number bounds of the top-level properties. Deeper checks
 * are the tool's own business.
 */
export function toolInputIssues(schema: JsonSchema | undefined, input: unknown): string[] {
  if (typeOf(input) !== 'object') return ['the input must be an object'];
  if (!schema) return [];
  const value = input as Record<string, unknown>;
  const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const issues: string[] = [];
  for (const k of (schema.required ?? []) as string[]) if (value[k] === undefined) issues.push(`${k}: required`);
  for (const [k, v] of Object.entries(value)) {
    const p = props[k];
    if (!p) { if (schema.additionalProperties === false) issues.push(`${k}: unknown`); continue; }
    if (v === undefined) continue;
    const types = p.type === undefined ? [] : Array.isArray(p.type) ? (p.type as string[]) : [p.type as string];
    if (types.length && !types.some((t) => fits(v, t))) { issues.push(`${k}: ${types.join(' or ')} expected`); continue; }
    if (Array.isArray(p.enum) && !p.enum.includes(v)) issues.push(`${k}: one of ${p.enum.map((e) => JSON.stringify(e)).join(', ')}`);
    if (typeof v === 'number') {
      if (typeof p.minimum === 'number' && v < p.minimum) issues.push(`${k}: at least ${p.minimum}`);
      if (typeof p.maximum === 'number' && v > p.maximum) issues.push(`${k}: at most ${p.maximum}`);
    }
  }
  return issues;
}
