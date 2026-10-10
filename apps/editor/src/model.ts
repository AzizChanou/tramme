// Pure helpers over the document for the editor: tree order, parents,
// keyframes, time formatting, and the ops of common edits.

import { getAt, pointer, propKind, setKeyframe, setProp, type Composition, type TrammeDoc, type Keyframe, type KeyframedProp, type Layer, type Op, type Prop } from '@tramme/core';
import { locale, t } from './i18n/index.ts';

export interface TreeItem { id: string; layer: Layer; depth: number; parent: string | null }

/** layers top first (the order of a layer list), with their depth */
export function flatTree(comp: Composition, collapsed: Set<string> = new Set()): TreeItem[] {
  const out: TreeItem[] = [];
  const walk = (ids: string[], depth: number, parent: string | null) => {
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i], layer = comp.layers[id];
      if (!layer) continue;
      out.push({ id, layer, depth, parent });
      if (layer.children && !collapsed.has(id)) walk(layer.children, depth + 1, id);
    }
  };
  walk(comp.order, 0, null);
  return out;
}

export function parentOf(comp: Composition, id: string): string | null {
  for (const [pid, l] of Object.entries(comp.layers)) if (l.children?.includes(id)) return pid;
  return null;
}

/** the list that holds a layer (the composition's order or a group's children) and its path in the composition */
export function siblingsOf(comp: Composition, id: string): { path: string[]; list: string[] } {
  if (comp.order.includes(id)) return { path: ['order'], list: comp.order };
  const p = parentOf(comp, id);
  if (!p) throw new Error(`${id} is not in the composition's tree`);
  return { path: ['layers', p, 'children'], list: comp.layers[p].children! };
}

/** ids of a layer and all its descendants */
export function subtree(comp: Composition, id: string): string[] {
  const out = [id];
  for (const c of comp.layers[id]?.children || []) out.push(...subtree(comp, c));
  return out;
}

/** the name of the group the sounds are kept in */
export const SOUND_GROUP = 'Sound';

/** the group the sounds are kept in, at the root: named Sound, or holding sounds only */
export const soundGroupOf = (comp: Composition): string | undefined => comp.order.find((id) => {
  const l = comp.layers[id];
  return l?.type === 'group' && (l.name === SOUND_GROUP || (!!l.children?.length && l.children.every((k) => comp.layers[k]?.type === 'audio')));
});

/** the layers of a set not inside another one of the set: those that carry the others along */
export const topLayers = (comp: Composition, ids: string[]) => ids.filter((id) => comp.layers[id] && !ids.some((o) => o !== id && subtree(comp, o).includes(id)));

export const layerName = (id: string, l: Layer) => l.name || id;

/** a text cut to at most max characters, an ellipsis marking the cut */
export const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** a name fit for ids and paths: ascii letters without accents, digits, _ and dashes */
export const slug = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

// ── time ─────────────────────────────────────────────────────
export const snap = (t: number, fps: number) => Math.round(t * fps) / fps;

const p2 = (n: number) => String(n).padStart(2, '0');
/** MM:SS:FF, minutes, seconds and frames */
export function timecode(t: number, fps: number): string {
  const f = Math.round(t * fps), total = Math.floor(f / fps), ff = f - total * fps;
  return `${p2(Math.floor(total / 60))}:${p2(total % 60)}:${p2(ff)}`;
}
/** short label for rulers: '2 s' on whole seconds, '2:15' (seconds:frames) otherwise */
export function rulerLabel(t: number, fps: number): string {
  const f = Math.round(t * fps), s = Math.floor(f / fps), ff = f - s * fps;
  return ff ? `${s}:${p2(ff)}` : `${s} s`;
}

/** parse '8.5' (seconds), '255f' (frames), '08:15' (seconds:frames) or '00:08:15' (minutes:seconds:frames) */
export function parseTime(text: string, fps: number): number | null {
  const s = text.trim().replace(',', '.');
  if (/^\d+f$/i.test(s)) return parseInt(s, 10) / fps;
  if (/^\d+(\.\d+)?s?$/.test(s)) return parseFloat(s);
  const parts = s.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 2) return parts[0] + parts[1] / fps;
  if (parts.length === 3) return parts[0] * 60 + parts[1] + parts[2] / fps;
  return null;
}

export const fmtSeconds = (s: number) => `${locale === 'fr' ? s.toFixed(2).replace('.', ',') : s.toFixed(2)} s`;

// ── properties ───────────────────────────────────────────────
/** 'size' -> props.size, 'transform.position' -> transform.position */
export function propPath(compId: string, id: string, name: string): string {
  return name.startsWith('transform.')
    ? pointer('compositions', compId, 'layers', id, 'transform', name.slice(10))
    : pointer('compositions', compId, 'layers', id, 'props', name);
}

export function rawProp(doc: TrammeDoc, compId: string, id: string, name: string): Prop | undefined {
  return getAt(doc, propPath(compId, id, name));
}

export function keysOf(p: Prop | undefined): Keyframe[] | null {
  return p !== undefined && propKind(p) === 'keyframes' ? (p as KeyframedProp).$k : null;
}

/** every animated property of a layer: [name, keys] (transform first) */
export function animatedProps(layer: Layer): [string, Keyframe[]][] {
  const out: [string, Keyframe[]][] = [];
  for (const [k, v] of Object.entries(layer.transform || {})) { const ks = keysOf(v as Prop); if (ks) out.push([`transform.${k}`, ks]); }
  for (const [k, v] of Object.entries(layer.props || {})) { const ks = keysOf(v as Prop); if (ks) out.push([k, ks]); }
  return out;
}

/** edit a property at time t: a key at t when it is animated, the static value otherwise */
export function editPropOps(doc: TrammeDoc, compId: string, id: string, name: string, value: unknown, t: number): Op[] {
  const fps = doc.compositions[compId].fps;
  const cur = rawProp(doc, compId, id, name);
  if (keysOf(cur)) return setKeyframe(doc, compId, id, name, snap(t, fps), value);
  return setProp(doc, compId, id, name, value as Prop);
}

/** move a layer and its descendants in time: in/out and every keyframe */
export function shiftLayerOps(doc: TrammeDoc, compId: string, id: string, dt: number): Op[] {
  const comp = doc.compositions[compId];
  const ops: Op[] = [];
  const r = (x: number) => Math.round(x * 1e6) / 1e6;
  for (const lid of subtree(comp, id)) {
    const l = comp.layers[lid];
    if (l.in !== undefined || lid === id) ops.push({ op: 'add', path: pointer('compositions', compId, 'layers', lid, 'in'), value: r(Math.max(0, (l.in ?? 0) + dt)) });
    if (l.out !== undefined || lid === id) ops.push({ op: 'add', path: pointer('compositions', compId, 'layers', lid, 'out'), value: r((l.out ?? comp.duration) + dt) });
    for (const [name, keys] of animatedProps(l)) {
      ops.push({ op: 'replace', path: propPath(compId, lid, name), value: { ...(rawProp(doc, compId, lid, name) as object), $k: keys.map((k) => ({ ...k, t: r(k.t + dt) })) } });
    }
  }
  return ops;
}

/** a fresh id: base, base2, base3... */
export function freshId(taken: Record<string, unknown>, base: string): string {
  const clean = base.replace(/[^A-Za-z0-9_-]/g, '') || 'layer';
  if (!taken[clean]) return clean;
  for (let i = 2; ; i++) if (!taken[`${clean}${i}`]) return `${clean}${i}`;
}

/** a short description of an op, for proposal cards */
export function describeOp(doc: TrammeDoc, op: Op): string {
  const parts = op.path.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  const short = (v: unknown) => { const s = JSON.stringify(v); return s.length > 48 ? s.slice(0, 46) + '…' : s; };
  if (parts[0] === 'compositions' && parts[2] === 'layers' && parts[3]) {
    const l = doc.compositions[parts[1]]?.layers[parts[3]];
    const name = l?.name || parts[3];
    const rest = parts.slice(4).join('.');
    if (op.op === 'add' && parts.length === 4) return t('editor.newLayerNameType', { name: (op.value as Layer)?.name || parts[3], type: (op.value as Layer)?.type });
    if (op.op === 'remove' && parts.length === 4) return t('editor.deleteName', { name });
    const v = 'value' in op ? ` = ${short(op.value)}` : '';
    return `${name} · ${rest || t('editor.layer')}${v}`;
  }
  if (parts[0] === 'compositions' && parts[2] === 'order') return t('editor.layerOrder');
  const v = 'value' in op ? ` = ${short(op.value)}` : '';
  return `${parts.join('.')}${v}`;
}

// ── generic edits by JSON Pointer (layer props, composition settings, effects) ──
/** set a value at path, creating the missing parent objects */
export function setAtOps(doc: TrammeDoc, path: string, value: unknown): Op[] {
  const parts = path.split('/').slice(1);
  for (let i = 1; i < parts.length; i++) {
    const parent = '/' + parts.slice(0, i).join('/');
    if (getAt(doc, parent) === undefined) {
      // build the missing branch in one op
      let v: unknown = value;
      for (let j = parts.length - 1; j >= i; j--) v = { [parts[j].replace(/~1/g, '/').replace(/~0/g, '~')]: v };
      return [{ op: 'add', path: parent, value: v }];
    }
  }
  return [{ op: 'add', path, value }];
}

const isWrapped = (p: unknown): p is { $v: unknown; $mod?: unknown[] } => !!p && typeof p === 'object' && !Array.isArray(p) && '$v' in p;
const modsKept = (p: unknown) => (p && typeof p === 'object' && Array.isArray((p as { $mod?: unknown[] }).$mod) ? { $mod: (p as { $mod: unknown[] }).$mod } : {});

/** a key at time t (replacing the one within half a frame), making the property animated if it was not */
export function keyAtOps(doc: TrammeDoc, path: string, t: number, v: unknown, fps: number): Op[] {
  const cur = getAt(doc, path) as Prop | undefined;
  const keys = keysOf(cur);
  if (!keys) return setAtOps(doc, path, { $k: [{ t, v }], ...modsKept(cur) });
  const half = 0.5 / fps;
  const same = keys.findIndex((k) => Math.abs(k.t - t) < half);
  if (same >= 0) return [{ op: 'replace', path: `${path}/$k/${same}`, value: { ...keys[same], v } }];
  const at = keys.findIndex((k) => k.t > t);
  return [{ op: 'add', path: `${path}/$k/${at < 0 ? '-' : at}`, value: { t, v } }];
}

/** edit at time t: a key when animated, the static value otherwise (expressions and links are replaced) */
export function editAtOps(doc: TrammeDoc, path: string, v: unknown, t: number, fps: number): Op[] {
  const cur = getAt(doc, path) as Prop | undefined;
  if (keysOf(cur)) return keyAtOps(doc, path, snap(t, fps), v, fps);
  if (isWrapped(cur)) return [{ op: 'replace', path: `${path}/$v`, value: v }];
  return setAtOps(doc, path, v);
}

/** a static value, keeping the modifier stack */
export function fixedOps(doc: TrammeDoc, path: string, v: unknown): Op[] {
  const kept = modsKept(getAt(doc, path));
  return setAtOps(doc, path, '$mod' in kept ? { $v: v, ...kept } : v);
}

/** add a modifier at the end of the property's stack */
export function addModifierOps(doc: TrammeDoc, path: string, mod: Record<string, unknown>, current: unknown): Op[] {
  const cur = getAt(doc, path);
  if (cur === undefined || cur === null || typeof cur !== 'object' || Array.isArray(cur)) return setAtOps(doc, path, { $v: cur ?? current, $mod: [mod] });
  if (Array.isArray((cur as { $mod?: unknown }).$mod)) return [{ op: 'add', path: `${path}/$mod/-`, value: mod }];
  return [{ op: 'add', path: `${path}/$mod`, value: [mod] }];
}

/** remove modifier i; a { $v } left without modifiers goes back to the raw value */
export function removeModifierOps(doc: TrammeDoc, path: string, i: number): Op[] {
  const cur = getAt(doc, path) as { $v?: unknown; $mod: unknown[] };
  if (cur.$mod.length > 1) return [{ op: 'remove', path: `${path}/$mod/${i}` }];
  if (isWrapped(cur)) return [{ op: 'replace', path, value: cur.$v }];
  return [{ op: 'remove', path: `${path}/$mod` }];
}

/** remove one key; the last key leaves its value as a static property */
export function removeKeyOps(doc: TrammeDoc, path: string, index: number): Op[] {
  const keys = keysOf(getAt(doc, path))!;
  if (keys.length <= 1) return [{ op: 'replace', path, value: keys[0].v }];
  return [{ op: 'remove', path: `${path}/$k/${index}` }];
}

export function keyIndexAt(keys: Keyframe[] | null, t: number, fps: number): number {
  if (!keys) return -1;
  const half = 0.5 / fps;
  return keys.findIndex((k) => Math.abs(k.t - t) < half);
}

// ── relative dates ───────────────────────────────────────────
const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
export function ago(iso: string): string {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  if (s > -45) return t('editor.justNow');
  if (s > -3600) return rtf.format(Math.round(s / 60), 'minute');
  if (s > -86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (s > -7 * 86400) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

// ── drawings ─────────────────────────────────────────────────
const natural = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
/** folder of an asset src ('assets/oeil/01.png' gives 'assets/oeil') */
export const folderOf = (src: string) => (src.includes('/') ? src.slice(0, src.lastIndexOf('/')) : '');
/** image assets of a folder, in natural name order (2 before 10) */
export function imagesIn(doc: TrammeDoc, folder: string): string[] {
  return Object.entries(doc.assets).filter(([, a]) => a.type === 'image' && folderOf(a.src) === folder)
    .sort((a, b) => natural.compare(a[1].src, b[1].src)).map(([id]) => id);
}
/** the shared name of numbered files ('oeil_01.png', 'oeil_02.png' give 'oeil'), or null */
export function commonStem(names: string[]): string | null {
  const stems = names.map((n) => n.replace(/\.[^.]+$/, '').replace(/[-_ .]*\d+$/, '').toLowerCase());
  return stems.length > 1 && stems[0] && stems.every((s) => s === stems[0]) ? stems[0] : null;
}
