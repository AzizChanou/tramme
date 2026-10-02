// Left column: the layer tree, the assets and the design tokens.

import { signal } from '@preact/signals';
import { useRef, useState } from 'preact/hooks';
import { addLayer, applyOps, layerActive, moveLayer, pointer, removeLayer, type Asset, type TrammeDoc, type Layer, type NodeType, type Op, type PresetType, type TokenType } from '@tramme/core';
import { comp, commit, S, select, viewDoc, toast, uiTime } from '../state.ts';
import { flatTree, freshId, layerName, parentOf, subtree, commonStem, folderOf, imagesIn } from '../model.ts';
import { ColorField, openMenu, Swatch, TextInput, resolveColor, type MenuItem } from './controls.tsx';
import { Icon, kindColor, kindIcon } from './icons.tsx';
import { preview } from '../preview.ts';
import { fromLottie } from '@tramme/interop';
import { transcribeAsset, transcriptIdOf } from '../speech.ts';
import { safeName, takenPaths, upload } from '../files.ts';
import { m, t, tr } from '../i18n/index.ts';

const tab = signal<'layers' | 'assets' | 'tokens'>('layers');
const collapsed = signal<Set<string>>(new Set());

// ── new layers ───────────────────────────────────────────────
function firstToken(doc: TrammeDoc, type: TokenType) {
  const e = Object.entries(doc.tokens).find(([, t]) => t.type === type);
  return e ? `@${e[0]}` : null;
}
function firstAsset(doc: TrammeDoc, type: string) {
  return Object.entries(doc.assets).find(([, a]) => a.type === type)?.[0] ?? null;
}

/** a new layer of a node type, centred, with sensible defaults */
export function newLayer(doc: TrammeDoc, compId: string, node: NodeType, extra: Partial<Layer> = {}): Layer {
  const c = doc.compositions[compId];
  const center: [number, number] = [c.width / 2, c.height / 2];
  const u = Math.min(c.width, c.height);
  const color = firstToken(doc, 'color') ?? '#2EC4B6';
  const props: Record<string, unknown> = {};
  switch (node.type) {
    case 'shape.rect': Object.assign(props, { size: [Math.round(u * 0.4), Math.round(u * 0.4)], fill: color }); break;
    case 'shape.ellipse': Object.assign(props, { size: [Math.round(u * 0.4), Math.round(u * 0.4)], fill: color }); break;
    case 'shape.path': Object.assign(props, { fill: color }); break;
    case 'text': case 'text.counter': {
      const font = firstAsset(doc, 'font');
      Object.assign(props, { size: Math.round(u * 0.09), weight: 700, align: 'center', color: '#FFFFFF', ...(font ? { font } : {}) });
      if (node.type === 'text') props.text = t('panel.text');
      break;
    }
    case 'image': { const img = firstAsset(doc, 'image'); Object.assign(props, { size: [Math.round(u * 0.6), Math.round(u * 0.6)], fit: 'contain', ...(img ? { image: img } : {}) }); break; }
    case 'audio': { const a = firstAsset(doc, 'audio'); if (a) props.audio = a; break; }
    case 'video': { const v = firstAsset(doc, 'video'); Object.assign(props, { size: [c.width, c.height], fit: 'cover', ...(v ? { video: v } : {}) }); break; }
  }
  const positioned = node.type !== 'group' && node.type !== 'code' && node.type !== 'audio';
  return {
    type: node.type, name: t(node.title),
    ...(positioned ? { transform: { position: center } } : {}),
    ...(node.container ? { children: [] } : {}),
    ...(Object.keys(props).length ? { props } : {}),
    ...extra,
  };
}

/** a preset as a layer of the open composition: centred when it has no position */
function presetLayer(p: PresetType): Layer {
  const c = S.doc.peek().compositions[S.compId.peek()];
  const tr0 = p.layer.transform ?? {};
  return { ...structuredClone(p.layer), name: tr(p.title ?? p.name), transform: { ...structuredClone(tr0), position: tr0.position ?? [c.width / 2, c.height / 2] } } as Layer;
}

/** add a layer above the selection (same parent), or at the top of the root */
export function insertLayer(layer: Layer, base?: string) {
  const doc = S.doc.peek(), compId = S.compId.peek(), c = doc.compositions[compId];
  const id = freshId(c.layers, base ?? layer.type.split('.').pop()!);
  const sel = S.selection.peek()[0];
  let place: { parent?: string; index?: number } = {};
  if (sel && c.layers[sel]) {
    if (c.layers[sel].children && S.registry.peek().node(c.layers[sel].type).container) place = { parent: sel };
    else {
      const parent = parentOf(c, sel) ?? undefined;
      const arr = parent ? c.layers[parent].children! : c.order;
      place = { parent, index: arr.indexOf(sel) + 1 };
    }
  }
  if (commit(t('panel.newLayerName', { name: layer.name ?? id }), addLayer(doc, compId, id, layer, place))) select([id]);
}

export function addLayerMenu(e: MouseEvent | DOMRect) {
  const reg = S.registry.peek();
  const groups = new Map<string, NodeType[]>();
  for (const n of reg.listNodes()) { if (!groups.has(n.category)) groups.set(n.category, []); groups.get(n.category)!.push(n); }
  const items: MenuItem[] = [];
  for (const [cat, nodes] of groups) {
    items.push({ section: t(cat) });
    for (const n of nodes) items.push({ label: t(n.title), icon: kindIcon(n.type), onClick: () => insertLayer(newLayer(S.doc.peek(), S.compId.peek(), n)) });
  }
  // ready-made layers: the editor's and the project's plugins'
  const presets = reg.listPresets().filter(({ preset }) => reg.hasNode(preset.layer.type));
  const sections = new Map<string, typeof presets>();
  for (const p of presets) { const cat = p.preset.category ?? m('panel.presets'); if (!sections.has(cat)) sections.set(cat, []); sections.get(cat)!.push(p); }
  for (const [cat, list] of sections) {
    items.push({ section: t(cat) });
    for (const { preset } of list) items.push({ label: tr(preset.title ?? preset.name), icon: kindIcon(preset.layer.type), onClick: () => insertLayer(presetLayer(preset), preset.name) });
  }
  openMenu(e as MouseEvent, items);
}

export function deleteSelection() {
  const doc = S.doc.peek(), compId = S.compId.peek(), c = doc.compositions[compId];
  const sel = S.selection.peek().filter((id) => c.layers[id]);
  if (!sel.length) return;
  // a layer inside another selected one goes with its parent
  const roots = sel.filter((id) => !sel.some((o) => o !== id && subtree(c, o).includes(id)));
  const ops: Op[] = [];
  let cur = doc;
  for (const id of roots) {
    const o = removeLayer(cur, compId, id);
    ops.push(...o);
    cur = applyOps(cur, o).doc;
  }
  if (commit(roots.length > 1 ? t('panel.deleteNLayers', { n: roots.length }) : t('panel.deleteName', { name: layerName(roots[0], c.layers[roots[0]]) }), ops)) select([]);
}

export function duplicateSelection() {
  const doc = S.doc.peek(), compId = S.compId.peek(), c = doc.compositions[compId];
  const id = S.selection.peek()[0];
  if (!id || !c.layers[id]) return;
  const taken: Record<string, unknown> = { ...c.layers };
  const mapping = new Map<string, string>();
  for (const lid of subtree(c, id)) { const nid = freshId(taken, lid); taken[nid] = 1; mapping.set(lid, nid); }
  const parent = parentOf(c, id) ?? undefined;
  const arr = parent ? c.layers[parent].children! : c.order;
  const ops: Op[] = [];
  for (const [lid, nid] of mapping) {
    const l = structuredClone(c.layers[lid]);
    if (l.children) l.children = l.children.map((ch) => mapping.get(ch)!);
    if (l.clip && mapping.has(l.clip)) l.clip = mapping.get(l.clip);
    if (lid === id) l.name = t('panel.nameCopy', { name: layerName(lid, c.layers[lid]) });
    ops.push({ op: 'add', path: pointer('compositions', compId, 'layers', nid), value: l });
  }
  const container = parent ? pointer('compositions', compId, 'layers', parent, 'children') : pointer('compositions', compId, 'order');
  ops.push({ op: 'add', path: `${container}/${arr.indexOf(id) + 1}`, value: mapping.get(id)! });
  if (commit(t('common.duplicate'), ops)) select([mapping.get(id)!]);
}

/** move the selected layers (same parent) into a new composition, replaced by one comp layer */
export function precompose() {
  const doc = S.doc.peek(), compId = S.compId.peek(), c = doc.compositions[compId];
  const sel = S.selection.peek().filter((id) => c.layers[id]);
  if (!sel.length) return;
  const parent = parentOf(c, sel[0]) ?? undefined;
  if (sel.some((id) => (parentOf(c, id) ?? undefined) !== parent)) { toast(t('panel.precomposeChooseLayersFrom'), 'error'); return; }
  const container = parent ? c.layers[parent].children! : c.order;
  const ordered = container.filter((id) => sel.includes(id));
  const moved = new Set(ordered.flatMap((id) => subtree(c, id)));
  const newId = freshId(doc.compositions, 'precomp');
  const layers: Record<string, Layer> = {};
  for (const id of moved) {
    const l = structuredClone(c.layers[id]);
    if (l.clip && !moved.has(l.clip)) delete l.clip;
    layers[id] = l;
  }
  const ops: Op[] = [{ op: 'add', path: pointer('compositions', newId), value: { name: t('panel.precompN', { n: Object.keys(doc.compositions).length }), width: c.width, height: c.height, fps: c.fps, duration: c.duration, background: null, layers, order: ordered } }];
  let cur = applyOps(doc, ops).doc;
  for (const id of ordered) { const o = removeLayer(cur, compId, id); ops.push(...o); cur = applyOps(cur, o).doc; }
  const at = Math.min(...ordered.map((id) => container.indexOf(id)));
  const layerId = freshId(cur.compositions[compId].layers, 'precomp');
  ops.push(...addLayer(cur, compId, layerId, { type: 'comp', name: t('panel.precompN', { n: Object.keys(doc.compositions).length }), transform: { position: [c.width / 2, c.height / 2] }, props: { comp: newId } }, { parent, index: at }));
  if (commit(t('panel.precompose'), ops)) select([layerId]);
}

// ── layer tree ───────────────────────────────────────────────
function LayerTree() {
  const c = comp.value, now = uiTime.value, sel = S.selection.value;
  const items = flatTree(c, collapsed.value);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; where: 'before' | 'after' | 'inside' } | null>(null);
  const anchor = useRef<string | null>(null);
  const compId = S.compId.value;
  const lp = (id: string) => pointer('compositions', compId, 'layers', id);

  const click = (e: MouseEvent, id: string) => {
    if (e.shiftKey && anchor.current) {
      const ids = items.map((i) => i.id), a = ids.indexOf(anchor.current), b = ids.indexOf(id);
      select(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (e.ctrlKey || e.metaKey) {
      select(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
      anchor.current = id;
    } else { select([id]); anchor.current = id; }
  };

  const startDrag = (e: PointerEvent, id: string) => {
    if (e.button !== 0 || renaming) return;
    const y0 = e.clientY;
    let dragging = false, target: typeof drop = null;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientY - y0) < 4) return;
      dragging = true;
      const row = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('[data-layer]') as HTMLElement | null;
      const over = row?.dataset.layer;
      if (!over || subtree(c, id).includes(over)) { target = null; setDrop(null); return; }
      const r = row!.getBoundingClientRect(), k = (ev.clientY - r.top) / r.height;
      const isGroup = !!c.layers[over].children;
      const where = isGroup && k > 0.3 && k < 0.7 ? 'inside' : k < 0.5 ? 'before' : 'after';
      target = { id: over, where };
      setDrop(target);
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      setDrop(null);
      if (!dragging || !target) return;
      const doc = S.doc.peek();
      let place: { parent?: string; index?: number };
      if (target.where === 'inside') place = { parent: target.id };
      else {
        const parent = parentOf(c, target.id) ?? undefined;
        const arr = (parent ? c.layers[parent].children! : c.order).filter((x) => x !== id);
        const i = arr.indexOf(target.id);
        // the list shows the top first: "before" in the list is above, so later in the stack
        place = { parent, index: target.where === 'before' ? i + 1 : i };
      }
      commit(t('panel.moveLayer'), moveLayer(doc, compId, id, place));
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  const rowMenu = (e: MouseEvent, id: string) => {
    e.preventDefault();
    if (!sel.includes(id)) select([id]);
    const l = c.layers[id];
    openMenu(e, [
      { label: t('common.rename'), icon: 'text', onClick: () => setRenaming(id) },
      { label: t('common.duplicate'), icon: 'copy', hint: 'Ctrl+D', onClick: duplicateSelection },
      { label: l.visible === false ? t('common.show') : t('common.hide'), icon: l.visible === false ? 'eye' : 'eyeOff', onClick: () => commit(t('panel.visibility'), l.visible === false ? [{ op: 'remove', path: `${lp(id)}/visible` }] : [{ op: 'add', path: `${lp(id)}/visible`, value: false }]) },
      { label: t('panel.goToInPoint'), icon: 'start', onClick: () => { S.time.value = l.in ?? 0; } },
      { label: t('panel.precompose'), icon: 'comp', onClick: precompose },
      ...(l.type === 'comp' && typeof l.props?.comp === 'string' ? [{ label: t('panel.openComposition'), icon: 'comp' as const, onClick: () => { S.compId.value = l.props!.comp as string; select([]); } }] : []),
      'sep',
      { label: t('common.delete'), icon: 'trash', hint: t('common.del'), onClick: deleteSelection },
    ]);
  };

  if (!items.length) {
    return <div class="empty"><Icon name="layers" />{t('panel.noLayers')}<button class="btn sm" onClick={(e) => addLayerMenu(e)}><Icon name="plus" />{t('panel.addALayer')}</button></div>;
  }
  return (
    <div class="tree" role="tree">
      {items.map(({ id, layer, depth }) => {
        const active = layerActive(layer, c, now);
        const hidden = layer.visible === false;
        const isOpen = !collapsed.value.has(id);
        const d = drop?.id === id ? ` drop-${drop.where}` : '';
        return (
          <div key={id} data-layer={id} role="treeitem" aria-selected={sel.includes(id)}
            class={`tree-row${sel.includes(id) ? ' selected' : ''}${active ? '' : ' inactive'}${hidden ? ' hidden' : ''}${d}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            onClick={(e) => click(e, id)} onDblClick={() => setRenaming(id)} onPointerDown={(e) => startDrag(e, id)} onContextMenu={(e) => rowMenu(e, id)}>
            {layer.children
              ? <button class={`twist${isOpen ? ' open' : ''}`} onClick={(e) => { e.stopPropagation(); const s = new Set(collapsed.value); isOpen ? s.add(id) : s.delete(id); collapsed.value = s; }}><Icon name="chevron" /></button>
              : <span style={{ width: 16, flex: 'none' }} />}
            <span class="kind" style={{ color: kindColor(layer.type) }}><Icon name={kindIcon(layer.type)} /></span>
            <span class="name">
              {renaming === id
                ? <input autoFocus value={layer.name ?? id} onPointerDown={(e) => e.stopPropagation()}
                  onBlur={(e) => { const v = (e.target as HTMLInputElement).value.trim(); setRenaming(null); if (v && v !== (layer.name ?? id)) commit(t('common.rename'), [{ op: 'add', path: `${lp(id)}/name`, value: v }]); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }} />
                : layerName(id, layer)}
            </span>
            {layer.clip && <span class="badge" title={t('panel.clippedByName', { name: layer.clip })}><Icon name="safe" size={12} /></span>}
            <span class={`row-actions${hidden ? ' always' : ''}`}>
              <button class={`icon-btn xs${hidden ? ' on' : ''}`} title={hidden ? t('common.show') : t('common.hide')} onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); commit(hidden ? t('common.show') : t('common.hide'), hidden ? [{ op: 'remove', path: `${lp(id)}/visible` }] : [{ op: 'add', path: `${lp(id)}/visible`, value: false }]); }}>
                <Icon name={hidden ? 'eyeOff' : 'eye'} />
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── assets ───────────────────────────────────────────────────
const ASSET_ICON: Record<string, string> = { image: 'image', font: 'text', audio: 'audio', video: 'film', module: 'code', json: 'code' };
const ASSET_LABEL: Record<string, string> = { image: m('panel.images'), font: m('panel.fonts'), audio: m('panel.sounds'), video: m('panel.videos'), module: m('panel.code'), json: m('panel.data') };

function typeOfFile(name: string): Asset['type'] | null {
  const ext = name.toLowerCase().split('.').pop()!;
  if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'avif'].includes(ext)) return 'image';
  if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) return 'font';
  if (['wav', 'mp3', 'ogg', 'm4a', 'flac'].includes(ext)) return 'audio';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (['js', 'mjs'].includes(ext)) return 'module';
  if (ext === 'json') return 'json';
  return null;
}

/** merge an imported document (Lottie) into this one: its compositions and assets, ids made unique */
async function importLottie(f: File) {
  const { doc: src, files, warnings } = fromLottie(JSON.parse(await f.text()));
  // the animation's embedded images become files of the project
  if (files.length) {
    const taken = await takenPaths(), moved = new Map<string, string>();
    const folder = `assets/${safeName(f.name.replace(/(\.lottie)?\.json$/i, ''))}`;
    for (const file of files) moved.set(file.path, await upload(taken, `${folder}/${safeName(file.path.split('/').pop()!)}`, file.data));
    for (const a of Object.values(src.assets)) a.src = moved.get(a.src) ?? a.src;
  }
  const doc = S.doc.peek();
  const ops: Op[] = [];
  const assetIds = new Map<string, string>(), compIds = new Map<string, string>();
  const takenA: Record<string, unknown> = { ...doc.assets }, takenC: Record<string, unknown> = { ...doc.compositions };
  for (const id of Object.keys(src.assets)) { const n = freshId(takenA, id); takenA[n] = 1; assetIds.set(id, n); }
  for (const id of Object.keys(src.compositions)) { const n = freshId(takenC, id === 'main' ? 'lottie' : id); takenC[n] = 1; compIds.set(id, n); }
  for (const [id, a] of Object.entries(src.assets)) ops.push({ op: 'add', path: pointer('assets', assetIds.get(id)!), value: a });
  for (const [id, c] of Object.entries(src.compositions)) {
    const copy = JSON.parse(JSON.stringify(c)) as typeof c;
    for (const l of Object.values(copy.layers)) {
      if (l.type === 'comp' && typeof l.props?.comp === 'string') l.props.comp = compIds.get(l.props.comp) ?? l.props.comp;
      if (l.type === 'image' && typeof l.props?.image === 'string') l.props.image = assetIds.get(l.props.image) ?? l.props.image;
    }
    if (id === 'main') copy.name = f.name.replace(/\.json$/i, '');
    ops.push({ op: 'add', path: pointer('compositions', compIds.get(id)!), value: copy });
  }
  if (commit(t('panel.importName', { name: f.name }), ops)) {
    S.compId.value = compIds.get('main')!;
    select([]);
    toast(warnings.length ? t('panel.lottieImportedWithN', { n: warnings.length, list: warnings.slice(0, 3).join(' ; ') }) : t('panel.lottieImported'), 'info', 8000);
  }
}

export async function importFiles(files: FileList | File[]) {
  const doc = S.doc.peek();
  const ops = [];
  const taken: Record<string, unknown> = { ...doc.assets };
  let paths: Set<string> | null = null;
  // numbered drawings (oeil_01.png, oeil_02.png…) go together in a folder of their own
  const images = Array.from(files).filter((f) => typeOfFile(f.name) === 'image');
  const stem = images.length > 1 ? commonStem(images.map((f) => f.name)) : null;
  const folder = stem ? `assets/${safeName(stem)}` : 'assets';
  for (const f of Array.from(files)) {
    if (/\.json$/i.test(f.name)) {
      try { await importLottie(f); } catch (e) { toast(t('panel.couldNotImportLottie', { error: (e as Error).message }), 'error'); }
      continue;
    }
    const type = typeOfFile(f.name);
    if (!type) { toast(t('panel.unsupportedFormatName', { name: f.name }), 'error'); continue; }
    let src: string;
    try {
      paths ??= await takenPaths();
      src = await upload(paths, `${type === 'image' ? folder : 'assets'}/${safeName(f.name)}`, f);
    } catch (e) { toast(t('panel.couldNotImportName', { name: f.name, error: (e as Error).message }), 'error'); continue; }
    const id = freshId(taken, f.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-'));
    taken[id] = 1;
    const asset: Asset = { type, src, name: f.name.replace(/\.[^.]+$/, '') };
    if (type === 'font') asset.family = asset.name;
    ops.push({ op: 'add' as const, path: pointer('assets', id), value: asset });
  }
  if (ops.length && commit(ops.length > 1 ? t('panel.importNFiles', { n: ops.length }) : t('panel.importName', { name: (ops[0].value as Asset).name ?? '' }), ops) && stem) {
    toast(t('panel.nDrawingsInFolder', { n: images.length, folder }), 'info', 9000);
  }
}

function Compositions() {
  const doc = viewDoc.value, active = S.compId.value;
  const create = () => {
    const c = doc.compositions[active];
    const id = freshId(doc.compositions, 'comp');
    if (commit(t('panel.newComposition'), [{ op: 'add', path: pointer('compositions', id), value: { name: t('panel.compositionN', { n: Object.keys(doc.compositions).length + 1 }), width: c.width, height: c.height, fps: c.fps, duration: c.duration, background: null, layers: {}, order: [] } }])) {
      S.compId.value = id; select([]);
    }
  };
  const menu = (e: MouseEvent, id: string) => {
    e.preventDefault();
    const c = doc.compositions[id];
    openMenu(e, [
      { label: t('common.open'), icon: 'comp', onClick: () => { S.compId.value = id; select([]); } },
      { label: t('panel.insertAsLayer'), icon: 'plus', disabled: id === active, onClick: () => insertLayer({ type: 'comp', name: c.name, transform: { position: [doc.compositions[active].width / 2, doc.compositions[active].height / 2] }, props: { comp: id } }, id) },
      { label: t('panel.mainComposition'), icon: doc.root === id ? 'check' : 'film', disabled: doc.root === id, onClick: () => commit(t('panel.mainComposition'), [{ op: 'replace', path: '/root', value: id }]) },
      'sep',
      { label: t('common.delete'), icon: 'trash', disabled: doc.root === id, onClick: () => { if (commit(t('panel.deleteName2', { name: c.name }), [{ op: 'remove', path: pointer('compositions', id) }])) { if (active === id) S.compId.value = doc.root; } } },
    ]);
  };
  return (
    <div>
      <div class="section-label" style={{ display: 'flex', alignItems: 'center' }}>{t('panel.compositions')}<span style={{ flex: 1 }} /><button class="icon-btn xs" title={t('panel.newComposition')} onClick={create}><Icon name="plus" /></button></div>
      {Object.entries(doc.compositions).map(([id, c]) => (
        <div key={id} class={`list-row${id === active ? ' on' : ''}`} onClick={() => { S.compId.value = id; select([]); }} onContextMenu={(e) => menu(e, id)}>
          <span class="thumb"><Icon name={doc.root === id ? 'film' : 'comp'} /></span>
          <span class="name">{c.name}</span>
          <span class="meta mono">{c.width}×{c.height} · {c.duration} s</span>
        </div>
      ))}
    </div>
  );
}

/** a sequence layer playing every drawing of a folder, at the size of the composition */
function animateFolder(folder: string) {
  const doc = S.doc.peek(), compId = S.compId.peek(), c = doc.compositions[compId];
  const frames = imagesIn(doc, folder);
  if (!frames.length) return;
  const name = folder.split('/').pop() || t('panel.sequence');
  insertLayer(newLayer(doc, compId, S.registry.peek().node('sequence'), { name, props: { frames, size: [c.width, c.height], hold: c.fps >= 48 ? 4 : 2 } }), frames[0]);
}

function Assets() {
  const doc = viewDoc.value;
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const byType = new Map<string, [string, Asset][]>();
  for (const e of Object.entries(doc.assets)) { if (!byType.has(e[1].type)) byType.set(e[1].type, []); byType.get(e[1].type)!.push(e); }
  const url = (id: string) => { try { return preview.renderer?.assets.url(id) ?? ''; } catch { return ''; } };
  const use = (id: string, a: Asset) => {
    const reg = S.registry.peek();
    if (a.type === 'image') insertLayer(newLayer(doc, S.compId.peek(), reg.node('image'), { name: a.name || id, props: { image: id, size: [600, 600], fit: 'contain' } }), id);
    else if (a.type === 'audio') insertLayer(newLayer(doc, S.compId.peek(), reg.node('audio'), { name: a.name || id, props: { audio: id } }), id);
    else if (a.type === 'video') { const l = newLayer(doc, S.compId.peek(), reg.node('video'), { name: a.name || id }); insertLayer({ ...l, props: { ...l.props, video: id } }, id); }
  };
  return (
    <div class={`panel-body${over ? ' drop' : ''}`} style={over ? { boxShadow: 'inset 0 0 0 2px var(--accent-line)' } : undefined}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer?.files.length) importFiles(e.dataTransfer.files); }}>
      <Compositions />
      <input ref={input} type="file" multiple hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files; if (f) importFiles(f); (e.target as HTMLInputElement).value = ''; }} />
      {byType.size === 0 && <div class="empty"><Icon name="folder" />{t('panel.noAssetsDropFiles')}<button class="btn sm" onClick={() => input.current?.click()}><Icon name="plus" />{t('panel.import')}</button></div>}
      {[...byType].map(([type, list]) => (
        <div key={type}>
          <div class="section-label">{ASSET_LABEL[type] ? t(ASSET_LABEL[type]) : type}</div>
          {list.map(([id, a]) => (
            <div key={id} class="list-row" title={a.src} onDblClick={() => use(id, a)}
              onContextMenu={(e) => { e.preventDefault(); openMenu(e, [
                ...(a.type === 'image' || a.type === 'audio' || a.type === 'video' ? [{ label: t('panel.createALayer'), icon: 'plus' as const, onClick: () => use(id, a) }] : []),
                ...(a.type === 'audio' || a.type === 'video' ? [{ label: doc.assets[transcriptIdOf(id)] ? t('panel.transcribeAgain') : t('panel.transcribeSpeech'), icon: 'text' as const, onClick: () => { transcribeAsset(id).catch((x) => toast(t('common.couldNotTranscribeError', { error: (x as Error).message }), 'error', 9000)); } }] : []),
                ...(a.type === 'image' ? [{ label: t('panel.animateTheFolderN', { n: imagesIn(doc, folderOf(a.src)).length }), icon: 'film' as const, onClick: () => animateFolder(folderOf(a.src)) }] : []),
                { label: t('panel.removeFromProject'), icon: 'trash', onClick: () => commit(t('common.removeName', { name: a.name || id }), [{ op: 'remove', path: pointer('assets', id) }]) },
              ]); }}>
              <span class="thumb" style={a.type === 'image' ? { backgroundImage: `url("${url(id)}")`, backgroundSize: 'contain', backgroundColor: 'var(--media)' } : undefined}>
                {a.type !== 'image' && (a.type === 'font' ? <span style={{ fontFamily: `"${a.family}"`, color: 'var(--text)', fontSize: 13 }}>Aa</span> : <Icon name={ASSET_ICON[a.type]} />)}
              </span>
              <span class="name">{a.name || id}</span>
              <span class="meta mono">{id}</span>
            </div>
          ))}
        </div>
      ))}
      {byType.size > 0 && <div style={{ padding: 10 }}><button class="btn sm ghost" onClick={() => input.current?.click()}><Icon name="plus" />{t('panel.importFiles')}</button></div>}
    </div>
  );
}

// ── tokens ───────────────────────────────────────────────────
function EaseThumb({ v }: { v: unknown }) {
  const b = Array.isArray(v) ? v as number[] : [0, 0, 1, 1];
  const P = (x: number, y: number) => `${3 + x * 20},${23 - y * 20}`;
  return <svg class="ease-thumb" viewBox="0 0 26 26"><path d={`M${P(0, 0)} C${P(b[0], b[1])} ${P(b[2], b[3])} ${P(1, 1)}`} /></svg>;
}

function Tokens() {
  const doc = viewDoc.value;
  const colors = Object.entries(doc.tokens).filter(([, t]) => t.type === 'color');
  const eases = Object.entries(doc.tokens).filter(([, t]) => t.type === 'ease');
  const others = Object.entries(doc.tokens).filter(([, t]) => t.type !== 'color' && t.type !== 'ease');
  const [editing, setEditing] = useState<string | null>(null);
  const addColor = () => {
    const id = freshId(doc.tokens, 'color');
    commit(t('panel.newToken'), [{ op: 'add', path: pointer('tokens', id), value: { type: 'color', value: '#2EC4B6' } }]);
    setEditing(id);
  };
  const tokenMenu = (e: MouseEvent, name: string) => { e.preventDefault(); openMenu(e, [
    { label: t('panel.edit'), icon: 'palette', onClick: () => setEditing(name) },
    { label: t('common.delete'), icon: 'trash', onClick: () => commit(t('panel.deleteName3', { name }), [{ op: 'remove', path: pointer('tokens', name) }]) },
  ]); };
  return (
    <div class="panel-body">
      <div class="section-label" style={{ display: 'flex', alignItems: 'center' }}>{t('panel.colors')}<span style={{ flex: 1 }} /><button class="icon-btn xs" title={t('panel.newColor')} onClick={addColor}><Icon name="plus" /></button></div>
      {colors.length === 0 && <div class="faint" style={{ padding: '0 10px 8px' }}>{t('panel.noBrandColors')}</div>}
      <div class="token-grid">
        {colors.map(([name, t]) => (
          <div class="token" key={name} title={t.description ?? ''} onContextMenu={(e) => tokenMenu(e, name)} onDblClick={() => setEditing(name)}>
            <Swatch color={resolveColor(`@${name}`, doc.tokens)} onClick={() => setEditing(editing === name ? null : name)} />
            <div style={{ minWidth: 0 }}><div class="tname">{name}</div><div class="tval">{String(t.value)}</div></div>
          </div>
        ))}
      </div>
      {editing && doc.tokens[editing] && (
        <div style={{ display: 'flex', gap: 4, padding: '0 10px 10px', alignItems: 'center' }}>
          <span class="mono faint" style={{ width: 80, overflow: 'hidden', textOverflow: 'ellipsis' }}>@{editing}</span>
          <ColorField value={String(doc.tokens[editing].value)} tokens={{}} onCommit={(v) => commit(`@${editing}`, [{ op: 'replace', path: pointer('tokens', editing, 'value'), value: v }])} />
          <button class="icon-btn sm" onClick={() => setEditing(null)}><Icon name="check" /></button>
        </div>
      )}
      <div class="section-label">{t('common.curves')}</div>
      {eases.length === 0 && <div class="faint" style={{ padding: '0 10px 8px' }}>{t('panel.noNamedCurves')}</div>}
      <div class="token-grid">
        {eases.map(([name, t]) => (
          <div class="token" key={name} title={t.description ?? ''} onContextMenu={(e) => tokenMenu(e, name)}>
            <EaseThumb v={t.value} />
            <div style={{ minWidth: 0 }}><div class="tname">{name}</div><div class="tval">{Array.isArray(t.value) ? (t.value as number[]).join(' ') : String(t.value)}</div></div>
          </div>
        ))}
      </div>
      {others.length > 0 && <>
        <div class="section-label">{t('panel.others')}</div>
        {others.map(([name, tok]) => (
          <div class="list-row" key={name}>
            <span class="name mono">@{name}</span>
            <div style={{ width: 110 }}><TextInput value={JSON.stringify(tok.value)} mono onCommit={(v) => { try { commit(`@${name}`, [{ op: 'replace', path: pointer('tokens', name, 'value'), value: JSON.parse(v) }]); } catch { toast(t('panel.invalidJsonValue'), 'error'); } }} /></div>
          </div>
        ))}
      </>}
    </div>
  );
}

export function LeftPanel() {
  const current = tab.value;
  return (
    <>
      <div class="panel-head">
        <div class="tabs" role="tablist">
          <button data-tour="left-tab-layers" class={`tab${current === 'layers' ? ' on' : ''}`} onClick={() => { tab.value = 'layers'; }}>{t('common.layers')}</button>
          <button data-tour="left-tab-assets" class={`tab${current === 'assets' ? ' on' : ''}`} onClick={() => { tab.value = 'assets'; }}>{t('panel.assets')}</button>
          <button data-tour="left-tab-tokens" class={`tab${current === 'tokens' ? ' on' : ''}`} onClick={() => { tab.value = 'tokens'; }}>{t('panel.tokens')}</button>
        </div>
        <span class="grow" />
        {current === 'layers' && <button class="icon-btn sm" title={t('panel.addALayer')} onClick={(e) => addLayerMenu(e)}><Icon name="plus" /></button>}
      </div>
      {current === 'layers' && <div class="panel-body" onClick={(e) => { if (e.target === e.currentTarget) select([]); }}><LayerTree /></div>}
      {current === 'assets' && <Assets />}
      {current === 'tokens' && <Tokens />}
    </>
  );
}
