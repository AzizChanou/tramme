// Files of the open project in storage: names, free paths, uploads.

import { signal } from '@preact/signals';
import { pathIssue } from '@tramme/project';
import { api } from './api.ts';
import { slug } from './model.ts';
import { S } from './state.ts';

/** a file name fit for a storage path: ascii, digits, dashes, the extension kept */
export function safeName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const base = slug(dot > 0 ? name.slice(0, dot) : name).slice(0, 60) || 'file';
  return ext ? `${base}.${ext}` : base;
}

/** the path itself when free, otherwise name-2.ext, name-3.ext… */
export function freePath(taken: Set<string>, path: string): string {
  if (!taken.has(path)) return path;
  const dot = path.lastIndexOf('.');
  const [stem, ext] = dot > path.lastIndexOf('/') ? [path.slice(0, dot), path.slice(dot)] : [path, ''];
  for (let i = 2; ; i++) if (!taken.has(`${stem}-${i}${ext}`)) return `${stem}-${i}${ext}`;
}

/** paths already used by the project's files */
export async function takenPaths(): Promise<Set<string>> {
  const { files } = await api.info(S.project.peek().id);
  return new Set(files.map((f) => f.path));
}

/** files being sent, with their progress (shown at the bottom of the screen) */
export const uploads = signal<{ id: number; name: string; sent: number; total: number }[]>([]);
let uploadId = 0;

/** write a file of the project at a free path near the wanted one, large ones in parts; returns the path */
export async function upload(taken: Set<string>, wanted: string, body: Blob | Uint8Array): Promise<string> {
  const path = freePath(taken, wanted);
  const bad = pathIssue(path);
  if (bad) throw new Error(`${path} : ${bad}`);
  const blob = body instanceof Uint8Array ? new Blob([body as BlobPart]) : body;
  // a progress line for files that take a moment
  const track = blob.size > 4 * 1024 * 1024 ? ++uploadId : 0;
  if (track) uploads.value = [...uploads.peek(), { id: track, name: path.split('/').pop()!, sent: 0, total: blob.size }];
  try {
    await api.writeAny(S.project.peek().id, path, blob, (sent, total) => {
      if (track) uploads.value = uploads.peek().map((u) => (u.id === track ? { ...u, sent, total } : u));
    });
  } finally {
    if (track) uploads.value = uploads.peek().filter((u) => u.id !== track);
  }
  taken.add(path);
  return path;
}
