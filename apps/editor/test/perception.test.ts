import { describe, expect, it } from 'vitest';
import { dominant } from '../src/perception.ts';

describe('the colours of a picture', () => {
  it('finds the main groups, the largest first', () => {
    const px = new Uint8ClampedArray(100 * 4);
    for (let i = 0; i < 100; i++) {
      const c = i < 60 ? [10, 20, 40] : i < 90 ? [240, 240, 235] : [230, 60, 30];
      px.set([c[0] + (i % 3), c[1], c[2], 255], i * 4);
    }
    const found = dominant(px, 3);
    expect(found.map((c) => Math.round(c.share * 100))).toEqual([60, 30, 10]);
    expect(found[2].rgb).toEqual([231, 60, 30]);
  });
});
