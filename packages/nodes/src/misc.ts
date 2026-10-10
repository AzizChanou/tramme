// Structure and escape hatches: groups, free code, audio.

import type { Host, NodeType } from '@tramme/core';
import { MIX_PROPS, RATE_PROP, SOUND_PROPS } from './sound.ts';

export const group: NodeType = {
  type: 'group', title: 'Group', category: 'Structure', container: true,
  props: {},
  render: {},
};

/**
 * Free code: draws with a function from a JavaScript module asset. The entry
 * is either a function (ctx, t, params, host) or an object
 * { init?(params, host), render(ctx, t, params, host) }. This is how existing
 * pieces (existing code-drawn scenes) enter a document before they are rewritten
 * as native nodes. The function must stay a pure function of t.
 */
export interface CodeEntry {
  init?(params: unknown, host: Host): Promise<void> | void;
  render(ctx: CanvasRenderingContext2D, t: number, params: unknown, host: Host): void;
}
interface CodeProps { module: string | null; entry: string; params: unknown }

const entryOf = (p: CodeProps, host: Host): CodeEntry | null => {
  if (!p.module) return null;
  const mod = host.asset<Record<string, unknown>>(p.module);
  const e = mod[p.entry];
  if (typeof e === 'function') return { render: e as CodeEntry['render'] };
  if (e && typeof (e as CodeEntry).render === 'function') return e as CodeEntry;
  throw new Error(`module "${p.module}" does not export "${p.entry}" (function or { render })`);
};

export const code: NodeType<CodeProps> = {
  type: 'code', title: 'Free code', category: 'Structure',
  props: {
    module: { type: 'asset', default: null, nullable: true, assetType: 'module', label: 'Module', animatable: false },
    entry: { type: 'string', default: 'default', label: 'Export', animatable: false },
    params: { type: 'json', default: null, nullable: true, label: 'Settings', animatable: false },
  },
  async load(p, host) { await entryOf(p, host)?.init?.(p.params, host); },
  render: {
    canvas2d(ctx, p, host) { entryOf(p, host)?.render(ctx, host.t, p.params, host); },
  },
};

/** a sound placed on the timeline at the layer's in point (mixed at export) */
export const audio: NodeType = {
  type: 'audio', title: 'Sound', category: 'Media',
  props: {
    audio: { type: 'asset', default: null, nullable: true, assetType: 'audio', label: 'File', animatable: false },
    start: { type: 'number', default: 0, label: 'Start in the file', min: 0, unit: 's', animatable: false },
    ...SOUND_PROPS,
    ...RATE_PROP,
    ...MIX_PROPS,
  },
  render: {},
};
