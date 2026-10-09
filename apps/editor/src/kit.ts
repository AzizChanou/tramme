// A project's kit: the brief.json (kind "tramme-kit") an agent writes from
// the project's repository, brought in with the sources, a folder at once.
// Its colours and curves become the document's tokens, the fonts it names font
// assets, its about / sources / tone / rules the project's brief; the whole
// file stays among the sources (assets/sources/kit.json), its paths pointing
// at the files as imported, for the assistant to read before it proposes.

import type { Asset, Token, TrammeDoc } from '@tramme/core';
import { inventoryOf, type Brief } from './brief.ts';

export const KIT_PATH = 'assets/sources/kit.json';
/** the font files a kit may name */
export const FONT_FILE = /\.(ttf|otf|woff2?)$/i;

export interface Kit {
  name?: string;
  tokens: Record<string, Token>;
  fonts: { family: string; weights?: number[]; file?: string }[];
  brief: Pick<Brief, 'about' | 'sources' | 'tone' | 'rules'>;
  /** the file as written, for the assistant */
  raw: Record<string, unknown>;
}

const COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter((x): x is string => !!x) : undefined);

/** a token the document takes: a colour, a Bézier curve, a number; null for anything else */
function tokenOf(v: unknown): Token | null {
  const t = v as { type?: unknown; value?: unknown };
  if (!t || typeof t !== 'object') return null;
  if (t.type === 'color' && typeof t.value === 'string' && COLOR.test(t.value)) return { type: 'color', value: t.value.toUpperCase() };
  if (t.type === 'ease' && Array.isArray(t.value) && t.value.length === 4 && t.value.every((n) => typeof n === 'number' && Number.isFinite(n))
    && t.value[0] >= 0 && t.value[0] <= 1 && t.value[2] >= 0 && t.value[2] <= 1) return { type: 'ease', value: t.value as [number, number, number, number] };
  if (t.type === 'number' && typeof t.value === 'number' && Number.isFinite(t.value)) return { type: 'number', value: t.value };
  return null;
}

/** a kit, when the JSON is one (kind "tramme-kit", or a brief with tokens): what of it the document can take */
export function readKit(json: unknown): Kit | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const j = json as Record<string, any>;
  if (j.kind !== 'tramme-kit' && !(j.about && j.tokens)) return null;
  const tokens: Record<string, Token> = {};
  for (const [name, v] of Object.entries(j.tokens ?? {})) {
    const t = /^[A-Za-z0-9_-]{1,64}$/.test(name) ? tokenOf(v) : null;
    if (t) tokens[name] = t;
  }
  const fonts = (Array.isArray(j.fonts) ? j.fonts : []).flatMap((f: any) => {
    const family = str(f?.family);
    if (!family) return [];
    return [{ family, weights: Array.isArray(f.weights) ? f.weights.filter((w: unknown) => typeof w === 'number') : undefined, file: str(f.file) }];
  });
  return {
    name: str(j.project?.name),
    tokens, fonts,
    brief: { about: str(j.about), sources: strs(j.sources), tone: str(j.tone), rules: strs(j.rules) },
    raw: j,
  };
}

/** the ways a file of the folder may be named in the kit: its path and its endings of two parts or more (tramme/assets/a.png, assets/a.png) */
export function namesOf(path: string): string[] {
  const parts = path.replace(/\\/g, '/').replace(/^\.?\/+/, '').split('/').filter(Boolean);
  return parts.slice(0, -1).map((_, i) => parts.slice(i).join('/'));
}

/** every string of a value, the paths of the folder replaced by those of the project (the longest first) */
export function relink<T>(value: T, moved: Map<string, string>): T {
  const from = [...moved.keys()].sort((a, b) => b.length - a.length);
  if (!from.length) return value;
  // one pass: a path already rewritten is never rewritten again
  const re = new RegExp(from.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(re, (old) => moved.get(old)!);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/**
 * The kit put into the document: its tokens (the plate and ink also as the
 * background and text the compositions start from), a font asset for each
 * font whose file came with it. `moved`: the folder's paths, to the project's.
 */
export function applyKit(doc: TrammeDoc, kit: Kit, moved: Map<string, string>) {
  const tokens = { ...kit.tokens };
  if (tokens.plate?.type === 'color') tokens.background = tokens.plate;
  if (tokens.ink?.type === 'color') tokens.text = tokens.ink;
  doc.tokens = { ...doc.tokens, ...tokens };
  for (const f of kit.fonts) {
    const src = f.file ? relink(f.file, moved) : undefined;
    if (!src || !FONT_FILE.test(src) || !src.startsWith('assets/')) continue;
    const id = `font-${f.family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`.slice(0, 64);
    const weights = f.weights?.length ? `${Math.min(...f.weights)} ${Math.max(...f.weights)}` : undefined;
    doc.assets[id] = { type: 'font', src, family: f.family, name: f.family, ...(weights ? { weight: weights } : {}) } satisfies Asset;
  }
  if (kit.name) doc.meta.title = kit.name;
}

/** the project's brief from the kit: the facts of the document, and what the kit says the piece is about */
export function briefOfKit(doc: TrammeDoc, kit: Kit, moved: Map<string, string>): Brief {
  const b = relink(kit.brief, moved);
  return {
    version: 1, kind: 'brief', updated: new Date().toISOString(), ...inventoryOf(doc),
    ...(b.about ? { about: b.about } : {}), ...(b.sources?.length ? { sources: b.sources } : {}),
    ...(b.tone ? { tone: b.tone } : {}), ...(b.rules?.length ? { rules: b.rules } : {}),
  };
}
