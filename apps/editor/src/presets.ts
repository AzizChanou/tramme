// Ready-made layers of the add menu: a node with props, effects and motion
// already tuned. Plugins add theirs (`presets` export) the same way.

import type { PresetType } from '@tramme/core';

export const EDITOR_PRESETS: PresetType[] = [
  {
    name: 'neon-title', title: 'Neon title', description: 'bright type with a cyan glow that flickers a little',
    layer: {
      type: 'text', transform: { opacity: { $v: 1, $mod: [{ type: 'wiggle', freq: 6, amp: 0.06, seed: 3 }] } },
      props: { text: 'NEON', size: 150, weight: 800, align: 'center', baseline: 'middle', color: '#F2FBFF', tracking: 0.04 },
      effects: [{ id: 'glow', type: 'fx.glow', props: { color: '#22D3EE', radius: 22, strength: 2 } }],
    },
  },
  {
    name: 'frosted-card', title: 'Frosted card', description: 'a translucent rounded card with a soft shadow, to set text on',
    layer: {
      type: 'shape.rect',
      props: { size: [720, 420], radius: 36, fill: 'rgba(255,255,255,0.08)', stroke: 'rgba(255,255,255,0.22)', strokeWidth: 2 },
      effects: [{ id: 'shadow', type: 'fx.shadow', props: { color: 'rgba(0,0,0,0.4)', blur: 40, offset: [0, 18] } }],
    },
  },
  {
    name: 'light-leak', title: 'Light leak', description: 'a warm glow that drifts slowly over the picture (add blending)',
    layer: {
      type: 'shape.ellipse', blend: 'add',
      transform: { opacity: 0.55, position: { $v: [540, 400], $mod: [{ type: 'wiggle', freq: 0.25, amp: 120, seed: 7 }] } },
      props: { size: [1400, 900], fill: { type: 'radial', center: [0, 0], radius: 700, stops: [[0, 'rgba(255,170,90,0.9)'], [0.5, 'rgba(255,90,60,0.35)'], [1, 'rgba(255,60,60,0)']] } },
    },
  },
  {
    name: 'spotlight', title: 'Spotlight', description: 'a soft circle of light that draws the eye (overlay blending)',
    layer: {
      type: 'shape.ellipse', blend: 'overlay',
      props: { size: [900, 900], fill: { type: 'radial', center: [0, 0], radius: 450, stops: [[0, 'rgba(255,255,255,0.75)'], [1, 'rgba(255,255,255,0)']] } },
    },
  },
];
