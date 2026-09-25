// Builders of common edits. Each returns plain ops, so the result goes
// through the same History as any hand-written patch.

import { getAt, pointer, type Op } from './ops.ts';
import { propKind } from './props.ts';
import type { EaseSpec, TrammeDoc, Keyframe, KeyframedProp, Layer, Prop } from './types.ts';

const layerPath = (comp: string, id: string, ...rest: string[]) => pointer('compositions', comp, 'layers', id, ...rest);

function layerOf(doc: TrammeDoc, comp: string, id: string): Layer {
  const l = doc.compositions[comp]?.layers[id];
  if (!l) throw new Error(`unknown layer: ${comp}/${id}`);
  return l;
}

/** where a property lives: node props, or the transform when name is 'transform.position' etc. */
function propSlot(name: string): [string, string] {
  return name.startsWith('transform.') ? ['transform', name.slice(10)] : ['props', name];
}

/** set a property to any value: static, { $k }, { $expr } or { $link } */
export function setProp(doc: TrammeDoc, comp: string, id: string, name: string, value: Prop): Op[] {
  const [bag, key] = propSlot(name);
  const layer = layerOf(doc, comp, id);
  if (!(layer as any)[bag]) return [{ op: 'add', path: layerPath(comp, id, bag), value: { [key]: value } }];
  return [{ op: 'add', path: layerPath(comp, id, bag, key), value }];
}

/**
 * Add or replace the keyframe at time t (same time within half a frame).
 * A static property becomes keyframed with its current value kept as is.
 */
export function setKeyframe(doc: TrammeDoc, comp: string, id: string, name: string, t: number, v: unknown, ease?: EaseSpec): Op[] {
  const [bag, key] = propSlot(name);
  const current = getAt(doc, layerPath(comp, id, bag, key)) as Prop | undefined;
  const half = 0.5 / doc.compositions[comp].fps;
  const key0: Keyframe = ease === undefined ? { t, v } : { t, v, ease };
  if (current === undefined || propKind(current) !== 'keyframes') {
    return setProp(doc, comp, id, name, { $k: [key0] });
  }
  const keys = (current as KeyframedProp).$k;
  const same = keys.findIndex((k) => Math.abs(k.t - t) < half);
  if (same >= 0) {
    const merged = { ...keys[same], v, ...(ease === undefined ? {} : { ease }) };
    return [{ op: 'replace', path: layerPath(comp, id, bag, key, '$k', String(same)), value: merged }];
  }
  const at = keys.findIndex((k) => k.t > t);
  return [{ op: 'add', path: layerPath(comp, id, bag, key, '$k', at < 0 ? '-' : String(at)), value: key0 }];
}

interface Place { parent?: string; index?: number }

function containerPath(comp: string, parent?: string) {
  return parent ? layerPath(comp, parent, 'children') : pointer('compositions', comp, 'order');
}

/** where a layer sits: its parent (undefined at the root) and index */
export function findLayer(doc: TrammeDoc, comp: string, id: string): { parent?: string; index: number } {
  const c = doc.compositions[comp];
  const i = c.order.indexOf(id);
  if (i >= 0) return { index: i };
  for (const [pid, l] of Object.entries(c.layers)) {
    const j = (l.children || []).indexOf(id);
    if (j >= 0) return { parent: pid, index: j };
  }
  throw new Error(`layer outside the tree: ${id}`);
}

export function addLayer(doc: TrammeDoc, comp: string, id: string, layer: Layer, place: Place = {}): Op[] {
  if (doc.compositions[comp].layers[id]) throw new Error(`layer id already taken: ${id}`);
  const ops: Op[] = [{ op: 'add', path: layerPath(comp, id), value: layer }];
  if (place.parent && !layerOf(doc, comp, place.parent).children) {
    ops.push({ op: 'add', path: layerPath(comp, place.parent, 'children'), value: [id] });
  } else {
    ops.push({ op: 'add', path: `${containerPath(comp, place.parent)}/${place.index ?? '-'}`, value: id });
  }
  return ops;
}

/** remove a layer, its descendants, and the clips that pointed at them */
export function removeLayer(doc: TrammeDoc, comp: string, id: string): Op[] {
  const c = doc.compositions[comp];
  const gone = new Set<string>();
  const collect = (lid: string) => { gone.add(lid); for (const ch of c.layers[lid]?.children || []) collect(ch); };
  collect(id);
  const at = findLayer(doc, comp, id);
  const ops: Op[] = [{ op: 'remove', path: `${containerPath(comp, at.parent)}/${at.index}` }];
  for (const [lid, l] of Object.entries(c.layers)) {
    if (!gone.has(lid) && l.clip && gone.has(l.clip)) ops.push({ op: 'remove', path: layerPath(comp, lid, 'clip') });
  }
  for (const lid of gone) ops.push({ op: 'remove', path: layerPath(comp, lid) });
  return ops;
}

/** move a layer to another parent and/or index (index counted after removal) */
export function moveLayer(doc: TrammeDoc, comp: string, id: string, place: Place): Op[] {
  const at = findLayer(doc, comp, id);
  const ops: Op[] = [{ op: 'remove', path: `${containerPath(comp, at.parent)}/${at.index}` }];
  if (place.parent && !layerOf(doc, comp, place.parent).children) {
    ops.push({ op: 'add', path: layerPath(comp, place.parent, 'children'), value: [id] });
  } else {
    ops.push({ op: 'add', path: `${containerPath(comp, place.parent)}/${place.index ?? '-'}`, value: id });
  }
  return ops;
}
