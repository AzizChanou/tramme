// Preferences of this machine (kept in the browser, not in the project): how
// much the preview may cost (a powerful computer keeps everything at full
// quality, a modest one lets the preview adapt; exports always render at full
// quality), and how the sound tools work by default.

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
  language: 'auto', theme: 'dark', motion: 'auto', still: 'display', blur: 'document', exactFrames: true,
  effectsDb: -8, musicDb: -14, duckDb: -12, varySounds: true, confirmPaid: true, voiceProvider: 'auto', voice: '', previewVolume: 1, previewMuted: false,
};
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
    if (!['dark', 'light', 'system'].includes(p.theme)) p.theme = DEFAULT_PREFERENCES.theme;
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

export type SettingsSection = 'appearance' | 'preview' | 'sound' | 'tours' | 'model' | 'providers' | 'behavior' | 'connection';
/** the section shown: the last one opened, or the one asked for */
export const settingsSection = signal<SettingsSection>('appearance');
export function openSettings(section?: SettingsSection) {
  if (section) settingsSection.value = section;
  settingsOpen.value = true;
}
