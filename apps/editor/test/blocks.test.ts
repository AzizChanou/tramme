import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { applyOps, validate, type ToolContext, type ToolOutput, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { shiftLayer, BLOCK_TOOLS } from '../src/blocks.ts';

const blockAdd = BLOCK_TOOLS[0], blocks = BLOCK_TOOLS[1];
const run = (tool: typeof blockAdd | typeof blocks, input: unknown, ctx: ToolContext) => tool.run(input as never, ctx) as Promise<ToolOutput>;

function doc(): TrammeDoc {
  const { doc } = newProject({ name: 'Blocks', width: 1080, height: 1920, fps: 30, duration: 10 });
  doc.compositions.main.layers = {
    a: { type: 'text', name: 'A', in: 1, out: 4, transform: { position: { $k: [{ t: 1, v: [100, 200], ease: [0.16, 1, 0.3, 1] }, { t: 1.5, v: [100, 300] }] } }, props: { text: 'Hi', size: 96 } },
    b: { type: 'shape.rect', name: 'B', in: 1.2, out: 4, transform: { position: [100, 400] }, props: { size: [80, 80] } },
    c: { type: 'shape.rect', name: 'C', transform: { position: [500, 500] }, props: { size: [80, 80] } },
  } as never;
  doc.compositions.main.order = ['b', 'a', 'c'];
  return doc;
}

const ctxOf = (d: TrammeDoc, written: Map<string, string> = new Map(), read: Map<string, string> = new Map(), selection: string[] = [], time = 0): ToolContext =>
  ({
    doc: d, compId: d.root, registry: builtinRegistry(), time, selection,
    writeFile: async (p: string, data: string | Blob) => { written.set(p, typeof data === 'string' ? data : ''); return p; },
    readText: async (p: string) => read.get(p) ?? null,
    assetUrl: () => '', signal: new AbortController().signal,
  } as unknown as ToolContext);

describe('shiftLayer', () => {
  it('moves in, out and every keyframe time, effects included, without touching the original', () => {
    const layer = {
      type: 'text', in: 1, out: 4,
      transform: { position: { $k: [{ t: 1, v: [0, 0] }, { t: 1.5, v: [10, 0] }] } },
      effects: [{ id: 'x', type: 'fx.blur', props: { radius: { $k: [{ t: 0.5, v: 20 }, { t: 1, v: 0 }] } } }],
    } as never;
    const moved = shiftLayer(layer, 2);
    expect(moved.in).toBe(3);
    expect((moved.out as number)).toBe(6);
    expect((moved.transform?.position as { $k: { t: number }[] }).$k.map((k) => k.t)).toEqual([3, 3.5]);
    const fx = (moved.effects as unknown as { props: { radius: { $k: { t: number }[] } } }[])[0]!;
    expect(fx.props.radius.$k[0]!.t).toBe(2.5);
    expect((layer as { in: number }).in).toBe(1);
  });
});

describe('blocks', () => {
  it('saves the selection with its stacking, and the document learns the block', async () => {
    const d = doc(), written = new Map<string, string>();
    const out = await run(blockAdd, { name: 'Title card' }, ctxOf(d, written, new Map(), ['a', 'b']));
    const saved = JSON.parse(written.get('assets/blocks/title-card.json')!);
    expect(saved.kind).toBe('block');
    expect(saved.name).toBe('Title card');
    expect(saved.order).toEqual(['b', 'a']);
    expect(saved.size).toEqual([1080, 1920]);
    const { doc: applied } = applyOps(d, out.ops!);
    expect(applied.assets['block-title-card']).toEqual({ type: 'json', src: 'assets/blocks/title-card.json' });
    expect(validate(applied, builtinRegistry())).toEqual([]);
  });

  it('places a block at a time, its keyframes shifted, fresh ids, on top of the stack', async () => {
    const d = doc(), written = new Map<string, string>();
    const ctx1 = ctxOf(d, written, new Map(), ['a', 'b']);
    const saved = await run(blockAdd, { name: 'Title card' }, ctx1);
    const d1 = applyOps(d, saved.ops!).doc;
    const read = new Map([['assets/blocks/title-card.json', written.get('assets/blocks/title-card.json')!]]);
    const out = await run(blocks, { block: 'title card', at: 5 }, ctxOf(d1, new Map(), read, [], 5));
    const d2 = applyOps(d1, out.ops!).doc;
    const comp = d2.compositions.main;
    expect(comp.order.slice(-2)).toEqual(['b2', 'a2']);
    expect((comp.layers['a2'] as { in: number }).in).toBe(5);
    expect((comp.layers['a2'] as { out: number }).out).toBe(8);
    const pos = (comp.layers['a2'] as { transform: { position: { $k: { t: number }[] } } }).transform.position;
    expect(pos.$k.map((k) => k.t)).toEqual([5, 5.5]);
    expect((comp.layers['b2'] as { in: number }).in).toBe(5.2);
    expect(out.text).toContain('shifted by 4 s');
    expect(validate(d2, builtinRegistry())).toEqual([]);
  });

  it('lists the blocks of the project, and says when the format differs', async () => {
    const d = doc(), read = new Map([['assets/blocks/wide.json', JSON.stringify({ version: 1, kind: 'block', name: 'Wide', from: 'other', size: [1920, 1080], layers: {}, order: ['x'], needs: [] })]]);
    d.assets['block-wide'] = { type: 'json', src: 'assets/blocks/wide.json' };
    const out = await run(blocks, {}, ctxOf(d, new Map(), read));
    expect(out.text).toContain('Wide');
    expect(out.text).toContain('built for 1920x1080');
  });
});
