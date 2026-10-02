import { describe, expect, it } from 'vitest';
import { newProject } from '@tramme/project';
import { keyTimes } from '../src/review.ts';

describe('the contact sheet', () => {
  it('looks just after the entrances and covers the whole duration', () => {
    const { doc } = newProject({ name: 'Sheet', width: 1080, height: 1080, fps: 30, duration: 10 });
    const c = doc.compositions.main;
    c.layers = { a: { type: 'shape.rect', in: 0 }, b: { type: 'shape.rect', in: 1 }, c: { type: 'shape.rect', in: 1.05 } } as never;
    c.order = ['a', 'b', 'c'];
    const times = keyTimes(doc, 'main', [], 6);
    expect(times).toHaveLength(6);
    expect(times).toContain(0.5);
    expect(times).toContain(1.5);
    expect(Math.max(...times)).toBeGreaterThan(8);
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  });
});
