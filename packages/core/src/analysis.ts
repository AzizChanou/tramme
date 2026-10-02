// What a sound is made of, over time: its loudness in three bands, the
// onsets (hits), the tempo, the beats and the bars, and its sections. The
// analysis runs once at authoring time (the editor decodes the audio and
// calls analyseAudio) and is saved as a JSON asset; the render reads it with
// pure functions of t (audioReader), so a picture can follow the music while
// every frame stays a function of time.

export interface AudioAnalysis {
  version: 1;
  kind: 'audio-analysis';
  /** asset id of the sound or video analysed */
  source?: string;
  duration: number;
  /** samples per second of the envelopes */
  rate: number;
  /** loudness 0..1 (normalised on the file) of the whole, the lows (< 150 Hz), the mids, the highs (> 2 kHz) */
  envelope: { rms: number[]; low: number[]; mid: number[]; high: number[] };
  /** hits: drums, plosives, notes (s) */
  onsets: number[];
  /** beats per minute, null when the sound has no steady pulse */
  tempo: number | null;
  beats: number[];
  /** the first beat of each bar (4 beats) */
  downbeats: number[];
  /** where the energy changes for good (verse, chorus, drop), with the loudness that follows */
  sections: { t: number; level: number }[];
}

export const isAudioAnalysis = (x: unknown): x is AudioAnalysis =>
  !!x && typeof x === 'object' && (x as AudioAnalysis).kind === 'audio-analysis' && Array.isArray((x as AudioAnalysis).beats);

export type Band = 'rms' | 'low' | 'mid' | 'high';

// ── analysis ─────────────────────────────────────────────────
const RATE = 50;

/** one-pole low-pass, in place copy */
function lowpass(x: Float32Array, rate: number, cutoff: number): Float32Array {
  const a = Math.exp((-2 * Math.PI * cutoff) / rate), y = new Float32Array(x.length);
  let s = 0;
  for (let i = 0; i < x.length; i++) { s = (1 - a) * x[i] + a * s; y[i] = s; }
  return y;
}

/** root mean square over hops of 1/RATE s */
function rmsOf(x: Float32Array, hop: number, frames: number): Float32Array {
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0, n = 0;
    for (let i = f * hop, end = Math.min(x.length, (f + 1) * hop); i < end; i++, n++) s += x[i] * x[i];
    out[f] = n ? Math.sqrt(s / n) : 0;
  }
  return out;
}

const normalise = (x: Float32Array) => { let m = 0; for (const v of x) m = Math.max(m, v); return Array.from(x, (v) => (m > 0 ? +(v / m).toFixed(3) : 0)); };
const mean = (a: ArrayLike<number>, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i]; return to > from ? s / (to - from) : 0; };

/** times of the peaks of a novelty curve above a moving threshold, at least `gap` s apart */
function peaks(nov: Float32Array, gap: number): number[] {
  const out: number[] = [], w = RATE, minGap = Math.round(gap * RATE);
  let last = -Infinity;
  for (let i = 1; i < nov.length - 1; i++) {
    if (nov[i] <= nov[i - 1] || nov[i] < nov[i + 1]) continue;
    const from = Math.max(0, i - w), to = Math.min(nov.length, i + w);
    const m = mean(nov, from, to);
    let v = 0;
    for (let k = from; k < to; k++) v += (nov[k] - m) ** 2;
    const sd = Math.sqrt(v / (to - from));
    if (nov[i] > m + 1.2 * sd && nov[i] > 0.02 && i - last >= minGap) { out.push(i / RATE); last = i; }
  }
  return out;
}

/**
 * The analysis of a mono sound. The tempo comes from the autocorrelation of
 * the onset curve (60 to 190 bpm, leaning to 120), the beat grid from the
 * phase that hits the most onsets, the bars from the beat where the lows hit
 * hardest.
 */
export function analyseAudio(samples: Float32Array, sampleRate: number): AudioAnalysis {
  const hop = Math.max(1, Math.round(sampleRate / RATE)), frames = Math.max(1, Math.ceil(samples.length / hop));
  const lo = lowpass(samples, sampleRate, 150), lo2k = lowpass(samples, sampleRate, 2000);
  const hi = new Float32Array(samples.length), mid = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) { hi[i] = samples[i] - lo2k[i]; mid[i] = lo2k[i] - lo[i]; }
  const bands = { rms: rmsOf(samples, hop, frames), low: rmsOf(lo, hop, frames), mid: rmsOf(mid, hop, frames), high: rmsOf(hi, hop, frames) };

  // novelty: rise of the log energy in each band, the lows and highs weighted most (drums)
  const nov = new Float32Array(frames);
  const logd = (b: Float32Array, i: number) => Math.max(0, Math.log(b[i] + 1e-4) - Math.log(b[i - 1] + 1e-4));
  for (let i = 1; i < frames; i++) nov[i] = 1.2 * logd(bands.low, i) + 0.6 * logd(bands.mid, i) + 1 * logd(bands.high, i);
  const onsets = peaks(nov, 0.08);

  // tempo: autocorrelation of the novelty between 60 and 190 bpm, weighted around 120
  let tempo: number | null = null, period = 0;
  if (onsets.length >= 8 && frames > RATE * 4) {
    let best = 0, bestLag = 0;
    const minLag = Math.floor((60 / 190) * RATE), maxLag = Math.ceil((60 / 60) * RATE);
    const ac = new Float32Array(maxLag + 2);
    for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
      let s = 0;
      for (let i = lag; i < frames; i++) s += nov[i] * nov[i - lag];
      ac[lag] = s / (frames - lag);
    }
    for (let lag = minLag; lag <= maxLag; lag++) {
      const bpm = (60 * RATE) / lag, w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
      // the double of the period backs a true beat
      const score = (ac[lag] + 0.5 * (ac[lag * 2] ?? 0)) * w;
      if (score > best) { best = score; bestLag = lag; }
    }
    // a pulse stands out of the average correlation
    if (bestLag && ac[bestLag] > 1.4 * mean(ac, minLag, maxLag + 1)) {
      // parabolic refinement of the lag
      const y0 = ac[bestLag - 1], y1 = ac[bestLag], y2 = ac[bestLag + 1], d = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
      period = (bestLag + (Math.abs(d) < 1 ? d : 0)) / RATE;
      tempo = +(60 / period).toFixed(1);
    }
  }

  // beat grid: the phase that hits the most novelty, each beat pulled to a close onset
  const beats: number[] = [];
  if (tempo) {
    const steps = 40;
    let bestPhase = 0, bestScore = -1;
    for (let k = 0; k < steps; k++) {
      const ph = (period * k) / steps;
      let s = 0;
      for (let t = ph; t < samples.length / sampleRate; t += period) s += nov[Math.min(frames - 1, Math.round(t * RATE))];
      if (s > bestScore) { bestScore = s; bestPhase = ph; }
    }
    const dur = samples.length / sampleRate;
    for (let t = bestPhase; t < dur; t += period) {
      const near = onsets.find((o) => Math.abs(o - t) <= 0.06);
      beats.push(+(near ?? t).toFixed(3));
    }
  }

  // bars: the beat of four where the lows hit hardest
  let downbeats: number[] = [];
  if (beats.length >= 8) {
    let bestOff = 0, bestLow = -1;
    for (let off = 0; off < 4; off++) {
      let s = 0;
      for (let i = off; i < beats.length; i += 4) s += bands.low[Math.min(frames - 1, Math.round(beats[i] * RATE))];
      if (s > bestLow) { bestLow = s; bestOff = off; }
    }
    downbeats = beats.filter((_, i) => i % 4 === bestOff);
  }

  // sections: the loudness of each bar (or window of 2 s), relative to the loudest one, changing for good
  const rmsN = normalise(bands.rms), sections: { t: number; level: number }[] = [];
  const marks = downbeats.length >= 4 ? downbeats : Array.from({ length: Math.floor(frames / (RATE * 2)) }, (_, i) => i * 2);
  const raw = marks.map((m, i) => mean(rmsN, Math.round(m * RATE), Math.max(Math.round(m * RATE) + 1, Math.min(frames, Math.round((marks[i + 1] ?? m + 2) * RATE)))));
  const top = Math.max(...raw, 1e-9), level = raw.map((v) => v / top);
  // two bars before against two after
  const span = 2;
  for (let i = span; i + span <= marks.length; i++) {
    const before = mean(level, i - span, i), after = mean(level, i, i + span);
    if (Math.abs(after - before) > 0.25 && (!sections.length || marks[i] - sections.at(-1)!.t >= 4)) sections.push({ t: +marks[i].toFixed(3), level: +after.toFixed(2) });
  }

  return {
    version: 1, kind: 'audio-analysis', duration: +(samples.length / sampleRate).toFixed(3), rate: RATE,
    envelope: { rms: rmsN, low: normalise(bands.low), mid: normalise(bands.mid), high: normalise(bands.high) },
    onsets: onsets.map((t) => +t.toFixed(3)), tempo, beats, downbeats, sections,
  };
}

// ── reading at render time ───────────────────────────────────
/** the last time of a sorted list at or before t, by bisection; -1 when none */
function lastIndex(list: number[], t: number): number {
  let lo = 0, hi = list.length - 1, at = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m] <= t + 1e-9) { at = m; lo = m + 1; } else hi = m - 1; }
  return at;
}

export interface AudioReader {
  /** loudness 0..1 at t, interpolated */
  energy(band?: Band): number;
  /** 1 on each beat, fading to 0 with `decay` (s) */
  pulse(decay?: number): number;
  /** the same on each bar */
  barPulse(decay?: number): number;
  /** the same on each hit */
  hit(decay?: number): number;
  /** rank of the current beat (0 for the first, -1 before it) */
  beat: number;
  /** rank of the current bar */
  bar: number;
  /** progress inside the beat, 0..1 */
  phase: number;
  /** rank of the current section (0 before the first change) */
  section: number;
}

const silent: AudioReader = { energy: () => 0, pulse: () => 0, barPulse: () => 0, hit: () => 0, beat: -1, bar: -1, phase: 0, section: 0 };

/** what an analysis says at time t (time of the sound); neutral values when there is none */
export function audioReader(a: unknown, t: number): AudioReader {
  if (!isAudioAnalysis(a)) return silent;
  const fade = (list: number[], decay: number) => { const i = lastIndex(list, t); return i < 0 ? 0 : Math.exp(-(t - list[i]) / Math.max(1e-3, decay)); };
  const b = lastIndex(a.beats, t);
  const period = a.tempo ? 60 / a.tempo : 0;
  return {
    energy(band: Band = 'rms') {
      const env = a.envelope[band] ?? a.envelope.rms, x = t * a.rate, i = Math.floor(x);
      if (i < 0 || !env.length) return 0;
      if (i >= env.length - 1) return env[env.length - 1];
      return env[i] + (env[i + 1] - env[i]) * (x - i);
    },
    pulse: (decay = 0.2) => fade(a.beats, decay),
    barPulse: (decay = 0.4) => fade(a.downbeats, decay),
    hit: (decay = 0.15) => fade(a.onsets, decay),
    beat: b,
    bar: lastIndex(a.downbeats, t),
    phase: b < 0 || !period ? 0 : Math.min(1, (t - a.beats[b]) / ((a.beats[b + 1] ?? a.beats[b] + period) - a.beats[b])),
    section: lastIndex(a.sections.map((s) => s.t), t) + 1,
  };
}
