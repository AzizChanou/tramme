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
});
