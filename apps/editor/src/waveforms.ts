// The waveform of each sound file, drawn in its clips on the timeline:
// decoded once in the background, kept as peaks (a hundred a second), the
// timeline drawn again when they are ready.

import { signal } from '@preact/signals';

const PER_SECOND = 100;
const peaks = new Map<string, Float32Array | null>();
/** bumped when peaks are ready: the clips that wait for them are drawn again */
export const wavesReady = signal(0);

/** the loudest sample of each hundredth of a second of a file; undefined while it is read, null when it cannot be */
export function peaksOf(url: string): Float32Array | null | undefined {
  if (peaks.has(url)) return peaks.get(url) ?? undefined;
  peaks.set(url, null);
  fetch(url).then((r) => r.arrayBuffer()).then((b) => new OfflineAudioContext(1, 1, 48000).decodeAudioData(b)).then((buf) => {
    const per = Math.max(1, Math.round(buf.sampleRate / PER_SECOND)), n = Math.ceil(buf.length / per), out = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) { let m = out[i]; for (let j = i * per, e = Math.min(d.length, j + per); j < e; j++) { const a = Math.abs(d[j]); if (a > m) m = a; } out[i] = m; }
    }
    peaks.set(url, out);
    wavesReady.value++;
  }).catch(() => { /* not a sound the browser reads: no waveform */ });
  return undefined;
}

/**
 * The outline of a clip's waveform in a box of `width` × 100: the file from
 * `offset` seconds, `seconds` of the timeline long, played at `rate`.
 * Mirrored around the middle, at most one point every two pixels.
 */
export function wavePath(p: Float32Array, offset: number, seconds: number, rate: number, width: number): string {
  const step = Math.max(2, width / 600), top: string[] = [], bottom: string[] = [];
  for (let x = 0; x <= width; x += step) {
    const at = Math.floor((offset + (x / width) * seconds * rate) * PER_SECOND), v = Math.min(1, p[at] ?? 0) * 48;
    top.push(`${x.toFixed(1)},${(50 - v).toFixed(1)}`);
    bottom.push(`${x.toFixed(1)},${(50 + v).toFixed(1)}`);
  }
  return `M${top.join('L')}L${bottom.reverse().join('L')}Z`;
}
