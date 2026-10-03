import { describe, expect, it } from 'vitest';
import { applyOps, Evaluator, runChecks, validate, type ToolContext, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { parseEvents, parseTotals } from '../src/events.ts';
import { editorRegistry } from '../src/vocabulary.ts';

const reg = editorRegistry();

/** a project and the files its tools write */
function project(width = 1920, height = 1080) {
  return { doc: newProject({ name: 'Day out', width, height, fps: 24, duration: 20 }).doc, files: new Map<string, string>() };
}

function context(doc: TrammeDoc, files: Map<string, string>): ToolContext {
  return {
    doc, compId: doc.root, time: 0, selection: [], registry: reg,
    assetUrl: (id: string) => `data:application/json,${encodeURIComponent(files.get(doc.assets[id].src) ?? '')}`,
    writeFile: async (path: string, data: Blob | string) => { files.set(path, String(data)); return path; },
    readText: async (path: string) => files.get(path) ?? null,
    signal: new AbortController().signal,
  } as unknown as ToolContext;
}

/** run a tool of the vocabulary as the / menu and the assistant do, and apply its operations */
async function use(p: { doc: TrammeDoc; files: Map<string, string> }, name: string, input: Record<string, unknown>) {
  const out = await reg.tool(name).tool.run(input, context(p.doc, p.files)) as { ops?: never[]; text?: string; reload?: string[] };
  if (out.ops?.length) p.doc = applyOps(p.doc, out.ops).doc;
  return out;
}

const data = (p: { doc: TrammeDoc; files: Map<string, string> }) => (id: string) => { const a = p.doc.assets[id]; return a && p.files.has(a.src) ? JSON.parse(p.files.get(a.src)!) : undefined; };

const DAY = '2.85 Laugh laughs +1; 3.1 Petrol cash -18 | full tank; 6 Rope cash -1.20; 9.5 Chips: cash -3.20, laughs +1 | the gull; 12 Ice cream cash -0.80';

describe('event lists written by hand', () => {
  it('read a time, a label, the changes with their signs and a detail', () => {
    expect(parseEvents('3.1 Petrol cash -18 | full tank\n9.5 Ice cream: cash -0,80, laughs +1; 00:12:12 Fin', 24)).toEqual([
      { id: '', t: 3.1, label: 'Petrol', detail: 'full tank', values: { cash: -18 } },
      { id: '', t: 9.5, label: 'Ice cream', values: { cash: -0.8, laughs: 1 } },
      { id: '', t: 12.5, label: 'Fin' },
    ]);
    expect(() => parseEvents('soon Petrol cash -18', 24)).toThrow(/soon Petrol/);
  });

  it('read values set with =, durations, and a number that belongs to the label', () => {
    expect(parseEvents('90 Weigh-in weight =72.5; 95 Cold snap temp =-3; 100 Lap time +1:30; 120 COVID-19 test tests : +1', 24)).toEqual([
      { id: '', t: 90, label: 'Weigh-in', set: { weight: 72.5 } },
      { id: '', t: 95, label: 'Cold snap', set: { temp: -3 } },
      { id: '', t: 100, label: 'Lap', values: { time: 90 } },
      { id: '', t: 120, label: 'COVID-19 test', values: { tests: 1 } },
    ]);
    expect(parseTotals('Time: 0:00; Days: 0 day|0 days')).toEqual({ time: { label: 'Time', start: 0, format: '0:00' }, days: { label: 'Days', start: 0, format: '0 day|0 days' } });
  });

  it('read totals written as they should look', () => {
    expect(parseTotals('Cash: £23.67; Laughs: 00')).toEqual({ cash: { label: 'Cash', start: 23.67, format: '£0.00' }, laughs: { label: 'Laughs', start: 0, format: '00' } });
    expect(parseTotals('Argent : 23,67 €, Rires : 0')).toEqual({ argent: { label: 'Argent', start: 23.67, format: '0,00 €' }, rires: { label: 'Rires', start: 0, format: '0' } });
    expect(() => parseTotals('Cash')).toThrow(/Cash/);
  });
});

describe('the event tools', () => {
  it('save a list as a JSON asset, then again under the same name without a new asset', async () => {
    const p = project();
    const out = await use(p, 'events', { events: DAY, totals: 'Cash: £23.67' });
    expect(p.doc.assets['events-main']).toEqual({ type: 'json', src: 'assets/events/main.json', name: 'Events · main' });
    const list = JSON.parse(p.files.get('assets/events/main.json')!);
    expect(list.kind).toBe('events');
    expect(list.events.map((e: { id: string }) => e.id)).toEqual(['laugh', 'petrol', 'rope', 'chips', 'ice-cream']);
    expect(out.text).toMatch(/cash "Cash" from £23\.67 to £0\.47/);
    const again = await use(p, 'events', { events: [{ t: 1, label: 'Laugh', values: { Laughs: 1 } }] });
    expect(again.ops).toEqual([]);
    expect(again.reload).toEqual(['events-main']);
    expect(JSON.parse(p.files.get('assets/events/main.json')!).events).toEqual([{ id: 'laugh', t: 1, label: 'Laugh', values: { laughs: 1 } }]);
  });

  for (const [w, h] of [[1920, 1080], [1080, 1920]]) {
    it(`show the totals, a tag at each event and a receipt, which pass the checks (${w}×${h})`, async () => {
      const p = project(w, h);
      await use(p, 'events', { events: DAY, totals: 'Cash: £23.67; Laughs: 0' });
      await use(p, 'event-counter', {});
      await use(p, 'event-tags', { key: 'cash' });
      await use(p, 'event-receipt', { title: 'Inventory', subtitle: 'One day', totals: 'Spent: -cash; Change: cash' });
      expect(validate(p.doc, reg)).toEqual([]);
      const warnings = (await runChecks(p.doc, reg, p.doc.root, { data: data(p) })).filter((i) => i.severity === 'warning');
      expect(warnings.map((i) => i.message)).toEqual([]);
      const c = p.doc.compositions.main;
      // the tags sit right above the counters, aligned on their right edge
      const row = c.layers['event-counters'].transform!.position as number[], tag = c.layers['event-tags'];
      expect((tag.transform!.position as number[])[0]).toBe(row[0]);
      expect((tag.transform!.position as number[])[1]).toBeLessThan(row[1]);
      expect(tag.props).toMatchObject({ events: 'events-main', key: 'cash', align: 'right' });
      // the receipt is complete 2.5 s before the end: eight lines and a beat before the totals, 0.3 s each
      expect(c.layers.receipt.in).toBeCloseTo(20 - 2.5 - 9 * 0.3);
    });
  }

  it('drive the counters with the list: the total now, the one before, the roll and its direction', async () => {
    const p = project();
    await use(p, 'events', { events: DAY, totals: 'Cash: £23.67; Laughs: 0' });
    await use(p, 'event-counter', {});
    const ev = new Evaluator(p.doc, reg, { data: data(p) });
    expect(ev.value('counter-value.to', 1)).toBe('£23.67');
    expect(ev.value('counter-value.to', 4)).toBe('£05.67');
    expect(ev.value('counter-value.from', 4)).toBe('£23.67');
    expect(ev.value('counter-value.progress', 3.1)).toBe(0);
    expect(ev.value('counter-value.progress', 3.6)).toBe(1);
    expect(ev.value('counter-value.direction', 4)).toBe('down');
    expect(ev.value('counter-value2.to', 3)).toBe('01');
    expect(ev.value('counter-value2.direction', 3)).toBe('up');
    expect(ev.value('counter-label.text', 3)).toBe('CASH');
  });

  it('show the total an event leaves rather than its change, on the tags and the receipt', async () => {
    const p = project();
    await use(p, 'events', { events: [{ t: 2, label: 'Birthday', values: { age: 1 } }, { t: 8, label: 'Birthday', values: { age: 1 } }], totals: 'Age: 29 years' });
    await use(p, 'event-tags', { show: 'total' });
    await use(p, 'event-receipt', { column: 'total' });
    expect(validate(p.doc, reg)).toEqual([]);
    const c = p.doc.compositions.main;
    expect(c.layers['event-tags'].props).toMatchObject({ show: 'total' });
    expect(c.layers.receipt.props).toMatchObject({ column: 'total', totals: 'Age: age' });
  });

  it('say what they need', async () => {
    const p = project();
    await expect(use(p, 'event-counter', {})).rejects.toThrow(/no event list/);
    await use(p, 'events', { events: DAY });
    await expect(use(p, 'event-tags', { key: 'points' })).rejects.toThrow(/its totals: laughs, cash/);
    await expect(use(p, 'event-tags', { color: 'red' })).rejects.toThrow(/not a colour/);
  });
});
