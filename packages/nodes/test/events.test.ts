import { describe, expect, it } from 'vitest';
import type { EventList } from '@tramme/core';
import { receiptRows, rowStarts, tagAt, tagMotion } from '../src/events.ts';

const day: EventList = {
  version: 1, kind: 'events',
  totals: { cash: { label: 'Cash', start: 23.67, format: '£0.00' } },
  events: [
    { id: 'laugh', t: 2.8, label: 'Laugh', values: { laughs: 1 } },
    { id: 'petrol', t: 3, label: 'Petrol', detail: 'Full tank', values: { cash: -18 } },
    { id: 'chips', t: 10, label: 'Chips', values: { cash: -3.2 } },
    { id: 'ice', t: 10.5, label: 'Ice cream', values: { cash: -0.8 } },
  ],
};

describe('the tag of each event', () => {
  it('shows the latest event for its time on screen, the next one cutting it short', () => {
    expect(tagAt(day, '', 2.9, 1.4)?.event.id).toBe('laugh');
    // the laugh does not change the cash
    expect(tagAt(day, 'cash', 2.9, 1.4)).toBeNull();
    expect(tagAt(day, 'cash', 3.5, 1.4)).toMatchObject({ event: { id: 'petrol' }, age: 0.5, cut: false });
    expect(tagAt(day, 'cash', 4.5, 1.4)).toBeNull();
    const cut = tagAt(day, 'cash', 10.2, 1.4)!;
    expect(cut.event.id).toBe('chips');
    expect(cut.cut).toBe(true);
    expect(cut.left).toBeCloseTo(0.3);
  });

  it('pops in, then fades out unless the next tag takes its place', () => {
    expect(tagMotion('pop', 0, 1, false).alpha).toBe(0);
    expect(tagMotion('pop', 0.1, 1, false).scale).toBeGreaterThan(0.55);
    expect(tagMotion('pop', 0.5, 1, false)).toEqual({ scale: 1, lift: 0, alpha: 1 });
    expect(tagMotion('snap', 0, 1, false).alpha).toBe(1);
    expect(tagMotion('snap', 1, 0.09, false).alpha).toBeCloseTo(0.5);
    expect(tagMotion('snap', 1, 0.09, true).alpha).toBe(1);
    expect(tagMotion('rise', 0, 1, false).lift).toBe(1);
  });
});

describe('the receipt', () => {
  const base = { title: 'Inventory', subtitle: 'One day', column: 'auto' as const, numbered: true, totals: 'Spent: -cash; Change: cash', uppercase: true };

  it('lists every event under its heading, the detail or the change on the right, then the totals', () => {
    expect(receiptRows(day, base)).toEqual([
      { left: 'INVENTORY', right: 'ONE DAY', kind: 'head' },
      { left: '01 LAUGH', right: '+1', kind: 'item' },
      { left: '02 PETROL', right: 'FULL TANK', kind: 'item' },
      { left: '03 CHIPS', right: '−£3.20', kind: 'item' },
      { left: '04 ICE CREAM', right: '−£0.80', kind: 'item' },
      { left: 'SPENT', right: '£22.00', kind: 'total' },
      { left: 'CHANGE', right: '£1.67', kind: 'total' },
    ]);
    const plain = receiptRows(day, { ...base, title: '', subtitle: '', column: 'change', numbered: false, totals: 'laughs', uppercase: false });
    expect(plain.map((r) => `${r.left}|${r.right}`)).toEqual(['Laugh|+1', 'Petrol|−£18.00', 'Chips|−£3.20', 'Ice cream|−£0.80', 'Laughs|1']);
    // or the totals each event leaves
    expect(receiptRows(day, { ...base, title: '', column: 'total', totals: '' }).map((r) => r.right)).toEqual(['ONE DAY', '1', '£5.67', '£2.47', '£1.67']);
  });

  it('starts a line every interval, with a beat before the totals', () => {
    expect(rowStarts(receiptRows(day, base), 0.5)).toEqual([0, 0.5, 1, 1.5, 2, 3, 3.5]);
  });
});
