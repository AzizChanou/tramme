// The interface's languages. Each text the editor shows has a key, and each
// language a catalog (en.json, fr.json) giving the text of every key:
//
//   t('common.newProject')                        'New project' / 'Nouveau projet'
//   t('home.importingName', { name: f.name })     'Importing photo.png'
//
// A key missing from the chosen language falls back to English. Texts defined
// outside the editor (node and property names of the engine and of plugins,
// example names, the assistant's activity lines) have no key: they are
// translated by their English text, from the catalog's `content` section and
// from what plugins add. A project plugin exports `messages` ({ fr: { ... } },
// or { en: { ... } } for one written in another language); a script calls
// window.tramme.i18n.add('fr', { ... }).
//
// The language is read once at startup (settings, or the browser's); changing
// it reloads the page, so texts computed ahead (menus, tours) follow too.

import { prefs } from '../settings.ts';
import EN from './en.json' with { type: 'json' };
import FR from './fr.json' with { type: 'json' };

export type Locale = 'fr' | 'en';
/** the languages offered, in their own words */
export const LOCALES: [Locale, string][] = [['fr', 'Français'], ['en', 'English']];

type Tree = { [k: string]: string | Tree };
/** 'a.b.c' -> text, for every leaf of a nested catalog (the content section aside) */
export function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    if (!prefix && k === 'content') continue;
    if (typeof v === 'string') out[prefix + k] = v;
    else Object.assign(out, flatten(v, `${prefix}${k}.`));
  }
  return out;
}

const keys: Record<Locale, Record<string, string>> = { en: flatten(EN as Tree), fr: flatten(FR as Tree) };
/** texts defined outside the editor, by their English text */
const content: Record<Locale, Record<string, string>> = { en: {}, fr: { ...(FR as { content: Record<string, string> }).content } };

function chosen(): Locale {
  const want = prefs.peek().language;
  if (want === 'fr' || want === 'en') return want;
  const nav = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  // French for French speakers, English for everyone else
  return nav.some((l) => /^fr\b/i.test(l ?? '')) || !nav.length ? 'fr' : 'en';
}

export const locale: Locale = chosen();
if (typeof document !== 'undefined') document.documentElement.lang = locale;

/** translations of a plugin or a module (the text as written, to its translation) */
export function addMessages(lang: Locale, messages: Record<string, string>) {
  content[lang] = { ...content[lang], ...messages };
}

/** a module's `messages` export: { en: { … }, fr: { … } } */
export function addModuleMessages(module: unknown) {
  const messages = (module as { messages?: unknown })?.messages;
  if (!messages || typeof messages !== 'object') return;
  for (const [lang, dict] of Object.entries(messages as Record<string, unknown>)) {
    if ((lang === 'fr' || lang === 'en') && dict && typeof dict === 'object') {
      addMessages(lang, Object.fromEntries(Object.entries(dict as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>);
    }
  }
}

/** for scripts and extensions: window.tramme.i18n */
if (typeof window !== 'undefined') {
  const w = window as unknown as { tramme?: Record<string, unknown> };
  w.tramme = { ...(w.tramme ?? {}), i18n: { locale, add: addMessages, t } };
}

/**
 * The text of a key in the interface's language ({name} replaced by
 * params.name); a text without a key (engine, plugin) translated if known,
 * shown as is otherwise.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const s = keys[locale][key] ?? keys.en[key] ?? content[locale][key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : s;
}

/** a number written the language's way (decimal comma in French) */
export const num = (n: number, digits = 2) => n.toLocaleString(locale, { maximumFractionDigits: digits });

/** marks a key where it is defined; t() translates it where it is shown */
export const m = (key: string) => key;

/** a text that may be missing from the catalogs (labels of plugins, names): translated if known */
export const tr = (text: string | undefined) => (text ? t(text) : '');
