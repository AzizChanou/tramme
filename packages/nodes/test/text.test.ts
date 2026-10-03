import { describe, expect, it } from 'vitest';
import { cells } from '../src/text.ts';

/** a context whose glyphs have the widths given (8 for any other) */
const ctx = (widths: Record<string, number>) => ({ measureText: (ch: string) => ({ width: widths[ch] ?? 8 }) }) as unknown as CanvasRenderingContext2D;

describe('counter', () => {
  it('sets every digit in a cell as wide as the widest digit, other signs at their own width', () => {
    const c = ctx({ '1': 10, '8': 14, ',': 5, d: 12 });
    expect(cells(c, '1,8')).toEqual([14, 5, 14]);
    // a letter is not a digit, even "d"
    expect(cells(c, 'd%')).toEqual([12, 8]);
  });
});
