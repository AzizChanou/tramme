// Gathers the desktop app's installers built on this machine (npm run
// desktop:build) under their release names (apps/desktop/downloads.ts), for
// .github/workflows/desktop.yml:
//   node scripts/desktop-release.ts <out dir> [tag]
// With a tag, it must be the app's version (vX.Y.Z, tauri.conf.json).

import fs from 'node:fs';
import path from 'node:path';
import { INSTALLERS } from '../apps/desktop/downloads.ts';

const [out, tag] = process.argv.slice(2);
if (!out) {
  console.error('usage: node scripts/desktop-release.ts <out dir> [tag]');
  process.exit(2);
}
const root = path.resolve(import.meta.dirname, '..');
const tauri = path.join(root, 'apps/desktop/src-tauri');
const { version } = JSON.parse(fs.readFileSync(path.join(tauri, 'tauri.conf.json'), 'utf8')) as { version: string };
if (tag && tag !== `v${version}`) {
  console.error(`the tag ${tag} is not the app's version, v${version} (apps/desktop/src-tauri/tauri.conf.json)`);
  process.exit(1);
}

fs.mkdirSync(out, { recursive: true });
let found = 0;
for (const i of INSTALLERS) {
  const dir = path.join(tauri, 'target', i.built);
  const file = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.includes(`_${version}_`) && f.endsWith(i.suffix)) : undefined;
  if (!file) continue;
  fs.copyFileSync(path.join(dir, file), path.join(out, i.file));
  console.log(`${i.file} ← ${path.relative(root, path.join(dir, file))}`);
  found++;
}
if (!found) {
  console.error(`no installer of version ${version} under ${path.relative(root, tauri)}/target`);
  process.exit(1);
}
