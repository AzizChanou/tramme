// Asset files on disk for the exporters (Node).

import fs from 'node:fs';
import path from 'node:path';
import type { TrammeDoc } from '@tramme/core';
import { assetFile, type AssetFile, type AssetReader } from './bytes.ts';

/**
 * readAsset for the exporters. resolve maps an asset src to a file path
 * (relative srcs resolve against the document's folder by default).
 */
export function fileAssetReader(doc: TrammeDoc, docDir: string, resolve?: (src: string) => string | null): AssetReader {
  const cache = new Map<string, AssetFile | null>();
  function read(id: string) {
    const a = doc.assets[id];
    if (!a) return null;
    const file = resolve?.(a.src) ?? (a.src.startsWith('/') ? null : path.resolve(docDir, a.src));
    if (!file || !fs.existsSync(file)) return null;
    return assetFile(a.type, file, new Uint8Array(fs.readFileSync(file)));
  }
  return (id: string) => {
    if (!cache.has(id)) cache.set(id, read(id));
    return cache.get(id)!;
  };
}
