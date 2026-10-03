// What the catalogs must cover. Keys: the literals passed to t() and m() in
// the editor. Content (texts defined outside the editor, translated by their
// English text): the assistant's activity lines, the names of the built-in
// nodes, effects and modifiers (titles, categories, property labels, groups,
// descriptions) and the example projects' titles and descriptions. The i18n
// test checks the catalogs; run directly, this prints what French lacks:
//
//   node apps/editor/test/i18n-keys.ts

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_CHECKS, CAMERA_SCHEMA, MOTION_BLUR_SCHEMA, TRANSFORM_SCHEMA, type PropSchema } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { EDITOR_PROMPTS, EDITOR_TOOLS } from '../src/vocabulary.ts';
import { REVIEW_TOOLS } from '../src/review.ts';
import { BUILTIN_KITS, RECIPE_TOOLS } from '../src/recipes.ts';
import { PERCEPTION_TOOLS } from '../src/perception.ts';
import { CUTOUT_TOOLS } from '../src/cutout.ts';
import { EDITOR_PRESETS } from '../src/presets.ts';
import { LIBRARY_TOOLS } from '../src/library.ts';
import { SOUND_TEXTS, SOUND_TOOLS } from '../src/sound.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'i18n' ? [] : files(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

/** a quoted JS literal, unescaped */
const unquote = (body: string) => body.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c));

/** t('…'), t("…"), m('…'), m("…") and t(`…`) without ${} */
const CALL = /(?<![\w.$])[tm]\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.)*)`)/g;

function literals(dir: string): Set<string> {
  const out = new Set<string>();
  for (const f of files(dir)) for (const m of fs.readFileSync(f, 'utf8').matchAll(CALL)) out.add(unquote(m[1] ?? m[2] ?? m[3]));
  return out;
}

/** the keys the editor uses */
export const sourceKeys = () => literals(path.join(ROOT, 'apps/editor/src'));

export function registryKeys(): Set<string> {
  const keys = new Set<string>();
  const add = (s?: string) => { if (s && /[a-zA-Zà-ÿ]/.test(s)) keys.add(s); };
  const schema = (p: PropSchema) => { for (const d of Object.values(p)) { add(d.label); add(d.group); add(d.description); } };
  const reg = builtinRegistry();
  for (const n of reg.listNodes()) { add(n.title); add(n.category); add(n.description); schema(n.props); }
  for (const e of reg.listEffects()) { add(e.title); add(e.category); add(e.description); schema(e.props); }
  for (const m of reg.listModifiers()) { add(m.title); add((m as { description?: string }).description); schema((m as { params?: PropSchema }).params ?? {}); }
  schema(TRANSFORM_SCHEMA);
  schema(MOTION_BLUR_SCHEMA);
  schema(CAMERA_SCHEMA);
  // the editor's tools and workflows, shown in the chat's / menu
  const tools = [...EDITOR_TOOLS, ...RECIPE_TOOLS, ...PERCEPTION_TOOLS, ...CUTOUT_TOOLS, ...REVIEW_TOOLS, ...SOUND_TOOLS, ...LIBRARY_TOOLS];
  for (const x of [...tools, ...EDITOR_PROMPTS, ...BUILTIN_CHECKS, ...BUILTIN_KITS, ...EDITOR_PRESETS]) { add(x.title); add(x.description); }
  for (const c of BUILTIN_CHECKS) for (const text of c.texts ?? []) add(text);
  for (const text of Object.values(SOUND_TEXTS)) add(text);
  for (const tool of tools) {
    for (const p of Object.values((tool.input?.properties ?? {}) as Record<string, { title?: string; description?: string; enum?: unknown[] }>)) {
      add(p.title); add(p.description);
      for (const v of p.enum ?? []) add(String(v));
    }
  }
  return keys;
}

/** the texts translated by their English text */
export function contentKeys(): Set<string> {
  const keys = new Set([...registryKeys(), ...literals(path.join(ROOT, 'packages/assistant/src')), 'Local models']);
  for (const ex of fs.readdirSync(path.join(ROOT, 'examples'))) {
    const f = path.join(ROOT, 'examples', ex, 'document.tramme.json');
    if (!fs.existsSync(f)) continue;
    const { meta } = JSON.parse(fs.readFileSync(f, 'utf8'));
    keys.add(meta.title);
    if (meta.description) keys.add(meta.description);
  }
  return keys;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { flatten } = await import('../src/i18n/index.ts');
  const FR = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/editor/src/i18n/fr.json'), 'utf8'));
  const fr = flatten(FR);
  const missing = [...[...sourceKeys()].filter((k) => !(k in fr)), ...[...contentKeys()].filter((k) => !(k in FR.content)).map((k) => `content: ${k}`)].sort();
  console.log(JSON.stringify(missing, null, 1));
  console.error(`${missing.length} text(s) without a French translation`);
}
