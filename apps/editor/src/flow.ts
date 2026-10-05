// The movement of pixels between two rendered stills (optical flow by block
// matching): what the property figures cannot see — a background that pans
// when it should hold, a title crossing against the camera's move, a hold
// that is not one. Pure functions over pixels: the editor computes it at
// authoring time, from stills it renders anyway; the render itself stays a
// pure function of time.

import { canvas } from './perception.ts';

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }

const GRID = 80;
const CELL = 8, REACH = 4;
/** luma units (0..255): a block flatter than this says nothing */
const CONTRAST = 3;
/** sample px: under this a shift is a hold */
const HOLD = 0.6;
/** sample px: how far a block may disagree with the whole before it is its own move */
const DISSENT = 1.5;

/** the image's pixels at the composition scale (browser: a canvas draw); null when there is no canvas */
export function pixelsOf(image: CanvasImageSource, width: number, height: number): Pixels | null {
  try {
    const { c, g } = canvas(width, height);
    g.drawImage(image, 0, 0, width, height);
    return { width, height, data: g.getImageData(0, 0, width, height).data };
  } catch { return null; }
}

/** the luminance of an image, downsampled to a width of 80 (nearest sample) */
export function gray(p: Pixels): { w: number; h: number; l: Float32Array } {
  const w = Math.min(GRID, p.width), h = Math.max(2, Math.round((p.height * w) / p.width));
  const l = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(p.width - 1, Math.round((x * p.width) / w)), sy = Math.min(p.height - 1, Math.round((y * p.height) / h));
    const i = (sy * p.width + sx) * 4;
    l[y * w + x] = 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
  }
  return { w, h, l };
}

const at = (g: { w: number; h: number; l: Float32Array }, x: number, y: number) => (x >= 0 && x < g.w && y >= 0 && y < g.h ? g.l[y * g.w + x] : null);

/** the shift of one block between two fields: the offset of ±reach with the smallest difference, or null when the block is too flat to say anything */
function blockMatch(a: { w: number; h: number; l: Float32Array }, b: { w: number; h: number; l: Float32Array }, x: number, y: number): { dx: number; dy: number } | null {
  let mean = 0, n = 0;
  for (let j = 0; j < CELL; j++) for (let i = 0; i < CELL; i++) { const v = at(a, x + i, y + j); if (v !== null) { mean += v; n++; } }
  if (n < CELL * CELL * 0.75) return null;
  mean /= n;
  let variance = 0;
  for (let j = 0; j < CELL; j++) for (let i = 0; i < CELL; i++) { const v = at(a, x + i, y + j); if (v !== null) variance += (v - mean) * (v - mean); }
  if (variance / n < CONTRAST * CONTRAST) return null;
  let best = Infinity, bdx = 0, bdy = 0;
  for (let dy = -REACH; dy <= REACH; dy++) for (let dx = -REACH; dx <= REACH; dx++) {
    let sad = 0, m = 0;
    for (let j = 0; j < CELL; j++) for (let i = 0; i < CELL; i++) {
      const u = at(a, x + i, y + j), v = at(b, x + i + dx, y + j + dy);
      if (u !== null && v !== null) { sad += Math.abs(u - v); m++; }
    }
    if (m >= n * 0.75 && sad / m < best) { best = sad / m; bdx = dx; bdy = dy; }
  }
  return { dx: bdx, dy: bdy };
}

export interface Flow {
  /** the median shift, sample px */
  dx: number;
  dy: number;
  /** its speed at the composition's scale, px/s */
  speed: number;
  /** blocks that said something, out of the grid */
  cells: number;
  /** blocks that move differently from the whole, with their mean place (0..1 of the frame) */
  dissent: { n: number; x: number; y: number };
}

/** the flow of pixels between two stills `dt` s apart, or null when the pixels hold still */
export function flowBetween(a: Pixels, b: Pixels, dt: number, compWidth: number): Flow | null {
  if (!(dt > 0)) return null;
  const ga = gray(a), gb = gray(b);
  const cells: { x: number; y: number; dx: number; dy: number }[] = [];
  for (let y = 0; y + CELL <= ga.h; y += CELL) for (let x = 0; x + CELL <= ga.w; x += CELL) {
    const m = blockMatch(ga, gb, x, y);
    if (m) cells.push({ x: (x + CELL / 2) / ga.w, y: (y + CELL / 2) / ga.h, dx: m.dx, dy: m.dy });
  }
  if (cells.length < 4) return null;
  const median = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)];
  const dx = median(cells.map((c) => c.dx)), dy = median(cells.map((c) => c.dy));
  const mag = Math.hypot(dx, dy);
  // blocks that move differently from the whole: a crossing, an element of its own
  const against = cells.filter((c) => Math.hypot(c.dx - dx, c.dy - dy) > DISSENT);
  // a majority disagreeing means the median is not the whole's move
  if (mag < HOLD && against.length < 2) return null;
  if (against.length > cells.length * 0.6) return null;
  const scale = compWidth / ga.w;
  return {
    dx, dy, speed: (mag / dt) * scale, cells: cells.length,
    dissent: {
      n: against.length,
      x: against.reduce((s, c) => s + c.x, 0) / Math.max(1, against.length),
      y: against.reduce((s, c) => s + c.y, 0) / Math.max(1, against.length),
    },
  };
}

const where = (x: number, y: number) => {
  const v = y < 1 / 3 ? 'upper' : y > 2 / 3 ? 'lower' : 'middle', h = x < 1 / 3 ? 'left' : x > 2 / 3 ? 'right' : 'centre';
  if (v === 'middle') return h === 'centre' ? 'the centre' : `the ${h}`;
  if (h === 'centre') return `the ${v}`;
  return `the ${v} ${h}`;
};

const way = (dx: number, dy: number) => {
  const parts = [
    Math.abs(dx) >= 0.6 ? (dx > 0 ? 'right' : 'left') : '',
    Math.abs(dy) >= 0.6 ? (dy > 0 ? 'down' : 'up') : '',
  ].filter(Boolean);
  return parts.join(' and ') || 'in place';
};

/** the flow as lines for the assistant, or null when the pixels hold still */
export function flowLines(a: Pixels, b: Pixels, dt: number, compWidth: number): string[] | null {
  const f = flowBetween(a, b, dt, compWidth);
  if (!f) return null;
  const out: string[] = [];
  if (Math.hypot(f.dx, f.dy) >= HOLD) out.push(`Pixels: the frame moves ${way(f.dx, f.dy)} at about ${Math.round(f.speed)} px/s (${f.cells} blocks read)`);
  if (f.dissent.n >= 2) out.push(`Pixels: ${f.dissent.n} blocks move differently, around ${where(f.dissent.x, f.dissent.y)}: something crosses the move, or holds against it`);
  return out.length ? out : null;
}
