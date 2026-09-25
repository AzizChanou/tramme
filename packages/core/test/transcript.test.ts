import { describe, expect, it } from 'vitest';
import { captionGroups, mergeChunks, remapTranscript, silences, transcriptText, type Transcript } from '../src/index.ts';

const words = [
  { w: 'Hello', s: 0.2, e: 0.6 }, { w: 'to', s: 0.65, e: 0.7 }, { w: 'everyone.', s: 0.72, e: 1.0 },
  { w: 'Today', s: 2.0, e: 2.5 }, { w: 'we', s: 2.55, e: 2.65 }, { w: 'talk', s: 2.7, e: 3.0 }, { w: 'about', s: 3.05, e: 3.1 }, { w: 'motion', s: 3.15, e: 3.5 }, { w: 'design.', s: 3.55, e: 4.0 },
];
const t: Transcript = { version: 1, duration: 5, words };

describe('transcription', () => {
  it('text, caption groups', () => {
    expect(transcriptText(t)).toBe('Hello to everyone. Today we talk about motion design.');
    const g = captionGroups(words, { maxWords: 4 });
    expect(g.map((x) => x.words.map((w) => w.w).join(' '))).toEqual(['Hello to everyone.', 'Today we talk about', 'motion design.']);
    // a short gap: the group stays until the next one
    expect(g[1].e).toBe(3.15);
  });

  it('silences and cuts: words follow their kept part', () => {
    expect(silences(t, 0.7)).toEqual([{ from: 1.0, to: 2.0 }, { from: 4.0, to: 5 }]);
    const r = remapTranscript(t, [{ from: 0, to: 1.1 }, { from: 1.9, to: 4.1 }]);
    expect(r.duration).toBeCloseTo(3.3);
    expect(r.words.length).toBe(9);
    expect(r.words[3]).toEqual({ w: 'Today', s: 1.1 + 0.1, e: 1.1 + 0.6 });
    const cut = remapTranscript(t, [{ from: 1.9, to: 3.12 }]);
    expect(cut.words.map((w) => w.w)).toEqual(['Today', 'we', 'talk', 'about']);
  });

  it('overlapping chunks: each word once', () => {
    const merged = mergeChunks([
      { start: 0, end: 3, words: words.filter((w) => w.s < 3) },
      { start: 2.5, end: 5, words: words.filter((w) => w.e > 2.5) },
    ]);
    expect(merged.map((w) => w.w)).toEqual(words.map((w) => w.w));
  });
});
