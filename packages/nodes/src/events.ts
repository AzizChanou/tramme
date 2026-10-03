// What an event list says, on screen: a tag that pops up at each event
// ("PETROL −£18.00") and a receipt that lists them all, typed a line at a
// time. Both read the list when they draw, so they follow it when it
// changes. (Running totals on screen are text.counter layers driven by
// events() in expressions.)

import { clamp, cubicBezier, eventsReader, isEventList, type EventList, type EventsReader, type Host, type NodeType, type Paint, type TimedEvent, type Vec2 } from '@tramme/core';
import { canvasPaint } from './paint.ts';
import { alignX, measureCtx, setType, TYPE, type TypeProps } from './text.ts';

const LIST = { type: 'asset', default: null, nullable: true, assetType: 'json', label: 'Event list', animatable: false } as const;
const POP = cubicBezier(0.34, 1.56, 0.64, 1), OUT = cubicBezier(0.16, 1, 0.3, 1);
/** capitals sit on the baseline at this fraction of the size below the middle of a line */
const CAP = 0.36;

/** the list a layer reads, once loaded */
function listOf(id: string | null, host: Host): EventList | null {
  if (!id) return null;
  try { const l = host.asset<unknown>(id); return isEventList(l) ? l : null; } catch { return null; }
}

const upper = (on: boolean, s: string) => (on ? s.toUpperCase() : s);

// ── the tag of each event ────────────────────────────────────
interface TagProps extends TypeProps { events: string | null; key: string; show: 'change' | 'total' | 'label'; hold: number; animation: 'pop' | 'snap' | 'rise' | 'fade'; uppercase: boolean; fill: Paint; padding: Vec2; radius: number; gap: number }

/** the tag on screen at time t: the latest event that brings one (one changing `key` when set), for `hold` seconds or until the next */
export function tagAt(list: EventList, key: string, t: number, hold: number): { event: TimedEvent; age: number; left: number; cut: boolean } | null {
  const r = eventsReader(list, t), e = r.last(key);
  if (!e || t - e.t >= hold) return null;
  const next = r.next(key), end = next && next.t < e.t + hold ? next.t : e.t + hold;
  return { event: e, age: t - e.t, left: end - t, cut: end < e.t + hold };
}

/** how a tag looks `age` seconds after its event and `left` seconds before it goes (cut: the next tag takes its place at once) */
export function tagMotion(animation: TagProps['animation'], age: number, left: number, cut: boolean): { scale: number; lift: number; alpha: number } {
  const k = clamp(age / (animation === 'pop' ? 0.28 : 0.22));
  let scale = 1, lift = 0, alpha = 1;
  if (animation === 'pop') { scale = 0.55 + 0.45 * POP(k); alpha = clamp(k * 4); }
  else if (animation === 'rise') { lift = 1 - OUT(k); alpha = OUT(k); }
  else if (animation === 'fade') alpha = OUT(k);
  if (!cut) alpha *= clamp(left / 0.18);
  return { scale, lift, alpha };
}

/** the tag of an event measured with the type set on ctx: its texts and its box */
function tagBox(ctx: CanvasRenderingContext2D, p: TagProps, r: EventsReader, e: TimedEvent) {
  const label = upper(p.uppercase, String(e.label ?? '')), value = p.show === 'change' ? r.changes(e, p.key) : p.show === 'total' ? r.after(e, p.key) : '';
  const trail = p.tracking * p.size, width = (s: string) => (s ? ctx.measureText(s).width - trail : 0);
  const gap = label && value ? p.gap * p.size : 0, lw = width(label);
  const w = p.size * p.padding[0] * 2 + lw + gap + width(value), h = p.size * (0.72 + p.padding[1] * 2);
  return { label, value, lw, gap, w, h, x: alignX(p.align, w) };
}

export const tag: NodeType<TagProps> = {
  type: 'events.tag', title: 'Event tag', category: 'Text',
  description: 'a tag that pops up at each event of an event list, with what it changes',
  props: {
    events: LIST,
    key: { type: 'string', default: '', label: 'Total', animatable: false, description: 'only the events that change this total, with that change; every event when empty' },
    show: { type: 'enum', default: 'change', options: ['change', 'total', 'label'], label: 'Shows', animatable: false, description: 'after the label: what the event changes (−£18.00), the total it leaves (£5.67), or nothing' },
    hold: { type: 'number', default: 1.4, min: 0.2, step: 0.1, unit: 's', label: 'On screen', group: 'Timing', animatable: false },
    animation: { type: 'enum', default: 'pop', options: ['pop', 'snap', 'rise', 'fade'], label: 'In', group: 'Timing', animatable: false },
    ...TYPE,
    size: { ...TYPE.size, default: 32 },
    weight: { ...TYPE.weight, default: 700 },
    tracking: { ...TYPE.tracking, default: 0.04 },
    uppercase: { type: 'bool', default: true, label: 'Uppercase', group: 'Typography' },
    fill: { type: 'paint', default: '#E5402A', label: 'Tag', group: 'Appearance' },
    padding: { type: 'vec2', default: [0.45, 0.3], step: 0.05, unit: 'em', label: 'Padding', group: 'Appearance' },
    radius: { type: 'number', default: 3, min: 0, unit: 'px', label: 'Radius', group: 'Appearance' },
    gap: { type: 'number', default: 1.2, min: 0, step: 0.1, unit: 'em', label: 'Gap', group: 'Appearance', description: 'between the label and what follows it' },
  },
  // the widest tag, so the layer keeps one box
  bounds(p, host) {
    const ctx = measureCtx();
    setType(ctx, p, host);
    const list = listOf(p.events, host), r = eventsReader(list, Infinity);
    const widths = r.list.filter((e) => !p.key || r.changes(e, p.key)).map((e) => tagBox(ctx, p, r, e).w);
    const w = Math.max(p.size * 4, ...widths), h = p.size * (0.72 + p.padding[1] * 2);
    return { x: alignX(p.align, w), y: -h / 2, w, h };
  },
  render: {
    canvas2d(ctx, p, host) {
      const list = listOf(p.events, host), on = list && tagAt(list, p.key, host.t, p.hold);
      if (!on) return;
      const m = tagMotion(p.animation, on.age, on.left, on.cut);
      if (m.alpha <= 0) return;
      setType(ctx, p, host);
      const b = tagBox(ctx, p, eventsReader(list, host.t), on.event), mid = b.x + b.w / 2;
      ctx.save();
      ctx.globalAlpha *= m.alpha;
      // it pops around its middle
      ctx.translate(mid, m.lift * p.size * 0.6);
      ctx.scale(m.scale, m.scale);
      ctx.translate(-mid, 0);
      const fill = canvasPaint(ctx, p.fill);
      if (fill) {
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.roundRect(b.x, -b.h / 2, b.w, b.h, Math.min(p.radius, b.h / 2, b.w / 2)); ctx.fill();
      }
      const ink = canvasPaint(ctx, p.color);
      if (ink) ctx.fillStyle = ink;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const x = b.x + p.size * p.padding[0];
      if (b.label) ctx.fillText(b.label, x, p.size * CAP);
      if (b.value) ctx.fillText(b.value, x + b.lw + b.gap, p.size * CAP);
      ctx.restore();
    },
  },
};

// ── the receipt of them all ──────────────────────────────────
interface ReceiptProps extends TypeProps {
  events: string | null; title: string; subtitle: string; column: 'auto' | 'detail' | 'change' | 'total' | 'none'; numbered: boolean; totals: string;
  interval: number; typing: boolean; uppercase: boolean; lineHeight: number; paper: Paint; rule: string; highlight: string; width: number; padding: Vec2;
}

export interface ReceiptRow { left: string; right: string; kind: 'head' | 'item' | 'total' }

/** the lines of a receipt: its heading, one per event, then the totals asked for ("Spent: -cash; Left: cash") */
export function receiptRows(list: EventList, p: Pick<ReceiptProps, 'title' | 'subtitle' | 'column' | 'numbered' | 'totals' | 'uppercase'>): ReceiptRow[] {
  const r = eventsReader(list, Infinity), up = (s: string) => upper(p.uppercase, s), rows: ReceiptRow[] = [];
  if (p.title || p.subtitle) rows.push({ left: up(p.title), right: up(p.subtitle), kind: 'head' });
  const digits = Math.max(2, String(r.list.length).length);
  r.list.forEach((e, i) => {
    const detail = typeof e.detail === 'string' ? up(e.detail) : '', change = r.changes(e);
    const right = p.column === 'detail' ? detail : p.column === 'change' ? change : p.column === 'total' ? r.after(e) : p.column === 'none' ? '' : detail || change;
    rows.push({ left: up(`${p.numbered ? `${String(i + 1).padStart(digits, '0')} ` : ''}${e.label ?? ''}`), right, kind: 'item' });
  });
  // a total, the sum of its decreases (-) or of its increases (+)
  for (const part of p.totals.split(/[;\n]/)) {
    const m = /^\s*(?:(.*?)\s*:\s*)?([+\-\u2212]?)\s*([^\s:;]+)\s*$/.exec(part);
    if (!m) continue;
    const key = r.keys.find((k) => k.toLowerCase() === m[3].toLowerCase()) ?? m[3];
    const value = m[2] === '+' ? r.gains(key) : m[2] ? r.losses(key) : r.total(key);
    rows.push({ left: up(m[1] || r.label(key)), right: r.format(value, key), kind: 'total' });
  }
  return rows;
}

/** when each line starts after the layer's in point: one every `interval`, a beat of silence before the totals */
export function rowStarts(rows: ReceiptRow[], interval: number): number[] {
  let beat = 0;
  return rows.map((row, i) => { if (row.kind === 'total' && rows[i - 1]?.kind !== 'total') beat = 1; return (i + beat) * interval; });
}

/** the receipt laid out with the type set on ctx: its lines, their tops, the columns and the whole height */
function receiptLayout(ctx: CanvasRenderingContext2D, p: ReceiptProps, list: EventList) {
  const rows = receiptRows(list, p), trail = p.tracking * p.size;
  const width = (s: string) => (s ? ctx.measureText(s).width - trail : 0);
  const rights = rows.map((row) => width(row.right));
  const px = p.padding[0] * p.size, py = p.padding[1] * p.size, gap = p.size * 0.8, lh = p.lineHeight * p.size;
  const leftCol = Math.max(0, ...rows.map((row) => width(row.left))), rightCol = Math.max(0, ...rights);
  // as wide as the longest line and a rule between the columns
  const w = p.width > 0 ? p.width : px * 2 + leftCol + rightCol + gap * 2 + p.size * 6;
  const tops: number[] = [];
  let y = py, band = { y: -1, row: -1 };
  rows.forEach((row, i) => {
    // the totals sit on a band of their own, half a line below the events
    if (row.kind === 'total' && rows[i - 1]?.kind !== 'total') { band = { y: y + lh * 0.25, row: i }; y += lh * 0.5; }
    tops.push(y);
    y += lh;
  });
  return { rows, rights, w, x0: alignX(p.align, w), px, py, lh, tops, band, height: y + py, ruleFrom: px + leftCol + gap, ruleTo: w - px - rightCol - gap };
}

export const receipt: NodeType<ReceiptProps> = {
  type: 'events.receipt', title: 'Receipt', category: 'Text',
  description: 'every event of an event list on a receipt, typed a line at a time from the in point, with totals at the bottom',
  props: {
    events: LIST,
    title: { type: 'string', default: 'Receipt', label: 'Title' },
    subtitle: { type: 'string', default: '', label: 'Subtitle', description: 'on the right of the title, e.g. a date' },
    column: { type: 'enum', default: 'auto', options: ['auto', 'detail', 'change', 'total', 'none'], label: 'Right column', animatable: false, description: 'auto: the detail of the event, or else what it changes; total: the totals it leaves' },
    numbered: { type: 'bool', default: true, label: 'Numbered', animatable: false },
    totals: { type: 'string', default: '', label: 'Totals', animatable: false, description: 'lines at the bottom, "Label: total" separated by ";": -total adds up its decreases, +total its increases, e.g. "Spent: -cash; Change: cash"' },
    interval: { type: 'number', default: 0.3, min: 0.02, step: 0.01, unit: 's', label: 'Line every', group: 'Timing', animatable: false },
    typing: { type: 'bool', default: true, label: 'Typed', group: 'Timing', animatable: false, description: 'each line typed letter by letter' },
    ...TYPE,
    size: { ...TYPE.size, default: 28 },
    weight: { ...TYPE.weight, default: 500 },
    tracking: { ...TYPE.tracking, default: 0.06 },
    color: { ...TYPE.color, default: '#1B1A17' },
    uppercase: { type: 'bool', default: true, label: 'Uppercase', group: 'Typography' },
    lineHeight: { type: 'number', default: 1.75, min: 1, step: 0.05, unit: 'em', label: 'Line height', group: 'Typography' },
    paper: { type: 'paint', default: '#EFEBE4', label: 'Paper', group: 'Appearance' },
    rule: { type: 'color', default: 'rgba(27,26,23,0.3)', label: 'Rules', group: 'Appearance' },
    highlight: { type: 'color', default: '#D9412B', label: 'Last total', group: 'Appearance' },
    width: { type: 'number', default: 0, min: 0, unit: 'px', label: 'Width', group: 'Appearance', description: '0: as wide as the longest line needs' },
    padding: { type: 'vec2', default: [0.9, 0.7], step: 0.05, unit: 'em', label: 'Padding', group: 'Appearance' },
  },
  // the whole receipt, every line printed; the origin is the middle, left or right of its top edge
  bounds(p, host) {
    const ctx = measureCtx();
    setType(ctx, p, host);
    const list = listOf(p.events, host);
    if (!list) return { x: alignX(p.align, p.size * 12), y: 0, w: p.size * 12, h: p.size * 4 };
    const L = receiptLayout(ctx, p, list);
    return { x: L.x0, y: 0, w: L.w, h: L.height };
  },
  render: {
    canvas2d(ctx, p, host) {
      const list = listOf(p.events, host), T = host.t - (host.layerIn ?? 0);
      if (!list || T < 0) return;
      setType(ctx, p, host);
      const L = receiptLayout(ctx, p, list), starts = rowStarts(L.rows, p.interval);
      if (!L.rows.length) return;
      // the paper reaches each line as it starts
      let bottom = L.tops[0];
      L.rows.forEach((_, i) => { const g = clamp((T - starts[i]) / 0.12); if (g > 0) bottom = L.tops[i] + L.lh * g; });
      const height = bottom + L.py, x0 = L.x0;
      ctx.save();
      const paper = canvasPaint(ctx, p.paper);
      if (paper) { ctx.fillStyle = paper; ctx.fillRect(x0, 0, L.w, height); }
      if (L.band.row >= 0 && T >= starts[L.band.row]) { ctx.fillStyle = 'rgba(0,0,0,0.045)'; ctx.fillRect(x0, L.band.y, L.w, height - L.band.y); }
      ctx.beginPath(); ctx.rect(x0, 0, L.w, height); ctx.clip();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const ink = canvasPaint(ctx, p.color), last = L.rows.map((row) => row.kind).lastIndexOf('total');
      L.rows.forEach((row, i) => {
        if (T < starts[i]) return;
        // both columns typed together, a letter at a time
        const typed = p.typing ? clamp((T - starts[i]) / (p.interval * 0.85)) : 1;
        const n = Math.floor(typed * Math.max(row.left.length, row.right.length) + 1e-6);
        const y = L.tops[i] + L.lh / 2 + p.size * CAP;
        if (row.kind !== 'head' && L.ruleTo - L.ruleFrom > p.size) {
          ctx.fillStyle = p.rule;
          ctx.fillRect(x0 + L.ruleFrom, y, L.ruleTo - L.ruleFrom, Math.max(1, p.size * 0.04));
        }
        if (ink) ctx.fillStyle = ink;
        ctx.fillText(row.left.slice(0, n), x0 + L.px, y);
        if (i === last) ctx.fillStyle = p.highlight;
        ctx.fillText(row.right.slice(0, n), x0 + L.w - L.px - L.rights[i], y);
      });
      ctx.restore();
    },
  },
};
