// Timing of drawn animation: which drawing shows at each frame. The exposure
// sheet ("feuille d'exposition") lists drawings and how many frames each one
// holds, as in traditional animation and anime:
//
//   "1-4/2, 5/6, 4-1/2, x/3"
//     drawings 1 to 4 held 2 frames each, drawing 5 held 6 frames,
//     then 4 down to 1 held 2 frames each, then 3 empty frames.
//
// Empty sheet: every drawing in order, each held `hold` frames ("on twos"
// with 2, the usual anime rate at 24 frames a second).

export type SequenceLoop = 'loop' | 'once' | 'pingpong';

export interface SequenceTiming {
  /** number of drawings */
  count: number;
  /** frames per drawing when there is no sheet */
  hold: number;
  sheet: string;
  loop: SequenceLoop;
  /** frames to shift the sequence by */
  offset: number;
  /** 1-based drawing forced at this instant (animated with hold keys, for a mouth for instance); 0 follows the sheet */
  drawing: number;
}

const TOKEN = /^(\d+|x)(?:-(\d+))?(?:\/(\d+))?$/i;
const cache = new Map<string, number[]>();

/** frame after frame, the 0-based drawing shown (-1: nothing) */
export function exposureSheet(sheet: string, count: number, hold: number): number[] {
  const h = Math.max(1, Math.round(hold) || 1);
  const key = `${sheet}|${count}|${h}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const out: number[] = [];
  const text = sheet.trim();
  if (!text) {
    for (let d = 0; d < count; d++) for (let i = 0; i < h; i++) out.push(d);
  } else {
    for (const token of text.split(/[\s,;]+/)) {
      const m = TOKEN.exec(token);
      if (!m) continue;
      const frames = m[3] ? Math.max(1, Number(m[3])) : h;
      if (m[1].toLowerCase() === 'x') { for (let i = 0; i < frames; i++) out.push(-1); continue; }
      const a = Number(m[1]), b = m[2] ? Number(m[2]) : a, step = b >= a ? 1 : -1;
      for (let d = a; step > 0 ? d <= b : d >= b; d += step) {
        if (d < 1 || d > count) continue;
        for (let i = 0; i < frames; i++) out.push(d - 1);
      }
    }
  }
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}

/** what is wrong in a sheet, for the inspector (empty when it reads well) */
export function sheetIssues(sheet: string, count: number): string[] {
  const issues: string[] = [];
  for (const token of sheet.trim().split(/[\s,;]+/).filter(Boolean)) {
    const m = TOKEN.exec(token);
    if (!m) { issues.push(`"${token}" unreadable (e.g. 1-4/2, 5/6, x/3)`); continue; }
    for (const n of [m[1], m[2]]) if (n && n.toLowerCase() !== 'x' && (Number(n) < 1 || Number(n) > count)) issues.push(`drawing ${n} missing (${count} drawing${count > 1 ? 's' : ''})`);
  }
  return issues;
}

/**
 * Frame of a layer at composition time t (0 at its in point): the nearest one,
 * so the sub-frames of motion blur around a frame keep its drawing (drawings
 * never blend into the next one).
 */
export const localFrame = (t: number, layerIn: number, fps: number) => Math.round((t - layerIn) * fps);

/** the 0-based drawing at a local frame, or -1 */
export function drawingAt(p: SequenceTiming, frame: number): number {
  if (p.count <= 0) return -1;
  if (p.drawing >= 1) return Math.min(p.count, Math.round(p.drawing)) - 1;
  const list = exposureSheet(p.sheet, p.count, p.hold), n = list.length;
  if (!n) return -1;
  const f = frame + Math.round(p.offset || 0);
  let i: number;
  if (p.loop === 'once') i = Math.min(n - 1, Math.max(0, f));
  else if (p.loop === 'pingpong' && n > 1) {
    const period = 2 * n - 2, m = ((f % period) + period) % period;
    i = m < n ? m : period - m;
  } else i = ((f % n) + n) % n;
  return list[i];
}
