// Event lists in the editor: the tool that writes one (what happens in a
// story, when, and what it changes in running totals) and the tools that show
// it: counters in a corner that roll at each change (text.counter driven by
// events()), a tag at each event, a receipt of them all at the end. These
// layers read the list as they render, so saving the list again changes
// everything that tells the story. All of it is a tool of the editor's
// vocabulary: the assistant runs it (use_tool), the user too (/ menu).

import { eventsReader, isColor, isEventList, parseFormatted, pointer, type Composition, type EventList, type EventsReader, type TimedEvent, type ToolContext, type ToolType, type TotalSpec } from '@tramme/core';
import { CAP, receiptRows, rowStarts } from '@tramme/nodes';
import { t } from './i18n/index.ts';
import { parseTime, slug } from './model.ts';
import { readJson } from './perception.ts';
import { compOf, counterWidth, measure, r, style } from './recipes.ts';
import { adder } from './templates.ts';

// ── writing a list ───────────────────────────────────────────
/** a total's key as the list keeps it: lower case, no spaces */
const keyOf = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-');

/** what an event does to a total: its key, then a space or : and a signed amount that adds up ("cash -18", "laughs: +1", "time +0:30"), or = and the value it sets ("weight =72.5") */
const CHANGE = /([\p{L}_][\p{L}\p{N}_-]*)(?:\s*=\s*([+\-\u2212]?)|(?:\s*:\s*|\s+)([+\-\u2212]))\s*(\d+(?::\d+){0,2}(?:[.,]\d+)?)/gu;

/** an amount as written: 18, 0,80, or a duration in seconds (1:30) */
const amount = (s: string) => s.replace(',', '.').split(':').reduce((n, x) => n * 60 + Number(x), 0);

/**
 * Events written by hand, one per line or separated by ";": a time (as in
 * the timecode field: 3.1, 01:01:12), a label, then what it does to the
 * totals, each change with its sign or = and the value it sets, and after a
 * | its detail.
 *   3.1 Petrol cash -18 | full tank
 *   61 Ice cream: cash -0.80, laughs +1
 *   90 Weigh-in weight =72.5
 */
export function parseEvents(text: string, fps: number): TimedEvent[] {
  const out: TimedEvent[] = [], bad: string[] = [];
  for (const raw of text.split(/[;\n]/)) {
    const line = raw.trim();
    if (!line) continue;
    const [main, ...more] = line.split('|');
    const m = /^(\S+)\s+(.+)$/.exec(main.trim()), at = m ? parseTime(m[1], fps) : null;
    const changes = m ? [...m[2].matchAll(CHANGE)] : [];
    const label = m ? (changes.length ? m[2].slice(0, changes[0].index) : m[2]).trim().replace(/[\s:,]+$/, '') : '';
    if (at === null || !label) { bad.push(line); continue; }
    const values: Record<string, number> = {}, set: Record<string, number> = {}, detail = more.join('|').trim();
    for (const [, key, to, sign, n] of changes) {
      const k = keyOf(key), x = amount(n);
      if (to !== undefined) set[k] = to && to !== '+' ? -x : x;
      else values[k] = (values[k] ?? 0) + (sign === '+' ? x : -x);
    }
    out.push({ id: '', t: at, label, ...(detail ? { detail } : {}), ...(Object.keys(values).length ? { values } : {}), ...(Object.keys(set).length ? { set } : {}) });
  }
  if (bad.length) throw new Error(`events: cannot read ${bad.map((l) => `"${l}"`).join(', ')}: expected "time label key ±value (or key =value) | detail", e.g. "3.1 Petrol cash -18"`);
  return out;
}

/**
 * Totals written as they should look, separated by ";": "Cash: £23.67;
 * Laughs: 00" (a pound sign and two decimals from 23.67; two digits from 0).
 * The label is shown on screen, the key is the label in lower case.
 */
export function parseTotals(text: string): Record<string, TotalSpec> {
  const out: Record<string, TotalSpec> = {};
  for (const part of text.split(/;|\n|,\s+(?=\D)/)) {
    if (!part.trim()) continue;
    const m = /^\s*([^:=]+?)\s*[:=]\s*(.+?)\s*$/.exec(part), n = m && parseFormatted(m[2]);
    if (!m || !n) throw new Error(`totals: cannot read "${part.trim()}": expected "Label: value as it looks", e.g. "Cash: £23.67"`);
    out[keyOf(m[1])] = { label: m[1].trim(), start: n.value, format: n.format };
  }
  return out;
}

/** the numbers of a map given as JSON, keyed as the list keeps them */
const numbers = (m: unknown) => Object.entries(m && typeof m === 'object' ? (m as Record<string, unknown>) : {})
  .filter((kv): kv is [string, number] => typeof kv[1] === 'number' && Number.isFinite(kv[1])).map(([k, v]) => [keyOf(k), v] as const);

/** events given as JSON ({ t, label, detail?, values?, set?, id? }), checked */
function eventsOf(raw: unknown[]): TimedEvent[] {
  return raw.map((x, i) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>, at = Number(o.t);
    const label = typeof o.label === 'string' ? o.label.trim() : '';
    if (!Number.isFinite(at) || at < 0 || !label) throw new Error(`events[${i}]: { t, label, values?, set? } expected, got ${JSON.stringify(x)}`);
    const values = numbers(o.values), set = numbers(o.set);
    return {
      id: typeof o.id === 'string' ? o.id.trim() : '', t: at, label, ...(typeof o.detail === 'string' && o.detail.trim() ? { detail: o.detail.trim() } : {}),
      ...(values.length ? { values: Object.fromEntries(values) } : {}), ...(set.length ? { set: Object.fromEntries(set) } : {}),
    };
  });
}

/** totals given as JSON ({ cash: { label, start, format } }), keyed as the list keeps them */
function totalsOf(raw: object): Record<string, TotalSpec> {
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => {
    const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return [keyOf(k), { ...(typeof o.label === 'string' ? { label: o.label } : {}), ...(typeof o.start === 'number' && Number.isFinite(o.start) ? { start: o.start } : {}), ...(typeof o.format === 'string' ? { format: o.format } : {}) }];
  }));
}

/** an id for each event without one (from its label), each unique, the list in time order */
function withIds(events: TimedEvent[]): TimedEvent[] {
  const taken = new Set<string>();
  return events.map((e) => {
    const base = e.id || slug(e.label) || 'event';
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
    taken.add(id);
    return { ...e, id };
  }).sort((a, b) => a.t - b.t);
}

interface ListArgs { events: string | unknown[]; totals?: string | Record<string, unknown>; name?: string }

const eventList: ToolType<ListArgs> = {
  name: 'events', title: 'Event list', description: 'saves what happens in a story and when: timed events with a label, a detail and what each one does to running totals (money in any currency, laughs, points, kilometres, a weight, a time), as a JSON asset that counters, tags, a receipt and expressions read',
  input: {
    type: 'object',
    properties: {
      events: { type: ['string', 'array'], title: 'Events', description: 'one per line or separated by ";": a time, a label, each change with its sign (or =value to set a total), a detail after |; e.g. "3.1 Petrol cash -18 | full tank; 4.5 Laugh laughs +1; 9 Weigh-in weight =72.5". Or a JSON array of { t, label, detail?, values: { cash: -18 }, set: { weight: 72.5 } }' },
      totals: { type: ['string', 'object'], title: 'Totals', description: 'each total and its value before the first event, written as it should look, separated by ";": "Cash: £23.67; Laughs: 00; Time: 0:00; Days: 0 day|0 days". Or a JSON object { cash: { label, start, format } }' },
      name: { type: 'string', title: 'Name', description: 'saved as the asset events-<name> (the composition\'s id by default); the same name replaces the list' },
    },
    required: ['events'],
  },
  ai: { when: 'a story that keeps score (money spent, laughs, points, kilometres): write its events once, then show them with event-counter, event-tags and event-receipt, or read them in expressions with events(); a value measured rather than added (a weight, a temperature) is set with =value; to move or change an event, save the list again under the same name rather than editing the layers', avoid: 'one list per composition when one story runs through several' },
  async run(a, ctx) {
    const c = compOf(ctx);
    let raw: unknown = a.events, given: unknown = a.totals;
    // JSON pasted in the form: an array of events, or a whole list with its totals
    if (typeof raw === 'string' && /^\s*[[{]/.test(raw)) {
      try { raw = JSON.parse(raw); } catch (e) { throw new Error(`events: invalid JSON (${(e as Error).message})`); }
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) { given ??= (raw as EventList).totals; raw = (raw as EventList).events; }
    }
    const events = withIds(typeof raw === 'string' ? parseEvents(raw, c.fps) : eventsOf(Array.isArray(raw) ? raw : []));
    if (!events.length) throw new Error('events: no event; write them as "time label key ±value", e.g. "3.1 Petrol cash -18; 4.5 Laugh laughs +1"');
    const totals = typeof given === 'string' ? parseTotals(given) : given && typeof given === 'object' ? totalsOf(given) : {};
    const list: EventList = { version: 1, kind: 'events', ...(Object.keys(totals).length ? { totals } : {}), events };
    const name = slug(a.name || ctx.compId).slice(0, 48) || 'story', id = `events-${name}`;
    const path = await ctx.writeFile(`assets/events/${name}.json`, JSON.stringify(list, null, 2));
    const had = ctx.doc.assets[id], entry = { type: 'json' as const, src: path, name: `Events · ${name}` };
    const first = eventsReader(list, -Infinity), end = eventsReader(list, Infinity);
    const late = events.filter((e) => e.t >= c.duration).length;
    return {
      ops: had?.type === 'json' && had.src === entry.src && had.name === entry.name ? [] : [{ op: had ? 'replace' : 'add', path: pointer('assets', id), value: entry }],
      reload: had ? [id] : [],
      label: t('events.listLabel', { name }),
      text: [
        `Event list "${id}" saved in ${path}: ${events.length} event(s) from ${events[0].t} to ${events.at(-1)!.t} s${late ? `, ${late} of them after the end of the composition (${c.duration} s)` : ''}.`,
        end.keys.length ? `Totals: ${end.keys.map((k) => `${k} "${end.label(k)}" from ${first.text(k)} to ${end.text(k)}`).join('; ')}.` : 'No total: its events change no value.',
        `Show it with use_tool "event-counter" (the running totals in a corner), "event-tags" (a tag at each event) and "event-receipt" (every event at the end). In expressions: events('${id}').total(key), .text(key), .change(key), .since(key), .pulse(0.3), .last(), .count. To change it, save it again under the same name: whatever reads it follows.`,
      ].join('\n'),
      notice: t('events.saved', { count: events.length, totals: end.keys.map((k) => `, ${end.label(k)} ${first.text(k)} → ${end.text(k)}`).join('') }),
    };
  },
};

// ── showing it ───────────────────────────────────────────────
type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
const CORNERS: Corner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left'];
/** the dark chip behind each counter and the light type on it; the tags' red */
const CHIP = 'rgba(11,15,18,0.72)', INK = '#F4F1EA', RED = '#E5402A';
const TRACK = 0.04;
const LIST_FIELD = { type: 'string', format: 'asset', assetType: 'json', title: 'Event list', description: 'the project\'s first event list by default' };

/** a string in an expression */
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** the event list a tool works on, read from its file: the one given (its asset id or its name), or the project's first */
async function readList(ctx: ToolContext, wanted?: string): Promise<{ id: string; list: EventList; r: EventsReader }> {
  const lists = Object.entries(ctx.doc.assets).filter(([id, a]) => a.type === 'json' && id.startsWith('events-')).map(([id]) => id);
  const id = !wanted ? lists[0] : ctx.doc.assets[wanted] || !ctx.doc.assets[`events-${wanted}`] ? wanted : `events-${wanted}`;
  if (!id) throw new Error('the project has no event list yet: make one with the events tool');
  if (!ctx.doc.assets[id]) throw new Error(`unknown asset: ${id}${lists.length ? ` (event lists: ${lists.join(', ')})` : ''}`);
  const list = await readJson(ctx, id);
  if (!isEventList(list)) throw new Error(`${id} is not an event list (a JSON { "kind": "events", "events": [...] })`);
  return { id, list, r: eventsReader(list, Infinity) };
}

/** a total of the list, whatever its case */
function totalOf(r: EventsReader, key: string, tool: string): string {
  const found = r.keys.find((k) => k.toLowerCase() === keyOf(key));
  if (!found) throw new Error(`${tool}: the list has no total "${key}" (${r.keys.length ? `its totals: ${r.keys.join(', ')}` : 'its events change no value'})`);
  return found;
}

/** the row of counters in a corner, inside the safe zone: its type size, the chips' padding and height, where it sits */
function hud(c: Composition, corner: Corner) {
  const size = Math.round(Math.min(c.width, c.height) * 0.032);
  const padX = Math.round(size * 0.45), padY = Math.round(size * 0.3), h = Math.round(size * 0.72 + padY * 2), gap = Math.round(size * 0.35);
  const right = corner.endsWith('right'), bottom = corner.startsWith('bottom');
  return { size, padX, padY, h, gap, right, bottom, x: r(c.width * (right ? 0.935 : 0.065)), y: r(bottom ? c.height * 0.925 - h / 2 : c.height * 0.075 + h / 2) };
}

/** the counters made by event-counter in a composition, where they sit */
function countersOf(c: Composition): { x: number; y: number; corner: Corner } | null {
  const id = c.order.find((x) => /^event-counters\d*$/.test(x) && c.layers[x]?.type === 'group');
  const pos = id ? c.layers[id].transform?.position : undefined;
  if (!Array.isArray(pos)) return null;
  const [x, y] = pos as number[];
  return { x, y, corner: `${y > c.height / 2 ? 'bottom' : 'top'}-${x > c.width / 2 ? 'right' : 'left'}` as Corner };
}

interface CounterArgs { events?: string; key?: string; place?: Corner; digits?: number; roll?: number }

const counters: ToolType<CounterArgs> = {
  name: 'event-counter', title: 'Event counters', description: 'the running totals of an event list in a corner of the frame (CASH £05.67, LAUGHS 09), the digits rolling at each change; the counters read the list, so they follow it when it changes',
  input: {
    type: 'object',
    properties: {
      events: LIST_FIELD,
      key: { type: 'string', title: 'Total', description: 'one total of the list; all of them side by side by default' },
      place: { enum: CORNERS, title: 'Corner' },
      digits: { type: 'integer', minimum: 1, maximum: 9, title: 'Digits', description: 'at least this many digits before the decimal mark, zeros in front (2 by default, more when a total needs them)' },
      roll: { type: 'number', minimum: 0, maximum: 3, title: 'Roll (s)', description: 'how long the digits roll at each change (0.45 by default); 0 jumps' },
    },
  },
  ai: { when: 'keeping score on screen through a story: one counter per total in a corner, then event-tags puts a tag above them at each event', avoid: 'more than three totals in one corner' },
  async run(a, ctx) {
    const { id, list, r: end } = await readList(ctx, a.events);
    const keys = a.key ? [totalOf(end, a.key, 'event-counter')] : end.keys;
    if (!keys.length) throw new Error(`event-counter: ${id} keeps no total (its events change no value)`);
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), H = hud(c, a.place ?? 'bottom-right'), weight = 700, roll = a.roll ?? 0.45;
    const font = s.font ? { font: s.font } : {};
    // every value a total takes, for the digits it needs and the width of its chip
    const moments = [-Infinity, ...end.list.map((e) => e.t)];
    const items = keys.map((key) => {
      const values = moments.map((at) => eventsReader(list, at).total(key));
      const digits = a.digits ?? Math.max(2, ...values.map((v) => String(Math.floor(Math.abs(v))).length));
      const label = end.label(key).toUpperCase(), lw = measure(doc, label, H.size, weight, s.font) + TRACK * H.size * (label.length - 1);
      const vw = Math.max(...values.map((v) => counterWidth(doc, end.format(v, key, { digits }), H.size, weight, s.font)));
      return { key, digits, label, lw, w: H.padX * 2 + lw + H.gap + vw };
    });
    const { add, done } = adder(doc, ctx.compId);
    const children: string[] = [];
    // laid out from the corner: leftwards from a right corner, rightwards from a left one
    let left = H.right ? -(items.reduce((n, it) => n + it.w, 0) + H.gap * (items.length - 1)) : 0;
    for (const it of items) {
      // the label ends and the value starts on either side of one gap: a font measured wrong moves the chip's edges, never one onto the other
      const src = `events(${q(id)})`, k = q(it.key), name = end.label(it.key), y = r(H.size * CAP), split = left + H.padX + it.lw;
      children.push(add('counter-chip', { type: 'shape.rect', name: t('events.chip', { label: name }), transform: { position: [r(left + it.w / 2), 0] }, props: { size: [r(it.w), H.h], radius: Math.round(H.size * 0.12), fill: CHIP } }, false));
      children.push(add('counter-label', { type: 'text', name, transform: { position: [r(split), y] }, props: { text: it.label, size: H.size, weight, tracking: TRACK, align: 'right', color: INK, ...font } }, false));
      children.push(add('counter-value', {
        type: 'text.counter', name: t('events.value', { label: name }), transform: { position: [r(split + H.gap), y] },
        props: {
          // from the total before the latest change to the total now, back when it went down
          from: { $expr: `const e = ${src}; return e.format(e.previous(${k}), ${k}, { digits: ${it.digits} });` },
          to: { $expr: `${src}.text(${k}, ${it.digits})` },
          progress: roll > 0 ? { $expr: `ease(${JSON.stringify(s.enter)}, clamp(${src}.since(${k}) / ${roll}, 0, 1))` } : 1,
          direction: { $expr: `${src}.change(${k}) < 0 ? 'down' : 'up'` },
          turns: 0, size: H.size, weight, tracking: 0, align: 'left', color: INK, ...font,
        },
      }, false));
      left += it.w + H.gap;
    }
    add('event-counters', { type: 'group', name: t('events.counters'), transform: { position: [H.x, H.y] }, children });
    const shown = items.map((it) => `${it.key} "${it.label}" ${end.format(eventsReader(list, -Infinity).total(it.key), it.key, { digits: it.digits })} → ${end.text(it.key, it.digits)}`);
    return {
      ops: done(), label: t('events.counterLabel', { name: id }),
      text: `Counters of "${id}" in the ${a.place ?? 'bottom-right'} corner (group "event-counters", one chip, label and text.counter per total): ${shown.join(', ')}. ${roll > 0 ? `The digits roll for ${roll} s at each change, back when the total goes down.` : 'The values jump at each change.'} They read the list through events('${id}') in their expressions: change the list, not the layers.`,
    };
  },
};

interface TagArgs { events?: string; key?: string; show?: 'change' | 'total' | 'label'; color?: string; hold?: number; animation?: 'pop' | 'snap' | 'rise' | 'fade'; place?: Corner }

const tags: ToolType<TagArgs> = {
  name: 'event-tags', title: 'Event tags', description: 'a tag that pops up at each event of an event list with what it changes (PETROL −£18.00), right above the counters when they are there; one layer that reads the list',
  input: {
    type: 'object',
    properties: {
      events: LIST_FIELD,
      key: { type: 'string', title: 'Total', description: 'only the events that change this total, with that change; every event when empty' },
      show: { enum: ['change', 'total', 'label'], title: 'Shows', description: 'after the label: what the event changes (−£18.00), the total it leaves (£5.67), or nothing' },
      color: { type: 'string', title: 'Colour', description: 'of the tag: "#E5402A" (red) by default, or a colour token such as "@accent"' },
      hold: { type: 'number', minimum: 0.2, maximum: 10, title: 'On screen (s)' },
      animation: { enum: ['pop', 'snap', 'rise', 'fade'], title: 'In' },
      place: { enum: CORNERS, title: 'Corner', description: 'the counters\' corner by default' },
    },
  },
  ai: { when: 'making each event of a story land (the money spent, a point scored); key keeps the events of one total, the others then go without a tag', avoid: 'a red tag over red footage: give it a light colour there' },
  async run(a, ctx) {
    const { id, r: end } = await readList(ctx, a.events);
    const key = a.key ? totalOf(end, a.key, 'event-tags') : '';
    const count = end.list.filter((e) => !key || end.changes(e, key)).length;
    if (!count) throw new Error(`event-tags: no event of ${id} changes ${key}`);
    const color = a.color ?? RED;
    if (color.startsWith('@') ? ctx.doc.tokens[color.slice(1)]?.type !== 'color' : !isColor(color)) throw new Error(`event-tags: "${color}" is not a colour (#E5402A, rgba(...) or a colour token such as @accent)`);
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), row = countersOf(c), corner = a.place ?? row?.corner ?? 'bottom-right', H = hud(c, corner);
    // a row above the counters (below them in a top corner), or the counters' place when there are none
    const at = row && row.corner === corner ? [row.x, r(row.y + (H.bottom ? -1 : 1) * (H.h + H.gap))] : [H.x, H.y];
    const { add, done } = adder(doc, ctx.compId);
    add('event-tags', {
      type: 'events.tag', name: t('events.tags'), transform: { position: at },
      props: {
        events: id, ...(key ? { key } : {}), ...(a.show ? { show: a.show } : {}), hold: a.hold ?? 1.4, animation: a.animation ?? 'pop',
        size: H.size, weight: 700, tracking: TRACK, align: H.right ? 'right' : 'left', fill: color, color: '#FFFFFF',
        padding: [r(H.padX / H.size), r(H.padY / H.size)], radius: Math.round(H.size * 0.12), ...(s.font ? { font: s.font } : {}),
      },
    });
    return {
      ops: done(), label: t('events.tagsLabel', { name: id }),
      text: `Tags of "${id}" (layer "event-tags", type events.tag) at ${at.join(', ')}${row && row.corner === corner ? ', right above the counters' : ''}: ${count} event(s)${key ? ` that change ${key}` : ''}, each tag showing its label${a.show === 'label' ? '' : a.show === 'total' ? ' and the total it leaves' : ' and what it changes'}, ${a.animation ?? 'pop'} in, on screen ${a.hold ?? 1.4} s or until the next one. It reads the list: change the list, not the layer.`,
    };
  },
};

interface ReceiptArgs { events?: string; title?: string; subtitle?: string; column?: 'auto' | 'detail' | 'change' | 'total' | 'none'; totals?: string; at?: number; interval?: number; place?: 'left' | 'center' | 'right' }

const receipt: ToolType<ReceiptArgs> = {
  name: 'event-receipt', title: 'Receipt', description: 'every event of an event list on a receipt, typed a line at a time, with totals at the bottom (SPENT £23.67): the end of a story that kept score; one layer that reads the list',
  input: {
    type: 'object',
    properties: {
      events: LIST_FIELD,
      title: { type: 'string', title: 'Title' },
      subtitle: { type: 'string', title: 'Subtitle', description: 'on the right of the title, e.g. a date' },
      column: { enum: ['auto', 'detail', 'change', 'total', 'none'], title: 'Right column', description: 'auto: the detail of the event, or else what it changes; total: the totals it leaves' },
      totals: { type: 'string', title: 'Totals', description: 'lines at the bottom, "Label: total" separated by ";": -total adds up its decreases, +total its increases, e.g. "Spent: -cash; Change: cash"; every total by default' },
      at: { type: 'number', minimum: 0, title: 'Start (s)', description: 'composition time; by default, early enough to be complete 2.5 s before the end' },
      interval: { type: 'number', minimum: 0.05, maximum: 2, title: 'Line every (s)' },
      place: { enum: ['left', 'center', 'right'], title: 'Place' },
    },
  },
  ai: { when: 'the end of a story that kept score: what happened, then what it came to', avoid: 'more than about 12 lines in a vertical format' },
  async run(a, ctx) {
    const { id, list, r: end } = await readList(ctx, a.events);
    const doc = ctx.doc, c = compOf(ctx), s = style(doc), interval = a.interval ?? 0.3;
    const title = a.title ?? t('events.receipt'), subtitle = a.subtitle ?? '';
    const totals = a.totals ?? end.keys.map((k) => `${end.label(k)}: ${k}`).join('; ');
    const rows = receiptRows(list, { title, subtitle, column: a.column ?? 'auto', numbered: true, totals, uppercase: true });
    // typed in full one interval after its last line starts
    const reveal = (rowStarts(rows, interval).at(-1) ?? 0) + interval;
    const at = r(a.at ?? Math.max(0, c.duration - reveal - 2.5));
    const place = a.place ?? (c.width > c.height ? 'left' : 'center');
    const x = place === 'left' ? c.width * 0.065 : place === 'right' ? c.width * 0.935 : c.width / 2;
    const { add, done } = adder(doc, ctx.compId);
    add('receipt', {
      type: 'events.receipt', name: t('events.receipt'), in: at, transform: { position: [r(x), r(c.height * 0.15)] },
      props: { events: id, title, subtitle, ...(a.column ? { column: a.column } : {}), totals, interval, size: Math.round(Math.min(c.width, c.height) * 0.03), align: place, ...(s.font ? { font: s.font } : {}) },
    });
    const complete = r(at + reveal);
    return {
      ops: done(), label: t('events.receiptLabel', { name: id }),
      text: `Receipt of "${id}" (layer "receipt", type events.receipt) from ${at} s: ${rows.length} line(s) typed one every ${interval} s, complete at ${complete} s, on screen until the end (${c.duration} s). Totals: ${totals || 'none'}.${complete > c.duration ? ' The composition ends before its last line: start it earlier (at) or lengthen the composition.' : ''} It reads the list: change the list, not the layer.`,
    };
  },
};

export const EVENT_TOOLS: ToolType[] = [eventList, counters, tags, receipt];
