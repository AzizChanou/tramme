import { describe, expect, it } from 'vitest';
import { calloutLayout } from '../src/callout.ts';

const frame = { width: 1920, height: 1080 }, chip = { w: 300, h: 32 };

describe('the label of a callout', () => {
  it('goes on the side with room, away from the edge the object is near', () => {
    const left = calloutLayout({ x: 300, y: 400, w: 200, h: 120 }, chip, 'auto', frame, false, 12);
    expect(left.side).toBe('right');
    expect(left.chip).toEqual({ x: 512, y: 400, w: 300, h: 32 });
    expect(left.anchor).toEqual([500, 400]);
    expect(calloutLayout({ x: 1400, y: 400, w: 200, h: 120 }, chip, 'auto', frame, false, 12).side).toBe('left');
    // a wide object: no room beside it, so above it
    expect(calloutLayout({ x: 200, y: 400, w: 1500, h: 300 }, chip, 'auto', frame, false, 12).side).toBe('above');
  });

  it('leaves room for a line, which runs from the corner to the label', () => {
    const L = calloutLayout({ x: 300, y: 400, w: 200, h: 120 }, chip, 'right', frame, true, 12);
    expect(L.chip.x).toBe(548);
    expect(L.chip.y).toBe(376);
    expect(L.end).toEqual([548, 392]);
  });

  it('stays in the frame', () => {
    const L = calloutLayout({ x: 1700, y: 10, w: 150, h: 100 }, chip, 'right', frame, false, 12);
    expect(L.chip.x + L.chip.w).toBeLessThanOrEqual(1920 - 12);
    expect(L.chip.y).toBeGreaterThanOrEqual(12);
  });
});
