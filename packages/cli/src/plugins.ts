// The vocabulary of a document on the Node side: built-in nodes plus the
// document's plugins, imported from its folder (a changed file is imported
// again, thanks to its modification time in the URL), or from the project's
// files held in memory (archives).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TrammeDoc, Registry } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { srcPath } from '@tramme/project';

/** the vocabulary of a project held in memory (an archive, a folder read for packing): its plugins imported from its own files, as the editor does on import */
export async function filesRegistry(doc: TrammeDoc, files: Map<string, Uint8Array>): Promise<Registry> {
  const reg = builtinRegistry().clone();
  for (const id of doc.plugins || []) {
    const file = srcPath(doc.assets[id]?.src ?? '');
    const data = file ? files.get(file) : undefined;
    if (!data) throw new Error(`plugin "${id}" not found in the project`);
    try { reg.use(await import(`data:text/javascript;base64,${Buffer.from(data).toString('base64')}`), id); }
    catch (e) { throw new Error(`plugin "${id}" unreadable: ${(e as Error).message}`); }
  }
  return reg;
}

/** resolve: absolute URL paths of mounts to files (relative srcs resolve against dir) */
export async function docRegistry(doc: TrammeDoc, dir: string, resolve?: (urlPath: string) => string | null): Promise<Registry> {
  const reg = builtinRegistry().clone();
  for (const id of doc.plugins || []) {
    const a = doc.assets[id];
    if (!a || a.type !== 'module') continue;
    const file = a.src.startsWith('/') ? resolve?.(a.src) ?? null : path.resolve(dir, a.src);
    if (!file || !fs.existsSync(file)) throw new Error(`plugin "${id}" not found: ${a.src}`);
    reg.use(await import(`${pathToFileURL(file).href}?v=${fs.statSync(file).mtimeMs}`), id);
  }
  return reg;
}
