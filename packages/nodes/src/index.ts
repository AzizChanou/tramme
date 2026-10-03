import { BUILTIN_CHECKS, Registry } from '@tramme/core';
import { bloom, blur, chromatic, color, displace, exposure, glow, grade, grain, matte, shadow, tint, vignette } from './effects.ts';
import { comp } from './comp.ts';
import { particles } from './particles.ts';
import { shader } from './shader.ts';
import { image } from './image.ts';
import { sequence } from './sequence.ts';
import { video } from './video.ts';
import { captions } from './captions.ts';
import { receipt, tag } from './events.ts';
import { follow } from './follow.ts';
import { audio, code, group } from './misc.ts';
import { ellipse, path, rect } from './shapes.ts';
import { counter, text } from './text.ts';
import { EFFECT_NOTES, NODE_NOTES } from './notes.ts';

export { canvasPaint, fillStroke, toPath2D } from './paint.ts';
export type { CodeEntry } from './misc.ts';
export const NODES = [rect, ellipse, path, image, sequence, video, text, captions, counter, tag, receipt, group, comp, particles, shader, follow, code, audio];
export const EFFECTS = [vignette, grain, bloom, exposure, chromatic, grade, blur, shadow, glow, color, tint, matte, displace];
// notes for the assistant (list_nodes)
for (const n of NODES) n.ai ??= NODE_NOTES[n.type];
for (const e of EFFECTS) e.ai ??= EFFECT_NOTES[e.type];
export { DEFAULT_SHADER } from './shader.ts';
export { receiptRows, rowStarts } from './events.ts';
export { localTime } from './comp.ts';

/** a registry holding every built-in node, effect and quality check */
export function builtinRegistry(): Registry {
  return new Registry().register(...NODES).registerEffect(...EFFECTS).registerCheck(...BUILTIN_CHECKS);
}
