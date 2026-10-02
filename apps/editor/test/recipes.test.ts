import { describe, expect, it } from 'vitest';
import { applyOps, runChecks, validate, type ToolContext, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { parseData } from '../src/recipes.ts';
import { editorRegistry } from '../src/vocabulary.ts';

const reg = editorRegistry();
const project = (w = 1080, h = 1920) => newProject({ name: 'Recipes', width: w, height: h, fps: 30, duration: 12 }).doc;
const ctxOf = (doc: TrammeDoc, time = 1): ToolContext => ({ doc, compId: doc.root, time, selection: [], registry: reg } as unknown as ToolContext);
/** run a tool of the vocabulary and apply its operations */
function use(doc: TrammeDoc, name: string, input: Record<string, unknown>, time = 1): TrammeDoc {
  const out = reg.tool(name).tool.run(input, ctxOf(doc, time)) as { ops: never[] };
  return applyOps(doc, out.ops).doc;
}

describe('recipes', () => {
  it('read data written by hand', () => {
    expect(parseData('2022: 12, 2023: 30,5; 2024 = 45')).toEqual([{ label: '2022', value: 12 }, { label: '2023', value: 30 }, { label: '3', value: 5 }, { label: '2024', value: 45 }]);
    expect(parseData('3, 7')).toEqual([{ label: '1', value: 3 }, { label: '2', value: 7 }]);
    expect(parseData('Paris: 2.5\nLyon: 1.2')).toEqual([{ label: 'Paris', value: 2.5 }, { label: 'Lyon', value: 1.2 }]);
  });

  for (const [w, h] of [[1080, 1920], [1920, 1080]]) {
    it(`lay out valid pieces that pass the checks (${w}×${h})`, async () => {
      let doc = project(w, h);
      doc = use(doc, 'kit', { kit: 'punchy' });
      doc = use(doc, 'kinetic-title', { text: 'Make every second count', style: 'pop', emphasis: 3, at: 0.5, duration: 3 });
      doc = use(doc, 'transition', { at: 4, style: 'bars' });
      doc = use(doc, 'bar-chart', { data: '2022: 12, 2023: 30, 2024: 45', title: 'Growth', unit: '%', at: 4.4, duration: 4 });
      doc = use(doc, 'stat', { value: '1,250', label: 'new members', at: 8.6, duration: 3 });
      expect(validate(doc, reg)).toEqual([]);
      const warnings = (await runChecks(doc, reg)).filter((i) => i.severity === 'warning');
      expect(warnings.map((i) => i.message)).toEqual([]);
    });
  }

  it('follow the style kit', () => {
    const doc = use(use(project(), 'kit', { kit: 'editorial' }), 'kinetic-title', { text: 'Hello world', emphasis: 2 });
    expect(doc.tokens.accent.value).toBe('#C2410C');
    expect(doc.compositions.main.background).toBe('@plate');
    const words = Object.values(doc.compositions.main.layers).filter((l) => l.type === 'text');
    expect(words.map((l) => l.props?.color)).toEqual(['@ink', '@accent']);
  });

  it('place a kinetic title as a group of words that leaves together', () => {
    const doc = use(project(), 'kinetic-title', { text: 'one two three four five six seven eight', at: 2 });
    const c = doc.compositions.main, group = Object.values(c.layers).find((l) => l.type === 'group')!;
    expect(group.children).toHaveLength(8);
    expect(group.in).toBe(2);
    // the words are children, not in the root stack
    expect(c.order).toHaveLength(1);
  });

  it('refuse what they cannot lay out', () => {
    expect(() => use(project(), 'bar-chart', { data: 'nothing here' })).toThrow(/no value/);
    expect(() => use(project(), 'stat', { value: 'many' })).toThrow(/digits/);
    expect(() => use(project(), 'kit', { kit: 'nope' })).toThrow(/unknown kit/);
  });
});
