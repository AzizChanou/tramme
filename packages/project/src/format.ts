// The tramme project format, version 1. A project is a set of files:
//
//   tramme.json            manifest (this file's schema)
//   document.tramme.json   the document (schema tramme/1)
//   assets/                 files referenced by the document's assets
//   plugins/                modules listed in the document's plugins
//   thumbnail.webp          picture for the home screen (optional)
//   .tramme/chats/         the assistant's conversations (<id>.json) and their index (index.json)
//   .tramme/chat.json      a single conversation (older projects; still read)
//   renders/                exports (never part of an archive)
//
// The same files live in storage (an R2 prefix, a folder) while working, and
// in a .tramme archive (zip) to import or export. Everything here runs in
// browsers, Node and Workers (no eval, no file system).

import { z } from 'zod';
import { DocSchema } from '@tramme/core/schema';
import { upgradeDoc, type TrammeDoc } from '@tramme/core/types';

export const PROJECT_FORMAT = 'tramme-project/1';
export const MANIFEST = 'tramme.json';
export const DOCUMENT = 'document.tramme.json';
export const CHAT = '.tramme/chat.json';
export const CHATS = '.tramme/chats/';
export const CHAT_INDEX = '.tramme/chats/index.json';
/** a conversation file, or the index of conversations */
export const isChatPath = (path: string) => path === CHAT || /^\.tramme\/chats\/[a-z0-9-]{1,64}\.json$/.test(path);
export const chatPath = (id: string) => `${CHATS}${id}.json`;

const legacy = (name: string) => ({ format: `${name}-project/1`, manifest: `${name}.json`, document: `document.${name}.json`, dir: `.${name}/`, archive: `.${name}` });
/** the same project format under the tool's former names (trame, before that emotion) */
export const LEGACIES = [legacy('trame'), legacy('emotion')];

/** where a file of a former-name project goes today */
export function currentPath(path: string): string {
  for (const l of LEGACIES) {
    if (path === l.manifest) return MANIFEST;
    if (path === l.document) return DOCUMENT;
    if (path.startsWith(l.dir)) return `.tramme/${path.slice(l.dir.length)}`;
  }
  return path;
}

/** a project saved under a former name: its manifest has the old file name */
export const isLegacyProject = (paths: Iterable<string>) => { const s = new Set(paths); return !s.has(MANIFEST) && LEGACIES.some((l) => s.has(l.manifest)); };

/** the manifest or the document of a former-name project, rewritten for today; other files unchanged */
export function upgradeFile(path: string, data: Uint8Array): Uint8Array {
  const p = currentPath(path);
  if (p !== MANIFEST && p !== DOCUMENT) return data;
  try {
    const j = JSON.parse(new TextDecoder().decode(data));
    if (p === MANIFEST && LEGACIES.some((l) => l.format === j.format)) j.format = PROJECT_FORMAT;
    if (p === DOCUMENT) upgradeDoc(j);
    return new TextEncoder().encode(JSON.stringify(j, null, 2) + '\n');
  } catch { return data; }
}

/** a former-name project with today's names and versions; any other project as it is */
export function migrateProject(files: Map<string, Uint8Array>): Map<string, Uint8Array> {
  if (!isLegacyProject(files.keys())) return files;
  const out = new Map<string, Uint8Array>();
  for (const [p, data] of files) out.set(currentPath(p), upgradeFile(p, data));
  return out;
}

export const ManifestSchema = z.strictObject({
  format: z.literal(PROJECT_FORMAT),
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/, 'id: lowercase letters, digits and hyphens'),
  name: z.string().min(1).max(200),
  /** ISO dates */
  created: z.string(),
  modified: z.string(),
  /** the composition shown on the home screen */
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.number().positive().optional(),
  thumbnail: z.string().optional(),
  app: z.string().optional(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** limits for one project (Cloudflare Workers accept request bodies up to 100 MB) */
export const LIMITS = {
  /** one request (Workers accept bodies up to 100 MB) */
  file: 95 * 1024 * 1024,
  /** a sound or a video, sent in parts */
  media: 4 * 1024 * 1024 * 1024,
  /** size of one part of a large file */
  part: 32 * 1024 * 1024,
  /** a .tramme archive opened in the browser or the command line */
  archive: 2 * 1024 * 1024 * 1024,
  files: 2000,
};

/** a sound or a video of the project: may exceed one request, sent in parts */
export const isMedia = (path: string) => /^(assets|renders)\/.+\.(wav|mp3|ogg|m4a|flac|mp4|webm|mov)$/i.test(path);
/** the largest size admitted for a file at this path */
export const maxSize = (path: string) => (isMedia(path) ? LIMITS.media : LIMITS.file);

const EXT: Record<string, string[]> = {
  assets: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg', 'ttf', 'otf', 'woff', 'woff2', 'wav', 'mp3', 'ogg', 'm4a', 'flac', 'mp4', 'webm', 'mov', 'json', 'js', 'mjs'],
  plugins: ['js', 'mjs'],
  renders: ['mp4', 'webm', 'mov', 'gif', 'png', 'zip', 'json', 'svg', 'wav'],
};

export const MIME: Record<string, string> = {
  json: 'application/json; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', zip: 'application/zip',
};
export const mimeOf = (path: string) => MIME[path.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';

/**
 * Why a path cannot be a file of a project, or null when it can. Paths are
 * relative, with '/' separators, inside one of the known places.
 */
export function pathIssue(path: string): string | null {
  if (!path || path.length > 300) return 'empty or too long path';
  if (path.startsWith('/') || path.includes('\\') || /^[a-z]+:/i.test(path)) return 'absolute path not allowed';
  const parts = path.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return 'invalid path';
  if (parts.some((p) => /[\u0000-\u001f<>:"|?*]/.test(p))) return 'forbidden character in the path';
  if (path === MANIFEST || path === DOCUMENT || isChatPath(path)) return null;
  if (/^thumbnail\.(webp|png|jpg)$/.test(path)) return null;
  const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : '';
  const allowed = EXT[parts[0]];
  if (!allowed || parts.length < 2) return 'location not allowed by the format (assets/, plugins/, renders/)';
  return allowed.includes(ext) ? null : `extension .${ext} not allowed in ${parts[0]}/`;
}

/** a relative src of the document, as the path of a project file */
export function srcPath(src: string): string | null {
  if (/^[a-z]+:/i.test(src) || src.startsWith('/')) return null;
  const parts: string[] = [];
  for (const p of src.split('/')) {
    if (p === '' || p === '.') continue;
    if (p === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(p);
  }
  return parts.join('/');
}

export interface Issue { path: string; message: string }

/** a fresh id: readable from the name, unique enough for one person's projects */
export function newId(name: string): string {
  const base = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'project';
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 6);
  return `${base.length < 3 ? 'project' : base}-${rand}`;
}

/**
 * Structure of a whole project: manifest, document schema, every asset and
 * plugin present, every path admitted, sizes. The meaning of the document
 * (node types, expressions, plugins) is checked by the editor, where they run.
 */
export function checkProject(files: Map<string, Uint8Array>): { issues: Issue[]; manifest?: Manifest; doc?: TrammeDoc } {
  const issues: Issue[] = [];
  const text = (p: string) => new TextDecoder().decode(files.get(p));
  if (files.size > LIMITS.files) issues.push({ path: '', message: `too many files (${files.size}, ${LIMITS.files} at most)` });
  for (const [p, data] of files) {
    const bad = pathIssue(p);
    if (bad) issues.push({ path: p, message: bad });
    if (data.byteLength > maxSize(p)) issues.push({ path: p, message: 'file too large' });
  }
  let manifest: Manifest | undefined;
  if (!files.has(MANIFEST)) issues.push({ path: MANIFEST, message: 'manifest missing: this is not a tramme project' });
  else {
    try {
      const r = ManifestSchema.safeParse(JSON.parse(text(MANIFEST)));
      if (r.success) manifest = r.data;
      else issues.push(...r.error.issues.map((i) => ({ path: `${MANIFEST}/${i.path.join('/')}`, message: i.message })));
    } catch { issues.push({ path: MANIFEST, message: 'unreadable JSON' }); }
  }
  let doc: TrammeDoc | undefined;
  if (!files.has(DOCUMENT)) issues.push({ path: DOCUMENT, message: 'document missing' });
  else {
    try {
      const raw = upgradeDoc(JSON.parse(text(DOCUMENT)));
      const r = DocSchema.safeParse(raw);
      if (r.success) doc = raw as TrammeDoc;
      else issues.push(...r.error.issues.slice(0, 20).map((i) => ({ path: `${DOCUMENT}/${i.path.join('/')}`, message: i.message })));
    } catch { issues.push({ path: DOCUMENT, message: 'unreadable JSON' }); }
  }
  if (doc) {
    for (const [id, a] of Object.entries(doc.assets)) {
      const p = srcPath(a.src);
      if (p === null) issues.push({ path: `${DOCUMENT}/assets/${id}/src`, message: `path outside the project: ${a.src}` });
      else if (!files.has(p)) issues.push({ path: `${DOCUMENT}/assets/${id}/src`, message: `missing file: ${p}` });
    }
    for (const id of doc.plugins || []) if (doc.assets[id]?.type !== 'module') issues.push({ path: `${DOCUMENT}/plugins`, message: `plugin "${id}" without a module` });
  }
  return { issues, manifest, doc };
}

/** manifest and document of a new, empty project */
export function newProject(opts: { name: string; width: number; height: number; fps: number; duration: number; id?: string; app?: string }): { manifest: Manifest; doc: TrammeDoc } {
  const now = new Date().toISOString();
  const manifest: Manifest = {
    format: PROJECT_FORMAT, id: opts.id ?? newId(opts.name), name: opts.name, created: now, modified: now,
    width: opts.width, height: opts.height, duration: opts.duration, ...(opts.app ? { app: opts.app } : {}),
  };
  const doc: TrammeDoc = {
    schema: 'tramme/1',
    meta: { title: opts.name },
    tokens: {
      background: { type: 'color', value: '#0E0F12' },
      text: { type: 'color', value: '#F4F5F7' },
      accent: { type: 'color', value: '#2EC4B6' },
      smooth: { type: 'ease', value: [0.42, 0, 0.58, 1] },
      snappy: { type: 'ease', value: [0.16, 1, 0.3, 1] },
    },
    assets: {},
    root: 'main',
    compositions: {
      main: {
        name: opts.name, width: opts.width, height: opts.height, fps: opts.fps, duration: opts.duration,
        background: '@background', motionBlur: { samples: 8, shutter: 0.5 }, layers: {}, order: [],
      },
    },
  };
  return { manifest, doc };
}

/** the document must parse before anything is written */
export function parseDocument(text: string): TrammeDoc {
  const raw = upgradeDoc(JSON.parse(text));
  const r = DocSchema.safeParse(raw);
  if (!r.success) throw new Error(`invalid document: ${r.error.issues[0]?.path.join('/')} ${r.error.issues[0]?.message}`);
  return raw as TrammeDoc;
}
