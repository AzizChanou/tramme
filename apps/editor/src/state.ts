// Editor state: signals around the core History. Every change is a
// transaction of ops (the same API the AI uses); a drag shows a draft built
// from the committed document and commits once on release.

import { batch, computed, effect, signal } from '@preact/signals';
import { applyOps, History, stringifyDoc, validate, type Composition, type TrammeDoc, type Op, type Registry } from '@tramme/core';
import { DOCUMENT, type Manifest } from '@tramme/project';
import { editorRegistry } from './vocabulary.ts';
import { api, ApiError } from './api.ts';
import { t } from './i18n/index.ts';

export interface Proposal {
  id: string;
  label: string;
  ops: Op[];
  status: 'pending' | 'accepted' | 'rejected';
}

export interface Toast { id: number; text: string; kind?: 'error' | 'info' }

let history: History<TrammeDoc> | null = null;

export const S = {
  ready: signal(false),
  loadError: signal<string | null>(null),
  /** the open project (its manifest) */
  project: signal<Manifest>(null as unknown as Manifest),
  /** URL of the document: relative asset srcs resolve against it */
  docUrl: signal(''),
  doc: signal<TrammeDoc>(null as unknown as TrammeDoc),
  draft: signal<TrammeDoc | null>(null),
  proposal: signal<Proposal | null>(null),
  showProposal: signal(true),
  registry: signal<Registry>(editorRegistry()),
  compId: signal(''),
  time: signal(0),
  playing: signal(false),
  loop: signal(true),
  /** preview render size as a fraction of the composition, from the viewport's display size */
  previewScale: signal(0.5),
  selection: signal<string[]>([]),
  /** groups folded, the same in the layer tree and the timeline */
  collapsed: signal<Set<string>>(new Set()),
  /** sound layers the preview plays alone (none: all); the exports keep the whole mix */
  solo: signal<Set<string>>(new Set()),
  /** keyframes selected in the timeline: 'layerId|prop|index' */
  keys: signal<string[]>([]),
  safe: signal(false),
  grid: signal(false),
  save: signal<'saved' | 'dirty' | 'saving' | 'error'>('saved'),
  version: signal(0),
  renderError: signal<string | null>(null),
  toasts: signal<Toast[]>([]),
  bottomTab: signal<'timeline' | 'graph'>('timeline'),
  mobileTab: signal<'viewport' | 'layers' | 'timeline' | 'inspector' | 'ai'>('viewport'),
  /** the panel summoned from an edge, in the cinema and conversation display modes */
  summon: signal<'none' | 'left' | 'right' | 'bottom' | 'props'>('none'),
  assistantFull: signal(false),
  /** the conversation card put away, in the conversation display mode */
  chatHidden: signal(false),
};

/**
 * The time for heavy panels (inspector, tree, curves): the same as S.time when
 * paused, about eight updates a second while playing, so playback stays smooth.
 */
export const uiTime = signal(0);
let uiStamp = 0;
effect(() => {
  const t = S.time.value, playing = S.playing.value, now = performance.now();
  if (!playing || now - uiStamp > 120) { uiStamp = now; uiTime.value = t; }
});

/** the document on screen: the draft of a drag, or the AI proposal previewed, or the committed one */
export const previewDoc = computed(() => {
  const p = S.proposal.value;
  if (!p || p.status !== 'pending') return null;
  try { return applyOps(S.doc.value, p.ops).doc; } catch { return null; }
});
export const viewDoc = computed<TrammeDoc>(() => S.draft.value ?? (S.showProposal.value ? previewDoc.value : null) ?? S.doc.value);
/** the composition shown: the chosen one, or the main one when the document no longer has it */
export const compIdOf = (doc: TrammeDoc) => (doc.compositions[S.compId.peek()] ? S.compId.peek() : doc.root);
export const comp = computed<Composition>(() => viewDoc.value.compositions[S.compId.value] ?? viewDoc.value.compositions[viewDoc.value.root]);
// a change removed the open composition (undo, deletion, a proposal applied): back to the main one
effect(() => {
  const doc = S.doc.value, id = S.compId.value;
  if (doc && id && !doc.compositions[id]) batch(() => { S.compId.value = doc.root; S.selection.value = []; S.keys.value = []; });
});
export const canUndo = computed(() => (S.version.value, history?.canUndo ?? false));
export const canRedo = computed(() => (S.version.value, history?.canRedo ?? false));
export const undoLabel = computed(() => (S.version.value, history?.undoLabel ?? null));
export const redoLabel = computed(() => (S.version.value, history?.redoLabel ?? null));

const check = (doc: TrammeDoc) => validate(doc, S.registry.peek()).map((i) => `${i.path || '/'} : ${i.message}`);

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info', ms = 4200) {
  const t = { id: ++toastId, text, kind };
  S.toasts.value = [...S.toasts.value, t];
  setTimeout(() => { S.toasts.value = S.toasts.value.filter((x) => x.id !== t.id); }, ms);
}

/** version of the document in storage: a save is refused if it changed elsewhere (another tab) */
let docEtag = '';

export function load(doc: TrammeDoc, project: Manifest, docUrl: string, etag: string) {
  history = new History(doc, check);
  docEtag = etag;
  batch(() => {
    S.doc.value = doc;
    S.project.value = project;
    S.docUrl.value = docUrl;
    S.compId.value = doc.root;
    S.version.value++;
    S.ready.value = true;
  });
}

/** apply a transaction; returns false (and tells the user) when the document would become invalid */
export function commit(label: string, ops: Op[], source = 'user'): boolean {
  if (!history || !ops.length) { S.draft.value = null; return false; }
  try {
    history.apply({ label, ops, source });
  } catch (e) {
    S.draft.value = null;
    toast((e as Error).message, 'error', 7000);
    return false;
  }
  batch(() => {
    S.draft.value = null;
    S.doc.value = history!.doc;
    S.version.value++;
    S.save.value = 'dirty';
  });
  return true;
}

/** show the result of ops without committing (during a drag) */
export function draft(ops: Op[]) {
  try { S.draft.value = applyOps(S.doc.value, ops).doc; } catch { /* stale drag: ignore */ }
}
export const cancelDraft = () => { S.draft.value = null; };

export function undo() {
  if (!history?.canUndo) return;
  history.undo();
  batch(() => { S.doc.value = history!.doc; S.version.value++; S.save.value = 'dirty'; });
}
export function redo() {
  if (!history?.canRedo) return;
  history.redo();
  batch(() => { S.doc.value = history!.doc; S.version.value++; S.save.value = 'dirty'; });
}

/** registry after the renderer loaded the document's plugins */
export function setRegistry(r: Registry) { S.registry.value = r; }

export function select(ids: string[]) { S.selection.value = ids; }

/** the layer clicked last without Shift: where a Shift+click range starts */
let anchor: string | null = null;

/** a click on a layer of a list (the tree, the timeline): alone, toggled with Ctrl, a range from the last one with Shift */
export function clickSelect(e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }, id: string, order: string[]) {
  const sel = S.selection.peek();
  if (e.shiftKey && anchor && order.includes(anchor)) {
    const a = order.indexOf(anchor), b = order.indexOf(id);
    select(order.slice(Math.min(a, b), Math.max(a, b) + 1));
    return;
  }
  anchor = id;
  if (e.ctrlKey || e.metaKey) select(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  else select([id]);
}

/** every layer of the composition shown */
export function selectAll() { select(Object.keys(comp.peek().layers)); }

/** folds or unfolds a group; with branch (Alt+click), every group inside it too */
export function toggleFold(id: string, branch = false) {
  const c = comp.peek(), fold = !S.collapsed.peek().has(id), s = new Set(S.collapsed.peek());
  const walk = (lid: string) => {
    if (!c.layers[lid]?.children) return;
    fold ? s.add(lid) : s.delete(lid);
    if (branch) c.layers[lid].children!.forEach(walk);
  };
  walk(id);
  S.collapsed.value = s;
}

/** folds or unfolds every group of the composition shown */
export function foldAll(fold: boolean) {
  S.collapsed.value = fold ? new Set(Object.entries(comp.peek().layers).filter(([, l]) => l.children).map(([id]) => id)) : new Set();
}

export function setTime(t: number) {
  const c = comp.peek();
  const fps = c.fps, last = (Math.round(c.duration * fps) - 1) / fps;
  S.time.value = Math.min(last, Math.max(0, t));
}
export const frameStep = (n: number) => {
  const fps = comp.peek().fps;
  setTime((Math.round(S.time.peek() * fps) + n) / fps);
};

// ── AI proposals ─────────────────────────────────────────────
export function propose(p: Omit<Proposal, 'status'>) {
  S.proposal.value = { ...p, status: 'pending' };
  S.showProposal.value = true;
}
export function acceptProposal(): boolean {
  const p = S.proposal.peek();
  if (!p || p.status !== 'pending') return false;
  const ok = commit(p.label, p.ops, 'ai');
  S.proposal.value = { ...p, status: ok ? 'accepted' : 'pending' };
  return ok;
}
export function rejectProposal() {
  const p = S.proposal.peek();
  if (p && p.status === 'pending') S.proposal.value = { ...p, status: 'rejected' };
}

// ── autosave ─────────────────────────────────────────────────
/** called after each save (the thumbnail follows) */
export const hooks = { afterSave: null as null | (() => void) };
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let conflict = false;

async function write(doc: TrammeDoc) {
  const p = S.project.peek();
  try {
    const r = await api.write(p.id, DOCUMENT, stringifyDoc(doc), { ifMatch: docEtag || undefined, type: 'application/json' });
    docEtag = r.etag;
    S.project.value = { ...S.project.peek(), modified: r.modified };
  } catch (e) {
    if (e instanceof ApiError && e.status === 412) {
      conflict = true;
      throw new Error(t('editor.theDocumentWasChanged'));
    }
    throw e;
  }
}

effect(() => {
  const doc = S.doc.value, state = S.save.value;
  if (state !== 'dirty' || !doc || conflict) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    S.save.value = 'saving';
    try {
      await write(doc);
      if (S.doc.peek() === doc) S.save.value = 'saved'; else S.save.value = 'dirty';
      hooks.afterSave?.();
    } catch (e) {
      S.save.value = 'error';
      toast(t('common.couldNotSaveError', { error: (e as Error).message }), 'error', 10000);
    }
  }, 700);
});

export async function saveNow() {
  if (saveTimer) clearTimeout(saveTimer);
  if (S.save.peek() === 'saved') return;
  S.save.value = 'saving';
  try { await write(S.doc.peek()); S.save.value = 'saved'; hooks.afterSave?.(); }
  catch (e) { S.save.value = 'error'; throw e; }
}

/** unsaved changes when leaving the page */
addEventListener('beforeunload', (e) => { if (S.ready.peek() && S.save.peek() !== 'saved') e.preventDefault(); });
