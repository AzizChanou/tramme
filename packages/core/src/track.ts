// Tracks: where something is in a video over time. The track tool follows
// what the user framed once, at authoring time, and saves it as a JSON asset:
// times are those of the file and boxes fractions of its picture, so a callout
// stays on the object when the video layer is moved, scaled or cut otherwise.
// The render reads it with pure functions of t (trackReader): the callout
// node, and expressions through track().

import { applyMat, layerMatrix, lastIndex } from './math.ts';
import type { Rect } from './registry.ts';
import type { Vec2 } from './types.ts';

/** a box as fractions of the picture: [x, y, width, height] */
export type Box = [number, number, number, number];

export interface Track {
  version: 1;
  kind: 'track';
  /** the video asset followed */
  source?: string;
  /** what was followed ('car') */
  name?: string;
  /** the picture's size (px): its proportions place the boxes in a frame */
  width: number;
  height: number;
  /** a look at the file every few frames: its time (s) and the object's box, null where it was lost */
  frames: { t: number; box: Box | null }[];
}

export const isTrack = (x: unknown): x is Track =>
  !!x && typeof x === 'object' && (x as Track).kind === 'track' && Array.isArray((x as Track).frames);

/** the asset id of a video's track */
export const trackId = (asset: string, name: string) => `track-${asset}-${name}`.slice(0, 64);

// ── on screen ────────────────────────────────────────────────
/** where a picture of picW × picH sits in a frame of w × h centred on the origin, as the video node draws it */
export function pictureRect(fit: string, w: number, h: number, picW: number, picH: number): Rect {
  if (fit === 'fill' || !(picW > 0) || !(picH > 0)) return { x: -w / 2, y: -h / 2, w, h };
  const s = fit === 'contain' ? Math.min(w / picW, h / picH) : Math.max(w / picW, h / picH);
  return { x: (-picW * s) / 2, y: (-picH * s) / 2, w: picW * s, h: picH * s };
}

/** a video layer as it is placed: its frame, its fit, its own transform */
export interface VideoPlacement { size: Vec2; fit: string; transform: { anchor: Vec2; position: Vec2; scale: Vec2; rotation: number } }

/** a box of a picture on screen, in the space the video layer sits in; inside: its middle shows in the layer's frame (cover crops) */
export function placeBox(picW: number, picH: number, box: Box, v: VideoPlacement): { rect: Rect; inside: boolean } {
  const [w, h] = v.size, r = pictureRect(v.fit, w, h, picW, picH), m = layerMatrix(v.transform);
  const at = (u: number, k: number): Vec2 => [r.x + u * r.w, r.y + k * r.h];
  const pts = [at(box[0], box[1]), at(box[0] + box[2], box[1]), at(box[0], box[1] + box[3]), at(box[0] + box[2], box[1] + box[3])].map((p) => applyMat(m, p));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), [cx, cy] = at(box[0] + box[2] / 2, box[1] + box[3] / 2);
  return {
    rect: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
    inside: Math.abs(cx) <= w / 2 && Math.abs(cy) <= h / 2,
  };
}

// ── reading at render time ───────────────────────────────────
interface Looks { times: number[]; boxes: (Box | null)[]; step: number }
const looks = new WeakMap<Track, Looks>();

function looksOf(track: Track): Looks {
  let l = looks.get(track);
  if (!l) {
    // a track may be written by hand: looks without a time are left out
    const frames = track.frames.filter((f) => !!f && Number.isFinite(f.t)).sort((a, b) => a.t - b.t);
    const times = frames.map((f) => f.t), n = times.length;
    const boxes = frames.map((f) => (Array.isArray(f.box) && f.box.length === 4 && f.box.every(Number.isFinite) ? f.box : null));
    l = { times, boxes, step: n > 1 ? (times[n - 1] - times[0]) / (n - 1) : 0.1 };
    looks.set(track, l);
  }
  return l;
}

/** the box at file time t, between the two nearest looks; null where the object was lost or out of the track */
function boxAt(l: Looks, t: number): Box | null {
  const n = l.times.length, i = lastIndex(l.times, t);
  if (!n) return null;
  if (i < 0) return t >= l.times[0] - l.step / 2 ? l.boxes[0] : null;
  if (i >= n - 1) return t <= l.times[n - 1] + l.step / 2 ? l.boxes[n - 1] : null;
  const a = l.boxes[i], b = l.boxes[i + 1], k = (t - l.times[i]) / (l.times[i + 1] - l.times[i]);
  if (!a || !b) return k < 0.5 ? a : b;
  return a.map((x, j) => x + (b[j] - x) * k) as Box;
}

/** where the object is at file time t, averaged over `smooth` seconds: found is the share of that span where it was seen, 0..1 */
export function trackAt(track: unknown, t: number, smooth = 0.2): { found: number; box: Box } {
  if (!isTrack(track)) return { found: 0, box: [0, 0, 0, 0] };
  const l = looksOf(track), taps = smooth > 0 ? 9 : 1, sum: Box = [0, 0, 0, 0];
  let weights = 0, seen = 0;
  for (let k = 0; k < taps; k++) {
    // a tent of nine taps across the span
    const u = taps === 1 ? 0 : k / (taps - 1) - 0.5, w = 1 - Math.abs(u) * 1.6, b = boxAt(l, t + u * smooth);
    weights += w;
    if (b) { seen += w; for (let j = 0; j < 4; j++) sum[j] += b[j] * w; }
  }
  return seen > 0 ? { found: seen / weights, box: sum.map((x) => x / seen) as Box } : { found: 0, box: [0, 0, 0, 0] };
}

/** a tracked object at one instant, on screen */
export interface TrackReader {
  /** how surely it shows now, 0..1: 0 when lost, out of the track, or out of the layer's frame */
  found: number;
  /** its box [x, y, width, height], in the space the video layer sits in (the composition for a layer at the root) */
  box: [number, number, number, number];
  center: Vec2;
  size: Vec2;
}

const NOWHERE: TrackReader = { found: 0, box: [0, 0, 0, 0], center: [0, 0], size: [0, 0] };

/** a track read at file time t through the video layer that shows it; nowhere without the track or the layer */
export function trackReader(track: unknown, t: number, video: VideoPlacement | null, smooth = 0.2): TrackReader {
  if (!isTrack(track) || !video) return NOWHERE;
  const s = trackAt(track, t, smooth);
  if (!s.found) return NOWHERE;
  const { rect: r, inside } = placeBox(track.width, track.height, s.box, video);
  return inside ? { found: s.found, box: [r.x, r.y, r.w, r.h], center: [r.x + r.w / 2, r.y + r.h / 2], size: [r.w, r.h] } : NOWHERE;
}

// ── following, at authoring time ─────────────────────────────
/** a picture as luma (0..1) */
export interface GrayFrame { width: number; height: number; data: Float32Array }

/** a picture as luma, from its RGBA pixels */
export function grayFrame(rgba: ArrayLike<number>, width: number, height: number): GrayFrame {
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
  return { width, height, data };
}

/** bilinear luma at (x, y), in pixels, the edges repeated */
function lumaAt(f: GrayFrame, x: number, y: number): number {
  const fx = Math.min(f.width - 1, Math.max(0, x - 0.5)), fy = Math.min(f.height - 1, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(f.width - 1, x0 + 1), y1 = Math.min(f.height - 1, y0 + 1), dx = fx - x0, dy = fy - y0, d = f.data, w = f.width;
  return (d[y0 * w + x0] * (1 - dx) + d[y0 * w + x1] * dx) * (1 - dy) + (d[y1 * w + x0] * (1 - dx) + d[y1 * w + x1] * dx) * dy;
}

/** a vector with no mean and a length of one; null when it is flat */
function unit(v: Float32Array): Float32Array | null {
  let mean = 0, norm = 0;
  for (const x of v) mean += x;
  mean /= v.length;
  for (let k = 0; k < v.length; k++) { v[k] -= mean; norm += v[k] * v[k]; }
  norm = Math.sqrt(norm);
  if (norm < 0.002 * Math.sqrt(v.length)) return null;
  for (let k = 0; k < v.length; k++) v[k] /= norm;
  return v;
}

/** a box of a frame resampled to tw × th cells (four taps a cell), ready to compare */
function patch(f: GrayFrame, b: Rect, tw: number, th: number): Float32Array | null {
  const out = new Float32Array(tw * th), cw = b.w / tw, ch = b.h / th;
  for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
    const x = b.x + (i + 0.25) * cw, y = b.y + (j + 0.25) * ch;
    out[j * tw + i] = (lumaAt(f, x, y) + lumaAt(f, x + cw / 2, y) + lumaAt(f, x, y + ch / 2) + lumaAt(f, x + cw / 2, y + ch / 2)) / 4;
  }
  return unit(out);
}

const dot = (a: Float32Array, b: Float32Array) => { let s = 0; for (let k = 0; k < a.length; k++) s += a[k] * b[k]; return s; };
const middle = (b: Rect): Vec2 => [b.x + b.w / 2, b.y + b.h / 2];

/** a box kept on the frame: its middle inside, its size between 4 px and the frame's */
function onFrame(b: Rect, f: GrayFrame): Rect {
  const w = Math.min(f.width, Math.max(4, b.w)), h = Math.min(f.height, Math.max(4, b.h));
  const [cx, cy] = middle(b), x = Math.min(f.width, Math.max(0, cx)), y = Math.min(f.height, Math.max(0, cy));
  return { x: x - w / 2, y: y - h / 2, w, h };
}

/**
 * The place of a template in a frame around where it was (moved by its
 * speed), at three scales: a grid as fine as the template's cells, then the
 * three best places apart from each other, each refined, so a repeated texture
 * does not lure the search a period away. A place is worth its match, a little
 * less far from where it was expected or at another scale.
 */
function search(f: GrayFrame, b: Rect, tpl: Float32Array, v: Vec2, tw: number, th: number, widen: number): { box: Rect; score: number } {
  const [px, py] = middle(b), cx = px + v[0], cy = py + v[1];
  const reach = (Math.max(4, 0.5 * Math.max(b.w, b.h)) + Math.hypot(v[0], v[1])) * widen, step = Math.max(b.w / tw, reach / 8);
  const at = (x: number, y: number, s: number) => {
    const w = b.w * s, h = b.h * s, p = patch(f, { x: x - w / 2, y: y - h / 2, w, h }, tw, th), score = p ? dot(tpl, p) : -2;
    return { x, y, s, score, worth: score - (0.05 * Math.hypot(x - cx, y - cy)) / reach - 0.3 * Math.abs(Math.log(s)) };
  };
  const grid = [];
  for (const s of [0.94, 1, 1.06]) for (let dy = -reach; dy <= reach + 1e-9; dy += step) for (let dx = -reach; dx <= reach + 1e-9; dx += step) grid.push(at(cx + dx, cy + dy, s));
  grid.sort((p, q) => q.worth - p.worth);
  const seeds: typeof grid = [];
  for (const g of grid) {
    if (seeds.every((q) => Math.hypot(q.x - g.x, q.y - g.y) > step * 1.5)) seeds.push(g);
    if (seeds.length === 3) break;
  }
  let best = seeds[0];
  for (let c of seeds) {
    for (let h = step / 2; h > 0.3; h /= 2) {
      let top = c;
      for (const dy of [-h, 0, h]) for (const dx of [-h, 0, h]) { const n = at(c.x + dx, c.y + dy, c.s); if (n.worth > top.worth) top = n; }
      c = top;
    }
    if (c.worth > best.worth) best = c;
  }
  const w = b.w * best.s, h = b.h * best.s;
  return { box: { x: best.x - w / 2, y: best.y - h / 2, w, h }, score: best.score };
}

export type Followed = ({ box: Rect; score: number } | null)[];

export interface FollowOptions {
  /** the least match that counts, 0..1 */
  minScore?: number;
  /** frames in a row without the object before it is given up */
  maxLost?: number;
  /** cuts[i]: a cut between frames i - 1 and i, found by the caller: past it the object is in another shot */
  cuts?: ArrayLike<boolean>;
}

/**
 * Follows what is inside `box` (pixels of frames[start]) through the frames
 * after and before it: its box in each, null where it is lost. A template of
 * the object is looked for around its last place, moved by its speed, at three
 * scales (normalised cross-correlation); it takes in slow changes of look. A
 * match counts when it is close to the object's usual score, not only above
 * minScore. A cut ends the track in that direction, as do maxLost frames
 * without the object.
 */
export function followBox(frames: GrayFrame[], start: number, box: Rect, opts: FollowOptions = {}): Followed {
  const steps = following(frames, start, box, opts);
  let s = steps.next();
  while (!s.done) s = steps.next();
  return s.value;
}

/** followBox a frame at a time, so a long track can leave the page room to breathe: yields the frames done */
export function* following(frames: GrayFrame[], start: number, box: Rect, { minScore = 0.5, maxLost = 12, cuts }: FollowOptions = {}): Generator<number, Followed> {
  const out: Followed = frames.map(() => null), b0 = onFrame(box, frames[start]);
  let done = 1;
  // about 20 cells on the long side, in the box's proportions
  const tw = Math.max(6, Math.round(b0.w >= b0.h ? 20 : (20 * b0.w) / b0.h)), th = Math.max(6, Math.round(b0.h >= b0.w ? 20 : (20 * b0.h) / b0.w));
  const first = patch(frames[start], b0, tw, th);
  if (!first) throw new Error('nothing to follow there: the area is flat');
  out[start] = { box: b0, score: 1 };
  for (const dir of [1, -1]) {
    let b = b0, tpl = first, v: Vec2 = [0, 0], lost = 0, usual = 1;
    for (let i = start + dir; i >= 0 && i < frames.length; i += dir) {
      yield done++;
      // a cut between this frame and the one before it in this direction: the object is in another shot, or gone
      if (cuts?.[dir > 0 ? i : i + 1]) break;
      const f = frames[i], found = search(f, b, tpl, v, tw, th, 1 + lost * 0.5);
      if (found.score < Math.max(minScore, 0.7 * usual)) { if (++lost > maxLost) break; continue; }
      usual = 0.8 * usual + 0.2 * found.score;
      const [x0, y0] = middle(b), [x1, y1] = middle(found.box);
      v = lost ? [0, 0] : [0.6 * v[0] + 0.4 * (x1 - x0), 0.6 * v[1] + 0.4 * (y1 - y0)];
      // the size settles slowly: three scales are a coarse measure
      const w = 0.7 * b.w + 0.3 * found.box.w, h = 0.7 * b.h + 0.3 * found.box.h;
      b = onFrame({ x: x1 - w / 2, y: y1 - h / 2, w, h }, f);
      out[i] = { box: b, score: Math.round(found.score * 1000) / 1000 };
      lost = 0;
      // the template takes in slow changes of look
      if (found.score > 0.7) {
        const p = patch(f, b, tw, th);
        if (p) tpl = unit(tpl.map((x, k) => 0.85 * x + 0.15 * p[k])) ?? tpl;
      }
    }
  }
  return out;
}
