import { describe, expect, it } from 'vitest';
import { viewBoxSize, withSize } from '../src/assets.ts';

describe('an SVG without a size of its own', () => {
  it('takes the proportions of its viewBox', () => {
    expect(viewBoxSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect/></svg>')).toEqual([24, 24]);
    expect(viewBoxSize('<?xml version="1.0"?>\n<svg width="100%" viewBox="-10 -5, 320,80">')).toEqual([320, 80]);
    expect(viewBoxSize("<svg viewBox='0 0 1.5e2 50'>")).toEqual([150, 50]);
  });

  it('is square when it says nothing of them', () => {
    expect(viewBoxSize('<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>')).toEqual([1, 1]);
    expect(viewBoxSize('<svg viewBox="0 0 0 10">')).toEqual([1, 1]);
  });

  it('is given a size of its own, in place of the one it had', () => {
    expect(withSize('<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 48 24"><rect width="24" height="24"/></svg>', 2048, 1024))
      .toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24" width="2048" height="1024"><rect width="24" height="24"/></svg>');
  });
});
