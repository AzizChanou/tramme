// Image comparison for the equivalence checks: PSNR, mean and max channel
// difference, share of visibly different pixels, and a diff image (the
// reference dimmed, differences in red with intensity by size).

import fs from 'node:fs';
import { PNG } from 'pngjs';

export interface Diff {
  psnr: number;
  mean: number;
  max: number;
  /** share of pixels whose largest channel difference exceeds `threshold` */
  over: number;
  threshold: number;
}

const read = (f: string) => PNG.sync.read(fs.readFileSync(f));

export function compareFiles(a: string, b: string, { threshold = 16, diffOut = null as string | null } = {}): Diff {
  const A = read(a), B = read(b);
  if (A.width !== B.width || A.height !== B.height) throw new Error(`different sizes: ${A.width}x${A.height} and ${B.width}x${B.height}`);
  const n = A.width * A.height;
  const out = diffOut ? new PNG({ width: A.width, height: A.height }) : null;
  let se = 0, sum = 0, max = 0, over = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(A.data[i * 4 + c] - B.data[i * 4 + c]);
      se += d * d; sum += d;
      if (d > m) m = d;
    }
    if (m > max) max = m;
    if (m > threshold) over++;
    if (out) {
      const L = (0.2126 * A.data[i * 4] + 0.7152 * A.data[i * 4 + 1] + 0.0722 * A.data[i * 4 + 2]) * 0.25;
      const k = Math.min(1, m / 48);
      out.data[i * 4] = L + (255 - L) * k;
      out.data[i * 4 + 1] = L * (1 - k);
      out.data[i * 4 + 2] = L * (1 - k);
      out.data[i * 4 + 3] = 255;
    }
  }
  if (out && diffOut) fs.writeFileSync(diffOut, PNG.sync.write(out));
  const mse = se / (n * 3);
  return { psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse), mean: sum / (n * 3), max, over: over / n, threshold };
}
