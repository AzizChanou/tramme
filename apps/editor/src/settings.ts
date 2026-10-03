// Preferences of this machine (kept in the browser, not in the project): how
// much the preview may cost. A powerful computer can keep everything at full
// quality; a modest one lets the preview adapt. Exports always render at full
// quality, whatever is set here.

import { effect, signal } from '@preact/signals';

export interface Preferences {
  /** interface language: the browser's (French or English), or chosen */
  language: 'auto' | 'fr' | 'en';
  /** interface colours: dark, light grey, or as the system */
  theme: 'dark' | 'light' | 'system';
  /** render size while playing, dragging or scrubbing */
  motion: 'auto' | 'full' | 'half' | 'quarter';
  /** render size once still: the size shown on screen, or the composition's full size */
  still: 'display' | 'full';
  /** motion blur in the preview: the document's, at most 4 sub-frames, or none */
  blur: 'document' | 'limited' | 'off';
  /** playback draws the composition's own frames (24, 30 i/s…), as the export, instead of every screen refresh */
  exactFrames: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { language: 'auto', theme: 'dark', motion: 'auto', still: 'display', blur: 'document', exactFrames: true };

const KEY = 'tramme.preferences';

// what this browser kept under the tool's former name (trame.*) is carried over once
try {
  const old = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).filter((k) => k.startsWith('trame.'));
  for (const k of old) if (localStorage.getItem(`tramme.${k.slice(6)}`) === null) localStorage.setItem(`tramme.${k.slice(6)}`, localStorage.getItem(k)!);
} catch { /* no storage */ }

function load(): Preferences {
  try {
    // the preferences kept under the tool's former name are taken over
    const saved = JSON.parse(localStorage.getItem(KEY) ?? localStorage.getItem('emotion.preferences') ?? '{}') as Partial<Preferences>;
    const p = { ...DEFAULT_PREFERENCES, ...saved };
    if (!['auto', 'full', 'half', 'quarter'].includes(p.motion)) p.motion = DEFAULT_PREFERENCES.motion;
    if (!['display', 'full'].includes(p.still)) p.still = DEFAULT_PREFERENCES.still;
    if (!['document', 'limited', 'off'].includes(p.blur)) p.blur = DEFAULT_PREFERENCES.blur;
    p.exactFrames = p.exactFrames !== false;
    if (!['dark', 'light', 'system'].includes(p.theme)) p.theme = DEFAULT_PREFERENCES.theme;
    if (!['auto', 'fr', 'en'].includes(p.language)) p.language = DEFAULT_PREFERENCES.language;
    return p;
  } catch { return { ...DEFAULT_PREFERENCES }; }
}

export const prefs = signal<Preferences>(load());

export function setPrefs(patch: Partial<Preferences>) {
  prefs.value = { ...prefs.peek(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(prefs.peek())); } catch { /* private mode: for this session only */ }
}

/** back to the defaults; the language stays as chosen */
export function resetPrefs() { setPrefs({ ...DEFAULT_PREFERENCES, language: prefs.peek().language }); }

/** another language: the page reloads, so every text (menus, tours) follows */
export function setLanguage(language: Preferences['language']) {
  if (language === prefs.peek().language) return;
  setPrefs({ language });
  location.reload();
}

// ── theme ────────────────────────────────────────────────────
const lightQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
const systemLight = signal(lightQuery?.matches ?? false);
lightQuery?.addEventListener('change', (e) => { systemLight.value = e.matches; });

/** the theme on the page: data-theme on <html>, read by the stylesheet's tokens */
effect(() => {
  if (typeof document === 'undefined') return;
  const t = prefs.value.theme, light = t === 'light' || (t === 'system' && systemLight.value);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#d8dde0' : '#0b0f12');
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', light ? 'light' : 'dark');
});

/** the settings dialog, opened from the top bar, the home screen or Ctrl+, */
export const settingsOpen = signal(false);

export type SettingsSection = 'appearance' | 'preview' | 'tours' | 'model' | 'behavior' | 'connection';
/** the section shown: the last one opened, or the one asked for */
export const settingsSection = signal<SettingsSection>('appearance');
export function openSettings(section?: SettingsSection) {
  if (section) settingsSection.value = section;
  settingsOpen.value = true;
}
