// The project's brief: what this project is, in a file the assistant reads
// before it works (assets/brief.json, also an asset record of the document).
// The tool writes the facts from the document (format, palette, type, motion,
// sound) and keeps the tone and the rules that the assistant and the user set;
// the brief wins over the assistant's defaults.

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
  tone?: string;
  rules?: string[];
}
export const isBrief = (x: unknown): x is Brief => !!x && typeof x === 'object' && (x as Brief).kind === 'brief';

/** the facts of a document, for the brief */
export function inventoryOf(doc: TrammeDoc): Omit<Brief, 'version' | 'kind' | 'updated' | 'tone' | 'rules'> {
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

const brief: ToolType<{ tone?: string; rules?: string[] }> = {
  name: 'brief', title: 'Project brief', description: 'writes the brief of the project (assets/brief.json): the facts of the document, the tone and the rules kept; the assistant follows it over its defaults',
  input: {
    type: 'object',
    properties: {
      tone: { type: 'string', title: 'Tone', description: 'two or three lines on the character of the piece; given, it replaces the one kept' },
      rules: { type: 'array', items: { type: 'string' }, title: 'Rules', description: 'the do and don\'t of this project; given, they replace the ones kept' },
    },
  },
  ai: { when: 'when a project starts to have a style of its own (after the first accepted proposal, after a kit), and whenever the user says a rule or a tone worth keeping; refresh it after big style decisions and keep it true from then on', avoid: 'rewriting the tone and rules the user set without asking; a brief that drifts from the document' },
  async run({ tone, rules }, ctx) {
    const prevRaw = await ctx.readText(BRIEF_PATH).catch(() => null);
    let prev: Brief | null = null;
    try { const p = JSON.parse(prevRaw ?? 'null'); if (isBrief(p)) prev = p; } catch { /* no brief yet */ }
    const written: Brief = {
      version: 1, kind: 'brief', updated: new Date().toISOString(),
      ...inventoryOf(ctx.doc),
      ...(tone ?? prev?.tone ? { tone: tone ?? prev?.tone } : {}),
      ...(rules ?? prev?.rules ? { rules: rules ?? prev?.rules } : {}),
    };
    const path = await ctx.writeFile(BRIEF_PATH, JSON.stringify(written, null, 1));
    const value = { type: 'json' as const, src: path };
    const op: Op = ctx.doc.assets.brief ? { op: 'replace', path: pointer('assets', 'brief'), value } : { op: 'add', path: pointer('assets', 'brief'), value };
    return {
      ops: [op], label: t('brief.written'),
      text: `The brief is at ${BRIEF_PATH}${prev ? ' (the tone and the rules are kept)' : ''}:\n${JSON.stringify(written, null, 1)}\nRead it: set its "tone" (two or three lines, the character of the piece) and its "rules" (the do and don't of this project, 3 to 8 lines) with another call when they are not set yet, and keep them true from then on. The brief wins over your defaults.`,
    };
  },
};

export const BRIEF_TOOLS: ToolType[] = [brief];
