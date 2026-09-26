import { Registry } from '@tramme/core';
import { bloom, blur, color, exposure, glow, grain, shadow, tint, vignette } from './effects.ts';
import { comp } from './comp.ts';
import { particles } from './particles.ts';
import { shader } from './shader.ts';
import { image } from './image.ts';
import { sequence } from './sequence.ts';
import { video } from './video.ts';
import { captions } from './captions.ts';
import { audio, code, group } from './misc.ts';
import { ellipse, path, rect } from './shapes.ts';
import { counter, text } from './text.ts';

export { canvasPaint, fillStroke, toPath2D } from './paint.ts';
export type { CodeEntry } from './misc.ts';
export const NODES = [rect, ellipse, path, image, sequence, video, text, captions, counter, group, comp, particles, shader, code, audio];
export const EFFECTS = [vignette, grain, bloom, exposure, blur, shadow, glow, color, tint];
export { DEFAULT_SHADER } from './shader.ts';
export { localTime } from './comp.ts';

/** a registry holding every built-in node and effect */
export function builtinRegistry(): Registry {
  return new Registry().register(...NODES).registerEffect(...EFFECTS);
}
