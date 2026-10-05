import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { Evaluator, animatedAddresses, motionFigures, motionReport, runChecks, sampleAddress, scalarFigures, type Layer, type TrammeDoc } from '../src/index.ts';
import { makeDoc, registry } from './fixtures.ts';

describe('the figures of a movement', () => {
  const times = (n: number, to = 1) => Array.from({ length: n }, (_, i) => (to * i) / (n - 1));

  it('a constant speed reads as even, one way, no overshoot — and stops dead', () => {
    const f = scalarFigures(times(11), times(11, 100));
    expect(f).not.toBeNull();
    expect(f!.change).toBeCloseTo(100);
    expect(f!.travel).toBeCloseTo(100);
    expect(f!.evenness).toBeGreaterThan(0.99);
    expect(f!.turns).toBe(0);
    expect(f!.overshoot).toBe(0);
    expect(f!.peak).toBeCloseTo(100);
    expect(f!.settle).toBeUndefined();
  });

  it('an ease-out reads as eased and settled', () => {
    const n = 21, ts = times(n), v = ts.map((t) => 100 * (1 - Math.pow(1 - t, 3)));
    const f = scalarFigures(ts, v)!;
    expect(f.turns).toBe(0);
    expect(f.evenness).toBeLessThan(0.6);
    expect(f.overshoot).toBe(0);
    expect(f.settle).toBeCloseTo(0.8);
  });

  it('passing the end value and coming back is an overshoot with a turn', () => {
    const f = scalarFigures([0, 0.2, 0.4, 0.6, 0.8, 1], [0, 40, 90, 120, 112, 100])!;
    expect(f.change).toBeCloseTo(100);
    expect(f.overshoot).toBeCloseTo(20);
    expect(f.turns).toBeGreaterThanOrEqual(1);
  });

  it('an oscillation turns and never settles; a flat series says nothing', () => {
    const f = scalarFigures([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6], [0, 60, 0, -40, 0, 20, 12])!;
    expect(f.turns).toBeGreaterThanOrEqual(3);
    expect(f.travel).toBeGreaterThan(100);
    expect(f.settle).toBeUndefined();
    expect(scalarFigures([0, 1, 2], [5, 5, 5])).toBeNull();
    expect(scalarFigures([0], [1])).toBeNull();
  });

  it('vectors: the component that travels most', () => {
    const f = motionFigures([0, 0.5, 1], [[0, 0], [5, 1], [10, 2]])!;
    expect(f.change).toBeCloseTo(10);
    const g = motionFigures([0, 1], [[3, 0], [3, 9]])!;
    expect(g.change).toBeCloseTo(9);
  });
});

describe('what moves in a composition', () => {
  it('the animated numeric properties, and only them', () => {
    const ids = animatedAddresses(makeDoc(), registry(), 'main');
    expect(ids).toEqual(expect.arrayContaining(['a.transform.position', 'a.radius', 'b.size', 'b.radius', '$comp.effects.g.seed']));
    expect(ids).not.toContain('bg.size');
    expect(ids).not.toContain('bg.fill');
    expect(ids.every((id) => /transform\.|\.props|\.effects|\.camera|\$comp/.test(id) || !id.startsWith('$') || id.includes('.'))).toBe(true);
  });

  it('the series of one address over a span', () => {
    const ev = new Evaluator(makeDoc(), registry());
    const s = sampleAddress(ev, 'a.transform.position', 'main', 2, 3, 11)!;
    expect(s.times).toHaveLength(11);
    expect(s.values.at(-1)).toEqual([100, 200]);
    expect(sampleAddress(ev, 'bg.fill', 'main', 0, 1)).toBeNull();
  });

  it('the report: the biggest travels first, the figures of the easing', () => {
    const report = motionReport(new Evaluator(makeDoc(), registry()), 'main', 1.9, 3.1);
    expect(report.figures[0].address).toBe('a.transform.position');
    expect(report.figures[0].figures.change).toBeCloseTo(200);
    expect(report.figures[0].figures.evenness).toBeLessThan(0.9);
  });
});

// ── the checks that read the figures ─────────────────────────
function doc(layers: Record<string, Partial<Layer>>): TrammeDoc {
  return {
    schema: 'tramme/1', meta: { title: 'Motion' }, tokens: {}, assets: {}, root: 'main',
    compositions: { main: { name: 'Main', width: 1080, height: 1920, fps: 30, duration: 6, layers: layers as Record<string, Layer>, order: Object.keys(layers) } },
  };
}
const dot = (name: string, position: unknown, extra: Partial<Layer> = {}): Partial<Layer> =>
  ({ type: 'shape.ellipse', name, transform: { position } as never, props: { size: [60, 60] }, ...extra });
const checks = async (d: TrammeDoc) => (await runChecks(d, builtinRegistry())).map((i) => `${i.check}:${(i.layers ?? []).join('+')}`);

describe('the movement checks', () => {
  it('a linear travel is named, an eased one is not', async () => {
    const linear = doc({ dot: dot('Dot', { $k: [{ t: 1, v: [100, 900] }, { t: 1.6, v: [500, 900] }] }, { in: 0.5, out: 2.5 }) });
    expect(await checks(linear)).toContain('linear-travel:dot');
    const eased = doc({ dot: dot('Dot', { $k: [{ t: 1, v: [100, 900], ease: [0.2, 0.8, 0.2, 1] }, { t: 1.6, v: [500, 900] }] }, { in: 0.5, out: 2.5 }) });
    expect((await checks(eased)).some((c) => c.startsWith('linear-travel'))).toBe(false);
  });

  it('a short or small travel stays silent', async () => {
    const d = doc({ dot: dot('Dot', { $k: [{ t: 1, v: [530, 960] }, { t: 1.5, v: [550, 960] }] }) });
    expect((await checks(d)).some((c) => c.startsWith('linear-travel'))).toBe(false);
  });

  it('a loose spring is still moving when its layer leaves; a damped one is not', async () => {
    const loose = doc({
      dot: dot('Dot', { $k: [{ t: 1, v: [100, 900] }, { t: 1.4, v: [500, 900] }], $mod: [{ type: 'spring', freq: 3, damping: 0.12 }] }, { in: 0.5, out: 2.5 }),
    });
    const found = await checks(loose);
    expect(found).toContain('spring-settle:dot');
    const damped = doc({
      dot: dot('Dot', { $k: [{ t: 1, v: [100, 900] }, { t: 1.4, v: [500, 900] }], $mod: [{ type: 'spring', freq: 3, damping: 0.95 }] }, { in: 0.5, out: 2.5 }),
    });
    expect((await checks(damped)).some((c) => c.startsWith('spring-settle'))).toBe(false);
  });

  it('a big bounce past its mark is a note', async () => {
    const bouncy = doc({
      dot: dot('Dot', { $k: [{ t: 1, v: [100, 900] }, { t: 1.4, v: [500, 900] }], $mod: [{ type: 'spring', freq: 2.5, damping: 0.25 }] }, { in: 0.5, out: 3.5 }),
    });
    const issues = await runChecks(bouncy, builtinRegistry());
    const over = issues.find((i) => i.check === 'spring-settle');
    expect(over?.severity).toBe('info');
    expect(over?.message).toMatch(/overshoots its mark by \d+%/);
  });

  it('two layers moving identically are twins; two different movements are not', async () => {
    const twins = doc({
      a: dot('A', { $k: [{ t: 1, v: [100, 900], ease: [0.2, 0.8, 0.2, 1] }, { t: 1.6, v: [500, 900] }] }, { in: 1, out: 3 }),
      b: dot('B', { $k: [{ t: 1, v: [100, 1100], ease: [0.2, 0.8, 0.2, 1] }, { t: 1.6, v: [500, 1100] }] }, { in: 1, out: 3 }),
    });
    expect(await checks(twins)).toContain('twin-motion:a+b');
    const apart = doc({
      a: dot('A', { $k: [{ t: 1, v: [100, 900], ease: [0.2, 0.8, 0.2, 1] }, { t: 1.6, v: [500, 900] }] }, { in: 1, out: 3 }),
      b: dot('B', { $k: [{ t: 1, v: [100, 1100], ease: [0.2, 0.8, 0.2, 1] }, { t: 2.4, v: [500, 1100] }] }, { in: 1, out: 3 }),
    });
    expect((await checks(apart)).some((c) => c.startsWith('twin-motion'))).toBe(false);
  });
});
