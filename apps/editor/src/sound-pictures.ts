// What a sound looks like, for an assistant that cannot hear: its waveform,
// its spectrogram (where its energy sits over time: a hit is a vertical
// stripe, a steady hiss a flat band, a sine a thin line), the motion of the
// picture under it, and marks at the moments that matter. The sound tools
// draw one sound, a sheet of candidates and the picture of a whole mix with
// these.

import { fft } from '@tramme/core';

export const INK = { ground: '#0b0f12', line: '#1f282e', wave: '#4cc38a', text: '#e6edf0', faint: '#8a979e', hero: '#ff6b5e', support: '#9aa5ab', motion: '#5aa9ff' };

export function canvas(w: number, h: number): { el: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const el = document.createElement('canvas');
  el.width = w; el.height = h;
  const g = el.getContext('2d')!;
  g.fillStyle = INK.ground; g.fillRect(0, 0, w, h);
  return { el, g };
}

/** the waveform of samples in a box: each column from its lowest to its highest sample */
export function drawWave(g: CanvasRenderingContext2D, d: Float32Array, x: number, y: number, w: number, h: number, color = INK.wave) {
  g.strokeStyle = INK.line; g.beginPath(); g.moveTo(x, y + h / 2); g.lineTo(x + w, y + h / 2); g.stroke();
  g.fillStyle = color;
  const per = Math.max(1, Math.floor(d.length / w)), half = h / 2 - 2;
  for (let i = 0; i < w; i++) {
    let lo = 0, hi = 0;
    for (let j = i * per; j < Math.min(d.length, (i + 1) * per); j++) { if (d[j] < lo) lo = d[j]; if (d[j] > hi) hi = d[j]; }
    g.fillRect(x + i, y + h / 2 - hi * half, 1, Math.max(1, (hi - lo) * half));
  }
}

/** dark to bright through purple and orange (magma-like): where the energy is */
function heat(v: number): string {
  const s = Math.max(0, Math.min(1, v));
  const stops = [[0, 0, 4], [80, 18, 123], [182, 54, 121], [251, 136, 97], [252, 253, 191]];
  const p = s * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(p)), f = p - i;
  const c = stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** the spectrogram of samples in a box: time across, frequency up (log scale, 60 Hz to maxHz), 70 dB of range */
export function drawSpectrogram(g: CanvasRenderingContext2D, d: Float32Array, rate: number, x: number, y: number, w: number, h: number, maxHz = 12000) {
  const N = 1024, re = new Float64Array(N), im = new Float64Array(N), win = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const cols: Float64Array[] = [];
  let top = -Infinity;
  for (let i = 0; i < w; i++) {
    const at = Math.floor((i / w) * Math.max(0, d.length - N));
    for (let k = 0; k < N; k++) { re[k] = (d[at + k] ?? 0) * win[k]; im[k] = 0; }
    fft(re, im);
    const col = new Float64Array(h);
    for (let r = 0; r < h; r++) {
      // row r covers a slice of the log axis
      const f0 = 60 * Math.pow(maxHz / 60, r / h), f1 = 60 * Math.pow(maxHz / 60, (r + 1) / h);
      const b0 = Math.max(1, Math.floor((f0 / rate) * N)), b1 = Math.max(b0, Math.min(N / 2 - 1, Math.ceil((f1 / rate) * N)));
      let p = 0;
      for (let b = b0; b <= b1; b++) p = Math.max(p, re[b] * re[b] + im[b] * im[b]);
      col[r] = p > 0 ? 10 * Math.log10(p) : -200;
      if (col[r] > top) top = col[r];
    }
    cols.push(col);
  }
  cols.forEach((col, i) => col.forEach((v, r) => { g.fillStyle = heat((v - (top - 70)) / 70); g.fillRect(x + i, y + h - 1 - r, 1, 1); }));
}

/** a curve of values in a box, 0 to the 95th percentile of the values (one huge spike does not flatten the rest; what passes it is clipped) */
export function drawCurve(g: CanvasRenderingContext2D, values: number[], x: number, y: number, w: number, h: number, color = INK.motion) {
  const sorted = [...values].sort((a, b) => a - b), top = Math.max(1e-9, sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0, 0.25 * (sorted.at(-1) ?? 0));
  g.strokeStyle = color; g.lineWidth = 1.5; g.beginPath();
  values.forEach((v, i) => { const px = x + (i / Math.max(1, values.length - 1)) * w, py = y + h - Math.min(1, v / top) * (h - 2); i ? g.lineTo(px, py) : g.moveTo(px, py); });
  g.stroke(); g.lineWidth = 1;
}

/** a vertical mark across a box, with a label at its top */
export function mark(g: CanvasRenderingContext2D, x: number, y: number, h: number, color: string, label?: string) {
  g.fillStyle = color; g.fillRect(Math.round(x), y, 1.5, h);
  if (label) { g.save(); g.font = '10px system-ui, sans-serif'; g.translate(Math.round(x) + 3, y + 3); g.rotate(Math.PI / 2); g.fillText(label, 0, 0); g.restore(); }
}

export function caption(g: CanvasRenderingContext2D, text: string, x: number, y: number, color = INK.text, font = '600 12px system-ui, sans-serif') {
  g.font = font; g.fillStyle = color; g.fillText(text, x, y);
}
