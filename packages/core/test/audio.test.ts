import { describe, expect, it } from 'vitest';
import { audioClips, gainAt, gainMoves, soundFigures, type TrammeDoc } from '../src/index.ts';

const doc = (props: Record<string, unknown>, extra: Record<string, unknown> = {}): TrammeDoc => ({
  version: 1, meta: { title: 't' }, root: 'main',
  assets: { s: { type: 'audio', src: 's.wav' }, v: { type: 'video', src: 'v.mp4' } },
  compositions: { main: { name: 'main', width: 100, height: 100, fps: 30, duration: 10, order: ['a'], layers: { a: { type: 'audio', in: 2, out: 6, props: { audio: 's', ...props } }, ...extra } } },
} as unknown as TrammeDoc);

describe('the sound of a layer', () => {
  it('reads how it sounds: level, fades, speed, filters, reverb, within their ranges', () => {
    const [c] = audioClips(doc({ gain: -6, fadeIn: 0.5, fadeOut: 9, rate: 9, lowCut: 120, highCut: 8000, reverb: 2, start: 1 }), 'main');
    expect(c).toMatchObject({ at: 2, duration: 4, offset: 1, gainDb: -6, envelope: null, fadeIn: 0.5, fadeOut: 4, rate: 4, lowCut: 120, highCut: 8000, reverb: 1 });
  });

  it('follows an animated gain: ducking under a voice', () => {
    const [c] = audioClips(doc({ gain: { $k: [{ t: 3, v: 0 }, { t: 3.5, v: -12 }, { t: 5, v: -12 }, { t: 5.5, v: 0 }] } }), 'main');
    expect(c.envelope![0]).toEqual([2, 0]);
    expect(gainMoves(c)).toBe(true);
    expect(gainAt(c, 2.5)).toBeCloseTo(1, 5);
    expect(gainAt(c, 4)).toBeCloseTo(Math.pow(10, -12 / 20), 4);
    expect(gainAt(c, 3.25)).toBeCloseTo(Math.pow(10, -6 / 20), 2);
  });

  it('fades in and out', () => {
    const [c] = audioClips(doc({ gain: 0, fadeIn: 1, fadeOut: 2 }), 'main');
    expect(gainAt(c, 2)).toBe(0);
    expect(gainAt(c, 2.5)).toBeCloseTo(0.5);
    expect(gainAt(c, 3.5)).toBe(1);
    expect(gainAt(c, 5)).toBeCloseTo(0.5);
    expect(gainAt(c, 6)).toBe(0);
    expect(gainMoves(audioClips(doc({ gain: -3 }), 'main')[0])).toBe(false);
  });

  it('keeps a video at its own speed, and leaves a muted one out', () => {
    const video = (muted: boolean) => audioClips(doc({}, { b: { type: 'video', props: { video: 'v', rate: 2, muted, fadeIn: 0.2 } } }), 'main').find((c) => c.asset === 'v');
    expect(video(false)).toMatchObject({ rate: 1, fadeIn: 0.2 });
    expect(video(true)).toBeUndefined();
  });
});

describe('what a sound is like', () => {
  const rate = 8000;
  const sound = (fn: (t: number) => number, seconds: number) => Float32Array.from({ length: seconds * rate }, (_, i) => fn(i / rate));

  it('finds a hit: where it lands, its peak and where it fades out', () => {
    // silence, then a hit at 0.3 s decaying over 0.2 s
    const hit = sound((t) => (t < 0.3 ? 0 : 0.5 * Math.exp(-(t - 0.3) * 30) * Math.sin(2 * Math.PI * 200 * t)), 1);
    const f = soundFigures([hit, hit], rate);
    expect(f.duration).toBe(1);
    expect(f.peakDb).toBeCloseTo(-6, 0);
    expect(f.peakAt).toBeGreaterThanOrEqual(0.3);
    expect(f.peakAt).toBeLessThan(0.33);
    expect(f.start).toBeCloseTo(0.3, 1);
    expect(f.end).toBeLessThan(0.75);
    expect(f.loudDb).toBeLessThan(f.peakDb);
  });

  it('lands a riser on its top, and says when there is nothing', () => {
    const riser = sound((t) => t * Math.sin(2 * Math.PI * (100 + 400 * t) * t), 2);
    expect(soundFigures([riser], rate).peakAt).toBeGreaterThan(1.9);
    const silent = soundFigures([new Float32Array(rate)], rate);
    expect(silent).toMatchObject({ peakDb: -120, start: 0, end: 0 });
  });
});
