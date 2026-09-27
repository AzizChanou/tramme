// The vocabulary of a document on the Node side: built-in nodes plus the
// document's plugins, imported from its folder (a changed file is imported
// again, thanks to its modification time in the URL).

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { TrammeDoc, Registry } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';

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
