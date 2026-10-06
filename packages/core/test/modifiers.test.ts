import { describe, expect, it } from 'vitest';
import { Evaluator, springStep, validate, type TrammeDoc } from '../src/index.ts';
import { makeDoc, registry } from './fixtures.ts';

function withProp(radius: unknown, extra: (d: TrammeDoc) => void = () => {}): Evaluator {
  const doc = makeDoc();
  (doc.compositions.main.layers.bg.props as any).radius = radius;
  extra(doc);
  return new Evaluator(doc, registry());
}

describe('modifiers', () => {
  it('wiggle: deterministic, bounded, varying over time, on a fixed value { $v }', () => {
    const ev = withProp({ $v: 100, $mod: [{ type: 'wiggle', freq: 3, amp: 10 }] });
    const a = ev.value('bg.radius', 1.234) as number;
    expect(ev.value('bg.radius', 1.234)).toBe(a);
    expect(new Evaluator(ev.doc, registry()).value('bg.radius', 1.234)).toBe(a);
    const vs = Array.from({ length: 200 }, (_, i) => ev.value('bg.radius', i / 30) as number);
    expect(Math.max(...vs) - Math.min(...vs)).toBeGreaterThan(5);
    expect(vs.every((v) => v > 88 && v < 112)).toBe(true);
  });

  it('wiggle on a vector: each component moves its own way', () => {
    const doc = makeDoc();
    doc.compositions.main.layers.bg.transform = { position: { $v: [100, 100], $mod: [{ type: 'wiggle', amp: 20 }] } };
    const p = new Evaluator(doc, registry()).value('bg.transform.position', 0.7) as number[];
    expect(p[0]).not.toBeCloseTo(p[1], 3);
  });

  it('loop: cycle, pingpong and offset after the last keyframe', () => {
    const keys = [{ t: 0, v: 0 }, { t: 1, v: 10 }];
    const cycle = withProp({ $k: keys, $mod: [{ type: 'loop' }] });
    expect(cycle.value('bg.radius', 1.25)).toBeCloseTo(2.5, 6);
    expect(cycle.value('bg.radius', 3.5)).toBeCloseTo(5, 6);
    const pp = withProp({ $k: keys, $mod: [{ type: 'loop', mode: 'pingpong' }] });
    expect(pp.value('bg.radius', 1.25)).toBeCloseTo(7.5, 6);
    const off = withProp({ $k: keys, $mod: [{ type: 'loop', mode: 'offset' }] });
    expect(off.value('bg.radius', 2.5)).toBeCloseTo(25, 6);
  });

  it('spring: starts from the first keyframe, overshoots when lightly damped, settles', () => {
    const ev = withProp({ $k: [{ t: 0, v: 0 }, { t: 0.5, v: 100 }], $mod: [{ type: 'spring', freq: 2, damping: 0.3 }] });
    expect(ev.value('bg.radius', 0)).toBe(0);
    const vs = Array.from({ length: 120 }, (_, i) => ev.value('bg.radius', i / 30) as number);
    expect(Math.max(...vs)).toBeGreaterThan(110);
    expect(ev.value('bg.radius', 6)).toBeCloseTo(100, 1);
    expect(springStep(10, 2, 1)).toBeCloseTo(1, 6);
  });

  it('stagger: each sibling is offset by its rank', () => {
    const doc = makeDoc();
    const L = doc.compositions.main.layers;
    const anim = { $k: [{ t: 2, v: 0 }, { t: 3, v: 100 }], $mod: [{ type: 'stagger', delay: 0.5 }] };
    (L.a.props as any).radius = anim;
    (L.b.props as any).radius = anim;
    const ev = new Evaluator(doc, registry());
    expect(ev.value('a.radius', 2.5)).toBeCloseTo(50, 6); // rank 0
    expect(ev.value('b.radius', 2.5)).toBeCloseTo(0, 6);  // rank 1: half a second later
    expect(ev.value('b.radius', 3)).toBeCloseTo(50, 6);
  });

  it('modifiers chain: base(t) sees the previous ones', () => {
    const ev = withProp({ $k: [{ t: 0, v: 0 }, { t: 1, v: 10 }], $mod: [{ type: 'loop' }, { type: 'smooth', window: 0 }] });
    expect(ev.value('bg.radius', 1.5)).toBeCloseTo(5, 6);
  });

  it('validation: unknown type, unknown parameter, non-numeric property type, $mod on a raw value', () => {
    const issues = (radius: unknown, prop = 'radius') => {
      const doc: any = makeDoc();
      doc.compositions.main.layers.bg.props[prop] = radius;
      return validate(doc, registry()).map((i) => i.message);
    };
    expect(issues({ $v: 1, $mod: [{ type: 'wobble' }] })[0]).toMatch(/unknown modifier "wobble"/);
    expect(issues({ $v: 1, $mod: [{ type: 'wiggle', speed: 2 }] })[0]).toMatch(/unknown parameter/);
    expect(issues({ $v: '#fff', $mod: [{ type: 'wiggle' }] }, 'fill')[0]).toMatch(/numbers and vectors/);
    expect(issues({ $v: 2, $mod: [{ type: 'wiggle', amp: 3 }] })).toEqual([]);
    expect(issues({ $foo: 1 })[0]).toMatch(/reserved key/);
  });

  it('near: deterministic, and the amount lands where the pointer is parked', () => {
    // layer a sits on bg ([0, 0]) until t = 2, then travels to [100, 200] by t = 3
    const withNear = (mod: Record<string, unknown>) => {
      const doc = makeDoc();
      (doc.compositions.main.layers.bg.props as any).radius = { $v: 100, $mod: [{ type: 'near', source: 'a', radius: 300, amount: 10, damping: 1, ...mod }] };
      return new Evaluator(doc, registry());
    };
    // parked far (past the radius): the offset is exactly 0
    expect((withNear({ radius: 100 }).value('bg.radius', 8) as number)).toBe(100);
    // parked on the layer: the offset is exactly the amount
    expect(withNear({}).value('bg.radius', 1.5)).toBeCloseTo(110, 6);
    // no source: the value passes through
    const none = withNear({});
    (none.doc.compositions.main.layers.bg.props as any).radius = { $v: 100, $mod: [{ type: 'near', amount: 10 }] };
    expect(none.value('bg.radius', 1.5)).toBe(100);
    // deterministic across evaluators
    const ev = withNear({ damping: 0.4 });
    const v = ev.value('bg.radius', 2.7) as number;
    expect(ev.value('bg.radius', 2.7)).toBe(v);
    expect(new Evaluator(ev.doc, registry()).value('bg.radius', 2.7)).toBe(v);
  });

  it('near: the offset follows the falloff, moves while the pointer passes, and settles', () => {
    const doc = makeDoc();
    (doc.compositions.main.layers.bg.props as any).radius = { $v: 100, $mod: [{ type: 'near', source: 'a', radius: 300, amount: 10, damping: 0.5 }] };
    const ev = new Evaluator(doc, registry());
    // pointer parked at [100, 200] (distance 223.6): smoothstep of 0.745 of the radius
    expect(ev.value('bg.radius', 9)).toBeCloseTo(100 + 10 * 0.1615, 1);
    // while it travels (t 2 to 3) the value moves
    const vs = Array.from({ length: 90 }, (_, i) => ev.value('bg.radius', 2 + i / 30) as number);
    expect(Math.max(...vs) - Math.min(...vs)).toBeGreaterThan(3);
    // and it has settled well before t = 9
    expect(Math.abs((ev.value('bg.radius', 9) as number) - (ev.value('bg.radius', 8.5) as number))).toBeLessThan(0.2);
  });

  it('near: one axis of a vector, and pushing away from the pointer', () => {
    const doc = makeDoc();
    const L = doc.compositions.main.layers;
    (L.bg.props as any).size = { $v: [100, 100], $mod: [{ type: 'near', source: 'a', radius: 300, amount: 5, axis: 'y', damping: 1 }] };
    expect(new Evaluator(doc, registry()).value('bg.size', 1.5)).toEqual([100, 105]);
    // push: bg moves away from a parked at [100, 200], along [0, 0] - [100, 200]
    const doc2 = makeDoc();
    doc2.compositions.main.layers.bg.transform = { position: { $v: [0, 0], $mod: [{ type: 'near', source: 'a', radius: 300, amount: 10, mode: 'push', damping: 1 }] } };
    const p = new Evaluator(doc2, registry()).value('bg.transform.position', 9) as number[];
    expect(p[0]).toBeCloseTo(10 * 0.1615 * (-100 / 223.6), 1);
    expect(p[1]).toBeCloseTo(10 * 0.1615 * (-200 / 223.6), 1);
  });

  it('near: validation of the source and the parameters', () => {
    const issues = (mod: Record<string, unknown>) => {
      const doc: any = makeDoc();
      doc.compositions.main.layers.bg.props.radius = { $v: 1, $mod: [{ type: 'near', ...mod }] };
      return validate(doc, registry()).map((i) => i.message);
    };
    expect(issues({ source: 'a', amount: 3 })).toEqual([]);
    expect(issues({ source: 'nope' })[0]).toMatch(/unknown layer/);
    expect(issues({ speed: 2 })[0]).toMatch(/unknown parameter/);
  });
});
