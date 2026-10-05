// Looking at the work as a whole: the quality checks with a contact sheet of
// the moments that matter, and a strip of frames to judge a movement. Both
// are tools of the editor's vocabulary, run by the assistant before it sums
// up (use_tool) or by the user from the / menu.

import { Evaluator, motionReport, runChecks, type QualityIssue, type ToolContext, type ToolType, type TrammeDoc } from '@tramme/core';
import { pixelsOf, flowLines } from './flow.ts';
import { analyses, canvas } from './perception.ts';
import { soundIssues } from './sound.ts';
import { t } from './i18n/index.ts';

const CELL = 360;

/** pictures side by side, `cols` to a row, each w × h with its label in a corner (a JPEG data URL) */
export function sheetOf(cells: { image: CanvasImageSource; label: string }[], w: number, h: number, cols: number): string {
  const gap = 6, rows = Math.ceil(cells.length / cols), { c, g } = canvas(cols * w + (cols + 1) * gap, rows * h + (rows + 1) * gap);
  g.fillStyle = '#0b0f12'; g.fillRect(0, 0, c.width, c.height);
  g.font = '600 13px system-ui, sans-serif';
  cells.forEach(({ image, label }, i) => {
    const x = gap + (i % cols) * (w + gap), y = gap + Math.floor(i / cols) * (h + gap);
    g.drawImage(image, x, y, w, h);
    const lw = g.measureText(label).width + 12;
    g.fillStyle = 'rgba(0,0,0,0.7)'; g.fillRect(x + 6, y + h - 26, lw, 20);
    g.fillStyle = '#fff'; g.fillText(label, x + 12, y + h - 11);
  });
  return c.toDataURL('image/jpeg', 0.85);
}

/** the stills of the given times, loaded (the sheet and the flow read the same images) */
async function stills(ctx: ToolContext, times: number[], compId: string) {
  const out: HTMLImageElement[] = [];
  for (const at of times) {
    if (ctx.signal.aborted) throw new Error('stopped');
    const image = new Image();
    image.src = await ctx.renderStill(at, compId);
    await image.decode();
    out.push(image);
  }
  return out;
}

/** a picture of several stills side by side, each labelled with its time */
async function sheet(ctx: ToolContext, times: number[], cols: number, compId: string): Promise<string> {
  const c = ctx.doc.compositions[compId];
  const images = await stills(ctx, times, compId);
  return sheetOf(images.map((image, i) => ({ image, label: `${times[i].toFixed(2)} s` })), CELL, Math.round((CELL * c.height) / c.width), cols);
}

/** the moments worth looking at: just after entrances, markers, problems, and enough to cover the whole */
export function keyTimes(doc: TrammeDoc, compId: string, issues: QualityIssue[], n: number): number[] {
  const c = doc.compositions[compId], end = Math.max(0, c.duration - 0.1);
  const raw = [
    ...Object.values(c.layers).map((l) => (l.in ?? 0) + 0.5),
    ...(c.markers ?? []).map((m) => m.t),
    ...issues.map((i) => i.t ?? -1),
  ].filter((x) => x >= 0 && x <= end);
  const near = (list: number[], x: number) => list.some((y) => Math.abs(x - y) < Math.max(0.3, c.duration / (n * 3)));
  let picked: number[] = [];
  for (const x of raw.sort((a, b) => a - b)) if (!near(picked, x)) picked.push(x);
  // too many: keep them evenly; too few: fill the gaps evenly
  if (picked.length > n) picked = Array.from({ length: n }, (_, i) => picked[Math.round((i * (picked.length - 1)) / Math.max(1, n - 1))]);
  // the gaps are filled where they are widest, so the sheet covers the whole duration
  const fill = Array.from({ length: n * 3 }, (_, i) => (end * (i + 0.5)) / (n * 3));
  const gap = (x: number) => Math.min(...picked.map((y) => Math.abs(x - y)), Infinity);
  while (picked.length < n) {
    const best = fill.reduce((a, b) => (gap(b) > gap(a) ? b : a), fill[0]);
    if (gap(best) < 0.05) break;
    picked.push(best);
  }
  return [...new Set(picked.map((x) => +x.toFixed(2)))].sort((a, b) => a - b).slice(0, n);
}

const check: ToolType<{ frames?: number }> = {
  name: 'check', title: 'Check the composition', description: 'runs the quality checks (readability, safe zone, overlaps, pacing, the sound: clipping, loudness, sounds on top of each other) and shows a contact sheet of the key moments',
  input: { type: 'object', properties: { frames: { type: 'integer', minimum: 2, maximum: 12, title: 'Frames' } } },
  ai: { when: 'before summing up any change, and whenever the user asks if it looks right; read the issues, look at the sheet, fix what matters' },
  async run({ frames = 8 }, ctx) {
    const issues = [...await runChecks(ctx.doc, ctx.registry, ctx.compId, { data: await analyses(ctx) }), ...await soundIssues(ctx)];
    const times = keyTimes(ctx.doc, ctx.compId, issues, frames);
    const url = await sheet(ctx, times, Math.min(4, times.length), ctx.compId);
    const warnings = issues.filter((i) => i.severity === 'warning').length, notes = issues.length - warnings;
    const lines = issues.map((i) => `- [${i.severity}] ${i.message}${i.layers?.length ? ` (layers: ${i.layers.join(', ')})` : ''}`);
    const head = issues.length ? `${warnings} warning(s), ${notes} note(s).` : 'No issue found by the checks.';
    const shown = issues.map((i) => `- ${i.say ? t(i.say.text, i.say.params) : i.message}`);
    return {
      text: `${head}\n${lines.join('\n')}\nContact sheet at ${times.map((x) => `${x} s`).join(', ')}: judge the composition, the hierarchy and the rhythm.`,
      notice: [issues.length ? t('review.issues', { warnings, notes }) : t('review.noIssue'), ...shown].join('\n'),
      images: [{ url, caption: t('review.contactSheet') }],
    };
  },
};

const motion: ToolType<{ t: number; span?: number; steps?: number }> = {
  name: 'motion', title: 'Look at a movement', description: 'a strip of frames over a short span, to judge a movement (timing, easing, overshoot, and the flow of pixels between the frames)',
  input: {
    type: 'object',
    properties: {
      t: { type: 'number', minimum: 0, title: 'Start (s)' },
      span: { type: 'number', minimum: 0.1, maximum: 5, title: 'Span (s)' },
      steps: { type: 'integer', minimum: 3, maximum: 12, title: 'Frames' },
    },
    required: ['t'],
  },
  ai: { when: 'checking an entrance, a transition or a bounce: span 0.4 to 1 s, 6 to 8 frames. The figures say how far it travels, how fast at the peak, whether the speed is even (the linear tell), how it turns, how far it overshoots and when it settles: judge with them, not only the spacing. The Pixels lines read the frames themselves: a background that moves when it should hold, something crossing against the move' },
  async run({ t: from, span = 0.6, steps = 6 }, ctx) {
    const c = ctx.doc.compositions[ctx.compId];
    const to = Math.min(c.duration, from + span);
    const times = Array.from({ length: steps }, (_, i) => +Math.min(c.duration - 0.01, from + (span * i) / (steps - 1)).toFixed(3));
    const images = await stills(ctx, times, ctx.compId);
    const url = sheetOf(images.map((image, i) => ({ image, label: `${times[i].toFixed(2)} s` })), CELL, Math.round((CELL * c.height) / c.width), Math.min(steps, 6));
    // the same evaluation the render uses, so the figures are the movement's
    const report = motionReport(new Evaluator(ctx.doc, ctx.registry), ctx.compId, from, to, { limit: 6 });
    const figs = report.figures.map(({ address, figures: f }) => {
      const pace = f.evenness > 0.92 ? 'constant speed (the linear tell: ease it)' : f.evenness > 0.6 ? 'eased' : 'strongly eased';
      const way = f.turns === 0 ? 'one way' : `${f.turns} turn(s)`;
      const over = f.overshoot > 0 ? `, overshoots its end by ${f.overshoot.toFixed(2)} u` : '';
      const end = f.settle === undefined ? ', still moving at the end of the span' : `, settled at ${(from + f.settle).toFixed(2)} s`;
      return `- ${address}: ${f.travel.toFixed(1)} u over ${f.span.toFixed(2)} s, peak ${f.peak.toFixed(1)} u/s at ${(from + f.peakAt).toFixed(2)} s, ${pace}, ${way}${over}${end}`;
    });
    // the pixels between the two first frames: what no property can say (a background that should hold, a crossing)
    let flow: string[] | null = null;
    if (images.length >= 2) {
      const w = 240, h = Math.max(2, Math.round((c.height * w) / c.width));
      const a = pixelsOf(images[0], w, h), b = pixelsOf(images[1], w, h);
      flow = a && b ? flowLines(a, b, times[1] - times[0], c.width) : null;
    }
    return {
      text: `Frames at ${times.join(', ')} s (left to right, top to bottom): check the spacing between frames, it shows the easing.${figs.length ? `\nMotion in the span, biggest travels first (u: the property's units):\n${figs.join('\n')}` : ''}${flow ? `\n${flow.join('\n')}` : ''}`,
      notice: t('review.motionStrip', { from: from.toFixed(2), to: to.toFixed(2) }),
      images: [{ url, caption: t('review.motionStrip', { from: from.toFixed(2), to: to.toFixed(2) }) }],
    };
  },
};

export const REVIEW_TOOLS: ToolType[] = [check, motion];
