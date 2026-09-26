// The .tramme archive: a zip of the project's files (renders left out).
// Reading checks every entry before anything else uses it.

import { unzipSync, zipSync, type Zippable } from 'fflate';
import { LEGACIES, LIMITS, MANIFEST, maxSize, migrateProject, pathIssue } from './format.ts';

/** zip the project's files; renders/ and unknown places stay out */
export function packProject(files: Map<string, Uint8Array>): Uint8Array {
  const entries: Zippable = {};
  for (const [p, data] of files) {
    if (p.startsWith('renders/') || pathIssue(p)) continue;
    // media are already compressed: store them as they are
    const stored = /\.(png|jpe?g|webp|gif|avif|mp3|ogg|m4a|mp4|webm|mov|woff2?)$/i.test(p);
    entries[p] = [data, { level: stored ? 0 : 6 }];
  }
  return zipSync(entries);
}

/** the files of an archive; throws when it is not a usable zip */
export function unpackProject(zip: Uint8Array): Map<string, Uint8Array> {
  if (zip.byteLength > LIMITS.archive) throw new Error('archive too large');
  if (zip[0] !== 0x50 || zip[1] !== 0x4b) throw new Error('this file is not a .tramme archive (zip)');
  let total = 0;
  const raw = unzipSync(zip, {
    // refuse oversized entries before inflating them (zip bombs)
    filter: (f) => {
      total += f.originalSize;
      if (f.originalSize > maxSize(f.name) || total > LIMITS.archive * 2) throw new Error(`entry too large: ${f.name}`);
      return !f.name.endsWith('/');
    },
  });
  const files = new Map<string, Uint8Array>(Object.entries(raw));
  // an archive made by hand may wrap everything in one folder: unwrap it
  const roots = new Set([...files.keys()].map((k) => k.split('/')[0]));
  if (!files.has(MANIFEST) && !LEGACIES.some((l) => files.has(l.manifest)) && roots.size === 1) {
    const root = [...roots][0] + '/';
    const unwrapped = new Map<string, Uint8Array>();
    for (const [k, v] of files) unwrapped.set(k.slice(root.length), v);
    return migrateProject(unwrapped);
  }
  // an archive of a former name (.trame, .emotion) is read as today's
  return migrateProject(files);
}
