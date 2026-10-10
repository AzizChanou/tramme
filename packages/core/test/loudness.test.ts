import { describe, expect, it } from 'vitest';
import { bandPowers, integratedLoudness, limit, loudnessSeries, master, soundFlaws, truePeak } from '../src/index.ts';

const RATE = 48000;
const sine = (hz: number, amp: number, seconds: number, phase = 0) => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE + phase));
const db = (x: number) => 20 * Math.log10(x);
/** white noise in [-1, 1), the same on every run */
const seededNoise = (seed: number) => { let s = seed; return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 2 ** 32) * 2 - 1; }; };

describe('loudness (BS.1770)', () => {
  it('reads a stereo 1 kHz sine at -23 dBFS as -23 LUFS, as EBU Tech 3341 says', () => {
    const s = sine(1000, Math.pow(10, -23 / 20), 10);
    expect(integratedLoudness([s, s.slice()], RATE)).toBeCloseTo(-23, 1);
  });

  it('gates silence out: a sine with silence after it reads the same', () => {
    const s = sine(1000, 0.1, 5), padded = new Float32Array(RATE * 10);
    padded.set(s);
    expect(integratedLoudness([padded], RATE)).toBeCloseTo(integratedLoudness([s], RATE), 0);
    expect(integratedLoudness([new Float32Array(RATE)], RATE)).toBe(-Infinity);
  });

  it('follows the level over time', () => {
    const quiet = sine(1000, 0.01, 2), loud = sine(1000, 0.5, 2), both = new Float32Array(RATE * 4);
    both.set(quiet); both.set(loud, RATE * 2);
    const series = loudnessSeries([both], RATE);
    expect(series.at(-1)!.lufs - series[0].lufs).toBeCloseTo(db(50), 0);
  });
});

describe('true peak', () => {
  it('finds the peak between the samples (a sine at a quarter of the rate, sampled off its tops)', () => {
    const s = sine(RATE / 4, 1, 0.1, Math.PI / 4);
    expect(db(Math.max(...s.map(Math.abs)))).toBeCloseTo(-3, 0);
    expect(truePeak([s])).toBeGreaterThan(-0.5);
  });
});

describe('the master', () => {
  it('limits the true peak under the ceiling', () => {
    const s = sine(440, 1, 1);
    limit([s], RATE, -6);
    expect(truePeak([s])).toBeLessThanOrEqual(-5.9);
  });

  it('brings a mix to its loudness, the true peak under -1 dBTP', () => {
    const rnd = seededNoise(3), left = Float32Array.from({ length: RATE * 6 }, (_, i) => 0.05 * rnd() + (i % 24000 < 200 ? 0.9 * rnd() : 0));
    const out = master([left, left.slice()], RATE, -14, -1);
    expect(Math.abs(out.lufs + 14)).toBeLessThanOrEqual(0.3);
    expect(out.truePeak).toBeLessThanOrEqual(-1);
  });
});

describe('bands and flaws', () => {
  it('puts a 1.5 kHz tone in the 1k band', () => {
    const p = bandPowers([sine(1500, 0.5, 1)], RATE);
    expect(p.indexOf(Math.max(...p))).toBe(3);
  });

  it('finds two hits in a clip meant for one, and none in one hit', () => {
    const hit = (at: number, n: Float32Array) => { for (let i = 0; i < RATE * 0.05; i++) n[Math.round(at * RATE) + i] = Math.exp(-i / 400) * Math.sin(i / 3); };
    const two = new Float32Array(RATE), one = new Float32Array(RATE);
    hit(0.1, two); hit(0.5, two); hit(0.1, one);
    expect(soundFlaws([two], RATE, 'click')).toContain('two-events');
    expect(soundFlaws([one], RATE, 'click')).toEqual([]);
  });

  it('finds a steady hiss where a gesture is expected, a clipped take, a click in a whoosh', () => {
    const rnd = seededNoise(1);
    const hiss = Float32Array.from({ length: RATE * 2 }, () => 0.3 * rnd());
    expect(soundFlaws([hiss], RATE, 'whoosh')).toContain('steady');
    expect(soundFlaws([hiss], RATE, 'ambience')).toEqual([]);
    const square = Float32Array.from({ length: RATE / 2 }, (_, i) => (Math.floor(i / 50) % 2 ? 1 : -1));
    expect(soundFlaws([square], RATE, 'impact')).toContain('clipped');
    const swell = Float32Array.from({ length: RATE }, (_, i) => 0.3 * Math.sin(i / 20) * Math.sin((Math.PI * i) / RATE));
    swell[RATE / 4] = 0.9; swell[RATE / 2] = -0.9;
    expect(soundFlaws([swell], RATE, 'whoosh')).toContain('clicks');
  });
});
