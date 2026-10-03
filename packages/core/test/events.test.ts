import { describe, expect, it } from 'vitest';
import { Evaluator, eventsReader, formatValue, parseFormatted, type EventList, type TrammeDoc } from '../src/index.ts';
import { registry } from './fixtures.ts';

const trip: EventList = {
  version: 1, kind: 'events',
  totals: { cash: { label: 'Cash', start: 23.67, format: '£0.00' } },
  events: [
    { id: 'petrol', t: 3, label: 'Petrol', values: { cash: -18 } },
    // out of order on purpose: the list is read in time order
    { id: 'laugh', t: 2, label: 'Laugh', values: { laughs: 1 } },
    { id: 'chips', t: 61, label: 'Chips', detail: 'the gull', values: { cash: -3.2, laughs: 1 } },
    { id: 'note', t: 70, label: 'Note' },
  ],
};

describe('numbers as they are written', () => {
  it('follow a pattern: prefix, digits, decimals, grouping, unit', () => {
    expect(formatValue(-18, '£0.00')).toBe('−£18.00');
    expect(formatValue(5.67, '£0.00', { digits: 2 })).toBe('£05.67');
    expect(formatValue(9, '00')).toBe('09');
    expect(formatValue(1250, '#,##0')).toBe('1,250');
    expect(formatValue(1250.5, '#,##0.00')).toBe('1,250.50');
    expect(formatValue(3.2, '0,00 €')).toBe('3,20 €');
    expect(formatValue(1234.5, '# ##0,00 €')).toBe('1 234,50 €');
    expect(formatValue(0.5, '0.##')).toBe('0.5');
    expect(formatValue(2, '0.##')).toBe('2');
    expect(formatValue(0.25, '0.000')).toBe('0.250');
  });

  it('sign gains when asked, losses always, zero never', () => {
    expect(formatValue(1, '0', { signed: true })).toBe('+1');
    expect(formatValue(-0.8, '£0.00', { signed: true })).toBe('−£0.80');
    expect(formatValue(0, '£0.00', { signed: true })).toBe('£0.00');
    expect(formatValue(-0.001, '0.00')).toBe('0.00');
  });

  it('read an example as its pattern', () => {
    expect(parseFormatted('£23.67')).toEqual({ value: 23.67, format: '£0.00' });
    expect(parseFormatted('00')).toEqual({ value: 0, format: '00' });
    expect(parseFormatted('1,250')).toEqual({ value: 1250, format: '#,##0' });
    expect(parseFormatted('0,50 €')).toEqual({ value: 0.5, format: '0,00 €' });
    expect(parseFormatted('−£5.00')).toEqual({ value: -5, format: '£0.00' });
    expect(parseFormatted('none')).toBeNull();
    for (const s of ['£23.67', '1,250', '0,50 €', '09']) expect(formatValue(parseFormatted(s)!.value, parseFormatted(s)!.format)).toBe(s);
    // an example given where a pattern is expected
    expect(formatValue(5, '£23.67')).toBe('£5.00');
  });

  it('write one and many, and durations', () => {
    expect([1, 3, 0].map((n) => formatValue(n, '0 day|0 days'))).toEqual(['1 day', '3 days', '0 days']);
    expect(formatValue(166, '00:00')).toBe('02:46');
    expect(formatValue(3766, '0:00:00')).toBe('1:02:46');
    expect(formatValue(90.5, '0:00.0')).toBe('1:30.5');
    expect(formatValue(59.96, '0:00')).toBe('1:00');
    expect(formatValue(-30, '0:00')).toBe('−0:30');
    expect(formatValue(30, '0:00', { signed: true })).toBe('+0:30');
    expect(formatValue(166, '0:00', { digits: 2 })).toBe('02:46');
    expect(parseFormatted('02:46')).toEqual({ value: 166, format: '00:00' });
    expect(parseFormatted('1:30.5 min')).toEqual({ value: 90.5, format: '0:00.0 min' });
  });
});

describe('an event list read at time t', () => {
  it('keeps running totals from their start', () => {
    const before = eventsReader(trip, 0);
    expect(before.count).toBe(0);
    expect(before.total('cash')).toBe(23.67);
    expect(before.last()).toBeNull();
    expect(before.since()).toBe(Infinity);
    expect(before.pulse()).toBe(0);
    expect(before.text('cash')).toBe('£23.67');
    expect(before.text('laughs', 2)).toBe('00');
    const end = eventsReader(trip, 100);
    expect(end.total('cash')).toBe(2.47);
    expect(end.losses('cash')).toBe(21.2);
    expect(end.gains('cash')).toBe(0);
    expect(end.total('laughs')).toBe(2);
    expect(end.list.map((e) => e.id)).toEqual(['laugh', 'petrol', 'chips', 'note']);
  });

  it('knows the latest change: what it was, from what, how long ago', () => {
    const at = eventsReader(trip, 3);
    expect(at.total('cash')).toBe(5.67);
    expect(at.previous('cash')).toBe(23.67);
    expect(at.change('cash')).toBe(-18);
    expect(at.since('cash')).toBe(0);
    expect(at.pulse(0.3, 'cash')).toBe(1);
    expect(at.count).toBe(2);
    expect(at.last()?.id).toBe('petrol');
    expect(at.last('laughs')?.id).toBe('laugh');
    const later = eventsReader(trip, 10);
    expect(later.since('cash')).toBe(7);
    expect(later.pulse(0.3, 'cash')).toBeCloseTo(Math.exp(-7 / 0.3));
    expect(later.next('cash')?.id).toBe('chips');
    expect(eventsReader(trip, 65).next()?.id).toBe('note');
    expect(eventsReader(trip, 65).next('cash')).toBeNull();
    // two purchases at once: one change, from the total before both
    const both: EventList = { ...trip, events: [...trip.events, { id: 'gum', t: 3, label: 'Gum', values: { cash: -0.5 } }] };
    expect(eventsReader(both, 3).previous('cash')).toBe(23.67);
    expect(eventsReader(both, 3).change('cash')).toBe(-18.5);
  });

  it('writes each change with its total\'s format, and names the totals', () => {
    const r = eventsReader(trip, 0), chips = r.find('chips')!;
    expect(chips.detail).toBe('the gull');
    expect(r.changes(chips)).toBe('−£3.20  +1');
    expect(r.changes(chips, 'cash')).toBe('−£3.20');
    expect(r.keys).toEqual(['cash', 'laughs']);
    expect([r.label('cash'), r.label('laughs')]).toEqual(['Cash', 'Laughs']);
    // without a format: as many decimals as the values have
    const walk: EventList = { version: 1, kind: 'events', events: [{ id: 'a', t: 1, label: 'Hill', values: { km: 1.5 } }, { id: 'b', t: 2, label: 'Lake', values: { km: 2 } }] };
    expect(eventsReader(walk, 5).text('km')).toBe('3.5');
    expect(eventsReader(walk, 1.5).text('km')).toBe('1.5');
  });

  it('takes the values an event sets, whatever the total was', () => {
    const weigh: EventList = { version: 1, kind: 'events', totals: { weight: { start: 75, format: '0.0 kg' } }, events: [
      { id: 'a', t: 1, label: 'Weigh-in', set: { weight: 73.5 } },
      { id: 'b', t: 2, label: 'Feast', values: { weight: 0.5 } },
      // the same value as before: not an event of this total
      { id: 'c', t: 3, label: 'Weigh-in', set: { weight: 74 } },
    ] };
    expect(eventsReader(weigh, 1.5).total('weight')).toBe(73.5);
    expect(eventsReader(weigh, 1.5).change('weight')).toBe(-1.5);
    expect(eventsReader(weigh, 3.5).total('weight')).toBe(74);
    expect(eventsReader(weigh, 3.5).last('weight')?.id).toBe('b');
    expect(eventsReader(weigh, 9).losses('weight')).toBe(1.5);
    const r = eventsReader(weigh, 0), [a, b, c] = r.list;
    expect([r.changes(a), r.after(a), r.changes(b), r.after(b), r.changes(c)]).toEqual(['−1.5 kg', '73.5 kg', '+0.5 kg', '74.0 kg', '']);
  });

  it('says nothing when there is no list', () => {
    const r = eventsReader(undefined, 3);
    expect(r.total('cash')).toBe(0);
    expect(r.text('cash', 2)).toBe('00');
    expect(r.since()).toBe(Infinity);
  });
});

describe('events() in expressions', () => {
  function doc(): TrammeDoc {
    return {
      schema: 'tramme/1', meta: { title: 'Trip' }, tokens: {}, root: 'main',
      assets: { 'events-trip': { type: 'json', src: 'assets/events/trip.json' } },
      compositions: { main: { name: 'Main', width: 100, height: 100, fps: 30, duration: 90, order: ['hud'], layers: {
        hud: {
          type: 'box', props: { label: { $expr: "events('events-trip').text('cash', 2)" }, radius: { $expr: "events('trip').total('cash')" } },
          // the kick of docs/document.md
          transform: { scale: { $expr: "add(value, mul([1, 1], 0.08 * events('events-trip').pulse(0.25)))" } },
        },
      } } },
    };
  }
  const data = (id: string) => (id === 'events-trip' ? trip : undefined);

  it('read the running totals at the time evaluated, by asset id or by the name of the list', () => {
    const ev = new Evaluator(doc(), registry(), { data });
    expect(ev.value('hud.label', 1)).toBe('£23.67');
    expect(ev.value('hud.label', 4)).toBe('£05.67');
    expect(ev.value('hud.radius', 62)).toBe(2.47);
    expect(ev.value('hud.transform.scale', 3)).toEqual([1.08, 1.08]);
    expect(ev.value('hud.transform.scale', 1)).toEqual([1, 1]);
  });

  it('stay neutral without the list loaded', () => {
    const ev = new Evaluator(doc(), registry());
    expect(ev.value('hud.label', 4)).toBe('00');
    expect(ev.value('hud.radius', 4)).toBe(0);
  });
});
