import { describe, expect, it } from 'vitest';
import { addLayer, applyOps, History, moveLayer, removeLayer, setKeyframe, setProp, validate, type Op } from '../src/index.ts';
import { makeDoc, registry } from './fixtures.ts';

describe('operations', () => {
  it('applying then the inverse gives back the original document, without mutating it', () => {
    const doc = makeDoc();
    const before = JSON.stringify(doc);
    const ops: Op[] = [
      { op: 'replace', path: '/meta/title', value: 'new' },
      { op: 'add', path: '/compositions/main/order/0', value: 'x' },
      { op: 'remove', path: '/compositions/main/markers/0' },
      { op: 'add', path: '/tokens/gold', value: { type: 'color', value: '#E5B965' } },
      { op: 'move', from: '/compositions/main/order/1', path: '/compositions/main/order/-' },
    ];
    const r = applyOps(doc, ops);
    expect(JSON.stringify(doc)).toBe(before);
    expect(r.doc.meta.title).toBe('new');
    expect(r.doc.compositions.main.order).toEqual(['x', 'grp', 'bg']);
    // untouched branches are shared
    expect(r.doc.assets).toBe(doc.assets);
    expect(JSON.stringify(applyOps(r.doc, r.inverse).doc)).toBe(before);
  });

  it('all or nothing: one invalid op applies nothing', () => {
    const doc = makeDoc();
    expect(() => applyOps(doc, [{ op: 'replace', path: '/meta/title', value: 'a' }, { op: 'remove', path: '/nope/x' }])).toThrow();
    expect(() => applyOps(doc, [{ op: 'test', path: '/meta/title', value: 'other' }])).toThrow(/expected/);
  });

  it('history: undo, redo, refusal of an invalid document', () => {
    const reg = registry();
    const h = new History(makeDoc(), (d) => validate(d, reg).map((i) => `${i.path} ${i.message}`));
    h.apply({ label: 'radius', ops: setProp(h.doc, 'main', 'a', 'radius', 42) });
    h.apply({ label: 'title', ops: [{ op: 'replace', path: '/meta/title', value: 'B' }] });
    expect(h.doc.meta.title).toBe('B');
    h.undo();
    expect(h.doc.meta.title).toBe('test');
    expect(h.undoLabel).toBe('radius');
    h.undo();
    expect((h.doc.compositions.main.layers.a.props as any).radius.$k).toBeDefined();
    h.redo(); h.redo();
    expect(h.doc.meta.title).toBe('B');
    expect((h.doc.compositions.main.layers.a.props as any).radius).toBe(42);
    expect(() => h.apply({ label: 'bad', ops: setProp(h.doc, 'main', 'a', 'radius', 'large') })).toThrow(/number expected/);
    expect(h.canRedo).toBe(false);
  });

  it('setKeyframe: static to keyframes, sorted insertion, replacement at the same frame', () => {
    let doc = makeDoc();
    doc = applyOps(doc, setKeyframe(doc, 'main', 'bg', 'radius', 1, 5)).doc;
    doc = applyOps(doc, setKeyframe(doc, 'main', 'bg', 'radius', 3, 15, '@swift')).doc;
    doc = applyOps(doc, setKeyframe(doc, 'main', 'bg', 'radius', 2, 10)).doc;
    doc = applyOps(doc, setKeyframe(doc, 'main', 'bg', 'radius', 2.01, 11)).doc;
    expect((doc.compositions.main.layers.bg.props as any).radius.$k).toEqual([
      { t: 1, v: 5 }, { t: 2, v: 11 }, { t: 3, v: 15, ease: '@swift' },
    ]);
    doc = applyOps(doc, setKeyframe(doc, 'main', 'bg', 'transform.opacity', 0, 0)).doc;
    expect(doc.compositions.main.layers.bg.transform).toEqual({ opacity: { $k: [{ t: 0, v: 0 }] } });
  });

  it('adding, moving, removing layers keeps a valid tree', () => {
    const reg = registry();
    let doc = makeDoc();
    doc = applyOps(doc, addLayer(doc, 'main', 'c', { type: 'box' }, { parent: 'grp', index: 0 })).doc;
    expect(doc.compositions.main.layers.grp.children).toEqual(['c', 'a', 'b']);
    doc = applyOps(doc, addLayer(doc, 'main', 'mask', { type: 'box', visible: false })).doc;
    doc = applyOps(doc, setProp(doc, 'main', 'c', 'radius', 3)).doc;
    doc = applyOps(doc, [{ op: 'add', path: '/compositions/main/layers/c/clip', value: 'mask' }]).doc;
    doc = applyOps(doc, moveLayer(doc, 'main', 'c', { index: 0 })).doc;
    expect(doc.compositions.main.order).toEqual(['c', 'bg', 'grp', 'mask']);
    expect(validate(doc, reg)).toEqual([]);
    doc = applyOps(doc, removeLayer(doc, 'main', 'mask')).doc;
    expect(doc.compositions.main.layers.c.clip).toBeUndefined();
    doc = applyOps(doc, removeLayer(doc, 'main', 'grp')).doc;
    expect(Object.keys(doc.compositions.main.layers).sort()).toEqual(['bg', 'c']);
    expect(validate(doc, reg)).toEqual([]);
  });
});
