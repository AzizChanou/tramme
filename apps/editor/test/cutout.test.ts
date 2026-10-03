import { describe, expect, it } from 'vitest';
import { applyOps, Evaluator, validate, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { cutoutLayers, gate, keep, peopleAt, steady } from '../src/cutout.ts';
import { editorRegistry } from '../src/vocabulary.ts';

const reg = editorRegistry();

/** footage seen from 1 s to 9 s, from 2 s into the file, moving; a title and captions above it */
function project(): TrammeDoc {
  const doc = newProject({ name: 'Cut-out', width: 1920, height: 1080, fps: 25, duration: 10 }).doc;
  const c = doc.compositions[doc.root];
  doc.assets.clip = { type: 'video', src: 'assets/clip.mp4', name: 'Clip' };
  doc.assets['cutout-clip'] = { type: 'video', src: 'assets/cutout/clip.mp4' };
  c.layers = {
    clip: { type: 'video', name: 'Clip', in: 1, out: 9, transform: { position: { $k: [{ t: 1, v: [960, 540] }, { t: 9, v: [1060, 540] }] } }, props: { video: 'clip', start: 2, size: [1920, 1080], fit: 'cover' }, effects: [{ id: 'look', type: 'fx.color', props: { saturation: 1.2 } }] },
    title: { type: 'text', props: { text: 'SAND' } },
    caps: { type: 'text', props: { text: 'There is sand in the backseat' } },
  };
  c.order = ['clip', 'title', 'caps'];
  return doc;
}

describe('the cut-out of a person', () => {
  it('draws the video again through its mask, right above it, the title given in between', () => {
    const doc = project(), root = doc.root;
    const { ops, matte, front } = cutoutLayers(doc, root, 'clip', 'cutout-clip', 'title');
    const out = applyOps(doc, ops).doc, c = out.compositions[root];
    expect(validate(out, reg)).toEqual([]);
    expect(c.order).toEqual(['clip', 'title', matte, front, 'caps']);
    // the mask: hidden, silent, timed like the file
    expect(c.layers[matte]).toMatchObject({ type: 'video', visible: false, in: 1, out: 9, props: { video: 'cutout-clip', start: 2, fit: 'cover', muted: true } });
    // the person: the same footage with its look, through the mask, silent
    expect(c.layers[front]).toMatchObject({ type: 'video', in: 1, out: 9, props: { video: 'clip', start: 2, muted: true } });
    expect(c.layers[front].effects).toEqual([{ id: 'look', type: 'fx.color', props: { saturation: 1.2 } }, { id: 'cutout', type: 'fx.matte', props: { source: matte, mode: 'luma' } }]);
    // both follow the frame and the movement of the footage
    const ev = new Evaluator(out, reg);
    for (const t of [1, 4.5, 8.9]) {
      const src = ev.layerAt('clip', t, root);
      expect(ev.layerAt(front, t, root).transform).toEqual(src.transform);
      expect(ev.layerAt(matte, t, root).transform).toEqual(src.transform);
      expect(ev.value(`${matte}.size`, t, root)).toEqual([1920, 1080]);
    }
  });

  it('run again, reuses its layers and only moves what goes behind', () => {
    const doc = project(), root = doc.root;
    const once = applyOps(doc, cutoutLayers(doc, root, 'clip', 'cutout-clip').ops).doc;
    expect(once.compositions[root].order).toEqual(['clip', 'clip-mask', 'clip-subject', 'title', 'caps']);
    expect(cutoutLayers(once, root, 'clip', 'cutout-clip').ops).toEqual([]);
    const again = cutoutLayers(once, root, 'clip', 'cutout-clip', 'caps');
    expect(again.ops).toHaveLength(1);
    const twice = applyOps(once, again.ops).doc;
    expect(twice.compositions[root].order).toEqual(['clip', 'caps', 'clip-mask', 'clip-subject', 'title']);
    expect(validate(twice, reg)).toEqual([]);
  });

  it('refuses what cannot go behind the person', () => {
    const doc = project(), root = doc.root;
    expect(() => cutoutLayers(doc, root, 'clip', 'cutout-clip', 'clip')).toThrow(/other than the video/);
    doc.compositions[root].layers.g = { type: 'group', children: ['caps'] };
    doc.compositions[root].order = ['clip', 'title', 'g'];
    expect(() => cutoutLayers(doc, root, 'clip', 'cutout-clip', 'caps')).toThrow(/same group/);
  });

  it('keeps the matte where people are, feathered, and nothing where nobody is', () => {
    const w = 100, h = 50, g = gate([{ x: 0.4, y: 0.2, w: 0.2, h: 0.6 }], w, h);
    const at = (x: number, y: number) => g[y * w + x];
    expect(at(50, 25)).toBe(1);
    // widened for hair and arms: just outside the box still kept
    expect(at(38, 25)).toBeGreaterThan(0.5);
    expect(at(5, 25)).toBe(0);
    expect(at(95, 5)).toBe(0);
    expect(gate([], w, h).every((v) => v === 0)).toBe(true);
  });

  it('takes the people of the nearest look in the same shot', () => {
    const a = { x: 0.1, y: 0, w: 0.2, h: 1 }, b = { x: 0.6, y: 0, w: 0.2, h: 1 };
    const looks = [{ t: 0, shot: 0, boxes: [a] }, { t: 0.5, shot: 0, boxes: [] }, { t: 0.62, shot: 1, boxes: [b] }];
    expect(peopleAt(looks, 0.2, 0)).toEqual([a]);
    expect(peopleAt(looks, 0.3, 0)).toEqual([]);
    // just before the cut: still the shot's own look, not the next shot's
    expect(peopleAt(looks, 0.6, 0)).toEqual([]);
    expect(peopleAt(looks, 0.7, 1)).toEqual([b]);
    expect(peopleAt(looks, 0.7, 2)).toEqual([]);
  });

  it('cuts the haze of the matte and fills its nearly full values', () => {
    expect([...keep(new Uint8ClampedArray([0, 10, 128, 245, 255]), null)]).toEqual([0, 0, 128, 255, 255]);
    expect([...keep(new Uint8ClampedArray([255, 255]), new Float32Array([0, 0.5]))]).toEqual([0, 127]);
  });

  it('steadies the flicker of the edges, not the movements', () => {
    const prev = new Uint8ClampedArray([0, 100, 255, 0]), cur = new Uint8ClampedArray([20, 120, 0, 255]);
    expect([...steady(prev, cur)]).toEqual([10, 110, 0, 255]);
    expect(steady(null, cur)).toBe(cur);
  });
});
