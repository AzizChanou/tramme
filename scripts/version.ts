// The project's version, one for every package and the desktop app. Setting a
// new one on main is what releases it: .github/workflows/desktop.yml publishes
// main's version as soon as it has no tag, with its changelog section as notes.
//   node scripts/version.ts 0.2.0           sets 0.2.0 everywhere it is written, and
//                                           dates the changelog's Unreleased section as 0.2.0
//   node scripts/version.ts --notes 0.2.0   prints the changelog's section of 0.2.0

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const write = (f: string, s: string) => fs.writeFileSync(path.join(root, f), s);
const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const args = process.argv.slice(2);
const notes = args[0] === '--notes';
const version = notes ? args[1] : args[0];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) fail('usage: node scripts/version.ts [--notes] X.Y.Z');

/** the changelog's section of a version: what follows its heading, up to the next one */
function section(changelog: string, v: string): string | undefined {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## [${v}]`));
  if (start < 0) return undefined;
  const end = lines.findIndex((l, i) => i > start && /^## \[|^\[[^\]]+\]: /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

if (notes) {
  const text = section(read('CHANGELOG.md'), version);
  if (!text) fail(`CHANGELOG.md has no section for ${version}: run node scripts/version.ts ${version} before releasing it`);
  console.log(text);
  process.exit(0);
}

const old = (JSON.parse(read('package.json')) as { version: string }).version;
if (old === version) fail(`the version is already ${version}`);

// the changelog: Unreleased becomes the version, dated, and its links follow
let changelog = read('CHANGELOG.md');
if (!section(changelog, 'Unreleased')) fail('the Unreleased section of CHANGELOG.md is empty: nothing to release');
// the local date, as YYYY-MM-DD (Sweden's format)
const today = new Date().toLocaleDateString('sv');
changelog = changelog
  .replace('## [Unreleased]', `## [Unreleased]\n\n## [${version}] - ${today}`)
  .replace(`[Unreleased]: ../../compare/v${old}...HEAD`, `[Unreleased]: ../../compare/v${version}...HEAD\n[${version}]: ../../compare/v${old}...v${version}`);
write('CHANGELOG.md', changelog);

// the packages, edited in place (their layouts differ): their own version, and
// the versions of each other they pin
const escaped = old.replaceAll('.', '\\.');
/** the old version, where it follows `before` (a pattern), becomes the new one */
const bump = (f: string, before: string, flags = '') => write(f, read(f).replace(new RegExp(`(${before})"${escaped}"`, flags), `$1"${version}"`));
const manifests = ['package.json', ...['apps', 'packages'].flatMap((d) => fs.readdirSync(path.join(root, d)).map((p) => `${d}/${p}/package.json`))];
for (const f of manifests.filter((f) => fs.existsSync(path.join(root, f)))) {
  bump(f, '"version": ');
  bump(f, '"@tramme/[^"]+": ', 'g');
}

// npm's lockfile, which npm writes as this does
type Entry = { version?: string; dependencies?: Record<string, string> };
const lock = JSON.parse(read('package-lock.json')) as { version: string; packages: Record<string, Entry> };
lock.version = version;
for (const [where, entry] of Object.entries(lock.packages)) {
  if (where !== '' && !/^(apps|packages)\/[^/]+$/.test(where)) continue;
  if (entry.version === old) entry.version = version;
  for (const [name, range] of Object.entries(entry.dependencies ?? {})) {
    if (name.startsWith('@tramme/') && range === old) entry.dependencies![name] = version;
  }
}
write('package-lock.json', JSON.stringify(lock, null, 2) + '\n');

// the desktop app: Tauri's version (the installers' names), the crate and its lockfile
const tauri = 'apps/desktop/src-tauri';
bump(`${tauri}/tauri.conf.json`, '"version": ');
bump(`${tauri}/Cargo.toml`, '^version = ', 'm');
bump(`${tauri}/Cargo.lock`, 'name = "tramme-desktop"\r?\nversion = ');

console.log(`${old} → ${version}: commit and push to main to release it`);
