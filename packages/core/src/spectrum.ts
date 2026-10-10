// What a sound holds in each register, and what is wrong with a recording,
// in pure functions of samples. The bands say whether an effect stands out
// of the music and the voice under it (the sound checks, the balance of the
// mix); the judgment keeps out of the library the files that would sound
// cheap once placed: two hits in one clip, a steady hiss, clicks in a
// whoosh, a clipped take.

/** in-place radix-2 FFT of re/im (length a power of two) */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = (-2 * Math.PI) / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2;
        const tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** the bands the balance is judged in: seven octaves from 125 Hz to 16 kHz */
export const BANDS: [number, number][] = [[125, 250], [250, 500], [500, 1000], [1000, 2000], [2000, 4000], [4000, 8000], [8000, 16000]];
export const BAND_NAMES = ['125', '250', '500', '1k', '2k', '4k', '8k'];

const SIZE = 4096;

/**
 * The energy of each band over [from, to] (s), mono mix of the channels:
 * Hann windows of 4096 samples, half overlapping, power summed per band and
 * averaged over the windows. Linear power (not dB), comparable between two
 * sounds and two spans.
 */
export function bandPowers(channels: Float32Array[], rate: number, from = 0, to = Infinity): number[] {
  const n = channels[0]?.length ?? 0;
  const a = Math.max(0, Math.floor(from * rate)), b = Math.min(n, Math.ceil(Math.min(to, n / rate) * rate));
  const out = BANDS.map(() => 0);
  if (b <= a) return out;
  const win = Float64Array.from({ length: SIZE }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE));
  const re = new Float64Array(SIZE), im = new Float64Array(SIZE), hz = rate / SIZE;
  const bins = BANDS.map(([lo, hi]) => [Math.ceil(lo / hz), Math.min(SIZE / 2, Math.floor(hi / hz))]);
  // a span shorter than a window is still read, padded with silence
  let frames = 0;
  for (let start = a; start < b; start += SIZE / 2) {
    frames++;
    for (let i = 0; i < SIZE; i++) {
      const j = start + i;
      let v = 0;
      if (j < b) for (const c of channels) v += c[j];
      re[i] = (v / channels.length) * win[i]; im[i] = 0;
    }
    fft(re, im);
    bins.forEach(([lo, hi], k) => { for (let i = lo; i <= hi; i++) out[k] += re[i] * re[i] + im[i] * im[i]; });
    if (b - start <= SIZE) break;
  }
  return out.map((p) => p / frames);
}

export const powerDb = (p: number) => (p > 0 ? 10 * Math.log10(p) : -200);

// ── what is wrong with a recording ───────────────────────────
export type SoundFlaw = 'two-events' | 'steady' | 'clicks' | 'clipped' | 'silent';

/** kinds of sound meant to be one event (a hit, a click): a second one inside the file is a flaw */
const ONE_EVENT = new Set(['impact', 'hit', 'boom', 'thump', 'tap', 'click', 'tick', 'pop', 'key', 'ui', 'chime']);
/** kinds meant to be a smooth gesture: clicks inside them are a flaw */
const SMOOTH = new Set(['whoosh', 'swish', 'transition', 'riser', 'reverse', 'swell', 'ambience', 'shimmer']);
/** kinds that may stay steady: a bed, a room */
const STEADY_OK = new Set(['ambience', 'music', 'voice', 'drone']);

/**
 * What would make a recording sound cheap once placed, for its kind: two
 * events where one is expected, a steady noise where a gesture is, clicks in
 * a smooth sound, a clipped or silent take.
 */
export function soundFlaws(channels: Float32Array[], rate: number, kind = ''): SoundFlaw[] {
  const n = channels[0]?.length ?? 0, flaws: SoundFlaw[] = [];
  if (!n) return ['silent'];
  // clipped: three samples in a row at the top
  let run = 0, clipped = false, peak = 0;
  for (const c of channels) for (let i = 0; i < n; i++) {
    const a = Math.abs(c[i]);
    if (a > peak) peak = a;
    run = a >= 0.999 ? run + 1 : 0;
    if (run >= 3) clipped = true;
  }
  if (peak < 1e-4) return ['silent'];
  if (clipped) flaws.push('clipped');
  // the envelope in 10 ms steps, dB under the loudest step
  const win = Math.max(1, Math.round(rate / 100)), env: number[] = [];
  for (let i = 0; i < n; i += win) {
    let s = 0;
    const to = Math.min(n, i + win);
    for (let j = i; j < to; j++) for (const c of channels) s += c[j] * c[j];
    env.push(s / ((to - i) * channels.length));
  }
  const top = Math.max(...env), db = env.map((e) => (e > 0 ? 10 * Math.log10(e / top) : -120));
  if (ONE_EVENT.has(kind)) {
    // events: stretches over -30 dB, apart by at least 80 ms under -40 dB; a second within 12 dB of the first is a second hit
    const events: number[] = [];
    let inside = false, best = -120, quiet = Infinity;
    for (const d of db) {
      if (inside) {
        best = Math.max(best, d);
        if (d < -40) { events.push(best); inside = false; quiet = 1; }
      } else if (d < -40) quiet++;
      else if (d > -30 && quiet >= 8) { inside = true; best = d; }
      else quiet = 0;
    }
    if (inside) events.push(best);
    if (events.filter((e) => e > -12).length > 1) flaws.push('two-events');
  }
  if (!STEADY_OK.has(kind) && n / rate > 1) {
    // steady: the level hardly moves over the sound (a hiss, a hum, a loop)
    const loud = db.filter((d) => d > -60);
    const mean = loud.reduce((a, b) => a + b, 0) / Math.max(1, loud.length);
    const spread = Math.sqrt(loud.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, loud.length));
    if (loud.length > 0.9 * db.length && spread < 2) flaws.push('steady');
  }
  if (SMOOTH.has(kind)) {
    // clicks: a sample far off the line of its neighbours, ten times what the 10 ms around it do
    const c = channels[0], d2 = new Float32Array(n), half = Math.max(2, Math.round(rate / 200));
    for (let i = 1; i < n - 1; i++) d2[i] = Math.abs(c[i] - (c[i - 1] + c[i + 1]) / 2);
    let clicks = 0, sum = 0;
    for (let i = 0; i < Math.min(n, 2 * half); i++) sum += d2[i];
    for (let i = half; i < n - half; i++) {
      const around = (sum - d2[i]) / (2 * half - 1);
      if (d2[i] > 0.1 * peak && d2[i] > 10 * around) clicks++;
      sum += d2[i + half] - d2[i - half];
    }
    if (clicks >= 2) flaws.push('clicks');
  }
  return flaws;
}
