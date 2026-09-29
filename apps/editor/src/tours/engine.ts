// Guided tours, on driver.js. The engine knows no tour: tours are declared
// elsewhere (the modules of tours/, a project's plugins, or any script through
// window.tramme.tours) and registered here. Each step points at a place of the
// interface by its data-tour name, so the interface can change its classes and
// layout without breaking the tours.
//
// A step can prepare the screen first (open a tab, select a layer), be shown
// only when it applies, and is skipped when its place is not on screen (a
// panel hidden on a phone, for instance).

import { signal } from '@preact/signals';
import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import { addModuleMessages, t } from '../i18n/index.ts';

export type TourPage = 'home' | 'editor';

export interface TourStep {
  /** where: a data-tour name ("export"), a CSS selector, or a function; none: a message in the middle */
  target?: string | (() => Element | null | undefined);
  title: string;
  /** plain text; **bold** is kept, line breaks too */
  body: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** prepares the screen before the step (open a tab, select a layer); may be async */
  before?: () => void | Promise<void>;
  /** the step is shown only when this holds (checked when the tour starts) */
  when?: () => boolean;
}

export interface Tour {
  /** unique, stable: remembers that the tour was seen */
  id: string;
  title: string;
  summary?: string;
  page: TourPage;
  steps: TourStep[];
  /** offered on its own the first time the page is seen */
  auto?: boolean;
  /** raised when the tour changes, so that it is offered again */
  version?: number;
  /** place in the help menu (lower first) */
  order?: number;
  /** who declared it: 'tramme', or a plugin's id */
  source?: string;
  /** the tour makes sense here and now (a layer of the right kind exists…) */
  available?: () => boolean;
}

// ── registry ─────────────────────────────────────────────────
const tours = new Map<string, Tour>();
/** changes when tours are added or removed: menus follow */
export const toursVersion = signal(0);

export function registerTour(tour: Tour) {
  if (!tour?.id || !Array.isArray(tour.steps) || !tour.steps.length) throw new Error('tour: id and steps required');
  tours.set(tour.id, { source: 'tramme', version: 1, order: 100, ...tour });
  toursVersion.value++;
}

export function unregisterTour(id: string) {
  if (tours.delete(id)) toursVersion.value++;
}

/** the tours of a page, available now, in menu order */
export function toursFor(page: TourPage): Tour[] {
  void toursVersion.value;
  return [...tours.values()]
    .filter((t) => t.page === page && (t.available?.() ?? true))
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));
}

// ── seen tours, per browser ──────────────────────────────────
const KEY = 'tramme.tours';
interface Seen { seen: Record<string, number>; auto: boolean }

function readSeen(): Seen {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return { seen: s.seen ?? {}, auto: s.auto !== false }; }
  catch { return { seen: {}, auto: true }; }
}
export const toursState = signal<Seen>(readSeen());
function writeSeen(next: Seen) {
  toursState.value = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode */ }
}

export const isSeen = (t: Tour) => (toursState.value.seen[t.id] ?? 0) >= (t.version ?? 1);
export function markSeen(t: Tour) { writeSeen({ ...toursState.peek(), seen: { ...toursState.peek().seen, [t.id]: t.version ?? 1 } }); }
/** every tour offered again */
export function resetSeen() { writeSeen({ ...toursState.peek(), seen: {} }); }
/** tours offered on their own when a page is first seen */
export function setAutoTours(on: boolean) { writeSeen({ ...toursState.peek(), auto: on }); }

// ── helpers for the steps' preparations ─────────────────────
/** clicks a place of the interface by its data-tour name (opens a tab, a panel), as the user would */
export function press(name: string) {
  (document.querySelector(`[data-tour="${name}"]`) as HTMLElement | null)?.click();
}

// ── playing ──────────────────────────────────────────────────
let current: Driver | null = null;
export const tourActive = signal<string | null>(null);

const resolve = (target: TourStep['target']): Element | undefined => {
  if (!target) return undefined;
  if (typeof target === 'function') return target() ?? undefined;
  const sel = /^[a-z0-9-]+$/i.test(target) ? `[data-tour="${target}"]` : target;
  const el = document.querySelector(sel);
  // a place on screen only (not hidden by a narrow layout)
  return el && (el as HTMLElement).getClientRects().length ? el : undefined;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const rich = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const token = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export async function startTour(id: string) {
  const tour = tours.get(id);
  if (!tour) return;
  current?.destroy();
  const steps = tour.steps.filter((s) => s.when?.() ?? true);
  if (!steps.length) return;
  const run = async (i: number) => { try { await steps[i]?.before?.(); } catch (e) { console.warn('[tramme] visite :', (e as Error).message); } await nextFrame(); };
  const driveSteps: DriveStep[] = steps.map((s) => ({
    // resolved when shown: the step's preparation may have just created the place
    element: s.target ? (() => resolve(s.target) as Element) : undefined,
    skipMissingElement: !!s.target,
    popover: { title: esc(t(s.title)), description: rich(t(s.body)), side: s.side, align: s.align },
  }));
  const d = driver({
    steps: driveSteps,
    popoverClass: 'tramme-tour',
    showProgress: steps.length > 1,
    progressText: '{{current}} / {{total}}',
    nextBtnText: t('tours.next'),
    prevBtnText: t('tours.previous'),
    doneBtnText: t('tours.done'),
    overlayColor: token('--tour-overlay', '#000'),
    overlayOpacity: Number(token('--tour-overlay-opacity', '0.6')),
    stagePadding: 6,
    stageRadius: 8,
    smoothScroll: true,
    allowKeyboardControl: true,
    onNextClick: async (_el, _step, { driver: dr }) => {
      const i = (dr.getActiveIndex() ?? 0) + 1;
      if (i >= steps.length) { dr.destroy(); return; }
      await run(i);
      dr.moveNext();
    },
    onPrevClick: async (_el, _step, { driver: dr }) => {
      const i = (dr.getActiveIndex() ?? 0) - 1;
      if (i < 0) return;
      await run(i);
      dr.movePrevious();
    },
    onDestroyed: () => { markSeen(tour); current = null; tourActive.value = null; },
  });
  current = d;
  tourActive.value = tour.id;
  await run(0);
  d.drive(0);
}

/** the first tour of the page not seen yet, when tours are offered on their own */
export function offerTours(page: TourPage) {
  if (!toursState.peek().auto || current) return;
  const next = toursFor(page).find((t) => t.auto && !isSeen(t));
  if (next) startTour(next.id);
}

// ── tours brought by a project's plugins ─────────────────────
const fromPlugins = new Set<string>();

/** a plugin module may export `tours`: they join the editor's while the project uses it */
export function syncPluginTours(plugins: { id: string; module: unknown }[]) {
  for (const id of fromPlugins) unregisterTour(id);
  fromPlugins.clear();
  for (const { id, module } of plugins) {
    // its translations (node names, tours), before its tours are shown
    addModuleMessages(module);
    const list = (module as { tours?: unknown })?.tours;
    if (!Array.isArray(list)) continue;
    for (const t of list as Tour[]) {
      try {
        registerTour({ ...t, page: (t as Partial<Tour>).page ?? 'editor', source: id });
        fromPlugins.add(t.id);
      } catch (e) { console.warn(`[tramme] tour of plugin ${id}:`, (e as Error).message); }
    }
  }
}

/** for scripts and extensions: window.tramme.tours.register({...}) */
(window as unknown as { tramme?: Record<string, unknown> }).tramme = {
  ...((window as unknown as { tramme?: Record<string, unknown> }).tramme ?? {}),
  tours: { register: registerTour, unregister: unregisterTour, start: startTour, press, list: (page: TourPage) => toursFor(page).map((t) => ({ id: t.id, title: t.title })) },
};
