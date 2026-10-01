// Builds the anime example (examples/anime): drawings made frame by frame as
// SVG, with the slight wobble of a line redrawn by hand from one drawing to
// the next ("boil") and flat cel colours, turned into PNG in Chrome; then the
// project that animates them with sequence layers.
//
//   node scripts/anime-example.ts

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyDoc, type TrammeDoc, type Layer, type PathValue } from '@tramme/core';
import { launch } from '../packages/cli/src/browser.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'examples', 'anime');
const W = 1920, H = 1080, FPS = 24;
const INK = '#1A1424';

type P = [number, number];
interface Drawing { folder: string; name: string; w: number; h: number; svg: string }

/** the same random numbers every run */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const n = (v: number) => v.toFixed(1);
const svg = (w: number, h: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
/** a hand's wobble: each drawing moves the points a little */
const boil = (r: () => number, amp: number) => (p: P): P => [p[0] + (r() - 0.5) * 2 * amp, p[1] + (r() - 0.5) * 2 * amp];
/** a smooth curve through points (Catmull-Rom as cubic Béziers) */
function curve(pts: P[], closed = false): string {
  const at = (i: number) => pts[closed ? (i + pts.length) % pts.length : Math.max(0, Math.min(pts.length - 1, i))];
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  const last = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += ` C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

// ── grass: a tuft swaying in the wind, 8 drawings ───────────
function grass(): Drawing[] {
  const w = 640, h = 380, base = h - 14;
  const r0 = rand(7);
  const blades = Array.from({ length: 12 }, (_, i) => ({
    x: 110 + (420 * i) / 11 + (r0() - 0.5) * 30,
    h: 150 + r0() * 190,
    w: 18 + r0() * 18,
    lean: (r0() - 0.5) * 0.7,
    ph: r0() * Math.PI * 2,
    back: r0() < 0.4,
  })).sort((a, b) => Number(b.back) - Number(a.back));
  return Array.from({ length: 8 }, (_, i) => {
    const r = rand(100 + i), wob = boil(r, 1.4);
    const phase = (Math.PI * 2 * i) / 8;
    let body = '';
    for (const b of blades) {
      const a = b.lean + Math.sin(phase + b.ph) * 0.22;
      const dir: P = [Math.sin(a), -Math.cos(a)], mid: P = [Math.sin(a * 0.45), -Math.cos(a * 0.45)];
      const tip = wob([b.x + dir[0] * b.h, base + dir[1] * b.h]);
      const m: P = [b.x + mid[0] * b.h * 0.55, base + mid[1] * b.h * 0.55];
      const perp: P = [-mid[1], mid[0]];
      const cl = wob([m[0] - perp[0] * b.w * 0.45, m[1] - perp[1] * b.w * 0.45]);
      const cr = wob([m[0] + perp[0] * b.w * 0.45, m[1] + perp[1] * b.w * 0.45]);
      const bl = wob([b.x - b.w / 2, base]), br = wob([b.x + b.w / 2, base]);
      const dark = b.back ? '#24493F' : '#2F6B55', light = b.back ? '#2F5D50' : '#5FA37A';
      body += `<path d="M${n(bl[0])} ${n(bl[1])} Q${n(cl[0])} ${n(cl[1])} ${n(tip[0])} ${n(tip[1])} Q${n(cr[0])} ${n(cr[1])} ${n(br[0])} ${n(br[1])}Z" fill="${dark}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`;
      // cel highlight on the lit side
      const hb: P = [b.x - b.w * 0.18, base], hc: P = [(cl[0] * 2 + m[0]) / 3, (cl[1] * 2 + m[1]) / 3];
      body += `<path d="M${n(hb[0])} ${n(hb[1])} Q${n(hc[0])} ${n(hc[1])} ${n(tip[0])} ${n(tip[1])} Q${n(m[0])} ${n(m[1])} ${n(b.x + b.w * 0.05)} ${n(base)}Z" fill="${light}"/>`;
    }
    return { folder: 'grass', name: `grass-${String(i + 1).padStart(2, '0')}`, w, h, svg: svg(w, h, body) };
  });
}

// ── eye: closed, opening, open, glint, 6 drawings ───────────
function eye(): Drawing[] {
  const w = 1200, h = 640, L: P = [230, 372], R: P = [970, 336];
  const opens = [0, 0.28, 0.62, 0.9, 1, 1];
  return opens.map((k, i) => {
    const r = rand(300 + i), wob = boil(r, 1.6);
    const brow = [wob([300, 96]), wob([520, 52]), wob([760, 50]), wob([930, 92])];
    let body = `<path d="${curve(brow)}" fill="none" stroke="#2B2140" stroke-width="26" stroke-linecap="round"/>`;
    if (k === 0) {
      // closed: the lash line bends down
      const lid = [wob(L), wob([430, 432]), wob([700, 440]), wob(R)];
      body += `<path d="${curve(lid)}" fill="none" stroke="${INK}" stroke-width="22" stroke-linecap="round"/>`;
      body += `<path d="M${n(R[0] - 30)} ${n(R[1] + 18)} l70 -42 l-24 52Z" fill="${INK}"/>`;
      return { folder: 'eye', name: `eye-${String(i + 1).padStart(2, '0')}`, w, h, svg: svg(w, h, body) };
    }
    const c1 = wob([430, 372 - 290 * k]), c2 = wob([800, 336 - 300 * k]);
    const l1 = wob([440, 486]), l2 = wob([800, 470]);
    const opening = `M${n(L[0])} ${n(L[1])} C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(R[0])} ${n(R[1])} C${n(l2[0])} ${n(l2[1])} ${n(l1[0])} ${n(l1[1])} ${n(L[0])} ${n(L[1])}Z`;
    const cy = 330 + 70 * (1 - k), cx = 600;
    body += `<defs><clipPath id="o"><path d="${opening}"/></clipPath><clipPath id="i"><circle cx="${cx}" cy="${cy}" r="196"/></clipPath></defs>`;
    body += `<path d="${opening}" fill="#FFFFFF"/>`;
    body += `<g clip-path="url(#o)">`;
    body += `<circle cx="${cx}" cy="${cy}" r="196" fill="#3576D8" stroke="#1C3C86" stroke-width="10"/>`;
    body += `<g clip-path="url(#i)"><ellipse cx="${cx}" cy="${cy - 110}" rx="230" ry="150" fill="#22489E"/><ellipse cx="${cx + 10}" cy="${cy + 130}" rx="150" ry="70" fill="#8ED0FF"/></g>`;
    body += `<ellipse cx="${cx}" cy="${cy + 6}" rx="66" ry="88" fill="#0D1530"/>`;
    if (k > 0.5) {
      body += `<ellipse cx="${cx - 80}" cy="${cy - 70}" rx="48" ry="34" transform="rotate(-20 ${cx - 80} ${cy - 70})" fill="#FFFFFF"/><circle cx="${cx + 78}" cy="${cy + 62}" r="18" fill="#FFFFFF"/>`;
    }
    if (i === 5) {
      // the glint: a four-point star on the iris
      const sx = cx - 40, sy = cy - 40, a = 80, b = 14;
      body += `<path d="M${sx} ${sy - a} Q${sx + b} ${sy - b} ${sx + a} ${sy} Q${sx + b} ${sy + b} ${sx} ${sy + a} Q${sx - b} ${sy + b} ${sx - a} ${sy} Q${sx - b} ${sy - b} ${sx} ${sy - a}Z" fill="#FFFFFF"/>`;
    }
    // the shadow of the upper lid on the eye
    body += `<path d="M${n(L[0])} ${n(L[1])} C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(R[0])} ${n(R[1])} L${n(R[0])} ${n(R[1] + 60)} C${n(c2[0])} ${n(c2[1] + 70)} ${n(c1[0])} ${n(c1[1] + 70)} ${n(L[0])} ${n(L[1] + 60)}Z" fill="#2B3E8A" opacity="0.28"/>`;
    body += `</g>`;
    // lids, crease, lashes
    body += `<path d="M${n(L[0] - 6)} ${n(L[1] + 4)} C${n(c1[0])} ${n(c1[1])} ${n(c2[0])} ${n(c2[1])} ${n(R[0] + 8)} ${n(R[1] - 2)}" fill="none" stroke="${INK}" stroke-width="24" stroke-linecap="round"/>`;
    body += `<path d="M${n(R[0] - 20)} ${n(R[1] - 6)} l86 -64 l-36 74Z M${n(R[0] - 70)} ${n(R[1] - 40 - 30 * k)} l60 -70 l-14 78Z" fill="${INK}"/>`;
    body += `<path d="M${n(l1[0] + 60)} ${n(l1[1] - 8)} Q${n((l1[0] + l2[0]) / 2 + 60)} ${n(l1[1] + 4)} ${n(l2[0] + 60)} ${n(l2[1] - 22)}" fill="none" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`;
    if (k > 0.3) body += `<path d="M${n(L[0] + 80)} ${n(L[1] - 150 * k)} Q${n(cx)} ${n(cy - 330 * k)} ${n(R[0] - 40)} ${n(R[1] - 190 * k)}" fill="none" stroke="#7A4E5E" stroke-width="5" stroke-linecap="round" opacity="0.8"/>`;
    return { folder: 'eye', name: `eye-${String(i + 1).padStart(2, '0')}`, w, h, svg: svg(w, h, body) };
  });
}

// ── scarf flapping in the wind, 8 drawings ──────────────────
function scarf(): Drawing[] {
  const w = 1800, h = 760, len = 1640, y0 = 380;
  return Array.from({ length: 8 }, (_, i) => {
    const r = rand(500 + i), wob = boil(r, 1.8);
    const phase = (Math.PI * 2 * i) / 8;
    const center = (x: number): P => {
      const u = x / len;
      return [x, y0 + (18 + 160 * u ** 1.3) * Math.sin((Math.PI * 2 * x) / 820 - phase)];
    };
    const width = (x: number) => 150 - 46 * (x / len);
    const N = 30;
    const top: P[] = [], bot: P[] = [];
    for (let j = 0; j <= N; j++) {
      const x = (len * j) / N, c = center(x), ww = width(x);
      top.push(wob([c[0], c[1] - ww / 2]));
      bot.push(wob([c[0] + 10, c[1] + ww / 2]));
    }
    const outline = `${curve(top)} L${n(bot[N][0])} ${n(bot[N][1])} ${curve([...bot].reverse()).slice(1).replace(/^[^C]*/, (m) => `L${m}`)}Z`;
    let body = `<defs><clipPath id="s"><path d="${outline}"/></clipPath></defs>`;
    body += `<path d="${outline}" fill="#D63A4F"/>`;
    body += `<g clip-path="url(#s)">`;
    // cel shadow along the underside, deeper where the cloth turns away
    const shade: P[] = [];
    for (let j = 0; j <= N; j++) {
      const x = (len * j) / N, c = center(x), ww = width(x);
      const slope = (center(x + 1)[1] - c[1]);
      shade.push([c[0] + 10, c[1] + ww / 2 - ww * (0.28 + 0.25 * Math.max(0, Math.sin((Math.PI * 2 * x) / 820 - phase + 1.2))) - slope * 4]);
    }
    body += `<path d="${curve(shade)} L${n(bot[N][0] + 40)} ${n(bot[N][1] + 60)} L${n(bot[0][0] - 40)} ${n(bot[0][1] + 60)}Z" fill="#9C2238"/>`;
    // two pale stripes near the end
    for (const sx of [1260, 1330]) {
      const a = center(sx), b = center(sx + 30);
      body += `<path d="M${n(a[0] - 4)} ${n(a[1] - 140)} L${n(b[0] + 4)} ${n(b[1] - 140)} L${n(b[0] + 14)} ${n(b[1] + 140)} L${n(a[0] + 6)} ${n(a[1] + 140)}Z" fill="#F4E3D7"/>`;
    }
    body += `</g>`;
    body += `<path d="${outline}" fill="none" stroke="${INK}" stroke-width="7" stroke-linejoin="round"/>`;
    // fringe at the free end
    const end = center(len);
    for (let k = 0; k < 6; k++) {
      const ey = end[1] - width(len) / 2 + 8 + (k * (width(len) - 16)) / 5;
      const sway = Math.sin(phase * 1 + k) * 18;
      const p1 = wob([end[0] + 8, ey]), p2 = wob([end[0] + 46, ey + sway * 0.5]), p3 = wob([end[0] + 78, ey + sway]);
      body += `<path d="${curve([p1, p2, p3])}" fill="none" stroke="${INK}" stroke-width="9" stroke-linecap="round"/><path d="${curve([p1, p2, p3])}" fill="none" stroke="#D63A4F" stroke-width="4" stroke-linecap="round"/>`;
    }
    return { folder: 'scarf', name: `scarf-${String(i + 1).padStart(2, '0')}`, w, h, svg: svg(w, h, body) };
  });
}

// ── speed lines, a new set every frame, 6 drawings ──────────
function speedLines(): Drawing[] {
  return Array.from({ length: 6 }, (_, i) => {
    const r = rand(700 + i);
    let body = '';
    for (let k = 0; k < 30; k++) {
      const y = r() * H, x0 = -200 + r() * 1500, len = 300 + r() * 1000, t = 2 + r() * 9;
      body += `<path d="M${n(x0)} ${n(y)} L${n(x0 + len)} ${n(y - t / 2)} L${n(x0 + len + 24)} ${n(y)} L${n(x0 + len)} ${n(y + t / 2)}Z" fill="#FFFFFF" opacity="${(0.55 + r() * 0.4).toFixed(2)}"/>`;
    }
    return { folder: 'speed-lines', name: `speed-lines-${String(i + 1).padStart(2, '0')}`, w: W, h: H, svg: svg(W, H, body) };
  });
}

// ── rasterise in Chrome ─────────────────────────────────────
async function rasterise(drawings: Drawing[]) {
  const { browser, page } = await launch();
  try {
    await page.goto('about:blank');
    for (const d of drawings) {
      const b64: string = await page.evaluate(async (x) => {
        const img = new Image();
        img.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(x.svg)))}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = x.w; c.height = x.h;
        c.getContext('2d')!.drawImage(img, 0, 0);
        return c.toDataURL('image/png').split(',')[1];
      }, d);
      const file = path.join(OUT, 'assets', d.folder, `${d.name}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    }
  } finally { await browser.close(); }
}

// ── the document ────────────────────────────────────────────
const ids = (ds: Drawing[]) => ds.map((d) => d.name);
const poly = (pts: P[]): PathValue => ({ v: pts, closed: true });
/** a ridge: points of a smooth hill line, closed under the frame */
function ridge(f: (x: number) => number, from = -120, to = W + 120, step = 60): PathValue {
  const pts: P[] = [];
  for (let x = from; x <= to; x += step) pts.push([x, Math.round(f(x))]);
  return poly([...pts, [to, H + 160], [from, H + 160]]);
}
const hill = (x: number) => 840 - 70 * Math.sin((x / W) * Math.PI * 1.1 + 0.3) - 24 * Math.sin(x / 140);

function documentOf(d: { grass: Drawing[]; eye: Drawing[]; scarf: Drawing[]; lines: Drawing[] }): TrammeDoc {
  const assets: TrammeDoc['assets'] = {};
  for (const x of [...d.grass, ...d.eye, ...d.scarf, ...d.lines]) assets[x.name] = { type: 'image', src: `assets/${x.folder}/${x.name}.png`, name: x.name };
  const full = { position: [W / 2, H / 2] };

  // shot 1: the hill at dusk, grass in the wind, petals
  const tufts: Record<string, Layer> = {};
  const tuftSpots: [number, number, number][] = [[140, 1.15, 0], [470, 0.8, 3], [760, 0.95, 5], [1080, 0.7, 2], [1420, 1.05, 6], [1760, 0.85, 1]];
  tuftSpots.forEach(([x, s, off], k) => {
    tufts[`grass${k + 1}`] = {
      type: 'sequence', name: `Grass ${k + 1}`,
      transform: { position: [x, Math.round(hill(x) - (380 / 2 - 14) * s + 6)], scale: [s, s] },
      props: { frames: ids(d.grass), size: [640, 380], hold: 3, loop: 'pingpong', offset: off },
    };
  });
  const hillShot: TrammeDoc['compositions'][string] = {
    name: 'Shot 1 · The hill', width: W, height: H, fps: FPS, duration: 3.5, background: '@night',
    layers: {
      sky: { type: 'shape.rect', name: 'Sky', transform: full, props: { size: [W * 1.3, H * 1.3], fill: { type: 'linear', from: [0, -700], to: [0, 700], stops: [[0, '@night'], [0.55, '@dusk'], [1, '@dawn']] } } },
      sun: {
        type: 'shape.ellipse', name: 'Sun', transform: { position: [1360, 700] }, props: { size: [300, 300], fill: '@sun' },
        effects: [{ id: 'glow', type: 'fx.glow', props: { color: '@sun', radius: 46, strength: 2 } }],
      },
      camera: {
        type: 'group', name: 'Camera',
        transform: {
          anchor: [W / 2, H / 2],
          position: { $k: [{ t: 0, v: [W / 2, H / 2], ease: '@smooth' }, { t: 3.5, v: [W / 2 - 40, H / 2 + 10] }] },
          scale: { $k: [{ t: 0, v: [1, 1], ease: '@smooth' }, { t: 3.5, v: [1.07, 1.07] }] },
        },
        children: ['far', 'mountains', 'hill', ...Object.keys(tufts), 'front1', 'front2'],
      },
      far: { type: 'shape.path', name: 'Distant mountains', props: { path: poly([[-200, 690], [120, 520], [330, 600], [560, 440], [780, 590], [1000, 470], [1230, 610], [1460, 500], [1700, 640], [2120, 520], [2120, 1300], [-200, 1300]]), fill: '@haze' } },
      mountains: { type: 'shape.path', name: 'Mountains', props: { path: poly([[-200, 760], [180, 610], [420, 700], [700, 560], [960, 720], [1260, 600], [1540, 730], [1800, 640], [2120, 740], [2120, 1300], [-200, 1300]]), fill: '@mountain', stroke: '@ink', strokeWidth: 4 } },
      hill: { type: 'shape.path', name: 'Hill', props: { path: ridge(hill), fill: '@hill', stroke: '@ink', strokeWidth: 5 } },
      ...tufts,
      // foreground tufts in silhouette, larger, for depth
      front1: { type: 'sequence', name: 'Grass (front)', transform: { position: [150, 1010], scale: [2.1, 2.1] }, props: { frames: ids(d.grass), size: [640, 380], hold: 2, loop: 'pingpong', offset: 4 }, effects: [{ id: 'shade', type: 'fx.tint', props: { color: '#121829', amount: 0.92 } }] },
      front2: { type: 'sequence', name: 'Grass (front)', transform: { position: [1780, 1030], scale: [-1.8, 1.8] }, props: { frames: ids(d.grass), size: [640, 380], hold: 2, loop: 'pingpong', offset: 1 }, effects: [{ id: 'shade', type: 'fx.tint', props: { color: '#121829', amount: 0.92 } }] },
      petals: {
        type: 'particles', name: 'Petals', transform: { position: [-160, 420] },
        props: { emitter: 'rect', emitterSize: [200, 900], direction: 12, spread: 24, speed: 210, speedVar: 0.4, gravity: [0, 26], drag: 0.05, spin: 220, size: 11, sizeVar: 0.45, shape: 'square', color: '@petal', colorEnd: '#F49AB5', life: 10, fadeOut: 0.12, rate: 14, preroll: 7, seed: 3 },
      },
    },
    order: ['sky', 'sun', 'camera', 'petals'],
  };

  // shot 2: the eye opens, blinks, a glint
  const gaze: TrammeDoc['compositions'][string] = {
    name: 'Shot 2 · The gaze', width: W, height: H, fps: FPS, duration: 2.5, background: '@skin',
    layers: {
      cheek: { type: 'shape.ellipse', name: 'Cheek', transform: { position: [1460, 940] }, props: { size: [760, 300], fill: 'rgba(240,130,150,0.38)' }, effects: [{ id: 'blur', type: 'fx.blur', props: { radius: 60 } }] },
      eye: {
        type: 'sequence', name: 'Eye',
        transform: { position: [W / 2, 590], scale: { $k: [{ t: 0, v: [1, 1], ease: '@smooth' }, { t: 2.5, v: [1.06, 1.06] }] } },
        props: { frames: ids(d.eye), size: [1200, 640], loop: 'once', sheet: '1/10, 2-4/2, 5/14, 4/1, 3/1, 2/1, 1/2, 2-4/1, 6/14' },
      },
      lock1: { type: 'shape.path', name: 'Hair lock', transform: { rotation: { $v: 0, $mod: [{ type: 'wiggle', freq: 0.8, amp: 1.2 }] } }, props: { path: poly([[1100, -40], [1300, -40], [1240, 180], [1180, 330], [1150, 210]]), fill: '@hair', stroke: '@ink', strokeWidth: 5 } },
      lock2: { type: 'shape.path', name: 'Hair lock', transform: { rotation: { $v: 0, $mod: [{ type: 'wiggle', freq: 0.7, amp: 1, seed: 4 }] } }, props: { path: poly([[1260, -40], [1500, -40], [1420, 120], [1340, 250], [1330, 120]]), fill: '@hair', stroke: '@ink', strokeWidth: 5 } },
    },
    order: ['cheek', 'eye', 'lock1', 'lock2'],
  };

  // shot 3: the scarf in the wind, speed lines, the title
  const wind: TrammeDoc['compositions'][string] = {
    name: 'Shot 3 · The wind', width: W, height: H, fps: FPS, duration: 3, background: '@day-low',
    layers: {
      sky: { type: 'shape.rect', name: 'Sky', transform: full, props: { size: [W, H], fill: { type: 'linear', from: [0, -540], to: [0, 540], stops: [[0, '@day-high'], [1, '@day-low']] } } },
      cloud1: { type: 'shape.ellipse', name: 'Cloud', transform: { position: { $k: [{ t: 0, v: [420, 260] }, { t: 3, v: [180, 260] }] } }, props: { size: [520, 120], fill: 'rgba(255,255,255,0.85)' }, effects: [{ id: 'blur', type: 'fx.blur', props: { radius: 8 } }] },
      cloud2: { type: 'shape.ellipse', name: 'Cloud', transform: { position: { $k: [{ t: 0, v: [1500, 170] }, { t: 3, v: [1300, 170] }] } }, props: { size: [380, 90], fill: 'rgba(255,255,255,0.75)' }, effects: [{ id: 'blur', type: 'fx.blur', props: { radius: 8 } }] },
      speed: { type: 'sequence', name: 'Speed lines', transform: { ...full, opacity: 0.6 }, props: { frames: ids(d.lines), size: [W, H], fit: 'fill', hold: 1 } },
      scarf: {
        type: 'sequence', name: 'Scarf',
        transform: { position: [W / 2 - 60, 520], rotation: { $v: -4, $mod: [{ type: 'wiggle', freq: 1.1, amp: 1.5 }] } },
        props: { frames: ids(d.scarf), size: [1800, 760], hold: 2 },
      },
      petals: {
        type: 'particles', name: 'Petals', transform: { position: [-120, 540] },
        props: { emitter: 'rect', emitterSize: [120, 1100], direction: 4, spread: 10, speed: 900, speedVar: 0.35, gravity: [0, 40], drag: 0, spin: 400, size: 12, sizeVar: 0.5, shape: 'square', color: '@petal', life: 3, fadeOut: 0.1, rate: 40, preroll: 2, seed: 9 },
      },
      title: {
        type: 'text', name: 'Title', in: 0.7,
        transform: {
          position: { $k: [{ t: 0.7, v: [1860, 980], ease: '@snappy' }, { t: 1.3, v: [1800, 980] }] },
          opacity: { $k: [{ t: 0.7, v: 0 }, { t: 1.1, v: 1 }] },
        },
        props: { text: 'The wind rises', size: 128, weight: 800, tracking: -0.01, color: '@white', align: 'right' },
        effects: [{ id: 'shadow', type: 'fx.shadow', props: { color: 'rgba(40,24,70,0.5)', blur: 26, offset: [0, 10] } }],
      },
      flash: { type: 'shape.rect', name: 'Flash', transform: { ...full, opacity: { $k: [{ t: 0, v: 0.9 }, { t: 0.3, v: 0 }] } }, props: { size: [W, H], fill: '#FFFFFF' } },
    },
    order: ['sky', 'cloud1', 'cloud2', 'speed', 'scarf', 'petals', 'title', 'flash'],
  };

  const shot = (comp: string, name: string, at: number, out: number): Layer => ({ type: 'comp', name, in: at, out, transform: full, props: { comp } });
  return {
    schema: 'tramme/1',
    meta: { title: 'Evening Breeze', description: 'Example anime: frame-by-frame drawings in sequences (grass, eye, scarf, speed lines), exposure sheet, three shots.' },
    tokens: {
      night: { type: 'color', value: '#1E2A5C' }, dusk: { type: 'color', value: '#8E5B9A' }, dawn: { type: 'color', value: '#F6A86B' },
      sun: { type: 'color', value: '#FFE3A3' }, haze: { type: 'color', value: '#6E5F92' }, mountain: { type: 'color', value: '#3A3866' },
      hill: { type: 'color', value: '#1F2B45' }, ink: { type: 'color', value: INK }, petal: { type: 'color', value: '#F9C3D3' },
      skin: { type: 'color', value: '#F7D9C4' }, hair: { type: 'color', value: '#2B2140' }, white: { type: 'color', value: '#FFFFFF' },
      'day-high': { type: 'color', value: '#7FB2EE' }, 'day-low': { type: 'color', value: '#F6E3C4' },
      smooth: { type: 'ease', value: [0.42, 0, 0.58, 1] }, snappy: { type: 'ease', value: [0.16, 1, 0.3, 1] },
    },
    assets,
    root: 'anime',
    compositions: {
      anime: {
        name: 'Evening Breeze', width: W, height: H, fps: FPS, duration: 9, background: '@night',
        motionBlur: { samples: 4, shutter: 0.5 },
        markers: [
          { id: 'hill', t: 0, label: 'The hill', kind: 'scene' },
          { id: 'gaze', t: 3.5, label: 'The gaze', kind: 'cut' },
          { id: 'wind', t: 6, label: 'The wind', kind: 'cut' },
        ],
        effects: [
          { id: 'vignette', type: 'look.vignette', props: { amount: 0.28 } },
          { id: 'bloom', type: 'look.bloom', props: { amount: 0.18, threshold: 0.75 } },
          { id: 'grain', type: 'look.grain', props: { amount: 0.025, seed: { $expr: 'frame + 1' } } },
        ],
        layers: {
          shot1: shot('hill', 'Shot 1 · The hill', 0, 3.5),
          shot2: shot('gaze', 'Shot 2 · The gaze', 3.5, 6),
          shot3: shot('wind', 'Shot 3 · The wind', 6, 9),
          fade: { type: 'shape.rect', name: 'Fade', transform: { ...full, opacity: { $k: [{ t: 0, v: 1 }, { t: 0.6, v: 0 }, { t: 8.4, v: 0 }, { t: 9, v: 1 }] } }, props: { size: [W, H], fill: '#000000' } },
        },
        order: ['shot1', 'shot2', 'shot3', 'fade'],
      },
      hill: hillShot, gaze, wind,
    },
  } as TrammeDoc;
}

const drawings = { grass: grass(), eye: eye(), scarf: scarf(), lines: speedLines() };
fs.rmSync(path.join(OUT, 'assets'), { recursive: true, force: true });
await rasterise([...drawings.grass, ...drawings.eye, ...drawings.scarf, ...drawings.lines]);
const doc = documentOf(drawings);
fs.writeFileSync(path.join(OUT, 'document.tramme.json'), stringifyDoc({ $schema: '../../schema/tramme-1.schema.json', ...doc }));
const now = new Date().toISOString();
const manifestFile = path.join(OUT, 'tramme.json');
const previous = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
const created = previous.created ?? now;
// the thumbnail made by scripts/example-thumbnails.ts is kept
const thumbnail = previous.thumbnail && fs.existsSync(path.join(OUT, previous.thumbnail)) ? { thumbnail: previous.thumbnail } : {};
fs.writeFileSync(manifestFile, JSON.stringify({ format: 'tramme-project/1', id: 'example-anime', name: 'Evening Breeze', created, modified: now, width: W, height: H, duration: 9, ...thumbnail }, null, 2) + '\n');
console.log(`wrote ${path.relative(ROOT, OUT)}: ${Object.keys(doc.assets).length} drawings`);
