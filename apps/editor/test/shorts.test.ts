import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { applyOps, validate, type ToolContext, type ToolOutput, type Transcript, type TrammeDoc } from '@tramme/core';
import { newProject } from '@tramme/project';
import { candidatesOf, SHORTS_TOOLS } from '../src/shorts.ts';

const shorts = SHORTS_TOOLS[0];
const run = (input: unknown, ctx: ToolContext) => shorts.run(input as never, ctx) as Promise<ToolOutput>;

const wordsOf = (lines: [number, string][]): Transcript => {
  const words: Transcript['words'] = [];
  for (const [s, line] of lines) for (const [i, w] of line.split(' ').entries()) words.push({ w, s: s + i * 0.3, e: s + i * 0.3 + 0.28 });
  return { version: 1, duration: words[words.length - 1].e, language: 'en', words };
};

describe('candidates', () => {
  it('packs sentences between min and max, cut on long pauses', () => {
    const lines: [number, string][] = [];
    for (let i = 0; i < 20; i++) lines.push([i * 3.2, `Sentence number ${i} says its thing.`]);
    const cands = candidatesOf(wordsOf(lines), { min: 15, max: 45 });
    expect(cands.length).toBeGreaterThanOrEqual(3);
    // every passage but the last (the transcript ends mid-window) holds its span
    for (const c of cands.slice(0, -1)) {
      expect(c.to - c.from).toBeGreaterThanOrEqual(14);
      expect(c.to - c.from).toBeLessThanOrEqual(46);
    }
    for (const c of cands) {
      expect(c.from).toBeGreaterThanOrEqual(0);
      expect(c.text).toContain('Sentence');
    }
  });

  it('never spans a long pause: dead air is not what a short is made of', () => {
    const t = wordsOf([[0, 'A first lone sentence.'], [40, 'Much later another one arrives.'], [43, 'And it finishes the idea here.']]);
    const cands = candidatesOf(t, { min: 5, max: 45 });
    expect(cands).toHaveLength(2);
    expect(cands[0].to).toBeLessThan(5);
    expect(cands[1].from).toBeGreaterThan(39);
  });
});

function doc(): TrammeDoc {
  const { doc } = newProject({ name: 'Talk', width: 1920, height: 1080, fps: 30, duration: 60 });
  doc.assets.talk = { type: 'video', src: 'assets/video/talk.mp4' };
  doc.assets['transcription-talk'] = { type: 'json', src: 'assets/transcripts/talk.json' };
  return doc;
}

const transcript = wordsOf([[2, 'This is the big idea and it lands here.'], [5, 'Here comes the proof of it, plainly.'], [8, 'And that is the whole point.'], [9.9, 'Good.']]);
const ctxOf = (d: TrammeDoc, written: Map<string, string> = new Map()): ToolContext =>
  ({
    doc: d, compId: d.root, registry: builtinRegistry(), time: 0, selection: [],
    transcript: async (id: string) => {
      if (id !== 'transcription-talk') throw new Error(`no transcript ${id}`);
      return transcript;
    },
    writeFile: async (p: string, data: string | Blob) => {
      written.set(p, typeof data === 'string' ? data : '');
      return p;
    },
    assetUrl: () => '', readText: async () => null, signal: new AbortController().signal,
  }) as unknown as ToolContext;

describe('the shorts tool', () => {
  it('lists the candidates with their times and what is said', async () => {
    const out = await run({ asset: 'talk', min: 2 }, ctxOf(doc()));
    expect(out.text).toContain('passage(s) that stand alone');
    expect(out.text).toMatch(/\[\d+\.\d–\d+\.\d s/);
  });

  it('refuses an asset without a transcript, with the way out', async () => {
    const d = doc();
    delete d.assets['transcription-talk'];
    await expect(run({ asset: 'talk' }, ctxOf(d))).rejects.toThrow(/get_transcript/);
  });

  it('builds one composition per passage: framed video, remapped transcript, captions, title', async () => {
    const d = doc(), written = new Map<string, string>();
    const out = await run({ asset: 'talk', plan: [{ from: 2, to: 10, title: 'The big idea' }] }, ctxOf(d, written));
    const next = applyOps(d, out.ops!).doc;
    expect(validate(next, builtinRegistry())).toEqual([]);
    const c = next.compositions['short-the-big-idea'];
    expect(c).toMatchObject({ width: 1080, height: 1920, fps: 30 });
    expect(c.duration).toBeCloseTo(8);
    const video = Object.values(c.layers).find((l) => l.type === 'video');
    expect(video?.props).toMatchObject({ video: 'talk', start: 2, fit: 'cover', size: [1080, 1920] });
    const captions = Object.values(c.layers).find((l) => l.type === 'captions');
    expect(String(captions?.props?.transcript)).toBe('transcription-talk-short1');
    expect(Object.values(c.layers).filter((l) => l.type === 'text').length).toBeGreaterThanOrEqual(1);
    // the captions and the title above the footage
    const idOf = (type: string) => Object.keys(c.layers).find((id) => c.layers[id].type === type)!;
    expect(c.order.indexOf(idOf('captions'))).toBeGreaterThan(c.order.indexOf(idOf('video')));
    // the transcript of the short starts at 0 and is a file of the project
    const sid = Object.keys(next.assets).find((id) => id.startsWith('transcription-talk-short'));
    expect(next.assets[sid!].src).toBe('assets/transcripts/talk-short-1.json');
    const remapped = JSON.parse(written.get('assets/transcripts/talk-short-1.json')!) as Transcript;
    expect(remapped.words[0].s).toBeCloseTo(0, 1);
    expect(remapped.duration).toBeCloseTo(8, 1);
  });

  it('keeps two shorts apart, each with its own transcript', async () => {
    const d = doc();
    const out = await run({ asset: 'talk', plan: [{ from: 2, to: 8, title: 'One' }, { from: 8, to: 9.5, title: 'Too short' }] }, ctxOf(d));
    const next = applyOps(d, out.ops!).doc;
    expect(validate(next, builtinRegistry())).toEqual([]);
    // the second passage is under 2 s: skipped, only the first stands
    expect(Object.keys(next.compositions).filter((id) => id.startsWith('short-'))).toHaveLength(1);
    expect(out.text).toContain('1 short(s) built');
  });
});
