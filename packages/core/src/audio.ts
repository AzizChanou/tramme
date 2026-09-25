// The sounds of a composition, each where it plays: audio layers, and the
// sound of video layers not muted. A layer plays its file from `start`, from
// its in point to its out point: several layers of one file make the cuts of
// an edit. The preview, the exports and the command line all mix these.

import { staticValue } from './props.ts';
import type { TrammeDoc } from './types.ts';

export interface AudioClip {
  layerId: string;
  /** asset id of the file */
  asset: string;
  /** composition time (s) where the clip starts */
  at: number;
  /** time in the file (s) played at `at` */
  offset: number;
  /** seconds played */
  duration: number;
  gainDb: number;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function audioClips(doc: TrammeDoc, compId: string): AudioClip[] {
  const comp = doc.compositions[compId];
  if (!comp) return [];
  const clips: AudioClip[] = [];
  for (const [layerId, layer] of Object.entries(comp.layers)) {
    if (layer.visible === false || (layer.type !== 'audio' && layer.type !== 'video')) continue;
    const props = layer.props ?? {};
    if (layer.type === 'video' && staticValue(props.muted) === true) continue;
    const asset = staticValue(layer.type === 'audio' ? props.audio : props.video);
    if (typeof asset !== 'string' || !doc.assets[asset]) continue;
    const at = layer.in ?? 0, end = Math.min(layer.out ?? comp.duration, comp.duration);
    if (end <= at) continue;
    clips.push({ layerId, asset, at, offset: Math.max(0, num(staticValue(props.start), 0)), duration: end - at, gainDb: num(staticValue(props.gain), 0) });
  }
  return clips.sort((a, b) => a.at - b.at);
}
