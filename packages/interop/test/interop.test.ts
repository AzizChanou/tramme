import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Evaluator, validate, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { fromLottie, imageSize, toLottie, toSvg } from '../src/index.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const load = (p: string): TrammeDoc => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const reg = builtinRegistry();

describe('export Lottie', () => {
  const { lottie, warnings } = toLottie(load('examples/showcase/document.tramme.json'), reg);
  const byName = (layers: any[], nm: string) => layers.find((l) => l.nm === nm);

  it('header, nested compositions as precomps, background as a solid', () => {
    expect(lottie).toMatchObject({ fr: 30, ip: 0, op: 180, w: 1920, h: 1080 });
    expect(lottie.assets.some((a: any) => a.id === 'comp_badge' && a.layers.length === 3)).toBe(true);
    expect(byName(lottie.layers, 'Background')).toMatchObject({ ty: 1, sc: '#0b0d14' });
    expect(byName(lottie.layers, 'Badge 2')).toMatchObject({ ty: 0, refId: 'comp_badge', parent: byName(lottie.layers, 'Badges').ind });
  });

  it('keyframes: time in frames, Bézier curve as o/i tangents', () => {
    const bokeh = byName(lottie.layers, 'Bokeh');
    const op = bokeh.ks.o;
    expect(op.a).toBe(1);
    expect(op.k[0]).toMatchObject({ t: 0, s: [0], o: { x: [0], y: [0] }, i: { x: [1], y: [1] } });
    const blur = bokeh.ef[0].ef[0].v;
    expect(blur.k[0].o).toEqual({ x: [0.16], y: [1] });
    expect(blur.k[0].s[0]).toBeCloseTo(200, 3);
  });

  it('modifiers and expressions baked frame by frame, within 0.01', () => {
    const doc = load('examples/showcase/document.tramme.json');
    const ev = new Evaluator(doc, reg);
    const rot = byName(lottie.layers, 'Badge 2').ks.r;
    expect(rot.a).toBe(1);
    // linear keys between the kept frames reproduce every frame
    for (let f = 41; f <= 80; f++) {
      const i = rot.k.findIndex((k: any, n: number) => k.t <= f && (rot.k[n + 1]?.t ?? Infinity) > f);
      const a = rot.k[i], b = rot.k[i + 1] ?? a;
      const v = b === a ? a.s[0] : a.s[0] + (b.s[0] - a.s[0]) * ((f - a.t) / (b.t - a.t));
      expect(Math.abs(v - (ev.value('b2.transform.rotation', f / 30) as number))).toBeLessThan(0.011);
    }
  });

  it('what Lottie cannot carry is reported', () => {
    expect(warnings.join('\n')).toMatch(/Sparks.*particles/);
    expect(warnings.join('\n')).toMatch(/shader/);
  });
});

describe('import Lottie', () => {
  it('round trip: a valid document, same visible layers, same keyframes', () => {
    const doc = load('examples/showcase/document.tramme.json');
    const { lottie } = toLottie(doc, reg);
    const back = fromLottie(lottie);
    expect(validate(back.doc, reg)).toEqual([]);
    const main = back.doc.compositions.main;
    const names = Object.values(main.layers).map((l) => l.name);
    for (const n of ['Title', 'Badges', 'Badge 1', 'Bokeh', 'Background']) expect(names).toContain(n);
    const bokeh = Object.values(main.layers).find((l) => l.name === 'Bokeh')!;
    expect((bokeh.transform!.opacity as any).$k.map((k: any) => k.t)).toEqual([0, 0.6, 2.6, 3.2]);
    expect(bokeh.effects?.[0]).toMatchObject({ type: 'fx.blur' });
    expect(Object.keys(back.doc.compositions)).toHaveLength(2);
  });

  it('Lottie parents become groups linked to the parent transform', () => {
    const { doc } = fromLottie({
      fr: 30, ip: 0, op: 30, w: 100, h: 100, layers: [
        { ind: 1, ty: 4, nm: 'enfant', parent: 2, ip: 0, op: 30, ks: { p: { a: 0, k: [10, 0, 0] } }, shapes: [{ ty: 'rc', s: { a: 0, k: [10, 10] }, p: { a: 0, k: [0, 0] } }, { ty: 'fl', c: { a: 0, k: [1, 0, 0, 1] }, o: { a: 0, k: 100 } }] },
        { ind: 2, ty: 3, nm: 'pivot', ip: 0, op: 30, ks: { p: { a: 1, k: [{ t: 0, s: [0, 0, 0], o: { x: [0.4], y: [0] }, i: { x: [0.2], y: [1] } }, { t: 30, s: [50, 50, 0] }] } } },
      ],
    });
    expect(validate(doc, reg)).toEqual([]);
    const c = doc.compositions.main;
    const wrapper = Object.values(c.layers).find((l) => l.children?.includes('enfant'))!;
    expect(wrapper.transform!.position).toEqual({ $link: 'pivot.transform.position' });
    expect((c.layers.pivot.transform!.position as any).$k[0].ease).toEqual([0.4, 0, 0.2, 1]);
  });
});

describe('export SVG', () => {
  it('shapes, gradients, clip, filters, text, as vectors', () => {
    const doc = load('examples/hello/document.tramme.json');
    const { svg } = toSvg(doc, reg, 1.5);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="1080" height="1080"/);
    expect(svg).toMatch(/<linearGradient id="g\d+" gradientUnits="userSpaceOnUse"/);
    expect(svg).toMatch(/<rect x="-120" y="-300" width="240" height="600" rx="24"/);
    expect(svg).toMatch(/<ellipse cx="0" cy="0"/);
    expect(svg).toMatch(/<text x="0" y="0"[^>]*text-anchor="middle"[^>]*>Hello<\/text>/);
    const showcase = toSvg(load('examples/showcase/document.tramme.json'), reg, 2);
    expect(showcase.svg).toMatch(/<feGaussianBlur in="SourceGraphic" stdDeviation="/);
    expect(showcase.svg).toMatch(/<feDropShadow/);
    expect(showcase.warnings.join('\n')).toMatch(/shader/);
  });

  it('image size read from the header', () => {
    const png = fs.readFileSync(path.join(root, 'examples/anime/assets/scarf/scarf-01.png'));
    expect(imageSize(new Uint8Array(png))).toEqual({ width: 1800, height: 760 });
  });
});
