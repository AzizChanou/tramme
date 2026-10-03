import { describe, expect, it } from 'vitest';
import { builtinRegistry } from '@tramme/nodes';
import { runChecks, sampleComposition, Evaluator, type CheckType, type Layer, type TrammeDoc } from '../src/index.ts';

/** a 1080 x 1920 composition of 6 s holding the given layers, in order */
function doc(layers: Record<string, Partial<Layer>>): TrammeDoc {
  return {
    schema: 'tramme/1', meta: { title: 'Checks' }, tokens: {}, assets: {}, root: 'main',
    compositions: { main: { name: 'Main', width: 1080, height: 1920, fps: 30, duration: 6, layers: layers as Record<string, Layer>, order: Object.keys(layers) } },
  };
}
const text = (s: string, extra: Partial<Layer> = {}, props: Record<string, unknown> = {}): Partial<Layer> =>
  ({ type: 'text', transform: { position: [540, 960] }, props: { text: s, size: 96, align: 'center', baseline: 'middle', ...props }, ...extra });
const checks = async (d: TrammeDoc) => (await runChecks(d, builtinRegistry())).map((i) => `${i.check}:${(i.layers ?? []).join('+')}`);

describe('quality checks', () => {
  it('place layers in composition space, through their groups', () => {
    const d = doc({ g: { type: 'group', transform: { position: [100, 0], scale: [2, 2] }, children: ['t'] } as Partial<Layer>, t: text('Hi', { transform: { position: [10, 20] } }) });
    d.compositions.main.order = ['g'];
    const [s] = sampleComposition(new Evaluator(d, builtinRegistry()), 'main', 1);
    const t = s.layers.find((p) => p.id === 't')!;
    expect(t.textSize).toBeCloseTo(192);
    expect(t.box!.x + t.box!.w / 2).toBeCloseTo(120);
    expect(t.box!.y + t.box!.h / 2).toBeCloseTo(40);
  });

  it('find nothing to say on a clean composition', async () => {
    expect(await checks(doc({ title: text('A clear title', { in: 0.5 }) }))).toEqual(['stillness:']);
  });

  it('find text too small, too brief, past the edges, and overlapping', async () => {
    const found = await checks(doc({
      tiny: text('small print', {}, { size: 20 }),
      brief: text('a sentence far too long to be read in half a second', { in: 1, out: 1.5, transform: { position: [540, 400] } }),
      edge: text('Off the side', { transform: { position: [1060, 1500] } }),
      a: text('Overlap one', { transform: { position: [540, 1200] } }),
      b: text('Overlap two', { transform: { position: [560, 1210] } }),
    }));
    expect(found).toEqual(expect.arrayContaining(['text-size:tiny', 'text-time:brief', 'safe-zone:edge', 'text-overlap:a+b']));
    expect(found).not.toContain('text-size:edge');
  });

  it('find crowded entrances and still stretches', async () => {
    const dots = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`dot${i}`, { type: 'shape.ellipse', in: 2, transform: { position: [200 + i * 150, 960] }, props: { size: [40, 40] } } as Partial<Layer>]));
    const found = await checks(doc(dots));
    expect(found).toContain('crowd:dot0+dot1+dot2+dot3+dot4');
    // empty for 2 s (under the threshold), then still from 2 to 6 s
    expect(found.filter((f) => f.startsWith('stillness'))).toHaveLength(1);
  });

  it('count a nested composition as playing, its own stretches found when it is checked', async () => {
    const d = doc({ scene: { type: 'comp', transform: { position: [540, 960] }, props: { comp: 'inner' } } });
    d.compositions.inner = { name: 'Inner', width: 1080, height: 1920, fps: 30, duration: 6, layers: { dot: { type: 'shape.ellipse', transform: { position: [540, 960] } } }, order: ['dot'] };
    expect(await checks(d)).toEqual([]);
    expect((await runChecks(d, builtinRegistry(), 'inner')).map((i) => i.check)).toEqual(['stillness']);
  });

  it('find text over a face once the people are known, through the framing of the video', async () => {
    // a 1920x1080 video filling a vertical frame (cover): its middle third shows
    const d = doc({
      clip: { type: 'video', transform: { position: [540, 960] }, props: { video: 'talk', size: [1080, 1920], fit: 'cover' } },
      onFace: text('Hello', { transform: { position: [540, 700] } }),
      below: text('Lower', { transform: { position: [540, 1700] } }),
    });
    d.assets = { talk: { type: 'video', src: 'talk.mp4' }, 'subjects-talk': { type: 'json', src: 'talk-subjects.json' } };
    // someone in the middle of the picture, head at the top, down to y 0.75 (1440 px in the frame)
    const subjects = { version: 1, kind: 'subjects', width: 1920, height: 1080, frames: [{ t: 0, boxes: [{ x: 0.4, y: 0.15, w: 0.2, h: 0.6, label: 'person', score: 0.9 }] }] };
    const issues = await runChecks(d, builtinRegistry(), 'main', { data: (id) => (id === 'subjects-talk' ? subjects : undefined) });
    const over = issues.filter((i) => i.check === 'text-over-subject');
    expect(over.map((i) => `${i.severity}:${i.layers}`)).toEqual(['warning:onFace']);
    // without the analysis, nothing is said
    expect((await runChecks(d, builtinRegistry())).some((i) => i.check === 'text-over-subject')).toBe(false);
  });

  it('run the checks of a plugin, and report one that fails', async () => {
    const custom: CheckType = { name: 'brand', description: 'logo present', run: () => [{ check: 'brand', severity: 'warning', message: 'no logo' }] };
    const broken: CheckType = { name: 'broken', description: 'fails', run: () => { throw new Error('boom'); } };
    const reg = builtinRegistry().clone().use({ checks: [custom, broken] }, 'brandkit');
    const issues = await runChecks(doc({ t: text('Hello') }), reg);
    expect(issues.find((i) => i.check === 'brand')?.message).toBe('no logo');
    expect(issues.find((i) => i.check === 'broken')?.message).toMatch(/boom/);
  });
});
