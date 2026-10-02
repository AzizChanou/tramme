import { describe, expect, it } from 'vitest';
import { analyseAudio, audioReader, Evaluator, type AudioAnalysis, type TrammeDoc } from '../src/index.ts';
import { builtinRegistry } from '@tramme/nodes';

const registry = builtinRegistry();

const RATE = 22050;

/** 20 s at 120 bpm: a kick on every beat (louder on the first of four), hats between, twice as loud from 10 s */
function groove(): Float32Array {
  const out = new Float32Array(RATE * 20);
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let b = 0; b < 40; b++) {
    const t0 = 0.25 + b * 0.5, gain = (t0 >= 10 ? 1 : 0.45) * (b % 4 === 0 ? 1 : 0.6);
    for (let i = 0; i < RATE * 0.15; i++) {
      const k = Math.floor(t0 * RATE) + i;
      if (k < out.length) out[k] += gain * Math.sin(2 * Math.PI * 60 * (i / RATE)) * Math.exp(-i / (RATE * 0.04));
    }
    for (let i = 0; i < RATE * 0.03; i++) {
      const k = Math.floor((t0 + 0.25) * RATE) + i;
      if (k < out.length) out[k] += gain * 0.3 * noise() * Math.exp(-i / (RATE * 0.008));
    }
  }
  return out;
}

describe('audio analysis', () => {
  const a = analyseAudio(groove(), RATE);

  it('finds the tempo, the beats and the bars', () => {
    expect(a.tempo).toBeGreaterThan(117);
    expect(a.tempo).toBeLessThan(123);
    expect(a.beats.length).toBeGreaterThanOrEqual(38);
    const gaps = a.beats.slice(1).map((t, i) => t - a.beats[i]);
    expect(Math.max(...gaps.map((g) => Math.abs(g - 0.5)))).toBeLessThan(0.05);
    // beats land on the kicks (0.25 + k/2), bars on the accented ones (every 2 s)
    const near = (t: number) => { const d = (((t - 0.25) % 0.5) + 0.5) % 0.5; return Math.min(d, 0.5 - d); };
    expect(Math.max(...a.beats.map(near))).toBeLessThan(0.04);
    const bars = a.downbeats.slice(1).map((t, i) => t - a.downbeats[i]);
    expect(bars.every((g) => Math.abs(g - 2) < 0.06)).toBe(true);
    const off = (((a.downbeats[0] - 0.25) % 2) + 2) % 2;
    expect(Math.min(off, 2 - off)).toBeLessThan(0.06);
  });

  it('finds the hits, the bands and the moment it gets louder', () => {
    expect(a.onsets.length).toBeGreaterThanOrEqual(60);
    expect(a.envelope.low.length).toBe(a.duration * a.rate);
    expect(Math.max(...a.envelope.rms)).toBe(1);
    expect(a.sections.some((s) => Math.abs(s.t - 10.25) < 1.1 && s.level > 0.2)).toBe(true);
  });

  it('says nothing of a pulse in silence', () => {
    const quiet = analyseAudio(new Float32Array(RATE * 6), RATE);
    expect(quiet.tempo).toBeNull();
    expect(quiet.beats).toEqual([]);
  });

  it('is read at any time as a pure function', () => {
    const at = audioReader(a, a.beats[4]);
    expect(at.pulse()).toBeCloseTo(1);
    expect(at.beat).toBe(4);
    expect(at.phase).toBeCloseTo(0);
    const later = audioReader(a, a.beats[4] + 0.2);
    expect(later.pulse(0.2)).toBeCloseTo(Math.exp(-1), 2);
    expect(later.phase).toBeGreaterThan(0.3);
    expect(audioReader(a, 15).section).toBeGreaterThanOrEqual(1);
    expect(audioReader(null, 3).pulse()).toBe(0);
  });
});

describe('following the music', () => {
  const analysis: AudioAnalysis = {
    version: 1, kind: 'audio-analysis', duration: 10, rate: 50,
    envelope: { rms: Array(500).fill(0.5), low: Array(500).fill(0.8), mid: Array(500).fill(0.2), high: Array(500).fill(0.1) },
    onsets: [1, 2, 3], tempo: 60, beats: [1, 2, 3, 4], downbeats: [1], sections: [],
  };
  function doc(): TrammeDoc {
    return {
      schema: 'tramme/1', meta: { title: 'Music' }, tokens: {}, root: 'main',
      assets: { song: { type: 'audio', src: 'song.mp3' }, 'analysis-song': { type: 'json', src: 'song.json' } },
      compositions: { main: { name: 'Main', width: 100, height: 100, fps: 30, duration: 10, order: ['music', 'dot'], layers: {
        // the song starts at 2 s in the composition, 0.5 s into the file
        music: { type: 'audio', in: 2, props: { audio: 'song', start: 0.5 } },
        dot: { type: 'shape.rect', props: { size: { $v: [10, 10], $mod: [{ type: 'react', source: 'music', signal: 'beat', amount: 10, decay: 0.1 }] } }, transform: { opacity: { $expr: "audio('music').energy('low')" } } },
      } } },
    };
  }
  const data = (id: string) => (id === 'analysis-song' ? analysis : undefined);

  it('in the time of the sound layer, through expressions and the react modifier', () => {
    const ev = new Evaluator(doc(), registry, { data });
    // composition 3.5 s = file 2 s: a beat
    expect(ev.value('dot.size', 3.5)).toEqual([20, 20]);
    expect((ev.value('dot.size', 3.6) as number[])[0]).toBeCloseTo(10 + 10 * Math.exp(-1));
    expect(ev.value('dot.transform.opacity', 3)).toBeCloseTo(0.8);
  });

  it('stays still without the analysis loaded', () => {
    const ev = new Evaluator(doc(), registry);
    expect(ev.value('dot.size', 3.5)).toEqual([10, 10]);
    expect(ev.value('dot.transform.opacity', 3)).toBe(0);
  });
});
