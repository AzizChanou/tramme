import { describe, expect, it } from 'vitest';
import { compileExpr, cubicBezier, Evaluator, mixColor, sampleKeyframes, type TrammeDoc } from '../src/index.ts';
import { makeDoc, registry } from './fixtures.ts';

describe('curves and interpolation', () => {
  it('cubic-bezier goes through its ends and follows the CSS curve', () => {
    const ease = cubicBezier(0.42, 0, 0.58, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBeCloseTo(0.5, 6);
    expect(cubicBezier(0, 0, 1, 1)(0.3)).toBeCloseTo(0.3, 6);
  });

  it('keyframes: before, after, linear, hold, curve token', () => {
    const keys = [{ t: 1, v: 0 }, { t: 2, v: 10, ease: 'hold' as const }, { t: 3, v: 20, ease: '@swift' as const }, { t: 4, v: 30 }];
    const tokens = makeDoc().tokens;
    expect(sampleKeyframes('number', keys, 0, tokens)).toBe(0);
    expect(sampleKeyframes('number', keys, 1.5, tokens)).toBe(5);
    expect(sampleKeyframes('number', keys, 2.9, tokens)).toBe(10);
    expect(sampleKeyframes('number', keys, 3.5, tokens)).toBeCloseTo(20 + 10 * cubicBezier(0.16, 1, 0.3, 1)(0.5), 9);
    expect(sampleKeyframes('number', keys, 9, tokens)).toBe(30);
  });

  it('colors: tokens resolved before mixing', () => {
    const tokens = makeDoc().tokens;
    const keys = [{ t: 0, v: '@ink' }, { t: 1, v: '#FFFFFF' }];
    expect(sampleKeyframes('color', keys, 0, tokens)).toBe('#1C1917');
    expect(sampleKeyframes('color', keys, 0.5, tokens)).toBe(mixColor('#1C1917', '#FFFFFF', 0.5));
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('expressions', () => {
  const scope = (over = {}) => ({
    t: 2, frame: 60, fps: 30, value: 5, comp: { width: 10, height: 10, duration: 1, fps: 30 },
    prop: () => 0, token: () => 0, marker: () => ({ t: 0, frame: 0 }), ease: (_: unknown, x: number) => x, ...over,
  });

  it('an expression or a body with return', () => {
    expect(compileExpr('value + t * 2')(scope())).toBe(9);
    expect(compileExpr('const k = clamp(t, 0, 1);\nreturn [k, value];')(scope())).toEqual([1, 5]);
    expect(compileExpr('linear(t, 1, 3, [0, 0], [10, 20])')(scope())).toEqual([5, 10]);
  });

  it('browser globals and randomness are out of reach', () => {
    expect(compileExpr('typeof window + typeof document + typeof fetch + typeof Date')(scope())).toBe('undefinedundefinedundefinedundefined');
    expect(() => compileExpr('Math.random()')(scope())).toThrow(/Math.random/);
    expect(compileExpr('random(3)')(scope())).toBe(compileExpr('random(3)')(scope()));
    expect(() => compileExpr('leak = 1')(scope())).toThrow();
  });

  it('syntax error reported with the source', () => {
    expect(() => compileExpr('value +')).toThrow(/value \+/);
  });
});

describe('evaluation', () => {
  const ev = (doc: TrammeDoc = makeDoc()) => new Evaluator(doc, registry());

  it('frame tree: in/out, groups, defaults, tokens', () => {
    const f0 = ev().frame(1);
    expect(f0.layers.map((l) => l.id)).toEqual(['bg']);
    expect(f0.background).toBe('#1C1917');
    expect(f0.layers[0].props.fill).toBe('#F5F0E8');
    expect(f0.layers[0].transform).toEqual({ anchor: [0, 0], position: [0, 0], scale: [1, 1], rotation: 0, opacity: 1 });
    const f = ev().frame(2.5);
    expect(f.layers.map((l) => l.id)).toEqual(['bg', 'grp']);
    expect(f.layers[1].children.map((l) => l.id)).toEqual(['a', 'b']);
    expect(ev().frame(4).layers.map((l) => l.id)).toEqual(['bg']);
  });

  it('links and prop() read the same frame; dependencies are recorded', () => {
    const e = ev();
    const f = e.frame(1.5);
    expect(e.value('a.radius', 1.5)).toBe(10);
    expect(e.value('b.radius', 1.5)).toBe(10);
    expect(e.value('b.size', 1.5)).toEqual([20, 100]);
    expect(f.motionBlur).toEqual({ samples: 8, shutter: 0.5 });
    expect([...e.deps.get('b.size')!]).toEqual(['a.radius']);
  });

  it('markers and frame in expressions (seed frozen during the hold)', () => {
    const e = ev();
    expect(e.frame(1).effects[0].props).toEqual({ amount: 0.02, seed: 31 });
    expect(e.frame(9.5).effects[0].props.seed).toBe(271);
  });

  it('expression on top of keyframes: value is the interpolated value', () => {
    const doc = makeDoc();
    (doc.compositions.main.layers.a.props as any).radius = { $k: [{ t: 0, v: 0 }, { t: 2, v: 20 }], $expr: 'value * 2' };
    expect(ev(doc).value('a.radius', 1)).toBe(20);
  });

  it('circular dependency detected', () => {
    const doc = makeDoc();
    (doc.compositions.main.layers.a.props as any).radius = { $expr: "prop('b.radius') + 1" };
    expect(() => ev(doc).value('a.radius', 1)).toThrow(/circular/);
  });

  it('pure function of t: two evaluations give the same result', () => {
    const a = ev().frame(2.73), b = ev().frame(2.73);
    const strip = (f: any) => JSON.stringify(f.layers.map((l: any) => [l.id, l.props, l.transform]));
    expect(strip(a)).toBe(strip(b));
  });
});
