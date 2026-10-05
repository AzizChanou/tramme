import { describe, expect, it } from 'vitest';
import { flowBetween, flowLines, type Pixels } from '../src/flow.ts';

/** a plaid texture: x stripes of a 24 px period, y stripes of a 12 px one, so every block has structure on both axes and matches uniquely */
const stripes = (shift: number) => (x: number, y: number) => ((x + shift) % 24 < 12 ? 200 : 30) + (y % 12 < 6 ? 15 : 0);
/** a textured square over the stripes: a moving element the blocks can tell from the background */
const withSquare = (sq: { x: number; y: number; s: number }) => (x: number, y: number) =>
  x >= sq.x && x < sq.x + sq.s && y >= sq.y && y < sq.y + sq.s ? (x % 8 < 4 ? 210 : 110) + (y % 8 < 4 ? 15 : 0) : stripes(0)(x, y);
const paint = (w: number, h: number, v: (x: number, y: number) => number): Pixels => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, g = v(x, y);
    data[i] = data[i + 1] = data[i + 2] = g;
    data[i + 3] = 255;
  }
  return { width: w, height: h, data };
};

describe('the flow of pixels', () => {
  it('reads a pan: the whole frame, at its speed in composition px/s', () => {
    // the content of a slides right by 8 px into b
    const a = paint(160, 160, stripes(0)), b = paint(160, 160, stripes(-8));
    const f = flowBetween(a, b, 0.125, 1080)!;
    expect(f.dx).toBe(4);
    expect(f.dy).toBe(0);
    expect(f.speed).toBeCloseTo(432, -1);
    const lines = flowLines(a, b, 0.125, 1080)!;
    expect(lines[0]).toContain('right');
    expect(lines[0]).toContain('432');
  });

  it('says nothing when the pixels hold still', () => {
    const a = paint(160, 160, stripes(0));
    expect(flowBetween(a, a, 0.125, 1080)).toBeNull();
    expect(flowLines(a, a, 0.125, 1080)).toBeNull();
    expect(flowBetween(a, a, 0, 1080)).toBeNull();
    // a flat frame has nothing to track either
    const flat = paint(160, 160, () => 20);
    expect(flowBetween(flat, flat, 0.125, 1080)).toBeNull();
  });

  it('points at what moves against the whole, and where', () => {
    // the background holds, a square slides right: the median holds, the square dissents
    const a = paint(160, 160, withSquare({ x: 20, y: 20, s: 48 })), b = paint(160, 160, withSquare({ x: 28, y: 20, s: 48 }));
    const f = flowBetween(a, b, 0.125, 1080)!;
    expect(f.dissent.n).toBeGreaterThanOrEqual(2);
    expect(f.dissent.x).toBeLessThan(0.45);
    expect(f.dissent.y).toBeLessThan(0.45);
    const lines = flowLines(a, b, 0.125, 1080)!;
    expect(lines.join(' ')).toContain('upper left');
  });
});
