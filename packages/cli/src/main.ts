// tramme: command line.
//   tramme validate <doc>
//   tramme still    <doc> --t 0.5,1.2 [--out dir] [--samples n] [--comp id]
//   tramme render   <doc> [--format mp4|mov|webm|gif|png] [--out file] [--samples n] [--from s] [--to s] [--crf 16] [--mute] [--comp id]
//   tramme export   <doc> --format lottie|svg|wav [--t s] [--comp id] [--out file]
//   tramme import   <animation.json> [--out folder]                     Lottie to a tramme project folder
//   tramme pack     <folder> [--out project.tramme]                    a project folder as a .tramme archive (checked)
//   tramme unpack   <project.tramme> [--out folder]                    a .tramme archive as a project folder (checked)
//   tramme nodes    [<doc>]                                            the node and effect vocabulary (plugins included)
//   tramme bench    <editor url> [--layer id] [--t s]                  how the editor holds up: playback, drag, hover
//   tramme check-export <doc> --format lottie|svg --t 0.5,1.5 [--out dir]   an export played back (lottie-web, Chrome) vs tramme
//   tramme compare  <ref> <test> [--diff dir] [--threshold 16]     files, or folders paired by time
//   tramme schema   [--out schema/tramme-1.schema.json]
//   tramme agent    [--origin https://app.example] [--port 4317] [--renew]   the local companion of the editor's assistant (Claude Code, Codex or the Gemini CLI of this computer)
// <doc> is a project folder (its document.tramme.json) or a document file.

import fs from 'node:fs';
import path from 'node:path';
import { upgradeDoc, documentJsonSchema, stringifyDoc, validate, type TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { fromLottie, toLottie, toSvg } from '@tramme/interop';
import { fileAssetReader } from '@tramme/interop/node';
import { launch, openDoc } from './browser.ts';
import { compareFiles } from './compare.ts';
import { renderAudio, renderVideo } from './jobs.ts';
import { VIDEO_FORMATS, type VideoFormat } from './media.ts';
import { docRegistry, filesRegistry } from './plugins.ts';
import { readConfig, Server } from './server.ts';
import { checkProject, DOCUMENT, isChatPath, MANIFEST, newProject, packProject, unpackProject, LEGACIES, migrateProject } from '@tramme/project';

const [cmd, ...rest] = process.argv.slice(2);
const pos: string[] = [];
const flags: Record<string, string | true> = {};
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (!a.startsWith('--')) { pos.push(a); continue; }
  const v = rest[i + 1];
  flags[a.slice(2)] = v === undefined || v.startsWith('--') ? true : (i++, v);
}
// a project folder stands for its document
const asDoc = (p?: string) => {
  if (!p || !fs.existsSync(p) || !fs.statSync(p).isDirectory()) return p;
  // a folder of a former name (document.trame.json, document.emotion.json) is read as well
  return [DOCUMENT, ...LEGACIES.map((l) => l.document)].map((d) => path.join(p, d)).find((f) => fs.existsSync(f)) ?? p;
};
if (!['compare', 'import', 'pack', 'unpack', 'bench', 'agent'].includes(cmd)) pos[0] = asDoc(pos[0])!;
const num = (k: string) => (flags[k] === undefined ? undefined : Number(flags[k]));
const str = (k: string) => (typeof flags[k] === 'string' ? (flags[k] as string) : undefined);

function readDoc(file: string): TrammeDoc {
  if (!file || !fs.existsSync(file)) throw new Error(`document not found: ${file ?? '(none)'}`);
  return upgradeDoc(JSON.parse(fs.readFileSync(file, 'utf8')));
}

const stem = (file: string) => ([DOCUMENT, ...LEGACIES.map((l) => l.document)].includes(path.basename(file)) ? path.basename(path.dirname(path.resolve(file))) : path.basename(file).replace(/(\.tramme|\.emotion)?\.json$/, ''));

/** a running server + headless Chrome on one document */
async function session(docFile: string) {
  const server = new Server(readConfig(path.resolve(docFile)));
  const port = await server.start();
  const { browser, page } = await launch({ quiet: !flags.verbose });
  const docUrl = '/project/' + encodeURIComponent(path.basename(docFile));
  const info = await openDoc(page, port, docUrl, str('comp'));
  return { server, browser, page, info, docUrl, close: async () => { await browser.close(); server.close(); } };
}

/** the document's vocabulary, its plugins loaded from its folder and mounts */
function registryOf(file: string, doc: TrammeDoc) {
  const cfg = readConfig(path.resolve(file));
  const resolve = (u: string) => { for (const [prefix, dir] of cfg.mounts) if (u.startsWith(prefix)) return path.join(dir, u.slice(prefix.length)); return null; };
  return { registry: docRegistry(doc, cfg.dir, resolve), resolve, dir: cfg.dir };
}

async function cmdValidate(file: string) {
  const doc = readDoc(file);
  const issues = validate(doc, await registryOf(file, doc).registry);
  if (!issues.length) { console.log(`${file} : valide`); return; }
  for (const i of issues) console.log(`  ${i.path || '/'} : ${i.message}`);
  throw new Error(`${issues.length} issue(s)`);
}

async function cmdStill(file: string) {
  const times = String(flags.t ?? '0').split(',').map(Number);
  const outDir = path.resolve(str('out') ?? path.join('out', stem(file)));
  fs.mkdirSync(outDir, { recursive: true });
  const s = await session(file);
  try {
    for (const t0 of times) {
      const t = Math.min(t0, s.info.duration - 1 / s.info.fps);
      const url: string = await s.page.evaluate((a) => (window as any).TRAMME.still(a.t, a.opts), { t, opts: { samples: num('samples') } });
      const f = path.join(outDir, `${stem(file)}_${t.toFixed(3)}.png`);
      fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
      console.log('wrote', path.relative(process.cwd(), f));
    }
  } finally { await s.close(); }
}

async function cmdRender(file: string) {
  const doc = readDoc(file);
  const s = await session(file);
  try {
    const format = (str('format') ?? 'mp4') as VideoFormat;
    if (!VIDEO_FORMATS.includes(format)) throw new Error(`unknown video format: ${format} (${VIDEO_FORMATS.join(', ')})`);
    const out = path.resolve(str('out') ?? path.join('out', format === 'png' ? `${stem(file)}_png` : `${stem(file)}.${format}`));
    console.log(`rendering ${stem(file)} (${format}): ${s.info.width}x${s.info.height} at ${s.info.fps} fps`);
    const r = await renderVideo(s.server, s.page, {
      docUrl: s.docUrl, doc, compId: str('comp'), format, samples: num('samples'), from: num('from'), to: num('to'), crf: num('crf'), mute: !!flags.mute, out,
    });
    console.log(`${r.frames} frames in ${r.seconds.toFixed(1)} s (${r.msPerFrame.toFixed(0)} ms/frame)${r.audio ? ', with sound' : ''} -> ${path.relative(process.cwd(), out)}`);
  } finally { await s.close(); }
}

function cmdCompare(ref: string, test: string) {
  const threshold = num('threshold') ?? 16;
  const diffDir = str('diff');
  if (diffDir) fs.mkdirSync(diffDir, { recursive: true });
  const timeOf = (f: string) => /_(\d+(?:\.\d+)?)\.png$/.exec(f)?.[1];
  let pairs: [string, string, string][] = [];
  if (fs.statSync(ref).isDirectory()) {
    const tests = new Map(fs.readdirSync(test).filter((f) => f.endsWith('.png')).map((f) => [timeOf(f) ?? f, f]));
    for (const f of fs.readdirSync(ref).filter((x) => x.endsWith('.png'))) {
      const key = timeOf(f) ?? f, g = tests.get(key);
      if (g) pairs.push([key, path.join(ref, f), path.join(test, g)]);
    }
    pairs.sort((a, b) => Number(a[0]) - Number(b[0]));
  } else pairs = [[path.basename(ref), ref, test]];
  if (!pairs.length) throw new Error('no pair of images to compare');
  console.log(`${'image'.padEnd(10)} ${'PSNR'.padStart(7)} ${'moy.'.padStart(6)} ${'max'.padStart(4)} ${`>${threshold}`.padStart(8)}`);
  let worst = Infinity;
  for (const [key, a, b] of pairs) {
    const d = compareFiles(a, b, { threshold, diffOut: diffDir ? path.join(diffDir, `diff_${key}.png`) : null });
    worst = Math.min(worst, d.psnr);
    const psnr = Number.isFinite(d.psnr) ? d.psnr.toFixed(1) : 'inf';
    console.log(`${key.padEnd(10)} ${psnr.padStart(7)} ${d.mean.toFixed(2).padStart(6)} ${String(d.max).padStart(4)} ${(d.over * 100).toFixed(3).padStart(7)}%`);
  }
  console.log(`${pairs.length} pairs, lowest PSNR ${Number.isFinite(worst) ? worst.toFixed(1) : 'inf'} dB`);
}

async function cmdExport(file: string) {
  const doc = readDoc(file);
  const format = str('format');
  const { registry, resolve, dir } = registryOf(file, doc);
  const compId = str('comp') ?? doc.root;
  const readAsset = fileAssetReader(doc, dir, resolve);
  const report = (w: string[]) => { for (const x of w) console.log(`  attention : ${x}`); };
  if (format === 'lottie') {
    const { lottie, warnings } = toLottie(doc, await registry, { compId, readAsset });
    const out = path.resolve(str('out') ?? path.join('out', `${stem(file)}.lottie.json`));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(lottie));
    console.log(`wrote ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
    report(warnings);
  } else if (format === 'svg') {
    const t = num('t') ?? 0;
    const { svg, warnings } = toSvg(doc, await registry, t, { compId, readAsset });
    const out = path.resolve(str('out') ?? path.join('out', `${stem(file)}_${t.toFixed(3)}.svg`));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, svg);
    console.log(`wrote ${path.relative(process.cwd(), out)}`);
    report(warnings);
  } else if (format === 'wav') {
    const out = path.resolve(str('out') ?? path.join('out', `${stem(file)}.wav`));
    const s = await session(file);
    try {
      const r = await renderAudio(s.server, s.page, s.docUrl, compId, out);
      console.log(`wrote ${path.relative(process.cwd(), r.file)}`);
    } finally { await s.close(); }
  } else throw new Error('export format: lottie, svg or wav (video: tramme render --format)');
}

function cmdImport(file: string) {
  if (!file || !fs.existsSync(file)) throw new Error(`file not found: ${file ?? '(none)'}`);
  const { doc, files, warnings } = fromLottie(JSON.parse(fs.readFileSync(file, 'utf8')));
  const name = path.basename(file).replace(/(\.lottie)?\.json$/, '');
  const dir = path.resolve(str('out') ?? path.join(path.dirname(file), name));
  const c = doc.compositions[doc.root];
  const { manifest } = newProject({ name, width: c.width, height: c.height, fps: c.fps, duration: c.duration });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(dir, f.path)), { recursive: true }); fs.writeFileSync(path.join(dir, f.path), f.data); }
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, DOCUMENT), stringifyDoc(doc));
  const issues = validate(doc, builtinRegistry());
  console.log(`wrote the project ${path.relative(process.cwd(), dir)}: ${Object.values(doc.compositions).reduce((n, x) => n + Object.keys(x.layers).length, 0)} layers, ${files.length} file(s)`);
  for (const w of warnings) console.log(`  attention : ${w}`);
  for (const i of issues) console.log(`  invalid: ${i.path} ${i.message}`);
}

/** every file of a project folder, by its path in the project */
function readFolder(dir: string): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (p !== 'renders' && p !== 'node_modules') walk(p); }
      else files.set(p, new Uint8Array(fs.readFileSync(path.join(dir, p))));
    }
  };
  walk('');
  // a folder of the former name takes today's names
  return migrateProject(files);
}

/** structure (format) then meaning (registry with the project's own plugins) of a project's files */
async function reportProject(files: Map<string, Uint8Array>, label: string) {
  const { issues, doc } = checkProject(files);
  const all = [...issues];
  if (doc && !issues.length) {
    try { all.push(...validate(doc, await filesRegistry(doc, files)).map((i) => ({ path: `${DOCUMENT}${i.path}`, message: i.message }))); }
    catch (e) { all.push({ path: `${DOCUMENT}/plugins`, message: (e as Error).message }); }
  }
  if (all.length) {
    for (const i of all.slice(0, 40)) console.log(`  ${i.path} : ${i.message}`);
    throw new Error(`${label}: ${all.length} issue(s)`);
  }
}

async function cmdPack(dir: string) {
  if (!dir || !fs.existsSync(path.join(dir, MANIFEST))) throw new Error(`no tramme project in ${dir ?? '(none)'} (${MANIFEST} missing)`);
  const files = readFolder(dir);
  for (const k of [...files.keys()]) if (k.startsWith('.tramme/') && !isChatPath(k)) files.delete(k);
  await reportProject(files, dir);
  const out = path.resolve(str('out') ?? `${path.basename(path.resolve(dir))}.tramme`);
  fs.writeFileSync(out, packProject(files));
  console.log(`wrote ${path.relative(process.cwd(), out)} (${files.size} files, ${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}

async function cmdUnpack(file: string) {
  if (!file || !fs.existsSync(file)) throw new Error(`archive not found: ${file ?? '(none)'}`);
  const files = unpackProject(new Uint8Array(fs.readFileSync(file)));
  await reportProject(files, file);
  const dir = path.resolve(str('out') ?? path.basename(file).replace(/\.(tramme|trame|emotion)$/, ''));
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`folder ${dir} exists and is not empty`);
  for (const [p, data] of files) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), data); }
  console.log(`wrote the project ${path.relative(process.cwd(), dir)} (${files.size} files)`);
}

async function cmdNodes(file?: string) {
  const reg = file ? await registryOf(file, readDoc(file)).registry : builtinRegistry();
  for (const n of reg.listNodes()) {
    console.log(`${n.type.padEnd(16)} ${n.title}${n.container ? ' (container)' : ''}`);
    for (const [k, d] of Object.entries(n.props)) console.log(`    ${k.padEnd(14)} ${d.type.padEnd(7)} ${JSON.stringify(d.default)}${d.options ? `  [${d.options.join(', ')}]` : ''}`);
  }
  console.log('\neffets');
  for (const e of reg.listEffects()) console.log(`${e.type.padEnd(16)} ${e.title} (${e.stage === 'finish' ? 'composition' : 'layer'}) : ${Object.keys(e.props).join(', ')}`);
  console.log('\nmodificateurs');
  for (const m of reg.listModifiers()) console.log(`${m.type.padEnd(16)} ${m.title} : ${Object.keys(m.params).join(', ')}`);
  const tools = reg.listTools();
  if (tools.length) {
    console.log('\noutils');
    for (const { tool, from } of tools) console.log(`${tool.name.padEnd(16)} ${tool.title ?? tool.description} (${from}) : ${Object.keys((tool.input?.properties ?? {}) as object).join(', ')}`);
  }
}

function cmdSchema() {
  const out = path.resolve(str('out') ?? 'schema/tramme-1.schema.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(documentJsonSchema(), null, 2) + '\n');
  console.log('wrote', path.relative(process.cwd(), out));
}

const COMMANDS: Record<string, () => Promise<void> | void> = {
  validate: () => cmdValidate(pos[0]),
  still: () => cmdStill(pos[0]),
  render: () => cmdRender(pos[0]),
  compare: () => cmdCompare(pos[0], pos[1]),
  schema: cmdSchema,
  export: () => cmdExport(pos[0]),
  import: () => cmdImport(pos[0]),
  pack: () => cmdPack(pos[0]),
  unpack: () => cmdUnpack(pos[0]),
  nodes: () => cmdNodes(pos[0]),
  bench: async () => { const { bench } = await import('./bench.ts'); await bench(pos[0], { layer: str('layer'), t: num('t'), width: num('width'), height: num('height'), dpr: num('dpr') }); },
  'check-export': async () => {
    const format = str('format') ?? 'lottie';
    if (format !== 'lottie' && format !== 'svg') throw new Error('check-export: --format lottie or svg');
    const { checkExport } = await import('./check-export.ts');
    await checkExport(pos[0], format, String(flags.t ?? '0').split(',').map(Number), path.resolve(str('out') ?? `out/check-${format}`), str('comp'));
  },
  agent: async () => { const { startCompanion } = await import('./companion.ts'); await startCompanion({ port: num('port'), origins: str('origin')?.split(',').filter(Boolean), renew: !!flags.renew }); },
};

const run = COMMANDS[cmd];
if (!run) {
  console.log('usage: tramme <validate|still|render|export|import|pack|unpack|nodes|compare|schema|bench|agent> ... (see the header of packages/cli/src/main.ts)');
  process.exit(cmd ? 1 : 0);
}
try {
  await run();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
