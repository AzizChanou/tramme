import { describe, expect, it } from 'vitest';
import { applyOps, Evaluator, validate, type ToolContext, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { editorRegistry } from '../src/vocabulary.ts';

const reg = editorRegistry();
const project = () => newProject({ name: 'Figures', width: 1080, height: 1080, fps: 30, duration: 10 }).doc;
const ctxOf = (doc: TrammeDoc, time = 0): ToolContext => ({ doc, compId: doc.root, time, selection: [], registry: reg } as unknown as ToolContext);
/** run a tool of the vocabulary and apply its operations */
function use(doc: TrammeDoc, name: string, input: Record<string, unknown> = {}, time = 0): TrammeDoc {
  const out = reg.tool(name).tool.run(input, ctxOf(doc, time)) as { ops: never[] };
  return applyOps(doc, out.ops).doc;
}

describe('pointer figures', () => {
  it('lay a pointer, a terrain, keys and a riffle that all validate, sharing the one pointer', () => {
    let doc = project();
    doc = use(doc, 'kit', { kit: 'hairline' });
    doc = use(doc, 'pointer', { path: 'sweep', at: 0, duration: 8 });
    doc = use(doc, 'terrain', { n: 6 });
    doc = use(doc, 'keys', { keys: 10, label: 'Press any key' });
    doc = use(doc, 'riffle', { cards: 7 });
    expect(validate(doc, reg)).toEqual([]);
    expect(doc.tokens.accent.value).toBe('#0F62FE');
    // one pointer for the whole composition: the figures reuse it
    const layers = Object.values(doc.compositions.main.layers);
    expect(layers.filter((l) => l.name === 'Pointer')).toHaveLength(1);
    expect(layers.filter((l) => l.name?.startsWith('Pillar'))).toHaveLength(36);
    expect(layers.filter((l) => l.name?.startsWith('Key '))).toHaveLength(10);
    expect(layers.filter((l) => l.name?.startsWith('Card '))).toHaveLength(7);
    // the pointer travels around the centre of the composition
    const pointer = layers.find((l) => l.name === 'Pointer')!;
    const first = (pointer.transform!.position as { $k: { v: number[] }[] }).$k[0].v;
    expect(first[0]).toBeCloseTo(1080 / 2 - 1080 * 0.9 / 2, 0);
    expect(first[1]).toBeCloseTo(1080 / 2 - 1080 * 0.7 * 0.16, 0);
  });

  it('a pillar rises as the pointer passes over it, and settles back after', () => {
    let doc = project();
    doc = use(doc, 'pointer', { path: 'sweep', at: 0, duration: 8 });
    doc = use(doc, 'terrain', { n: 5, rise: 2, radius: 300 });
    const comp = doc.compositions.main;
    const [id, pillar] = Object.entries(comp.layers).find(([, l]) => l.name === 'Pillar 3.3')!;
    const group = comp.layers[comp.order.find((x) => comp.layers[x].type === 'group')!];
    expect(group.children).toContain(id);
    const ev = new Evaluator(doc, reg);
    // the pointer crosses the centre of the frame at t = 2 s, right over the pillar
    const over = ev.value(`${id}.transform.scale`, 2) as number[];
    expect(over[1]).toBeGreaterThan(2.5);
    // far before the pointer arrives, the pillar is at rest
    const rest = ev.value(`${id}.transform.scale`, 0.05) as number[];
    expect(rest[1]).toBeLessThan(1.15);
    // and it has settled long after the pointer left
    expect((ev.value(`${id}.transform.scale`, 8) as number[])[1]).toBeLessThan(1.15);
    expect(pillar.type).toBe('shape.rect');
  });

  it('answers a pointer the user names, and refuses an unknown one', () => {
    const doc = use(use(project(), 'pointer', { show: false }), 'keys', { keys: 6, pointer: 'pointer' });
    expect(validate(doc, reg)).toEqual([]);
    expect(() => use(project(), 'keys', { pointer: 'nope' })).toThrow(/unknown layer/);
  });
});
