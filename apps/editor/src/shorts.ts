// A long video cut into shorts: the transcript grouped into passages that
// stand alone (candidates), the passages the assistant picks built into one
// composition per short — the video framed to fill the format, the transcript
// remapped to the short and captioned, a title with its bar. Every short is
// an ordinary composition: editable, checked, exported like any other
// (docs/shorts-roadmap.md).

import { applyOps, isTranscript, pointer, remapTranscript, transcriptIdOf, type Composition, type Layer, type Op, type ToolContext, type ToolType, type Transcript, type TrammeDoc } from '@tramme/core';
import { TEMPLATES } from './templates.ts';
import { clip, freshId, slug } from './model.ts';
import { t } from './i18n/index.ts';

const FORMATS = { vertical: [1080, 1920], square: [1080, 1080], horizontal: [1920, 1080] } as const;
type Format = keyof typeof FORMATS;

/** the transcript of a video asset of the project (it must exist: get_transcript makes it) */
async function transcriptOf(ctx: ToolContext, assetId: string): Promise<{ t: Transcript; id: string }> {
  const id = transcriptIdOf(assetId);
  if (!ctx.doc.assets[id]) throw new Error(`no transcript for "${assetId}": make one first (get_transcript), or open the project from the video`);
  const t = await ctx.transcript(id);
  if (!isTranscript(t)) throw new Error(`${id} is not a transcript`);
  return { t, id };
}

// ── candidates ───────────────────────────────────────────────
export interface Candidate {
  /** file time (s), a little air included on both sides */
  from: number;
  to: number;
  /** what is said, the words joined */
  text: string;
  words: number;
}

/** the transcript grouped into passages that stand alone: sentences packed between min and max, cut on pauses and sentence ends */
export function candidatesOf(t: Transcript, { min = 15, max = 45, air = 0.4 }: { min?: number; max?: number; air?: number } = {}): Candidate[] {
  const sentences: { s: number; e: number; text: string; n: number }[] = [];
  let cur: Transcript['words'] = [];
  const flush = () => {
    if (!cur.length) return;
    sentences.push({ s: cur[0].s, e: cur[cur.length - 1].e, text: cur.map((w) => w.w).join(' '), n: cur.length });
    cur = [];
  };
  t.words.forEach((w, i) => {
    if (cur.length && w.s - t.words[i - 1].e > 0.6) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.w)) flush();
  });
  flush();
  const out: Candidate[] = [];
  let group: typeof sentences = [];
  const push = () => {
    if (!group.length) return;
    out.push({ from: Math.max(0, group[0].s - air), to: group[group.length - 1].e + air, text: group.map((s) => s.text).join(' '), words: group.reduce((a, s) => a + s.n, 0) });
    group = [];
  };
  for (const s of sentences) {
    // a long pause ends the passage: dead air is not what a short is made of
    if (group.length && (s.s - group[group.length - 1].e > 2 || s.e - group[0].s + (s.e - s.s) > max)) push();
    group.push(s);
    if (s.e - group[0].s >= min) push();
  }
  push();
  return out;
}

// ── build ────────────────────────────────────────────────────
interface PlanItem { from: number; to: number; title?: string }
interface Made { comp: string; title: string; duration: number }

/** one composition per passage: the video filling the frame, the transcript remapped and captioned, the title on top */
async function build(ctx: ToolContext, assetId: string, plan: PlanItem[], format: Format): Promise<{ ops: Op[]; made: Made[] }> {
  const { t: src } = await transcriptOf(ctx, assetId);
  const [w, h] = FORMATS[format];
  const fps = ctx.doc.compositions[ctx.compId]?.fps ?? 30;
  const tid = transcriptIdOf(assetId);
  const taken: Record<string, unknown> = { ...ctx.doc.compositions };
  const ops: Op[] = [], made: Made[] = [];
  let doc: TrammeDoc = ctx.doc;
  for (let n = 1; n <= plan.length; n++) {
    const { from, to, title } = plan[n - 1];
    const lo = Math.max(0, Number(from) || 0), hi = Math.min(src.duration, Number(to) || 0), dur = hi - lo;
    if (!(dur >= 2)) continue;
    const cs = (title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    const cid = freshId(taken, `short-${cs || n}`);
    taken[cid] = 1;
    const name = title ?? `Short ${n}`;
    const vid = freshId({ footage: 1 }, 'footage');
    const video: Layer = { type: 'video', name, in: 0, out: +dur.toFixed(3), transform: { position: [w / 2, h / 2] }, props: { video: assetId, start: +lo.toFixed(3), size: [w, h], fit: 'cover' } };
    const comp: Composition = { name, width: w, height: h, fps, duration: +dur.toFixed(3), layers: { [vid]: video }, order: [vid] };
    ops.push({ op: 'add', path: pointer('compositions', cid), value: comp });
    // the transcript of the passage, composition time: the captions read it
    const remapped = remapTranscript(src, [{ from: lo, to: hi }], 0);
    const path = await ctx.writeFile(`assets/transcripts/${slug(`${assetId}-short-${n}`)}.json`, JSON.stringify(remapped));
    const sid = `${tid.slice(0, 56)}-short${n}`;
    ops.push({ op: 'add', path: pointer('assets', sid), value: { type: 'json', src: path, name: `Transcript · ${name}` } });
    // the dressings build against the document as the proposal will make it, so their layers stack in order
    let sd: TrammeDoc = { ...doc, compositions: { ...doc.compositions, [cid]: comp }, assets: { ...doc.assets, [sid]: { type: 'json' as const, src: path, name: `Transcript · ${name}` } } };
    const captions = TEMPLATES.captions.build(sd, cid, { at: 0, transcript: sid, place: 'bottom' });
    ops.push(...captions.ops);
    sd = applyOps(sd, captions.ops).doc;
    if (title) {
      const head = TEMPLATES.title.build(sd, cid, { at: 0.2, duration: 2.5, text: title, place: 'top' });
      ops.push(...head.ops);
      sd = applyOps(sd, head.ops).doc;
    }
    doc = sd;
    made.push({ comp: cid, title: name, duration: dur });
  }
  if (!made.length) throw new Error('no passage of the plan is usable (from and to in the file, 2 s at least)');
  return { ops, made };
}

// ── the tool ─────────────────────────────────────────────────
const shorts: ToolType<{ asset: string; format?: Format; min?: number; max?: number; count?: number; plan?: PlanItem[] }> = {
  name: 'shorts', title: 'Cut shorts', description: 'a long video as shorts: lists the passages that stand alone (candidates), or builds one composition per passage of a plan — the video framed for the format, captions on the remapped transcript, a title',
  input: {
    type: 'object',
    properties: {
      asset: { type: 'string', format: 'asset', assetType: 'video', title: 'Video' },
      format: { enum: ['vertical', 'square', 'horizontal'], title: 'Format', description: 'vertical 1080×1920 by default' },
      min: { type: 'number', minimum: 5, maximum: 90, title: 'Shortest (s)', description: 'candidates: the shortest passage worth keeping, 15 s by default' },
      max: { type: 'number', minimum: 10, maximum: 180, title: 'Longest (s)', description: 'candidates: 45 s by default' },
      count: { type: 'integer', minimum: 1, maximum: 12, title: 'Candidates', description: 'how many to list, 3 by default' },
      plan: {
        type: 'array', title: 'Plan', description: 'build: the passages to turn into shorts, in file time, each with its title',
        items: { type: 'object', properties: { from: { type: 'number', title: 'From (s)' }, to: { type: 'number', title: 'To (s)' }, title: { type: 'string', title: 'Title' } }, required: ['from', 'to'] },
      },
    },
    required: ['asset'],
  },
  ai: {
    when: 'a long video of someone speaking (an interview, a talk, a stream): first the candidates, then build the picked ones with a plan — one call, one plan, and the user sees the whole proposal',
    avoid: 'building without reading the candidates; a passage that starts mid-idea (it is skipped, not rescued); titles that promise what the passage does not keep',
    example: { asset: 'talk', plan: [{ from: 132.5, to: 171, title: 'The one idea that changed everything' }] },
  },
  async run({ asset, format = 'vertical', min = 15, max = 45, count = 3, plan }, ctx) {
    const a = ctx.doc.assets[asset];
    if (!a || a.type !== 'video') throw new Error(`${asset}: a video asset of the project is expected`);
    if (!plan?.length) {
      const { t: src } = await transcriptOf(ctx, asset);
      const cands = candidatesOf(src, { min, max });
      if (!cands.length) return { text: `No passage of ${min} s or more in the transcript (${src.duration.toFixed(1)} s, ${src.words.length} words).`, notice: t('shorts.nothing') };
      const list = cands.slice(0, count);
      return {
        text: [`${cands.length} passage(s) that stand alone:`, ...list.map((c, i) => `${i + 1}. [${c.from.toFixed(1)}–${c.to.toFixed(1)} s, ${c.words} words] ${clip(c.text, 160)}`), 'Pick the ones that hook in their first sentence and end on a point — a short that starts mid-idea is skipped, not rescued — then call shorts again with plan: [{ from, to, title }] (file time, the title in a few words). Say which you would pick and why.'].join('\n'),
        notice: t('shorts.candidates', { n: list.length }),
      };
    }
    const { ops, made } = await build(ctx, asset, plan, format);
    return {
      ops, label: made.length > 1 ? `Shorts ×${made.length}` : made[0].title,
      text: [`${made.length} short(s) built as compositions:`, ...made.map((m) => `- ${m.comp}: "${m.title}", ${m.duration.toFixed(1)} s (${format})`), 'Each is an ordinary composition: check it (check, after switching to it), reframe it (focus follows the subject: subjects), export it like any other.'].join('\n'),
      notice: t('shorts.built', { n: made.length }),
    };
  },
};

export const SHORTS_TOOLS: ToolType[] = [shorts];
