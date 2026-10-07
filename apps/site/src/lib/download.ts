// The desktop app for Windows, offered by the site when it was built on this
// machine (npm run desktop:build): at each site build (astro.config.mjs) the
// installer of the current version is copied to public/download/, served by
// the site's Worker beside the pages, and the pages learn of it through
// __DOWNLOAD__ (components/DownloadLink.astro). Without it, the links stay out.

import fs from 'node:fs';
import path from 'node:path';

export interface Download {
  /** where the site serves it */
  href: string;
  version: string;
  /** in bytes */
  size: number;
}

/** copies the Windows installer into the site's public folder (alone there), and says what it is */
export function publishInstaller(root: string, log: (s: string) => void): Download | null {
  const repo = path.resolve(root, '../..');
  const conf = JSON.parse(fs.readFileSync(path.join(repo, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8')) as { version: string; productName: string };
  const file = `${conf.productName}_${conf.version}_x64-setup.exe`;
  const built = path.join(repo, 'apps/desktop/src-tauri/target/release/bundle/nsis', file);
  const out = path.join(root, 'public/download');
  fs.rmSync(out, { recursive: true, force: true });
  if (!fs.existsSync(built)) {
    log(`site: no ${file} (npm run desktop:build): the download links are left out`);
    return null;
  }
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(built, path.join(out, file));
  return { href: `/download/${file}`, version: conf.version, size: fs.statSync(built).size };
}
