import { describe, expect, it } from 'vitest';
import { addLayer, applyOps, validate } from '@tramme/core';
import { newProject } from '@tramme/project';
import { editorRegistry } from '../src/vocabulary.ts';

describe('presets', () => {
  const reg = editorRegistry();

  it('each one is a valid layer of a composition', () => {
    let { doc } = newProject({ name: 'Presets', width: 1080, height: 1080, fps: 30, duration: 4 });
    for (const { preset } of reg.listPresets()) {
      doc = applyOps(doc, addLayer(doc, 'main', preset.name, { ...preset.layer, transform: { position: [540, 540], ...preset.layer.transform } })).doc;
    }
    expect(Object.keys(doc.compositions.main.layers)).toEqual(['neon-title', 'frosted-card', 'light-leak', 'spotlight']);
    expect(validate(doc, reg)).toEqual([]);
  });

  it('come from plugins too, and a malformed one is refused', () => {
    const more = reg.clone().use({ presets: [{ name: 'dot', layer: { type: 'shape.ellipse' } }] }, 'mine');
    expect(more.listPresets().at(-1)).toMatchObject({ from: 'mine', preset: { name: 'dot' } });
    expect(() => reg.clone().use({ presets: [{ name: 'bad', layer: {} as never }] }, 'mine')).toThrow(/malformed preset/);
  });

  it('give the rectangle a corner radius handle on its top edge', () => {
    const rect = reg.node('shape.rect');
    expect(rect.handles!({ size: [200, 100], radius: 20 })).toEqual([{ prop: 'radius', kind: 'distance', at: [80, -50], from: [100, -50] }]);
  });
});
