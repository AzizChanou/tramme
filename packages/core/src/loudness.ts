// How loud a mix is and how it is finished, in pure functions of samples:
// loudness as ITU-R BS.1770 measures it (K-weighted, gated: integrated,
// short-term and momentary), the true peak (4× oversampled), and the
// look-ahead limiter of the master. The mixer of @tramme/render brings every
// export to its composition's loudness with them; the sound checks read them.

export const LOUDNESS_FLOOR = -70;

/** one biquad, coefficients normalised by a0 */
interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** the two stages of the K-weighting at a sample rate: the head's high shelf, then a high pass (libebur128's design, the ITU coefficients at 48 kHz) */
function kStages(rate: number): Biquad[] {
  const shelf = (() => {
    const fc = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    const K = Math.tan((Math.PI * fc) / rate), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Q + K * K;
    return { b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  })();
  const pass = (() => {
    const fc = 38.13547087602444, Q = 0.5003270373238773;
    const K = Math.tan((Math.PI * fc) / rate), a0 = 1 + K / Q + K * K;
    return { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  })();
  return [shelf, pass];
}

function filter(x: Float32Array, f: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = f.b0 * x[i] + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** the mean square of the K-weighted channels, summed (left and right weigh 1), over windows of `win` seconds every `hop` seconds */
function powers(channels: Float32Array[], rate: number, win: number, hop: number): { t: number; z: number }[] {
  const stages = kStages(rate);
  const weighted = channels.map((c) => stages.reduce((x, f) => filter(x, f), c));
  const n = channels[0]?.length ?? 0, w = Math.max(1, Math.round(win * rate)), h = Math.max(1, Math.round(hop * rate));
  // running sum of squares: each window in constant time
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) { let s = 0; for (const c of weighted) s += c[i] * c[i]; cum[i + 1] = cum[i] + s; }
  const out: { t: number; z: number }[] = [];
  if (n < w) { if (n) out.push({ t: 0, z: cum[n] / n }); return out; }
  for (let i = 0; i + w <= n; i += h) out.push({ t: i / rate, z: (cum[i + w] - cum[i]) / w });
  return out;
}

const lufs = (z: number) => (z > 0 ? -0.691 + 10 * Math.log10(z) : -Infinity);

/** integrated loudness (LUFS): 400 ms blocks every 100 ms, gated at -70 LUFS then 10 LU under their own loudness; -Infinity for silence */
export function integratedLoudness(channels: Float32Array[], rate: number): number {
  const blocks = powers(channels, rate, 0.4, 0.1).filter((b) => lufs(b.z) > LOUDNESS_FLOOR);
  if (!blocks.length) return -Infinity;
  const gate = lufs(blocks.reduce((s, b) => s + b.z, 0) / blocks.length) - 10;
  const kept = blocks.filter((b) => lufs(b.z) > gate);
  return lufs(kept.reduce((s, b) => s + b.z, 0) / Math.max(1, kept.length));
}

/** loudness over time (LUFS, every 100 ms): momentary on 400 ms windows, short-term on 3 s; t is the start of each window */
export function loudnessSeries(channels: Float32Array[], rate: number, window: 'momentary' | 'short-term' = 'momentary'): { t: number; lufs: number }[] {
  return powers(channels, rate, window === 'momentary' ? 0.4 : 3, 0.1).map((b) => ({ t: +b.t.toFixed(3), lufs: Math.max(LOUDNESS_FLOOR - 10, lufs(b.z)) }));
}

// ── true peak ────────────────────────────────────────────────
const OVER = 4, TAPS = 12;
/** the interpolation filter of 4× oversampling: a Hann-windowed sinc, OVER phases of TAPS taps */
const PHASES = (() => {
  const len = OVER * TAPS, h = new Float64Array(len);
  for (let i = 0; i < len; i++) {
    const x = (i - (len - 1) / 2) / OVER;
    h[i] = (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * (0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / len));
  }
  return Array.from({ length: OVER }, (_, p) => {
    const taps = Array.from({ length: TAPS }, (_, k) => h[k * OVER + p]);
    const sum = taps.reduce((a, b) => a + b, 0);
    return taps.map((v) => v / sum);
  });
})();

/** the peak between the samples too, as a DAC rebuilds the wave: |amplitude| of each sample, 4× oversampled, the loudest channel */
export function truePeakEnvelope(channels: Float32Array[]): Float32Array {
  const n = channels[0]?.length ?? 0, out = new Float32Array(n), half = TAPS / 2;
  for (const c of channels) {
    for (let i = 0; i < n; i++) {
      let peak = Math.abs(c[i]);
      for (const ph of PHASES) {
        let v = 0;
        for (let k = 0; k < TAPS; k++) { const j = i + k - half + 1; if (j >= 0 && j < n) v += ph[k] * c[j]; }
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      if (peak > out[i]) out[i] = peak;
    }
  }
  return out;
}

/** true peak, dBTP */
export function truePeak(channels: Float32Array[]): number {
  let p = 0;
  for (const v of truePeakEnvelope(channels)) if (v > p) p = v;
  return p > 0 ? 20 * Math.log10(p) : -Infinity;
}

// ── the master ───────────────────────────────────────────────
/**
 * Holds the true peak under `ceilingDb` (dBTP): the gain goes down over the
 * `lookahead` before a peak and comes back over `release`, so nothing is cut
 * square. In place. `env`: the true-peak envelope of the channels when it is
 * known already (scaled by `scale`), as the master does round after round.
 */
export function limit(channels: Float32Array[], rate: number, ceilingDb = -1, opts: { lookahead?: number; release?: number; env?: Float32Array; scale?: number } = {}): void {
  const n = channels[0]?.length ?? 0;
  if (!n) return;
  const { lookahead = 0.005, release = 0.08, scale = 1 } = opts;
  const ceil = Math.pow(10, ceilingDb / 20) / scale, env = opts.env ?? truePeakEnvelope(channels);
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) need[i] = env[i] > ceil ? ceil / env[i] : 1;
  const L = Math.max(1, Math.round(lookahead * rate));
  // the smallest gain needed over the next L samples (a sliding minimum)
  const ahead = new Float32Array(n), q: number[] = [];
  for (let i = n - 1, head = 0; i >= 0; i--) {
    while (q.length > head && need[q[q.length - 1]] >= need[i]) q.pop();
    q.push(i);
    while (q[head] > i + L - 1) head++;
    ahead[i] = need[q[head]];
    if (head > 4096) { q.splice(0, head); head = 0; }
  }
  // averaged over the L samples before: the gain is down by the time the peak comes, ramped
  const gain = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += ahead[i];
    if (i >= L) sum -= ahead[i - L];
    gain[i] = sum / Math.min(L, i + 1);
  }
  // back up slowly, never above what is needed
  const r = Math.exp(-1 / Math.max(1, release * rate));
  let g = 1;
  for (let i = 0; i < n; i++) {
    g = Math.min(gain[i], 1 - (1 - g) * r);
    for (const c of channels) c[i] *= g;
  }
}

/**
 * Brings a mix to `target` LUFS with its true peak under `ceilingDb`, in
 * place: gain, limiter, measured again until both hold (the limiter takes a
 * little loudness away). Returns what was measured at the end.
 */
export function master(channels: Float32Array[], rate: number, target = -14, ceilingDb = -1): { lufs: number; truePeak: number; gainDb: number } {
  const dry = channels.map((c) => c.slice()), env = truePeakEnvelope(dry);
  let gainDb = 0, measured = integratedLoudness(channels, rate);
  if (!Number.isFinite(measured)) return { lufs: measured, truePeak: truePeak(channels), gainDb: 0 };
  // a little under the ceiling: the AAC of an export adds a few tenths
  const ceiling = ceilingDb - 0.5;
  for (let round = 0; round < 6; round++) {
    gainDb += target - measured;
    const k = Math.pow(10, gainDb / 20);
    channels.forEach((c, ch) => { const d = dry[ch]; for (let i = 0; i < c.length; i++) c[i] = d[i] * k; });
    limit(channels, rate, ceiling, { env, scale: k });
    measured = integratedLoudness(channels, rate);
    if (Math.abs(target - measured) <= 0.3) break;
  }
  return { lufs: +measured.toFixed(2), truePeak: +truePeak(channels).toFixed(2), gainDb: +gainDb.toFixed(2) };
}
