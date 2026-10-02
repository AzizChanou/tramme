// Notes for the assistant on the built-in vocabulary: when each node and
// effect is the right choice (the modifiers' notes are in @tramme/core), and the values that tend to look good or
// bad. They reach the model through list_nodes; the interface does not show
// them. Sizes are given relative to the short side of the composition (u).

import type { AiNotes } from '@tramme/core';

export const NODE_NOTES: Record<string, AiNotes> = {
  'shape.rect': { when: 'cards, bars, bands behind text, wipes, progress bars; radius for pills', avoid: 'pure white or pure black fills on a dark/light plate: use the tokens' },
  'shape.ellipse': { when: 'dots, rings (fill null + stroke), circular reveals used as a clip, soft glows with a radial gradient' },
  'shape.path': { when: 'logos, arrows, underlines and strokes that draw themselves, organic shapes', avoid: 'hand-written paths with dozens of vertices: keep them simple or use an svg asset' },
  image: { when: 'photos and illustrations; fit cover + focus to keep the subject framed when the format changes; a slow zoom 1 to 1.08 over the shot gives life', avoid: 'zoom faster than about 3 % per second, it reads as a mistake' },
  sequence: { when: 'frame by frame drawn animation; hold 2 (on twos) feels hand made at 24 fps', example: { hold: 2, loop: 'loop' } },
  video: { when: 'filmed footage; size = composition size with fit cover for a full frame; one layer per cut (cut_media builds them)' },
  text: { when: 'titles, labels, keywords; one idea per layer, one word per layer for kinetic type', avoid: 'size under 0.035 u (unreadable on a phone), more than two fonts, long lines over 0.8 of the width, text on screen less than 0.3 s per word', example: { size: 96, weight: 800, tracking: -0.01, align: 'center', baseline: 'middle' } },
  'text.counter': { when: 'numbers that roll up (stats, prices, years); animate progress 0 to 1 with an ease out over 0.8 to 1.6 s' },
  captions: { when: 'captions of speech from a transcript; maxWords 3 in vertical formats, 5 in horizontal; highlight box or color for the spoken word', avoid: 'covering the face: place them in the lower third or above the chin line' },
  group: { when: 'moving or fading several layers together; an effect on the group composites it as one' },
  comp: { when: 'reusing an animated block several times, time remapping, loops; build the block in its own composition' },
  particles: { when: 'sparks, dust, confetti, snow, bokeh; deterministic: change seed for variety', avoid: 'rate over about 300 with long lifetimes (slow previews); hard white dots: lower opacity, vary size', example: { rate: 60, life: 1.8, speed: 260, spread: 50, gravity: [0, 400] } },
  shader: { when: 'animated backgrounds, gradients that move, noise textures, abstract looks; keep it subtle behind text' },
  follow: { when: 'secondary motion: a dot, a cursor or a highlight lagging behind a moving element and settling; leave its own transform at rest (it draws in composition space)', example: { target: 'logo', frequency: 2.2, damping: 0.35, trail: 12 } },
  code: { when: 'last resort for existing drawing code; prefer a node plugin for anything reusable' },
  audio: { when: 'music, voice over and sound effects placed on the timeline; gain in dB (-12 to -18 for a music bed under a voice)' },
};

export const EFFECT_NOTES: Record<string, AiNotes> = {
  'look.vignette': { when: 'drawing the eye to the centre on a solid background', example: { amount: 0.18 } },
  'look.grain': { when: 'a filmic texture that hides banding in gradients', avoid: 'amount over 0.03' },
  'look.bloom': { when: 'neon, light leaks, glowing type on dark plates', avoid: 'bloom on a light background (washes out)', example: { amount: 0.6, threshold: 0.8 } },
  'look.exposure': { when: 'fades to or from white or black of the whole picture (animate value)' },
  'fx.blur': { when: 'focus pulls, entrances that sharpen in (radius 20 to 0 over 0.4 s), depth behind text' },
  'fx.shadow': { when: 'lifting text or cards off a busy picture', example: { color: 'rgba(0,0,0,0.45)', blur: 24, offset: [0, 10] } },
  'fx.glow': { when: 'neon type and icons on dark plates', avoid: 'strength over 2 on body text' },
  'fx.color': { when: 'matching footage, desaturating a background so the subject stands out' },
  'fx.tint': { when: 'duotone looks, recolouring an icon or a logo to the accent token' },
  'fx.matte': { when: 'footage or a gradient seen through big type or a shape (hide the matte layer); luma for a soft mask', example: { source: 'title', mode: 'alpha' } },
  'fx.displace': { when: 'glass, heat haze, liquid or glitch looks: the map layer is usually a hidden moving shader or noisy shape' },
  'look.chromatic': { when: 'a glitch beat, an energetic edit, a lens feel; animate it on hits', avoid: 'more than 8 px on calm pieces' },
  'look.grade': { when: 'giving the whole film one mood: warm (temperature 0.3), cold, washed (saturation 0.8, lift 0.03)' },
};
