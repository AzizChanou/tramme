import { describe, expect, it } from 'vitest';
import { drawingAt, exposureSheet, localFrame, sheetIssues, type SequenceTiming } from '../src/index.ts';

const base: SequenceTiming = { count: 4, hold: 2, sheet: '', loop: 'loop', offset: 0, drawing: 0 };
const run = (p: Partial<SequenceTiming>, frames: number) => Array.from({ length: frames }, (_, f) => drawingAt({ ...base, ...p }, f));

describe('image sequence', () => {
  it('without a sheet: each drawing held for "Hold" frames', () => {
    expect(exposureSheet('', 3, 2)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(run({}, 10)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 0, 0]);
  });

  it('exposure sheet: ranges, holds, reverse order, blanks', () => {
    expect(exposureSheet('1-3/2, 4/3, 3-2, x/2', 4, 1)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 3, 2, 1, -1, -1]);
    expect(exposureSheet('2 1/3', 4, 2)).toEqual([1, 1, 0, 0, 0]);
    expect(sheetIssues('1-4/2, 7, zz', 4)).toEqual(['drawing 7 missing (4 drawings)', '"zz" unreadable (e.g. 1-4/2, 5/6, x/3)']);
    expect(sheetIssues('1-4/2, x/3', 4)).toEqual([]);
  });

  it('playback: loop, once, ping-pong, offset', () => {
    expect(run({ hold: 1, loop: 'once' }, 6)).toEqual([0, 1, 2, 3, 3, 3]);
    expect(run({ hold: 1, loop: 'pingpong' }, 8)).toEqual([0, 1, 2, 3, 2, 1, 0, 1]);
    expect(run({ hold: 1, offset: 1 }, 4)).toEqual([1, 2, 3, 0]);
    expect(drawingAt({ ...base, hold: 1 }, -1)).toBe(3);
  });

  it('forced drawing (a mouth with hold keyframes) and local frames', () => {
    expect(run({ drawing: 3 }, 3)).toEqual([2, 2, 2]);
    expect(drawingAt({ ...base, drawing: 9 }, 0)).toBe(3);
    expect(drawingAt({ ...base, count: 0 }, 0)).toBe(-1);
    expect(localFrame(1.5, 0.5, 24)).toBe(24);
    // the sub-frames of motion blur (around a frame time) keep that frame's drawing
    expect(localFrame(0.5 + 1 / 24 - 0.3 / 24, 0.5, 24)).toBe(1);
    expect(localFrame(0.5 + 1 / 24 + 0.3 / 24, 0.5, 24)).toBe(1);
  });
});
