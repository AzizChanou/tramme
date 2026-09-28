// Production build of the editor into apps/editor/dist, served by the Worker
// as static assets: the bundle (hashed names), index.html, the examples as
// .tramme archives.
//
//   node apps/editor/build.ts          build once (minified)
//   node apps/editor/build.ts --dev    rebuild on change, run `wrangler dev` (R2 simulated, no Access) and the assistant's companion

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { checkProject, MANIFEST, packProject } from '@tramme/project';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
// TRAMME_DIST: build elsewhere (benchmarks, without touching a running `npm run dev`)
const DIST = process.env.TRAMME_DIST ? path.resolve(process.env.TRAMME_DIST) : path.join(HERE, 'dist');
const dev = process.argv.includes('--dev');

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#0E1215"/><g transform="translate(2.4 2.3) scale(.8)" fill="#2EC4B6"><rect x="2.5" y="2.6" width="19" height="5" rx="1.8"/><rect x="8.8" y="8.7" width="6.4" height="3.9" rx="1.2"/><rect x="9.9" y="13.7" width="6.4" height="3.9" rx="1.2" opacity=".66"/><rect x="11" y="18.7" width="6.4" height="3.9" rx="1.2" opacity=".36"/></g></svg>`;

const page = (js: string, css: string | undefined) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark"><meta name="theme-color" content="#0b0f12">
<title>tramme</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(ICON)}">
<link rel="manifest" href="/manifest.webmanifest"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="tramme">
${css ? `<link rel="stylesheet" href="/${css}">` : ''}</head>
<body><div id="app"></div><script type="module" src="/${js}"></script></body></html>
`;

// built files have hashed names: they never change and stay cached. In dev the
// names are stable: always checked again (and versioned in the page, see below)
const HEADERS = `/assets/*
  Cache-Control: ${dev ? 'no-cache' : 'public, max-age=31536000, immutable'}
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: same-origin
`;

/** index.html pointing at the bundle esbuild just wrote */
function writePage(meta: esbuild.Metafile) {
  const outs = Object.keys(meta.outputs).map((p) => path.relative(DIST, path.resolve(ROOT, p)).split(path.sep).join('/'));
  const js = outs.find((p) => /^assets\/main(-[^/]+)?\.js$/.test(p))!;
  const css = outs.find((p) => /^assets\/main(-[^/]+)?\.css$/.test(p));
  // in dev, a new address at each rebuild, so no browser keeps an older bundle
  const v = dev ? `?v=${Date.now().toString(36)}` : '';
  fs.writeFileSync(path.join(DIST, 'index.html'), page(`${js}${v}`, css && `${css}${v}`));
  // drop the bundles of previous builds
  const keep = new Set(outs.flatMap((p) => [p, `${p}.LEGAL.txt`]));
  for (const f of fs.readdirSync(path.join(DIST, 'assets'))) if (!keep.has(`assets/${f}`)) fs.rmSync(path.join(DIST, 'assets', f));
}

/** every file of a project folder (renders/ and local state left out) */
function readFolder(dir: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (p !== 'renders' && p !== '.tramme') walk(p); }
      else files.set(p, new Uint8Array(fs.readFileSync(path.join(dir, p))));
    }
  };
  walk('');
  return files;
}

/** the example projects (folders with a manifest) as archives, and their list */
function writeExamples() {
  const out = path.join(DIST, 'examples');
  fs.mkdirSync(out, { recursive: true });
  const list = [];
  for (const name of fs.readdirSync(path.join(ROOT, 'examples')).sort()) {
    const dir = path.join(ROOT, 'examples', name);
    if (!fs.existsSync(path.join(dir, MANIFEST))) continue;
    const files = readFolder(dir);
    const { issues, manifest, doc } = checkProject(files);
    if (issues.length || !manifest || !doc) throw new Error(`exemple ${name} : ${issues.map((i) => `${i.path} ${i.message}`).join(' ; ')}`);
    const root = doc.compositions[doc.root];
    fs.writeFileSync(path.join(out, `${manifest.id}.tramme`), packProject(files));
    // the example's thumbnail, published beside its archive for the home screen
    let thumbnail: string | undefined;
    if (manifest.thumbnail && files.has(manifest.thumbnail)) {
      thumbnail = `${manifest.id}${path.extname(manifest.thumbnail)}`;
      fs.writeFileSync(path.join(out, thumbnail), files.get(manifest.thumbnail)!);
    }
    list.push({ file: `${manifest.id}.tramme`, name: manifest.name, description: doc.meta.description ?? '', width: root.width, height: root.height, duration: root.duration, thumbnail });
  }
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(list, null, 2));
  return list.length;
}

const options: esbuild.BuildOptions = {
  entryPoints: { main: path.join(HERE, 'src/main.tsx') },
  outdir: path.join(DIST, 'assets'),
  // in dev, stable names: files are rewritten in place under the running `wrangler dev`
  entryNames: dev ? '[name]' : '[name]-[hash]', assetNames: '[name]-[hash]',
  bundle: true, splitting: !dev, chunkNames: 'chunk-[hash]', format: 'esm', platform: 'browser', target: 'chrome120',
  minify: !dev && !process.env.TRAMME_NOMINIFY, sourcemap: 'linked', metafile: true, logLevel: 'warning',
  jsx: 'automatic', jsxImportSource: 'preact',
  loader: { '.ttf': 'file', '.woff2': 'file', '.md': 'text' },
  legalComments: 'linked',
};

// empty the folder rather than removing it (a running `wrangler dev` watches it)
fs.mkdirSync(DIST, { recursive: true });
for (const f of fs.readdirSync(DIST)) fs.rmSync(path.join(DIST, f), { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
fs.writeFileSync(path.join(DIST, '_headers'), HEADERS);
// installable on a phone's home screen: opens full screen, in the editor's colours
fs.writeFileSync(path.join(DIST, 'icon.svg'), ICON);
fs.writeFileSync(path.join(DIST, 'manifest.webmanifest'), JSON.stringify({
  name: 'tramme', short_name: 'tramme', start_url: '/', scope: '/', display: 'standalone', background_color: '#0b0f12', theme_color: '#0b0f12',
  icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
}, null, 2));
const examples = writeExamples();

if (!dev) {
  const t0 = performance.now();
  const r = await esbuild.build(options);
  writePage(r.metafile!);
  const size = Object.values(r.metafile!.outputs).reduce((n, o) => n + o.bytes, 0);
  console.log(`editor built in ${path.relative(process.cwd(), DIST)} in ${((performance.now() - t0) / 1000).toFixed(1)} s (${(size / 1e6).toFixed(1)} MB with source maps, ${examples} example(s))`);
} else {
  const ctx = await esbuild.context({
    ...options,
    plugins: [{ name: 'page', setup: (b) => b.onEnd((r) => { if (r.metafile && !r.errors.length) { writePage(r.metafile); console.log(`[build] ${new Date().toLocaleTimeString('en-GB')} editor up to date`); } }) }],
  });
  await ctx.rebuild();
  await ctx.watch();
  const port = process.env.PORT ?? '8787';
  // TRAMME_STATE: projects stored elsewhere (trials beside a running `npm run dev`)
  const state = process.env.TRAMME_STATE ?? '.wrangler/state';
  const wrangler = spawn('npx', ['wrangler', 'dev', '-c', 'apps/worker/wrangler.jsonc', '--port', port, '--var', 'DEV_OPEN:1', '--persist-to', state], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  // the assistant's local companion, paired by itself with this editor (TRAMME_NO_COMPANION=1: without it)
  let companion: ReturnType<typeof spawn> | null = null, elsewhere = false;
  if (!process.env.TRAMME_NO_COMPANION) {
    companion = spawn(process.execPath, ['packages/cli/src/main.ts', 'agent', '--origin', `http://localhost:${port},http://127.0.0.1:${port}`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    const tell = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        // already running (another `tramme agent`): that one serves the editor
        if (/EADDRINUSE/.test(line)) { elsewhere = true; console.log('[companion] already running elsewhere, that one serves the editor'); continue; }
        if (/^\s+at |^node:|^Node\.js|^\s*\^|^\{|^\}|code: '|errno|syscall|address|port:/.test(line)) continue;
        console.log(`[companion] ${line}`);
      }
    };
    companion.stdout!.on('data', tell);
    companion.stderr!.on('data', tell);
    companion.on('exit', (code) => { if (code && !elsewhere) console.log(`[companion] stopped (code ${code}); the assistant will go through the server if it has a key`); companion = null; });
  }
  wrangler.on('exit', async (code) => { companion?.kill(); await ctx.dispose(); process.exit(code ?? 0); });
  console.log(`[build] editor on http://localhost:${port}/ (projects in ${state})`);
}
