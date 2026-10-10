import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { Evaluator, soundCues, type Layer, type TrammeDoc } from '../src/index.ts';

/** a 1080 x 1920 composition of `duration` s holding the given layers, bottom first */
function doc(layers: Record<string, Partial<Layer>>, duration = 6): TrammeDoc {
  return {
    schema: 'tramme/1', meta: { title: 'Cues' }, tokens: {}, assets: {}, root: 'main',
    compositions: { main: { name: 'Main', width: 1080, height: 1920, fps: 30, duration, layers: layers as Record<string, Layer>, order: Object.keys(layers) } },
  };
}
const rect = (size: [number, number], extra: Partial<Layer> = {}): Partial<Layer> => ({ type: 'shape.rect', transform: { position: [540, 960] }, props: { size, fill: '#fff' }, ...extra });
const cues = (d: TrammeDoc) => soundCues(new Evaluator(d, builtinRegistry()), 'main').map((c) => `${c.kind}@${c.t}:${c.layer}:${c.weight}`);

describe('sound cues, read from the timing of the picture', () => {
  it('finds a move at its fastest and its landing', () => {
    const d = doc({
      card: rect([400, 400], { transform: { position: { $k: [{ t: 1, v: [200, 960], ease: [0.4, 0, 0.2, 1] }, { t: 1.6, v: [880, 960] }] } } }),
    });
    const list = soundCues(new Evaluator(d, builtinRegistry()), 'main');
    const move = list.find((c) => c.kind === 'move')!, land = list.find((c) => c.kind === 'land')!;
    expect(move.layer).toBe('card');
    expect(move.t).toBeGreaterThan(1.15);
    expect(move.t).toBeLessThan(1.45);
    expect(land.t).toBeGreaterThan(1.45);
    expect(land.t).toBeLessThanOrEqual(1.64);
  });

  it('finds an appearance, and a cut where half the frame changes', () => {
    const d = doc({
      a: rect([1080, 1920], { out: 3 }),
      b: rect([1080, 1920], { in: 3 }),
      logo: rect([300, 300], { in: 4.5 }),
    });
    // the logo closes the film: its hero; the cut, 1.5 s before, supports it
    expect(cues(d)).toEqual(['cut@3:b:support', 'appear@4.5:logo:hero']);
  });

  it('keeps one cue for layers moving together, the biggest naming it', () => {
    const d = doc({
      g: { type: 'group', transform: { position: { $k: [{ t: 1, v: [0, 1200] }, { t: 1.5, v: [0, 0] }] } }, children: ['big', 'small'] } as Partial<Layer>,
      big: rect([800, 800]),
      small: rect([100, 100], { transform: { position: [540, 1300] } }),
    });
    d.compositions.main.order = ['g'];
    const moves = soundCues(new Evaluator(d, builtinRegistry()), 'main').filter((c) => c.kind === 'move');
    expect(moves.map((c) => c.layer)).toEqual(['big']);
  });

  it('spaces the heroes: about one in four seconds, the end card among them', () => {
    const layers: Record<string, Partial<Layer>> = {};
    for (let i = 0; i < 6; i++) layers[`t${i}`] = rect([500, 300], { in: 0.5 + i * 1.5, transform: { position: [540, 300 + i * 250] } });
    const list = soundCues(new Evaluator(doc(layers, 10), builtinRegistry()), 'main');
    const heroes = list.filter((c) => c.weight === 'hero');
    expect(heroes.length).toBeLessThanOrEqual(3);
    expect(heroes.some((h) => h.layer === 't5')).toBe(true);
    for (let i = 1; i < heroes.length; i++) expect(heroes[i].t - heroes[i - 1].t).toBeGreaterThanOrEqual(3);
  });
});
