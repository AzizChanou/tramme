import { describe, expect, it } from 'vitest';
import { applyOps, Evaluator, validate, type ToolContext, type Track, type TrammeDoc } from '@tramme/core';
import { parseRegion, toPicture } from '../src/tracking.ts';
import { editorRegistry } from '../src/vocabulary.ts';

const reg = editorRegistry();

/** a portrait composition showing a landscape clip from 1 s, 0.5 s into the file */
function project(): TrammeDoc {
  return {
    schema: 'tramme/1', meta: { title: 'Tracked' }, tokens: {}, root: 'main',
    assets: { clip: { type: 'video', src: 'assets/video/clip.mp4' }, 'track-clip-car': { type: 'json', src: 'assets/tracks/clip-car.json' } },
    compositions: { main: { name: 'Main', width: 1080, height: 1920, fps: 30, duration: 6, order: ['video', 'title'], layers: {
      video: { type: 'video', in: 1, transform: { position: [540, 960] }, props: { video: 'clip', start: 0.5, size: [1080, 1920], fit: 'cover' } },
      title: { type: 'text', props: { text: 'Title' } },
    } } },
  };
}

const track: Track = { version: 1, kind: 'track', source: 'clip', name: 'car', width: 1920, height: 1080, frames: Array.from({ length: 21 }, (_, i) => ({ t: i / 10, box: i < 5 ? null : [0.45, 0.4, 0.1, 0.1] })) };

const context = (doc: TrammeDoc, selection: string[] = []): ToolContext => ({
  doc, compId: doc.root, time: 2, selection, registry: reg,
  assetUrl: (id: string) => `data:application/json,${encodeURIComponent(id === 'track-clip-car' ? JSON.stringify(track) : '{}')}`,
  signal: new AbortController().signal,
} as unknown as ToolContext);

describe('framing the object to track', () => {
  it('reads a region in % of the picture, or as fractions', () => {
    expect(parseRegion('40, 30, 20, 25')).toEqual([0.4, 0.3, 0.2, 0.25]);
    expect(parseRegion([0.4, 0.3, 0.2, 0.25])).toEqual([0.4, 0.3, 0.2, 0.25]);
    expect(() => parseRegion('40, 30')).toThrow(/region/);
  });

  it('turns a rectangle of the composition into a box of the picture, through the video layer that crops it', () => {
    const doc = project(), ev = new Evaluator(doc, reg);
    // 200 px around the middle of a portrait frame covered by a landscape picture
    const [x, y, w, h] = toPicture(ev, doc.compositions.main, 'main', 'video', 2, [[440, 860], [640, 860], [440, 1060], [640, 1060]], 1920, 1080);
    expect(x).toBeCloseTo(0.4707, 3);
    expect(y).toBeCloseTo(0.4479, 3);
    expect(w).toBeCloseTo(0.0586, 3);
    expect(h).toBeCloseTo(0.1042, 3);
  });
});

describe('the callout tool', () => {
  it('puts a callout right above the video, while the object is seen', async () => {
    const doc = project();
    const out = await reg.tool('callout').tool.run({ label: 'EV.00 · THE CAR', detail: '1990s estate', line: true }, context(doc)) as { ops: never[] };
    const next = applyOps(doc, out.ops).doc, c = next.compositions.main;
    expect(validate(next, reg)).toEqual([]);
    expect(c.order).toEqual(['video', 'callout', 'title']);
    // seen from 0.5 s of the file, 1 s in the composition, to 2 s of the file and a look more
    expect(c.layers.callout).toMatchObject({ type: 'callout', in: 1, out: 2.6, props: { source: 'video', track: 'track-clip-car', label: 'EV.00 · THE CAR', detail: '1990s estate', line: true } });
  });

  it('needs a track, played by a video of the composition', async () => {
    const bare = project();
    delete bare.assets['track-clip-car'];
    await expect(reg.tool('callout').tool.run({}, context(bare))).rejects.toThrow(/no track yet/);
    const other = project();
    other.compositions.main.layers.video.props!.video = 'other';
    other.assets.other = { type: 'video', src: 'other.mp4' };
    await expect(reg.tool('callout').tool.run({}, context(other))).rejects.toThrow(/plays clip/);
  });
});
