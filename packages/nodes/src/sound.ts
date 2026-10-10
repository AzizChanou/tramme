// How a layer sounds, the same on audio layers and on the sound of videos:
// its gain (animated for fades and ducking), fades, filters and reverb. Read
// by audioClips (@tramme/core) and mixed by the one mixer of @tramme/render.

import type { PropSchema } from '@tramme/core';

const group = 'Sound';

export const SOUND_PROPS: PropSchema = {
  gain: { type: 'number', default: 0, step: 0.5, unit: 'dB', label: 'Volume', group, description: 'animate it for a fade or to duck the sound under a voice' },
  fadeIn: { type: 'number', default: 0, min: 0, step: 0.05, unit: 's', label: 'Fade in', group, animatable: false },
  fadeOut: { type: 'number', default: 0, min: 0, step: 0.05, unit: 's', label: 'Fade out', group, animatable: false },
  lowCut: { type: 'number', default: 0, min: 0, max: 20000, step: 10, label: 'Low cut', group, description: 'Hz: removes the sound under it (rumble, a thinner sound); 0 for none; animate it to thin a music out before a hit (a build)' },
  highCut: { type: 'number', default: 0, min: 0, max: 20000, step: 100, label: 'High cut', group, animatable: false, description: 'Hz: removes the sound over it (muffled, far away); 0 for none' },
  reverb: { type: 'number', default: 0, min: 0, max: 1, step: 0.05, label: 'Reverb', group, animatable: false, description: 'share of room sound, 0 (dry) to 1' },
};

/** an audio layer's place in the mix: its bus, its weight, what it underlines in the picture (the sound checks read them) */
export const MIX_PROPS: PropSchema = {
  role: { type: 'enum', default: 'effect', options: ['effect', 'music', 'voice', 'ambience'], label: 'Role', group, animatable: false, description: 'effects share the room of the composition; music and ambience are the bed under the voice' },
  weight: { type: 'enum', default: 'support', options: ['support', 'hero'], label: 'Weight', group, animatable: false, description: 'hero: one of the few moments the film is built around (a logo, a reveal), louder over the bed; support: the others' },
  visual: { type: 'enum', default: 'none', options: ['none', 'cut', 'move', 'land', 'appear'], label: 'Underlines', group, animatable: false, description: 'what it marks in the picture: a cut, a move at its fastest, a landing, an appearance (the checks look for it there)' },
};

/** an audio layer's own: its playback speed, the pitch with it */
export const RATE_PROP: PropSchema = {
  rate: { type: 'number', default: 1, min: 0.25, max: 4, step: 0.05, unit: 'x', label: 'Speed', group, animatable: false, description: 'playback speed, the pitch with it: under 1 lower and longer, over 1 higher and shorter' },
};
