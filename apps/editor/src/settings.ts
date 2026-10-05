// Preferences of this machine (kept in the browser, not in the project): how
// much the preview may cost (a powerful computer keeps everything at full
// quality, a modest one lets the preview adapt; exports always render at full
// quality), and how the sound tools work by default.

import { effect, signal } from '@preact/signals';

export interface Preferences {
  /** interface language: the browser's (French or English), or chosen */
  language: 'auto' | 'fr' | 'en';
  /** the theme: one palette (all are dark but paper), or as the system says */
  theme: ThemeId;
  /** how the interface is laid out: the editor, or a display mode */
  display: Display;
  /** render size while playing, dragging or scrubbing */
  motion: 'auto' | 'full' | 'half' | 'quarter';
  /** render size once still: the size shown on screen, or the composition's full size */
  still: 'display' | 'full';
  /** motion blur in the preview: the document's, at most 4 sub-frames, or none */
  blur: 'document' | 'limited' | 'off';
  /** playback draws the composition's own frames (24, 30 i/s…), as the export, instead of every screen refresh */
  exactFrames: boolean;
  /** sound: the level (dB) of the effects the tools place, of the music beds, and how much a music drops under a voice */
  effectsDb: number;
  musicDb: number;
  duckDb: number;
  /** a sound placed on several moments alternates its variants */
  varySounds: boolean;
  /** a sound made by a provider (it costs money) waits for the user's yes */
  confirmPaid: boolean;
  /** voice-overs: the provider (auto: the first the server has a key for) and the voice ('' for its own) */
  voiceProvider: 'auto' | 'elevenlabs' | 'openai' | 'gemini';
  voice: string;
  /** what the preview plays at, 0 to 1, and muted; the exports keep the mix as it is */
  previewVolume: number;
  previewMuted: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  language: 'auto', theme: 'studio', display: 'editor', motion: 'auto', still: 'display', blur: 'document', exactFrames: true,
  effectsDb: -8, musicDb: -14, duckDb: -12, varySounds: true, confirmPaid: true, voiceProvider: 'auto', voice: '', previewVolume: 1, previewMuted: false,
};

// ── themes and display modes ────────────────────────────────
/** a theme is one palette; all are dark but paper, and system follows the computer */
export type ThemeId = 'system' | 'studio' | 'obsidian' | 'carbon' | 'dusk' | 'paper';
/** a display mode lays the same interface out differently: the editor, the film leading (cinema), the conversation leading */
export type Display = 'editor' | 'cinema' | 'conversation';
const THEME_IDS: ThemeId[] = ['system', 'studio', 'obsidian', 'carbon', 'dusk', 'paper'];
const DISPLAY_IDS: Display[] = ['editor', 'cinema', 'conversation'];
const DARK_LEGACY: string[] = ['studio', 'obsidian', 'carbon', 'dusk'], LIGHT_LEGACY: string[] = ['paper'];

/** a theme as the picker shows it: its id and the three colours that tell it apart (its name's key lives beside the picker) */
export interface ThemeInfo { id: ThemeId; bg: string; panel: string; accent: string }
export const THEMES: ThemeInfo[] = [
  { id: 'studio', bg: '#0b0f12', panel: '#12181c', accent: '#2ec4b6' },
  { id: 'obsidian', bg: '#040607', panel: '#0a0d0f', accent: '#2ec4b6' },
  { id: 'carbon', bg: '#0f1011', panel: '#151617', accent: '#2ec4b6' },
  { id: 'dusk', bg: '#14110c', panel: '#1a1712', accent: '#2ec4b6' },
  { id: 'paper', bg: '#d8dde0', panel: '#e6eaec', accent: '#12968a' },
  { id: 'system', bg: '#0b0f12', panel: '#8a939b', accent: '#2ec4b6' },
];
/** the window bar's colour, per theme (system resolves to one of the two) */
const BAR: Record<string, string> = { studio: '#0b0f12', obsidian: '#040607', carbon: '#0f1011', dusk: '#14110c', paper: '#d8dde0' };
/** the display modes, in the order they are offered */
export const DISPLAYS: Display[] = ['editor', 'cinema', 'conversation'];
const VOICE_PROVIDERS = ['auto', 'elevenlabs', 'openai', 'gemini'] as const;

/** a number kept within its range, the default when it is not one */
const within = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

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
    // the theme preference: the former mode + per-mode themes collapse into one theme
    const legacyTheme = (saved as { theme?: unknown }).theme, legacyMode = (saved as { mode?: unknown }).mode;
    if (typeof legacyTheme === 'string' && THEME_IDS.includes(legacyTheme as ThemeId)) p.theme = legacyTheme as ThemeId;
    else if (legacyMode === 'light') p.theme = LIGHT_LEGACY.includes(String((saved as { lightTheme?: unknown }).lightTheme)) ? (saved as { lightTheme: ThemeId }).lightTheme : 'paper';
    else if (legacyMode === 'dark') p.theme = DARK_LEGACY.includes(String((saved as { darkTheme?: unknown }).darkTheme)) ? (saved as { darkTheme: ThemeId }).darkTheme : 'studio';
    else if (legacyTheme === 'dark') p.theme = 'studio';
    else if (legacyTheme === 'light') p.theme = 'paper';
    if (!THEME_IDS.includes(p.theme)) p.theme = DEFAULT_PREFERENCES.theme;
    if (!DISPLAY_IDS.includes(p.display)) p.display = DEFAULT_PREFERENCES.display;
    if (!['auto', 'fr', 'en'].includes(p.language)) p.language = DEFAULT_PREFERENCES.language;
    const d = DEFAULT_PREFERENCES;
    p.effectsDb = within(p.effectsDb, d.effectsDb, -40, 12);
    p.musicDb = within(p.musicDb, d.musicDb, -40, 12);
    p.duckDb = within(p.duckDb, d.duckDb, -40, -1);
    p.previewVolume = within(p.previewVolume, d.previewVolume, 0, 1);
    p.varySounds = p.varySounds !== false;
    p.confirmPaid = p.confirmPaid !== false;
    p.previewMuted = p.previewMuted === true;
    if (!VOICE_PROVIDERS.includes(p.voiceProvider)) p.voiceProvider = d.voiceProvider;
    if (typeof p.voice !== 'string') p.voice = d.voice;
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

/** the theme on the page: data-theme and data-display on <html>, read by the stylesheet's tokens */
let lastDisplay = '';
effect(() => {
  if (typeof document === 'undefined') return;
  const p = prefs.value;
  const theme = p.theme === 'system' ? (systemLight.value ? 'studio' : 'paper') : p.theme;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.display = p.display;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[theme] ?? BAR.studio);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme === 'paper' ? 'light' : 'dark');
  // the display modes change the size of the stage without a window resize: the viewport re-measures on this
  if (lastDisplay && lastDisplay !== p.display) window.dispatchEvent(new Event('resize'));
  lastDisplay = p.display;
});

/** the settings dialog, opened from the top bar, the home screen or Ctrl+, */
export const settingsOpen = signal(false);

export type SettingsSection = 'appearance' | 'preview' | 'sound' | 'tours' | 'model' | 'providers' | 'behavior' | 'connection';
/** the section shown: the last one opened, or the one asked for */
export const settingsSection = signal<SettingsSection>('appearance');
export function openSettings(section?: SettingsSection) {
  if (section) settingsSection.value = section;
  settingsOpen.value = true;
}
