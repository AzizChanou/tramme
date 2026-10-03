// tramme's built-in sound library, made from Kenney's packs (CC0, public
// domain: www.kenney.nl): downloads the packs, keeps the sounds useful for
// motion design, measures each one in Chrome (the decoder of the editor) and
// writes sounds/<pack>/<name>.ogg and sounds/catalog.json.
//
//   node scripts/sound-library.ts [folder of the unzipped packs]
//
// Run again after changing the selection below; the catalog follows the files.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { soundFigures, type SoundEntry } from '@tramme/core';
import { launch } from '../packages/cli/src/browser.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'sounds');

/** the packs, their sounds kept (by file name), and what each kind of name is */
interface Pack { name: string; url: string; keep: RegExp; describe(base: string): { kind: string; tags: string[] } }

/** the words of a file name: camelCase, digits and underscores apart, numbers left out */
const split = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').toLowerCase().split(/[\s_]+/).filter((w) => w && !/^\d+$/.test(w));
/** the jingles' prefix says nothing: "jingles_HIT00" is the first orchestra hit jingle */
const plain = (base: string) => base.replace(/^jingles_/, 'jingle_');

const PACKS: Pack[] = [
  {
    name: 'impact', url: 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip',
    keep: /^impact/,
    describe(base) {
      const [, material = 'generic', weight = 'medium'] = /^impact([A-Z][a-z]+)(?:_([a-z]+))?/.exec(base) ?? [];
      const m = material.toLowerCase();
      const kind = m === 'bell' ? 'chime' : 'impact';
      return { kind, tags: ['impact', 'hit', m, weight, ...(m === 'punch' ? ['punch', 'body', 'fight'] : []), ...(m === 'soft' ? ['thud', 'cushion'] : []), ...(m === 'glass' ? ['glass', 'break'] : [])] };
    },
  },
  {
    name: 'interface', url: 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip',
    keep: /./,
    describe(base) {
      const w = split(base)[0];
      const kind = ({ click: 'click', select: 'click', tick: 'click', switch: 'click', toggle: 'click', scroll: 'click', back: 'click', confirmation: 'chime', glass: 'chime', bong: 'chime', pluck: 'chime', error: 'alert', question: 'alert', glitch: 'glitch', scratch: 'glitch', open: 'ui', maximize: 'ui', close: 'ui', minimize: 'ui', drop: 'pop' } as Record<string, string>)[w] ?? 'ui';
      return { kind, tags: ['interface', 'ui', w, ...(w === 'confirmation' ? ['success', 'positive', 'done'] : []), ...(w === 'error' ? ['fail', 'negative', 'wrong'] : []), ...(['open', 'maximize'].includes(w) ? ['appear', 'in'] : []), ...(['close', 'minimize'].includes(w) ? ['disappear', 'out'] : [])] };
    },
  },
  {
    name: 'digital', url: 'https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip',
    keep: /^(?!Preview)/,
    describe(base) {
      const w = split(base), first = w[0], name = w.join(' ');
      const kind = /up/.test(name) && !/pep/.test(name) ? 'riser' : /down/.test(name) ? 'fall' : /laser|zap/.test(name) ? 'zap' : /tone/.test(name) ? 'chime' : first === 'pep' ? 'pop' : 'glitch';
      return { kind, tags: ['digital', 'game', 'retro', 'synth', ...w, ...(kind === 'riser' ? ['power', 'up', 'positive'] : []), ...(kind === 'fall' ? ['down', 'negative'] : [])] };
    },
  },
  {
    name: 'ui', url: 'https://kenney.nl/media/pages/assets/ui-audio/490d233f68-1677590494/kenney_ui-audio.zip',
    keep: /^(rollover\d|click\d|mouseclick|mouserelease|switch([1-9]|1[0-2])\b)/,
    describe(base) {
      const w = split(base)[0];
      return { kind: w === 'rollover' ? 'ui' : 'click', tags: ['interface', 'ui', 'button', w, ...(w === 'rollover' ? ['hover'] : [])] };
    },
  },
  {
    name: 'jingle', url: 'https://kenney.nl/media/pages/assets/music-jingles/f37e530b9e-1677590399/kenney_music-jingles.zip',
    keep: /^jingles_/,
    describe(base) {
      const style = ({ NES: '8-bit', HIT: 'orchestra hit', PIZZI: 'pizzicato strings', SAX: 'saxophone', STEEL: 'steel drums' } as Record<string, string>)[/jingles_([A-Z]+)/.exec(base)?.[1] ?? ''] ?? 'music';
      return { kind: 'sting', tags: ['jingle', 'sting', 'music', 'logo', 'outro', ...style.split(' ')] };
    },
  },
  {
    name: 'scifi', url: 'https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip',
    keep: /^(forceField|explosionCrunch|lowFrequency_explosion|laser|door|computerNoise|impactMetal|slime)/,
    describe(base) {
      const w = split(base), name = w.join(' ');
      const kind = /explosion/.test(name) ? 'boom' : /laser/.test(name) ? 'zap' : /door/.test(name) ? 'mechanical' : /computer/.test(name) ? 'glitch' : /impact/.test(name) ? 'impact' : /force/.test(name) ? 'energy' : 'foley';
      return { kind, tags: ['sci-fi', 'space', 'tech', ...w] };
    },
  },
];

/** "Impact metal heavy 1": the words, then the number of the variant counted from 1 */
const title = (base: string) => {
  const n = /(\d+)$/.exec(base)?.[1];
  const w = split(plain(base));
  return `${w.map((x, i) => (i ? x : x[0].toUpperCase() + x.slice(1))).join(' ')}${n !== undefined ? ` ${Number(n) + (/^0/.test(n) ? 1 : 0)}` : ''}`;
};
const slug = (pack: string, base: string) => `${pack}-${base.replace(/^jingles_/, '')}`.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const familyOf = (pack: string, base: string) => slug(pack, base.replace(/_?\d+$/, ''));

async function packFiles(pack: Pack, from: string | undefined): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  if (from) {
    const dir = fs.readdirSync(from).map((d) => path.join(from, d)).find((d) => fs.statSync(d).isDirectory() && d.includes(pack.url.split('/').pop()!.replace('.zip', '')));
    if (!dir) throw new Error(`pack not found in ${from}: ${pack.url}`);
    const walk = (d: string): string[] => fs.readdirSync(d).flatMap((f) => (fs.statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
    for (const f of walk(dir)) if (f.endsWith('.ogg')) files.set(path.basename(f), fs.readFileSync(f));
  } else {
    const res = await fetch(pack.url);
    if (!res.ok) throw new Error(`${pack.url}: HTTP ${res.status}`);
    for (const [name, data] of Object.entries(unzipSync(new Uint8Array(await res.arrayBuffer())))) if (name.endsWith('.ogg')) files.set(path.basename(name), Buffer.from(data));
  }
  return new Map([...files].filter(([name]) => pack.keep.test(name.replace(/\.ogg$/, ''))).sort(([a], [b]) => a.localeCompare(b)));
}

const { browser, page } = await launch({ quiet: true });
try {
  await page.goto('about:blank');
  /** decoded by Chrome, back as 16-bit channels */
  const decode = async (data: Buffer) => {
    const out: { rate: number; channels: string[] } = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const buf = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(bytes.buffer);
      const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => {
        const d = buf.getChannelData(c), i16 = new Int16Array(d.length);
        for (let i = 0; i < d.length; i++) i16[i] = Math.max(-1, Math.min(1, d[i])) * 32767;
        const u8 = new Uint8Array(i16.buffer);
        let s = '';
        for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
        return btoa(s);
      });
      return { rate: buf.sampleRate, channels };
    }, data.toString('base64'));
    return { rate: out.rate, channels: out.channels.map((c) => { const b = Buffer.from(c, 'base64'); const i16 = new Int16Array(b.buffer, b.byteOffset, b.length / 2); return Float32Array.from(i16, (v) => v / 32767); }) };
  };

  fs.rmSync(OUT, { recursive: true, force: true });
  const entries: SoundEntry[] = [];
  let bytes = 0;
  for (const pack of PACKS) {
    const files = await packFiles(pack, process.argv[2]);
    fs.mkdirSync(path.join(OUT, pack.name), { recursive: true });
    for (const [name, data] of files) {
      const base = name.replace(/\.ogg$/, '');
      const { rate, channels } = await decode(data);
      const f = soundFigures(channels, rate);
      const { kind, tags } = pack.describe(base);
      const file = `${pack.name}/${name}`;
      fs.writeFileSync(path.join(OUT, file), data);
      bytes += data.length;
      entries.push({ id: slug(pack.name, base), title: title(base), kind, tags: [...new Set(tags)], family: familyOf(pack.name, base), source: 'built-in', file, duration: f.duration, peakAt: f.peakAt, peakDb: f.peakDb, loudDb: f.loudDb, license: 'CC0', author: 'Kenney (www.kenney.nl)' });
    }
    console.log(`${pack.name}: ${files.size} sounds`);
  }
  // a family of one is no family
  const count = new Map<string, number>();
  for (const e of entries) count.set(e.family!, (count.get(e.family!) ?? 0) + 1);
  for (const e of entries) if (count.get(e.family!) === 1) delete e.family;
  fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify({ version: 1, sounds: entries }, null, 1) + '\n');
  fs.writeFileSync(path.join(OUT, 'LICENSE.txt'), [
    'The sounds of this folder are by Kenney (www.kenney.nl), from the packs Impact Sounds, Interface Sounds, Digital Audio,',
    'UI Audio, Music Jingles and Sci-fi Sounds, released under Creative Commons Zero (CC0 1.0, public domain):',
    'http://creativecommons.org/publicdomain/zero/1.0/',
    'Free to use in personal, educational and commercial projects; crediting Kenney is welcome, not required.',
    '',
  ].join(os.EOL));
  console.log(`${entries.length} sounds, ${(bytes / 1e6).toFixed(1)} MB -> ${path.relative(process.cwd(), OUT)}`);
} finally {
  await browser.close();
}
