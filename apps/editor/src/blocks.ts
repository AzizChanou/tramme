// Reusable pieces: a dressed selection of layers saved as a block of the
// project (assets/blocks/<name>.json, with a "block-" asset record so the
// document knows it), then placed again in any composition, its times
// shifted. The assistant saves a piece it will reuse (use_tool), the user
// from the / menu.

import { pointer, type Layer, type Op, type ToolContext, type ToolType } from '@tramme/core';
import { t } from './i18n/index.ts';
import { freshId, slug } from './model.ts';

/** a block file's shape (assets/blocks/<name>.json) */
export interface Block {
  version: 1;
  kind: 'block';
  name: string;
  from: string;
  size: [number, number];
  layers: Record<string, Layer>;
  order: string[];
  needs: string[];
}
export const isBlock = (x: unknown): x is Block => !!x && typeof x === 'object' && (x as Block).kind === 'block' && Array.isArray((x as Block).order);

/** a copy of the layer moved `delta` s later: its in, its out and every keyframe time; expressions keep their own clock */
export function shiftLayer(layer: Layer, delta: number): Layer {
  const clone = JSON.parse(JSON.stringify(layer)) as Record<string, unknown>;
  if (typeof clone.in === 'number') clone.in = +(clone.in + delta).toFixed(4);
  if (typeof clone.out === 'number') clone.out = +(clone.out + delta).toFixed(4);
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== 'object') return;
    for (const [k, v] of Object.entries(x)) {
      if (k === '$k' && Array.isArray(v)) {
        for (const kf of v) if (kf && typeof kf === 'object' && typeof (kf as { t?: unknown }).t === 'number') (kf as { t: number }).t = +((kf as { t: number }).t + delta).toFixed(4);
      } else walk(v);
    }
  };
  walk(clone);
  return clone as unknown as Layer;
}

const blockId = (name: string) => `block-${slug(name) || 'block'}`.slice(0, 64);

const blockAdd: ToolType<{ name: string; layers?: string[] }> = {
  name: 'block-add', title: 'Save a block', description: 'saves the selected layers (or the given ones) as a reusable block of the project',
  input: {
    type: 'object',
    properties: {
      name: { type: 'string', title: 'Name' },
      layers: { type: 'array', items: { type: 'string' }, title: 'Layers', description: 'their ids; the selection by default' },
    },
    required: ['name'],
  },
  ai: { when: 'a dressed piece the project will reuse (a title treatment, a lower third, a chart): save it once, place it again with "block-use"', avoid: 'one plain layer; a piece whose times or words only made sense where it was built' },
  async run({ name, layers }, ctx) {
    if (!name?.trim()) throw new Error('block-add: a name is expected');
    const comp = ctx.doc.compositions[ctx.compId];
    const ids = layers?.length ? layers : (ctx.selection ?? []);
    if (!ids.length) throw new Error('block-add: select layers or pass their ids');
    const missing = ids.filter((id) => !comp.layers[id]);
    if (missing.length) throw new Error(`block-add: no such layer in this composition: ${missing.join(', ')}`);
    // the stacking of the composition, kept
    const order = comp.order.filter((id) => ids.includes(id));
    for (const id of ids) if (!order.includes(id)) order.push(id);
    const needs = [...new Set(order.flatMap((id) => (comp.layers[id].type === 'comp' ? [String((comp.layers[id].props as { comp?: unknown }).comp ?? '')] : [])))].filter(Boolean);
    const block: Block = { version: 1, kind: 'block', name: name.trim(), from: ctx.compId, size: [comp.width, comp.height], layers: Object.fromEntries(order.map((id) => [id, comp.layers[id]])), order, needs };
    const cs = slug(name) || 'block';
    const path = await ctx.writeFile(`assets/blocks/${cs}.json`, JSON.stringify(block, null, 1));
    const id = blockId(name);
    const value = { type: 'json' as const, src: path };
    const op: Op = ctx.doc.assets[id] ? { op: 'replace', path: pointer('assets', id), value } : { op: 'add', path: pointer('assets', id), value };
    return {
      ops: [op], label: t('blocks.saved', { name: name.trim() }),
      text: `Block "${name.trim()}" saved: ${order.length} layer(s)${needs.length ? `, it shows compositions ${needs.join(', ')}` : ''}. Place it again with "block-use" (called without a block, it lists the ones the project has).`,
    };
  },
};

const blocks: ToolType<{ block?: string; at?: number }> = {
  name: 'block-use', title: 'Blocks', description: 'the blocks saved in the project (list), or places one at a time',
  input: {
    type: 'object',
    properties: {
      block: { type: 'string', title: 'Block', description: 'its name or id; left out, the tool lists the blocks' },
      at: { type: 'number', minimum: 0, title: 'Place at (s)', description: 'composition time; the current time by default' },
    },
  },
  ai: { when: 'reusing a saved piece: list the blocks first (no input), place the picked one with block and at; say when the format differs from the one it was built for', avoid: 'placing a block whose message only fit its first place' },
  async run({ block, at }, ctx) {
    const comp = ctx.doc.compositions[ctx.compId];
    const found: { id: string; b: Block }[] = [];
    for (const [id, a] of Object.entries(ctx.doc.assets)) {
      if (!id.startsWith('block-') || a.type !== 'json') continue;
      try {
        const b = JSON.parse((await ctx.readText(a.src)) ?? 'null');
        if (isBlock(b)) found.push({ id, b });
      } catch { /* a block file the project lost: skipped */ }
    }
    if (!block) {
      const list = found.map(({ id, b }) => `- ${b.name} [${id}]: ${b.order.length} layer(s), from ${b.from}${b.size[0] !== comp.width || b.size[1] !== comp.height ? ` (built for ${b.size[0]}x${b.size[1]})` : ''}`);
      return { text: list.length ? `The blocks of the project:\n${list.join('\n')}` : 'No block saved yet: select layers and run "block-add".' };
    }
    const hit = found.find(({ id }) => id === blockId(block)) ?? found.find(({ b }) => b.name === block);
    if (!hit) throw new Error(`blocks: no block "${block}" (${found.map(({ b }) => b.name).join(', ') || 'none saved'})`);
    const at0 = at ?? ctx.time ?? 0;
    const starts = hit.b.order.map((id) => hit.b.layers[id].in ?? 0);
    const delta = at0 - (starts.length ? Math.min(...starts) : 0);
    const taken: Record<string, unknown> = { ...comp.layers };
    const ops: Op[] = [], order = [...comp.order];
    for (const oldId of hit.b.order) {
      const newId = freshId(taken, oldId);
      taken[newId] = 1;
      ops.push({ op: 'add', path: pointer('compositions', ctx.compId, 'layers', newId), value: shiftLayer(hit.b.layers[oldId], delta) });
      order.push(newId);
    }
    ops.push({ op: 'replace', path: pointer('compositions', ctx.compId, 'order'), value: order });
    const off = hit.b.size[0] !== comp.width || hit.b.size[1] !== comp.height ? ` It was built for ${hit.b.size[0]}x${hit.b.size[1]}: check the placement in this format.` : '';
    return {
      ops,
      label: t('blocks.placed', { name: hit.b.name }),
      text: `Block "${hit.b.name}" placed from ${+at0.toFixed(2)} s: ${hit.b.order.length} layer(s) on top of the stack, their times shifted by ${+delta.toFixed(2)} s.${off}`,
    };
  },
};

export const BLOCK_TOOLS: ToolType[] = [blockAdd, blocks];
