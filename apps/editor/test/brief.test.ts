import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { applyOps, validate, type ToolContext, type ToolOutput, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { BRIEF_PATH, inventoryOf, BRIEF_TOOLS } from '../src/brief.ts';

const brief = BRIEF_TOOLS[0];
const run = (input: unknown, ctx: ToolContext) => brief.run(input as never, ctx) as Promise<ToolOutput>;

function doc(): TrammeDoc {
  const { doc } = newProject({ name: 'Show', width: 1080, height: 1920, fps: 30, duration: 10 });
  doc.tokens = {
    ...doc.tokens,
    ink: { type: 'color', value: '#1C1917' },
    swift: { type: 'ease', value: [0.16, 1, 0.3, 1] },
    pace: { type: 'number', value: 0.4 },
  };
  doc.assets.fontMain = { type: 'font', src: 'assets/fonts/main.woff2', family: 'Inter' };
  doc.assets.bed = { type: 'audio', src: 'assets/sounds/bed.mp3' };
  return doc;
}

const ctxOf = (d: TrammeDoc, written: Map<string, string> = new Map(), read: Map<string, string> = new Map()): ToolContext =>
  ({
    doc: d, compId: d.root, registry: builtinRegistry(), time: 0, selection: [],
    writeFile: async (p: string, data: string | Blob) => { written.set(p, typeof data === 'string' ? data : ''); return p; },
    readText: async (p: string) => read.get(p) ?? null,
    assetUrl: () => '', signal: new AbortController().signal,
  } as unknown as ToolContext);

describe('the brief of the project', () => {
  it('writes the facts of the document, and the document learns the asset', async () => {
    const d = doc(), written = new Map<string, string>();
    const out = await run({}, ctxOf(d, written));
    const saved = JSON.parse(written.get(BRIEF_PATH)!);
    expect(saved.kind).toBe('brief');
    expect(saved.format).toBe('1080x1920 vertical, 30 fps, 10 s');
    expect(saved.look.palette.ink).toBe('#1C1917');
    expect(saved.look.fonts).toEqual(['Inter']);
    expect(saved.motion.curves.swift).toEqual([0.16, 1, 0.3, 1]);
    expect(saved.motion.pace).toEqual({ pace: 0.4 });
    expect(saved.sound.assets).toEqual(['bed']);
    expect(saved.tone).toBeUndefined();
    const { doc: applied } = applyOps(d, out.ops!);
    expect(applied.assets.brief).toEqual({ type: 'json', src: BRIEF_PATH });
    expect(validate(applied, builtinRegistry())).toEqual([]);
  });

  it('keeps the tone and the rules of the previous brief, and new ones replace them', async () => {
    const d = doc(), written = new Map<string, string>();
    const prev = { version: 1, kind: 'brief', updated: '2026-10-01T00:00:00.000Z', format: 'x', look: {}, motion: {}, sound: {}, tone: 'Calm and wide.', rules: ['no pure red'] };
    const ctx = ctxOf(d, written, new Map([[BRIEF_PATH, JSON.stringify(prev)]]));
    await run({}, ctx);
    const first = JSON.parse(written.get(BRIEF_PATH)!);
    expect(first.tone).toBe('Calm and wide.');
    expect(first.rules).toEqual(['no pure red']);
    await run({ tone: 'Loud.', rules: ['one idea at a time'] }, ctx);
    const second = JSON.parse(written.get(BRIEF_PATH)!);
    expect(second.tone).toBe('Loud.');
    expect(second.rules).toEqual(['one idea at a time']);
  });

  it('keeps what the sources taught, beside the tone', async () => {
    const d = doc(), written = new Map<string, string>(), read = new Map<string, string>();
    const ctx = ctxOf(d, written, read);
    await run({ about: 'A bakery opens a second shop; for its neighbours.', sources: ['logo: the brand, red and cream', 'assets/sources/menu.pdf: the prices'] }, ctx);
    read.set(BRIEF_PATH, written.get(BRIEF_PATH)!);
    await run({ tone: 'Warm.' }, ctx);
    const saved = JSON.parse(written.get(BRIEF_PATH)!);
    expect(saved.about).toBe('A bakery opens a second shop; for its neighbours.');
    expect(saved.sources).toHaveLength(2);
    expect(saved.tone).toBe('Warm.');
  });

  it('the inventory counts the other compositions', () => {
    const d = doc();
    d.compositions.inner = { name: 'Inner', width: 100, height: 100, fps: 30, duration: 1, layers: {}, order: [] };
    expect(inventoryOf(d).compositions).toBe(1);
    expect(inventoryOf(doc()).compositions).toBeUndefined();
  });
});
