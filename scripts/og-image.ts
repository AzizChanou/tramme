// The picture a link to tramme shows (Open Graph, X, chats): a 1200×630 card
// in the site's colours, its title in Geist and the editor's screenshot,
// rendered by a headless Edge or Chrome, written to apps/editor/og.jpg. The
// site (apps/site) and the editor's page (apps/editor/build.ts) share it.
//
//   node scripts/og-image.ts            (BROWSER=<path to chrome or msedge> elsewhere than Windows)

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'apps/editor/og.jpg');
const W = 1200, H = 630;

const BROWSER = process.env.BROWSER ?? [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => fs.existsSync(p));
if (!BROWSER) throw new Error('no Chrome or Edge found: BROWSER=<its path> node scripts/og-image.ts');

const icon = fs.readFileSync(path.join(ROOT, 'apps/editor/icon.svg'), 'utf8');
const shot = pathToFileURL(path.join(ROOT, 'apps/site/src/assets/editor.png')).href;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Geist; font-weight: 100 900; src: url(https://cdn.jsdelivr.net/fontsource/fonts/geist:vf@latest/latin-wght-normal.woff2) format('woff2'); }
@font-face { font-family: Geist Mono; font-weight: 100 900; src: url(https://cdn.jsdelivr.net/fontsource/fonts/geist-mono:vf@latest/latin-wght-normal.woff2) format('woff2'); }
* { margin: 0; box-sizing: border-box; }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; }
body { position: relative; background: #0b0f12; color: #e8edef; font-family: Geist, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
body::before { content: ''; position: absolute; inset: 0; background: radial-gradient(70% 90% at 100% 100%, rgba(115, 144, 255, 0.16), transparent 70%), radial-gradient(50% 60% at 0% 0%, rgba(46, 196, 182, 0.12), transparent 70%); }
.text { position: absolute; left: 72px; top: 64px; width: 560px; display: flex; flex-direction: column; height: ${H - 128}px; }
.brand { display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 600; letter-spacing: -0.02em; }
.brand svg { width: 44px; height: 44px; }
h1 { margin-top: 64px; font-size: 76px; line-height: 0.98; letter-spacing: -0.048em; font-weight: 600; }
h1 span { display: block; }
.quiet { color: #7a8890; }
p { margin-top: 28px; font-size: 25px; line-height: 1.4; color: #9eabb3; letter-spacing: -0.01em; }
.foot { margin-top: auto; display: flex; gap: 22px; font-family: 'Geist Mono', monospace; font-size: 19px; color: #7a8890; }
.foot b { color: #2ec4b6; font-weight: 500; }
.shot { position: absolute; left: 676px; top: 96px; width: 820px; border-radius: 16px; overflow: hidden; box-shadow: 0 0 0 1px rgba(228, 234, 237, 0.14), 0 40px 120px -30px rgba(0, 0, 0, 0.9); }
.shot img { display: block; width: 100%; }
</style></head><body>
<div class="text">
  <div class="brand">${icon}<span>tramme</span></div>
  <h1><span>Motion design,</span> <span class="quiet">written as data.</span></h1>
  <p>An open-source engine and editor. You and the AI edit the same document.</p>
  <div class="foot"><b>tramme.dev</b><span>Apache-2.0</span></div>
</div>
<div class="shot"><img src="${shot}" alt=""></div>
</body></html>`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tramme-og-'));
try {
  const page = path.join(dir, 'card.html'), png = path.join(dir, 'card.png');
  fs.writeFileSync(page, html);
  execFileSync(BROWSER, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files',
    `--window-size=${W},${H}`, '--virtual-time-budget=8000', `--user-data-dir=${path.join(dir, 'profile')}`, `--screenshot=${png}`, pathToFileURL(page).href,
  ], { stdio: 'ignore' });
  await sharp(png).resize(W, H, { fit: 'cover', position: 'top' }).jpeg({ quality: 88, mozjpeg: true }).toFile(OUT);
  console.log(`${path.relative(ROOT, OUT)}: ${W}×${H}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
