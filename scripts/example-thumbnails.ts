// Thumbnails of the example projects: a still from the engine at the middle
// of the main composition, made smaller in WebP, kept in the example's folder
// (thumbnail.webp) and named in its manifest. The home screen shows it.
//
//   node scripts/example-thumbnails.ts

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DOCUMENT, MANIFEST } from '@tramme/project';
import { launch } from '../packages/cli/src/browser.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIDTH = 640;
const tmp = path.join(ROOT, 'out', 'example-thumbnails');
fs.mkdirSync(tmp, { recursive: true });

const { browser, page } = await launch();
try {
  for (const name of fs.readdirSync(path.join(ROOT, 'examples')).sort()) {
    const dir = path.join(ROOT, 'examples', name);
    if (!fs.existsSync(path.join(dir, MANIFEST))) continue;
    const doc = JSON.parse(fs.readFileSync(path.join(dir, DOCUMENT), 'utf8'));
    const root = doc.compositions[doc.root];
    // a moment chosen in the document (meta.thumbnailTime), or the middle
    const t = typeof doc.meta?.thumbnailTime === 'number' ? doc.meta.thumbnailTime : root.duration / 2;
    execFileSync(process.execPath, [path.join(ROOT, 'packages/cli/src/main.ts'), 'still', dir, '--t', String(t), '--out', path.join(tmp, name)], { cwd: ROOT, stdio: 'ignore' });
    const png = fs.readdirSync(path.join(tmp, name)).find((f) => f.endsWith('.png'))!;
    const data = fs.readFileSync(path.join(tmp, name, png)).toString('base64');
    const webp: string = await page.evaluate(async (x) => {
      const img = new Image();
      img.src = `data:image/png;base64,${x.data}`;
      await img.decode();
      const k = Math.min(1, x.width / img.naturalWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/webp', 0.84).split(',')[1];
    }, { data, width: WIDTH });
    fs.writeFileSync(path.join(dir, 'thumbnail.webp'), Buffer.from(webp, 'base64'));
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
    manifest.thumbnail = 'thumbnail.webp';
    fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`${name}: thumbnail at ${t} s`);
  }
} finally {
  await browser.close();
}
