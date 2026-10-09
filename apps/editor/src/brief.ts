// The project's brief: what this project is, in a file the assistant reads
// before it works (assets/brief.json, also an asset record of the document).
// The tool writes the facts from the document (format, palette, type, motion,
// sound) and keeps what the assistant and the user set: what the piece is
// about (learned from the sources), what each source is good for, the tone and
// the rules; the brief wins over the assistant's defaults.

import { pointer, type Op, type ToolType, type TrammeDoc } from '@tramme/core';
import { t } from './i18n/index.ts';

export const BRIEF_PATH = 'assets/brief.json';

export interface Brief {
  version: 1;
  kind: 'brief';
  updated: string;
  format: string;
  look: Record<string, unknown>;
  motion: Record<string, unknown>;
  sound: Record<string, unknown>;
  /** the compositions other than the main one, when there are any */
  compositions?: number;
  /** what the piece is about: subject, audience, purpose, key messages and facts (from the sources and the user) */
  about?: string;
  /** one line per source: what it is and what it is good for in the video */
  sources?: string[];
  tone?: string;
  rules?: string[];
}
export const isBrief = (x: unknown): x is Brief => !!x && typeof x === 'object' && (x as Brief).kind === 'brief';

/** the facts of a document, for the brief */
export function inventoryOf(doc: TrammeDoc): Omit<Brief, 'version' | 'kind' | 'updated' | 'about' | 'sources' | 'tone' | 'rules'> {
  const comp = doc.compositions[doc.root];
  const palette: Record<string, string> = {}, curves: Record<string, unknown> = {}, pace: Record<string, number> = {};
  for (const [n, tok] of Object.entries(doc.tokens ?? {})) {
    if (tok.type === 'color') palette[n] = String(tok.value);
    else if (tok.type === 'ease') curves[n] = tok.value;
    else if (tok.type === 'number' && (n === 'pace' || n === 'stagger')) pace[n] = Number(tok.value);
  }
  const fonts = Object.entries(doc.assets).filter(([, a]) => a.type === 'font').map(([, a]) => String((a as { family?: string }).family ?? ''));
  const sounds = Object.entries(doc.assets).filter(([, a]) => a.type === 'audio').map(([id]) => id);
  const others = Object.keys(doc.compositions).filter((id) => id !== doc.root).length;
  return {
    format: `${comp.width}x${comp.height} ${comp.height > comp.width ? 'vertical' : comp.width > comp.height ? 'horizontal' : 'square'}, ${comp.fps} fps, ${+comp.duration.toFixed(2)} s`,
    look: { palette, ...(fonts.length ? { fonts } : {}) },
    motion: { ...(Object.keys(curves).length ? { curves } : {}), ...(Object.keys(pace).length ? { pace } : {}) },
    sound: sounds.length ? { assets: sounds } : {},
    ...(others ? { compositions: others } : {}),
  };
}

/** what the user and the assistant set, kept from one writing to the next */
const KEPT = ['about', 'sources', 'tone', 'rules'] as const;

const brief: ToolType<{ about?: string; sources?: string[]; tone?: string; rules?: string[] }> = {
  name: 'brief', title: 'Project brief', description: 'writes the brief of the project (assets/brief.json): the facts of the document, and what the piece is about, its sources, the tone and the rules kept; the assistant follows it over its defaults',
  input: {
    type: 'object',
    properties: {
      about: { type: 'string', title: 'About', description: 'what the piece is about: subject, audience, purpose, key messages, the facts and figures it must get right; given, it replaces the one kept' },
      sources: { type: 'array', items: { type: 'string' }, title: 'Sources', description: 'one line per source (its ref first): what it is and what it is good for in the video; given, they replace the ones kept' },
      tone: { type: 'string', title: 'Tone', description: 'two or three lines on the character of the piece; given, it replaces the one kept' },
      rules: { type: 'array', items: { type: 'string' }, title: 'Rules', description: 'the do and don\'t of this project; given, they replace the ones kept' },
    },
  },
  ai: { when: 'after reading the sources of a project (about, sources), when a project starts to have a style of its own (after the first accepted proposal, after a kit), and whenever the user says a rule or a tone worth keeping; refresh it after big style decisions and keep it true from then on', avoid: 'rewriting the tone and rules the user set without asking; a brief that drifts from the document or the sources' },
  async run(input, ctx) {
    const prevRaw = await ctx.readText(BRIEF_PATH).catch(() => null);
    let prev: Brief | null = null;
    try { const p = JSON.parse(prevRaw ?? 'null'); if (isBrief(p)) prev = p; } catch { /* no brief yet */ }
    const written: Brief = { version: 1, kind: 'brief', updated: new Date().toISOString(), ...inventoryOf(ctx.doc) };
    for (const k of KEPT) {
      const v = input[k] ?? prev?.[k];
      if (v !== undefined) (written as unknown as Record<string, unknown>)[k] = v;
    }
    const path = await ctx.writeFile(BRIEF_PATH, JSON.stringify(written, null, 1));
    const value = { type: 'json' as const, src: path };
    const op: Op = ctx.doc.assets.brief ? { op: 'replace', path: pointer('assets', 'brief'), value } : { op: 'add', path: pointer('assets', 'brief'), value };
    return {
      ops: [op], label: t('brief.written'),
      text: `The brief is at ${BRIEF_PATH}${prev ? ' (what was set before and not given now is kept)' : ''}:\n${JSON.stringify(written, null, 1)}\nRead it: set its "tone" (two or three lines, the character of the piece) and its "rules" (the do and don't of this project, 3 to 8 lines) with another call when they are not set yet, and keep them true from then on. The brief wins over your defaults.`,
    };
  },
};

export const BRIEF_TOOLS: ToolType[] = [brief];
