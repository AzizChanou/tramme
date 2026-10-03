// Event lists: what happens in a story, when, and what it does to running
// totals: a change (money spent, a laugh, a kilometre) or a value it sets (a
// weight, a temperature). A JSON asset of timed events, each with a label and
// an optional detail. The render reads it with pure functions of t
// (eventsReader): expressions through events(), the tag and receipt nodes, so
// every picture that tells the story follows the one list. Times are in
// seconds, in the time of the composition that reads it.

import { lastIndex } from './math.ts';

export interface TimedEvent {
  /** unique in the list */
  id: string;
  /** when it happens (s) */
  t: number;
  label: string;
  detail?: string;
  /** what it adds to the running totals: { cash: -18, laughs: 1 } */
  values?: Record<string, number>;
  /** the totals it sets, whatever they were: { weight: 72.5 } */
  set?: Record<string, number>;
}

/** a running total: its name on screen, its value before the first event, how it is written */
export interface TotalSpec {
  label?: string;
  /** 0 by default */
  start?: number;
  /** a pattern of formatValue ('£0.00', '0,00 €', '0 day|0 days', '0:00'); by default as many decimals as the list's values have */
  format?: string;
}

export interface EventList {
  version: 1;
  kind: 'events';
  totals?: Record<string, TotalSpec>;
  events: TimedEvent[];
}

export const isEventList = (x: unknown): x is EventList =>
  !!x && typeof x === 'object' && (x as EventList).kind === 'events' && Array.isArray((x as EventList).events);

// ── numbers as they are written ──────────────────────────────
const MINUS = '\u2212';
/** a run of digits, or of a pattern's 0 and #, with the separators between them (: in a duration) */
const DIGITS = /\d(?:\d|[.,:\u00a0\u202f ](?=\d))*/;
const PLACES = /[0#](?:[0#]|[.,:\u00a0\u202f ](?=[0#]))*/;

/**
 * Where the decimal mark is in a run like '1,250.50', '0,00' or '0 000': the
 * last . or , unless it groups thousands (a single , before three digits, or
 * a mark that repeats); -1 when there is none. A space only groups.
 */
function decimalMark(run: string): number {
  const seps = [...run].flatMap((c, i) => (/[\d#]/.test(c) ? [] : [i]));
  const i = seps.at(-1);
  if (i === undefined || (run[i] !== '.' && run[i] !== ',')) return -1;
  if (new Set(seps.map((k) => run[k])).size > 1) return i;
  if (seps.length > 1) return -1;
  return run[i] === ',' && run.length - 1 - i === 3 ? -1 : i;
}

/** how a pattern writes a number; clock: 2 for minutes:seconds, 3 for hours:minutes:seconds, 0 for a plain number */
interface Pattern { prefix: string; suffix: string; minInt: number; minDec: number; maxDec: number; group: string; point: string; clock: number }
const patterns = new Map<string, Pattern>();
const zeros = (s: string) => [...s].filter((c) => c === '0').length;

function pattern(p: string): Pattern {
  let hit = patterns.get(p);
  if (hit) return hit;
  // an example rather than a pattern ('£23.67'): the pattern it shows
  const src = /[1-9]/.test(p) ? parseFormatted(p)?.format ?? p : p;
  const m = PLACES.exec(src);
  if (!m) hit = { prefix: '', suffix: '', minInt: 1, minDec: 0, maxDec: 2, group: '', point: '.', clock: 0 };
  else {
    // a duration's decimals belong to its seconds
    const run = m[0], parts = run.split(':'), clock = parts.length > 1 ? Math.min(3, parts.length) : 0;
    const body = clock ? parts.at(-1)! : run, at = clock ? body.search(/[.,]/) : decimalMark(run);
    const int = clock ? parts[0] : at < 0 ? run : run.slice(0, at), dec = at < 0 ? '' : body.slice(at + 1);
    hit = {
      prefix: src.slice(0, m.index), suffix: src.slice(m.index + run.length),
      minInt: Math.max(1, zeros(int)), minDec: zeros(dec), maxDec: dec.replace(/[^0#]/g, '').length,
      group: clock ? '' : [...int].find((c) => c !== '0' && c !== '#') ?? '', point: at < 0 ? '.' : body[at], clock,
    };
  }
  patterns.set(p, hit);
  return hit;
}

export interface FormatOptions {
  /** + before a gain (a loss always gets −) */
  signed?: boolean;
  /** at least this many digits before the decimal mark (or in a duration's first field), zeros in front: a counter that keeps its width */
  digits?: number;
}

/**
 * A number written with a pattern: '£0.00' (a pound sign, two decimals), '00'
 * (at least two digits), '#,##0 pts' (thousands grouped, a unit after),
 * '0,00 €' (a decimal comma), '0.##' (up to two decimals), '0 day|0 days' (the
 * first form for one), '0:00' or '0:00:00' (seconds as minutes:seconds or
 * hours:minutes:seconds). In a pattern, 0 is a digit always written and # one
 * written when needed; the last . or , before digits is the decimal mark,
 * unless it groups thousands (a single , before three digits). An example
 * reads as its pattern: '£23.67' as '£0.00'. A loss gets a minus sign before
 * the prefix: −£18.00.
 */
export function formatValue(value: number, format = '0.##', opts: FormatOptions = {}): string {
  const v = Number.isFinite(value) ? value : 0;
  // singular|plural: the first form for one, as written
  const [one, other = one] = format.split('|');
  const many = pattern(other), f = Number(Math.abs(v).toFixed(many.maxDec)) === 1 ? pattern(one) : many;
  const n = Number(Math.abs(v).toFixed(f.maxDec)), width = Math.max(f.minInt, opts.digits ?? 0);
  let int: string, dec: string;
  if (f.clock) {
    // seconds as [hours:]minutes:seconds, the first field as long as it needs
    const big = f.clock === 3 ? 3600 : 60, first = Math.floor(n / big), rest = n - first * big;
    const minutes = f.clock === 3 ? `${String(Math.floor(rest / 60)).padStart(2, '0')}:` : '';
    [int, dec = ''] = (rest % 60).toFixed(f.maxDec).split('.');
    int = `${String(first).padStart(width, '0')}:${minutes}${int.padStart(2, '0')}`;
  } else {
    [int, dec = ''] = n.toFixed(f.maxDec).split('.');
    int = int.padStart(width, '0');
    if (f.group) int = int.replace(/\B(?=(\d{3})+$)/g, f.group);
  }
  while (dec.length > f.minDec && dec.endsWith('0')) dec = dec.slice(0, -1);
  const body = `${f.prefix}${int}${dec ? f.point + dec : ''}${f.suffix}`;
  return n === 0 ? body : v < 0 ? MINUS + body : opts.signed ? `+${body}` : body;
}

/** a number written as it should look ('£23.67', '1,250', '0,50 €', '00', '1:30'): its value and its pattern; null without a number */
export function parseFormatted(text: string): { value: number; format: string } | null {
  const s = text.trim(), m = DIGITS.exec(s);
  if (!m) return null;
  const sign = /^[-\u2212]|[-\u2212]\s*$/.test(s.slice(0, m.index)) ? -1 : 1;
  const prefix = s.slice(0, m.index).replace(/^[+\-\u2212]\s*|[+\-\u2212]\s*$/g, ''), run = m[0], suffix = s.slice(m.index + run.length);
  // zeros in front of the example are wanted ('00', '05.67', '02:46'); otherwise one digit at least
  const padded = (digits: string) => digits.length > 1 && digits[0] === '0';
  if (run.includes(':')) {
    // a duration, in seconds
    const parts = run.split(':'), last = parts.at(-1)!, at = last.search(/[.,]/);
    const fields = [padded(parts[0]) ? parts[0].replace(/\d/g, '0') : '0', ...parts.slice(1).map(() => '00')];
    return { value: sign * parts.reduce((n, x) => n * 60 + Number(x.replace(',', '.')), 0), format: `${prefix}${fields.join(':')}${at < 0 ? '' : last[at] + '0'.repeat(last.length - at - 1)}${suffix}` };
  }
  const at = decimalMark(run);
  const int = at < 0 ? run : run.slice(0, at), dec = at < 0 ? '' : run.slice(at + 1).replace(/\D/g, '');
  const digits = int.replace(/\D/g, '');
  // # where thousands are grouped
  let seen = 0;
  const places = padded(digits) ? int.replace(/\d/g, '0') : int === digits ? '0' : [...int].reverse().map((c) => (!/\d/.test(c) ? c : seen++ === 0 ? '0' : '#')).reverse().join('');
  return { value: sign * Number(`${digits}${dec ? `.${dec}` : ''}`), format: `${prefix}${places}${dec ? run[at] + '0'.repeat(dec.length) : ''}${suffix}` };
}

// ── reading at render time ───────────────────────────────────
interface Track {
  label: string;
  start: number;
  format: string;
  /** the events that change it (indices in time order), their times, and the change, total, gains and losses at each */
  at: number[];
  times: number[];
  deltas: number[];
  totals: number[];
  gains: number[];
  losses: number[];
  /** an event's index in time order -> its step on this track */
  step: Map<number, number>;
}

interface Prepared { events: TimedEvent[]; times: number[]; keys: string[]; tracks: Map<string, Track>; index: Map<TimedEvent, number> }

/** no float dust in the totals (0.1 + 0.2) */
const tidy = (x: number) => Math.round(x * 1e9) / 1e9;
const decimals = (x: number) => /\.(\d+)$/.exec(String(x))?.[1].length ?? 0;
/** a number of a map of the list, when it is one: it may be written by hand */
const num = (o: unknown, key: string) => { const v = o && typeof o === 'object' ? (o as Record<string, unknown>)[key] : undefined; return typeof v === 'number' && Number.isFinite(v) ? v : undefined; };
const keysOf = (o: unknown) => (o && typeof o === 'object' ? Object.keys(o) : []);

const prepared = new WeakMap<EventList, Prepared>();

/** the list in time order, with the track of each total, computed once per list */
function prepare(list: EventList): Prepared {
  const hit = prepared.get(list);
  if (hit) return hit;
  // events without a time are left out
  const events = list.events.filter((e) => !!e && typeof e === 'object' && Number.isFinite(e.t)).sort((a, b) => a.t - b.t);
  const specs = list.totals && typeof list.totals === 'object' ? list.totals : {};
  const keys = [...new Set([...Object.keys(specs), ...events.flatMap((e) => [...keysOf(e.values), ...keysOf(e.set)])])];
  const tracks = new Map<string, Track>();
  for (const key of keys) {
    const spec: TotalSpec = specs[key] ?? {}, start = typeof spec.start === 'number' && Number.isFinite(spec.start) ? spec.start : 0;
    const label = typeof spec.label === 'string' && spec.label ? spec.label : key.charAt(0).toUpperCase() + key.slice(1);
    const tr: Track = { label, start, format: '', at: [], times: [], deltas: [], totals: [], gains: [], losses: [], step: new Map() };
    let total = start, gains = 0, losses = 0, places = decimals(start);
    events.forEach((e, i) => {
      // a value it sets first, then what it adds; an event that leaves the total as it was is not one of its events
      const set = num(e.set, key), add = num(e.values, key) ?? 0, next = tidy((set ?? total) + add), d = tidy(next - total);
      if (!d) return;
      places = Math.max(places, decimals(set ?? 0), decimals(add));
      total = next;
      if (d > 0) gains = tidy(gains + d); else losses = tidy(losses - d);
      tr.step.set(i, tr.at.length);
      tr.at.push(i); tr.times.push(e.t); tr.deltas.push(d); tr.totals.push(total); tr.gains.push(gains); tr.losses.push(losses);
    });
    tr.format = typeof spec.format === 'string' && spec.format ? spec.format : places ? `0.${'0'.repeat(Math.min(3, places))}` : '0';
    tracks.set(key, tr);
  }
  const p = { events, times: events.map((e) => e.t), keys, tracks, index: new Map(events.map((e, i) => [e, i])) };
  prepared.set(list, p);
  return p;
}

/** what an event list says at one instant; without a key, every total or every event */
export interface EventsReader {
  /** every event, in time order */
  list: TimedEvent[];
  /** the totals it keeps: those it declares, then those only its events change */
  keys: string[];
  /** how many events have happened */
  count: number;
  /** the latest event so far (that changed the total), or null */
  last(key?: string): TimedEvent | null;
  /** the next event to come (that changes the total), or null */
  next(key?: string): TimedEvent | null;
  /** an event by its id, or null */
  find(id: string): TimedEvent | null;
  /** a running total: its start, then every change and value set so far */
  total(key: string): number;
  /** the total before its latest change (a counter rolls from it), every event of that instant counted */
  previous(key: string): number;
  /** the latest change of a total (the events of one instant together), 0 before the first */
  change(key: string): number;
  /** what a total gained and lost so far, as amounts (lost: money spent) */
  gains(key: string): number;
  losses(key: string): number;
  /** seconds since the latest event (that changed the total); Infinity before the first */
  since(key?: string): number;
  /** 1 at each event (that changes the total), fading to 0 with decay (s) */
  pulse(decay?: number, key?: string): number;
  /** a number written with a total's format */
  format(value: number, key?: string, opts?: FormatOptions): string;
  /** a running total written with its format, at least `digits` digits before the decimal mark */
  text(key: string, digits?: number): string;
  /** what an event of the list changed, each change written with its total's format and its sign: '−£18.00  +1' */
  changes(event: TimedEvent, key?: string): string;
  /** the totals an event of the list left, each written with its format: '£5.67  1' */
  after(event: TimedEvent, key?: string): string;
  /** the name of a total on screen */
  label(key: string): string;
}

const NONE: EventsReader = {
  list: [], keys: [], count: 0,
  last: () => null, next: () => null, find: () => null,
  total: () => 0, previous: () => 0, change: () => 0, gains: () => 0, losses: () => 0,
  since: () => Infinity, pulse: () => 0,
  format: (v, _key, opts) => formatValue(v, undefined, opts),
  text: (_key, digits) => formatValue(0, undefined, { digits }),
  changes: () => '', after: () => '', label: (key) => key,
};

/** what an event list says at time t; neutral values when there is none (or it is not loaded) */
export function eventsReader(list: unknown, t: number): EventsReader {
  if (!isEventList(list)) return NONE;
  const p = prepare(list), now = lastIndex(p.times, t);
  /** the latest change of a total at t: -1 before its first */
  const step = (tr: Track | undefined) => (tr ? lastIndex(tr.times, t) : -1);
  const last = (key?: string) => {
    if (!key) return p.events[now] ?? null;
    const tr = p.tracks.get(key), k = step(tr);
    return tr && k >= 0 ? p.events[tr.at[k]] : null;
  };
  const next = (key?: string) => {
    if (!key) return p.events[now + 1] ?? null;
    const tr = p.tracks.get(key), k = step(tr);
    return tr && k + 1 < tr.at.length ? p.events[tr.at[k + 1]] : null;
  };
  const value = (key: string, of: 'totals' | 'gains' | 'losses') => {
    const tr = p.tracks.get(key), k = step(tr);
    return !tr ? 0 : k >= 0 ? tr[of][k] : of === 'totals' ? tr.start : 0;
  };
  /** a total before its latest change, every event of that instant counted */
  const previous = (key: string) => {
    const tr = p.tracks.get(key);
    let k = step(tr);
    if (!tr || k < 0) return tr ? tr.start : 0;
    while (k > 0 && tr.times[k - 1] === tr.times[k]) k--;
    return k > 0 ? tr.totals[k - 1] : tr.start;
  };
  const format = (v: number, key?: string, opts?: FormatOptions) => formatValue(v, (key && p.tracks.get(key)?.format) || undefined, opts);
  const since = (key?: string) => { const e = last(key); return e ? t - e.t : Infinity; };
  /** the step of an event on a total's track, when it changed that total */
  const stepOf = (e: TimedEvent, key: string) => { const tr = p.tracks.get(key), i = p.index.get(e); return tr && i !== undefined ? tr.step.get(i) : undefined; };
  /** each total an event changed, written from its track */
  const written = (e: TimedEvent, key: string | undefined, of: 'deltas' | 'totals') => (key ? [key] : p.keys)
    .flatMap((k) => { const s = stepOf(e, k); return s === undefined ? [] : [format(p.tracks.get(k)![of][s], k, { signed: of === 'deltas' })]; }).join('  ');
  return {
    list: p.events, keys: p.keys, count: now + 1,
    last, next,
    find: (id) => p.events.find((e) => e.id === id) ?? null,
    total: (key) => value(key, 'totals'),
    previous,
    change: (key) => tidy(value(key, 'totals') - previous(key)),
    gains: (key) => value(key, 'gains'),
    losses: (key) => value(key, 'losses'),
    since,
    pulse: (decay = 0.3, key) => { const s = since(key); return Number.isFinite(s) ? Math.exp(-s / Math.max(1e-3, decay)) : 0; },
    format,
    text: (key, digits) => format(value(key, 'totals'), key, { digits }),
    changes: (e, key) => written(e, key, 'deltas'),
    after: (e, key) => written(e, key, 'totals'),
    label: (key) => p.tracks.get(key)?.label ?? key,
  };
}
