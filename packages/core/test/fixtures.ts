import { Registry, type TrammeDoc, type NodeType } from '../src/index.ts';

const noop = { canvas2d() {} };

export const box: NodeType = {
  type: 'box', title: 'Box', category: 'test',
  props: {
    size: { type: 'vec2', default: [100, 100] },
    fill: { type: 'paint', default: '#000000' },
    radius: { type: 'number', default: 0 },
    label: { type: 'string', default: '' },
    mode: { type: 'enum', default: 'a', options: ['a', 'b'] },
    image: { type: 'asset', default: null, nullable: true, assetType: 'image' },
    entry: { type: 'string', default: 'x', animatable: false },
  },
  path: () => null,
  render: noop,
};

export const group: NodeType = { type: 'group', title: 'Group', category: 'test', container: true, props: {}, render: noop };

export const grain = { type: 'look.grain', title: 'Grain', category: 'look', stage: 'finish' as const, props: { amount: { type: 'number' as const, default: 0 }, seed: { type: 'number' as const, default: 0 } } };

export const registry = () => new Registry().register(box, group).registerEffect(grain);

export function makeDoc(): TrammeDoc {
  return {
    schema: 'tramme/1',
    meta: { title: 'test' },
    tokens: {
      ink: { type: 'color', value: '#1C1917' },
      paper: { type: 'color', value: '#F5F0E8' },
      alias: { type: 'color', value: '@ink' },
      swift: { type: 'ease', value: [0.16, 1, 0.3, 1] },
    },
    assets: { photo: { type: 'image', src: 'a.png' } },
    root: 'main',
    compositions: {
      main: {
        name: 'Main', width: 1080, height: 1920, fps: 30, duration: 10,
        background: '@ink',
        motionBlur: { samples: 8, shutter: 0.5 },
        markers: [{ id: 'm1', t: 9, kind: 'hold' }],
        effects: [{ id: 'g', type: 'look.grain', props: { amount: 0.02, seed: { $expr: "Math.min(frame, marker('hold').frame) + 1" } } }],
        layers: {
          bg: { type: 'box', props: { size: [1080, 1920], fill: '@paper' } },
          grp: { type: 'group', in: 2, out: 4, children: ['a', 'b'] },
          a: {
            type: 'box',
            transform: { position: { $k: [{ t: 2, v: [0, 0], ease: '@swift' }, { t: 3, v: [100, 200] }] } },
            props: { radius: { $k: [{ t: 0, v: 0 }, { t: 1, v: 10, ease: 'hold' }, { t: 2, v: 20 }] } },
          },
          b: { type: 'box', props: { radius: { $link: 'a.radius' }, size: { $expr: "[prop('a.radius') * 2, value[1]]" } } },
        },
        order: ['bg', 'grp'],
      },
    },
  };
}
