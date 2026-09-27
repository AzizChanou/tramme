// tramme check-export <doc> --format lottie|svg --t 0.5,1.5: how faithful an
// export is. Lottie is played back by lottie-web (the reference player), SVG
// is drawn by Chrome; both are compared with tramme's own frames at the same
// instants. The tramme side drops what the format cannot carry (motion blur,
// finishing effects, layers drawn by code) so the comparison is like for like.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { upgradeDoc, type TrammeDoc } from '@tramme/core';
import { toLottie, toSvg } from '@tramme/interop';
import { fileAssetReader } from '@tramme/interop/node';
import { launch, openDoc } from './browser.ts';
import { compareFiles } from './compare.ts';
import { docRegistry } from './plugins.ts';
import { readConfig, Server, serveFile } from './server.ts';

const require = createRequire(import.meta.url);
const EXPORTABLE = (type: string) => type.startsWith('shape.') || ['text', 'text.counter', 'image', 'sequence', 'group', 'comp', 'audio'].includes(type);

export async function checkExport(file: string, format: 'lottie' | 'svg', times: number[], outDir: string, compId?: string) {
  const doc: TrammeDoc = upgradeDoc(JSON.parse(fs.readFileSync(file, 'utf8')));
  const cfg = readConfig(path.resolve(file));
  const server = new Server(cfg);
  const resolve = (u: string) => server.resolve(u);
  const registry = await docRegistry(doc, cfg.dir, resolve);
  const readAsset = fileAssetReader(doc, cfg.dir, resolve);
  const plain: TrammeDoc = structuredClone(doc);
  for (const c of Object.values(plain.compositions)) {
    c.effects = [];
    if (c.motionBlur) c.motionBlur = { samples: 1, shutter: 0 };
    for (const l of Object.values(c.layers)) if (!EXPORTABLE(l.type) || (format === 'lottie' && l.type === 'text.counter')) l.visible = false;
  }
  const comp = doc.compositions[compId ?? doc.root];
  const lottie = format === 'lottie' ? toLottie(doc, registry, { compId, readAsset }) : null;
  const lottieJs = path.join(path.dirname(require.resolve('lottie-web/package.json')), 'build/player/lottie.min.js');
  let svgNow = '';
  server.use((req, res, url) => {
    if (url.pathname === '/__tramme/lib/lottie.js') { serveFile(req, res, lottieJs); return true; }
    if (url.pathname === '/__tramme/check.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body style="margin:0;background:#000"><div id="c" style="width:${comp.width}px;height:${comp.height}px"></div><script src="/__tramme/lib/lottie.js"></script></body></html>`);
      return true;
    }
    if (url.pathname === '/__tramme/check.svg') { res.writeHead(200, { 'content-type': 'image/svg+xml' }); res.end(svgNow); return true; }
    return false;
  });
  const port = await server.start();
  const { browser, page } = await launch();
  fs.mkdirSync(outDir, { recursive: true });
  const stem = path.basename(file).replace(/(\.tramme)?\.json$/, '');
  const warnings = new Set<string>(lottie?.warnings ?? []);
  try {
    await openDoc(page, port, '/project/' + encodeURIComponent(path.basename(file)), compId);
    await page.evaluate((a) => (window as any).TRAMME.load(a.d, a.c), { d: plain as any, c: compId });
    const other = await browser.newPage();
    await other.setViewport({ width: comp.width, height: comp.height });
    if (lottie) {
      await other.goto(`http://127.0.0.1:${port}/__tramme/check.html`);
      await other.evaluate((data) => {
        (window as any).anim = (window as any).lottie.loadAnimation({ container: document.getElementById('c'), renderer: 'svg', loop: false, autoplay: false, animationData: data });
      }, lottie.lottie);
    }
    console.log(`${'image'.padEnd(10)} ${'PSNR'.padStart(7)} ${'moy.'.padStart(6)} ${'max'.padStart(4)} ${'>16'.padStart(8)}`);
    for (const t of times) {
      const a = path.join(outDir, `${stem}_tramme_${t.toFixed(3)}.png`), b = path.join(outDir, `${stem}_${format}_${t.toFixed(3)}.png`);
      const e: string = await page.evaluate((x) => (window as any).TRAMME.still(x, { samples: 1 }), t);
      fs.writeFileSync(a, Buffer.from(e.split(',')[1], 'base64'));
      if (lottie) await other.evaluate((frame) => (window as any).anim.goToAndStop(frame, true), t * lottie.lottie.fr);
      else {
        const r = toSvg(doc, registry, t, { compId, readAsset });
        r.warnings.forEach((w) => warnings.add(w));
        svgNow = r.svg;
        fs.writeFileSync(b.replace(/\.png$/, '.svg'), r.svg);
        await other.goto(`http://127.0.0.1:${port}/__tramme/check.svg`);
      }
      await other.screenshot({ path: b as `${string}.png`, clip: { x: 0, y: 0, width: comp.width, height: comp.height } });
      const d = compareFiles(a, b, { diffOut: path.join(outDir, `${stem}_${format}_diff_${t.toFixed(3)}.png`) });
      console.log(`${t.toFixed(3).padEnd(10)} ${(Number.isFinite(d.psnr) ? d.psnr.toFixed(1) : 'inf').padStart(7)} ${d.mean.toFixed(2).padStart(6)} ${String(d.max).padStart(4)} ${(d.over * 100).toFixed(3).padStart(7)}%`);
    }
    for (const w of warnings) console.log(`  attention : ${w}`);
  } finally {
    await browser.close();
    server.close();
  }
}
