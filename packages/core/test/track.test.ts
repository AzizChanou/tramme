import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { Evaluator, followBox, pictureRect, placeBox, trackAt, type GrayFrame, type Track, type TrammeDoc, type Vec2 } from '../src/index.ts';

describe('a picture in its frame', () => {
  it('fills, covers or fits as the video node draws it', () => {
    expect(pictureRect('fill', 1080, 1920, 1920, 1080)).toEqual({ x: -540, y: -960, w: 1080, h: 1920 });
    const cover = pictureRect('cover', 1080, 1920, 1920, 1080);
    expect(cover.h).toBeCloseTo(1920);
    expect(cover.w).toBeCloseTo(3413.33, 1);
    expect(pictureRect('contain', 1080, 1920, 1920, 1080)).toEqual({ x: -540, y: -303.75, w: 1080, h: 607.5 });
  });

  it('places a box of the picture on screen, and knows when the frame crops it out', () => {
    const v = { size: [1080, 1920] as Vec2, fit: 'cover', transform: { anchor: [0, 0] as Vec2, position: [540, 960] as Vec2, scale: [1, 1] as Vec2, rotation: 0 } };
    const mid = placeBox(1920, 1080, [0.45, 0.45, 0.1, 0.1], v);
    expect(mid.inside).toBe(true);
    expect(mid.rect.x + mid.rect.w / 2).toBeCloseTo(540);
    expect(mid.rect.h).toBeCloseTo(192);
    // the left side of a landscape picture falls outside a portrait frame
    expect(placeBox(1920, 1080, [0.02, 0.45, 0.1, 0.1], v).inside).toBe(false);
  });
});

describe('a track read at time t', () => {
  const track: Track = { version: 1, kind: 'track', width: 1920, height: 1080, frames: [
    { t: 0, box: [0.1, 0.1, 0.2, 0.2] }, { t: 0.1, box: null }, { t: 0.2, box: [0.3, 0.1, 0.2, 0.2] }, { t: 0.3, box: [0.4, 0.1, 0.2, 0.2] },
  ] };

  it('goes between two looks, loses the object where it was lost, nowhere outside', () => {
    expect(trackAt(track, 0.25, 0).box[0]).toBeCloseTo(0.35);
    expect(trackAt(track, 0.04, 0)).toEqual({ found: 1, box: [0.1, 0.1, 0.2, 0.2] });
    expect(trackAt(track, 0.1, 0).found).toBe(0);
    expect(trackAt(track, 5).found).toBe(0);
    expect(trackAt(undefined, 0.2).found).toBe(0);
  });

  it('smooths over a span, and says how much of it saw the object', () => {
    const s = trackAt(track, 0.25, 0.2);
    expect(s.found).toBeGreaterThan(0.9);
    expect(s.box[0]).toBeGreaterThan(0.3);
    expect(s.box[0]).toBeLessThan(0.4);
    const partly = trackAt(track, 0.1, 0.2);
    expect(partly.found).toBeGreaterThan(0);
    expect(partly.found).toBeLessThan(1);
  });
});

/** a still noisy background and a checkered 24 × 18 target that moves (null: hidden) */
function scene(n: number, at: (i: number) => Vec2 | null, w = 160, h = 120): GrayFrame[] {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const bg = Float32Array.from({ length: w * h }, () => 0.3 + 0.1 * rnd());
  return Array.from({ length: n }, (_, i) => {
    const data = bg.slice(), p = at(i);
    if (p) for (let y = 0; y < 18; y++) for (let x = 0; x < 24; x++) data[(p[1] + y) * w + p[0] + x] = ((x >> 2) + (y >> 2)) % 2 ? 0.9 : 0.1;
    return { width: w, height: h, data };
  });
}

describe('following an object', () => {
  it('finds it frame after frame, forward and back from where it was framed', () => {
    const truth = (i: number): Vec2 => [30 + 3 * i, 40 + i];
    const out = followBox(scene(20, truth), 10, { x: 60, y: 50, w: 24, h: 18 });
    out.forEach((f, i) => {
      expect(f, `frame ${i}`).not.toBeNull();
      expect(Math.abs(f!.box.x - truth(i)[0]), `x of frame ${i}`).toBeLessThan(1.5);
      expect(Math.abs(f!.box.y - truth(i)[1]), `y of frame ${i}`).toBeLessThan(1.5);
      expect(Math.abs(f!.box.w - 24)).toBeLessThan(4);
    });
  });

  it('loses it while it is hidden, and finds it again', () => {
    const out = followBox(scene(20, (i) => (i === 14 || i === 15 ? null : [30 + 3 * i, 40 + i])), 10, { x: 60, y: 50, w: 24, h: 18 });
    expect(out[14]).toBeNull();
    expect(out[15]).toBeNull();
    expect(Math.abs(out[17]!.box.x - 81)).toBeLessThan(1.5);
  });

  it('ends the track at a cut, forward and back, even where the other shot matches', () => {
    const cutAt = (k: number) => Array.from({ length: 20 }, (_, i) => i === k);
    // past the cut, the same checkered thing right where the target would be
    const frames = [...scene(15, (i) => [30 + 3 * i, 40 + i]), ...scene(5, () => [75, 55])];
    const out = followBox(frames, 10, { x: 60, y: 50, w: 24, h: 18 }, { cuts: cutAt(15) });
    expect(out[14]).not.toBeNull();
    expect(out.slice(15)).toEqual([null, null, null, null, null]);
    const back = followBox(scene(20, (i) => [30 + 3 * i, 40 + i]), 10, { x: 60, y: 50, w: 24, h: 18 }, { cuts: cutAt(5) });
    expect(back.slice(0, 5)).toEqual([null, null, null, null, null]);
    expect(back[5]).not.toBeNull();
  });

  it('refuses a flat area', () => {
    const flat = [{ width: 40, height: 40, data: new Float32Array(1600).fill(0.5) }];
    expect(() => followBox(flat, 0, { x: 10, y: 10, w: 10, h: 10 })).toThrow(/flat/);
  });
});

describe('track() in expressions', () => {
  const track: Track = { version: 1, kind: 'track', source: 'clip', name: 'car', width: 1920, height: 1080, frames: [{ t: 0, box: [0.4, 0.4, 0.2, 0.2] }, { t: 2, box: [0.6, 0.4, 0.2, 0.2] }] };
  function doc(): TrammeDoc {
    return {
      schema: 'tramme/1', meta: { title: 'Track' }, tokens: {}, root: 'main',
      assets: { clip: { type: 'video', src: 'clip.mp4' }, 'track-clip-car': { type: 'json', src: 'assets/tracks/clip-car.json' } },
      compositions: { main: { name: 'Main', width: 1920, height: 1080, fps: 30, duration: 5, order: ['video', 'dot'], layers: {
        // the clip starts at 1 s in the composition, 0.5 s into the file
        video: { type: 'video', in: 1, transform: { position: [960, 540] }, props: { video: 'clip', start: 0.5, size: [1920, 1080] } },
        dot: { type: 'shape.rect', transform: { position: { $expr: "track('video', 'car').center" } } },
      } } },
    };
  }
  const data = (id: string) => (id === 'track-clip-car' ? track : undefined);

  it('follow the object on screen, in the time of the video layer', () => {
    const ev = new Evaluator(doc(), builtinRegistry(), { data });
    // composition 1.5 s = file 1 s: the box halfway, its middle at 0.6 of the width
    const [x, y] = ev.value('dot.transform.position', 1.5) as Vec2;
    expect(x).toBeCloseTo(1152, 0);
    expect(y).toBeCloseTo(540, 0);
  });

  it('stay nowhere before the video, or without the track', () => {
    expect(new Evaluator(doc(), builtinRegistry(), { data }).value('dot.transform.position', 0.5)).toEqual([0, 0]);
    expect(new Evaluator(doc(), builtinRegistry()).value('dot.transform.position', 1.5)).toEqual([0, 0]);
  });
});
