// What was said, word by word, with its timing: the transcript of a sound or
// a video. Stored as a JSON asset of the project, read by caption layers and
// by the assistant. Times are in seconds, in the time of the file, or of the
// timeline once the cuts of an edit are applied (remapTranscript).

export interface TranscriptWord {
  /** the word as written, with its punctuation */
  w: string;
  /** start and end (s) */
  s: number;
  e: number;
}

export interface Transcript {
  version: 1;
  /** asset id (or path) of the sound or video transcribed */
  source?: string;
  language?: string;
  /** seconds covered */
  duration: number;
  words: TranscriptWord[];
  /** after remapTranscript: the parts of the source kept, in order, laid end to end */
  keeps?: { from: number; to: number }[];
}

export function isTranscript(x: unknown): x is Transcript {
  const t = x as Transcript;
  return !!t && typeof t === 'object' && Array.isArray(t.words) && t.words.every((w) => typeof w?.w === 'string' && typeof w.s === 'number' && typeof w.e === 'number');
}

/** the whole text, words joined */
export const transcriptText = (t: Transcript, from = 0, to = Infinity) =>
  t.words.filter((w) => w.e > from && w.s < to).map((w) => w.w).join(' ').replace(/\s+([,.;:!?…])/g, '$1');

export interface CaptionGroup { s: number; e: number; words: TranscriptWord[] }

/**
 * Words gathered into the groups shown together on screen: at most maxWords
 * and maxChars, a new group after a pause or the end of a sentence. Each group
 * stays until the next one starts when the gap is short.
 */
export function captionGroups(words: TranscriptWord[], { maxWords = 4, maxChars = 28, pause = 0.6, hold = 0.35 } = {}): CaptionGroup[] {
  const groups: CaptionGroup[] = [];
  let cur: TranscriptWord[] = [];
  const flush = () => { if (cur.length) groups.push({ s: cur[0].s, e: cur[cur.length - 1].e, words: cur }); cur = []; };
  for (let i = 0; i < words.length; i++) {
    const w = words[i], prev = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
    if (prev && (w.s - prev.e > pause || cur.length >= maxWords || chars > maxChars)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.w)) flush();
  }
  flush();
  // a short gap: the group stays until the next one
  for (let i = 0; i < groups.length - 1; i++) if (groups[i + 1].s - groups[i].e < hold) groups[i].e = groups[i + 1].s;
  return groups;
}

/**
 * The transcript of an edit: only the words inside the parts kept, with their
 * times moved to where those parts play once laid end to end from `at`.
 */
export function remapTranscript(t: Transcript, keeps: { from: number; to: number }[], at = 0): Transcript {
  const words: TranscriptWord[] = [];
  let offset = at;
  for (const k of keeps) {
    for (const w of t.words) {
      const mid = (w.s + w.e) / 2;
      if (mid < k.from || mid >= k.to) continue;
      words.push({ w: w.w, s: offset + Math.max(0, w.s - k.from), e: offset + Math.min(k.to, w.e) - k.from });
    }
    offset += k.to - k.from;
  }
  return { version: 1, source: t.source, language: t.language, duration: offset, words, keeps };
}

/** pauses longer than minGap between words (candidates for cuts), in source time */
export function silences(t: Transcript, minGap = 0.7): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  let last = 0;
  for (const w of t.words) { if (w.s - last >= minGap) out.push({ from: last, to: w.s }); last = Math.max(last, w.e); }
  if (t.duration - last >= minGap) out.push({ from: last, to: t.duration });
  return out;
}

/**
 * Words from overlapping chunks put together: each chunk keeps the words
 * whose middle falls in its own part (the overlap is split in two).
 */
export function mergeChunks(chunks: { start: number; end: number; words: TranscriptWord[] }[]): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  chunks.forEach((c, i) => {
    const lo = i === 0 ? -Infinity : (c.start + chunks[i - 1].end) / 2;
    const hi = i === chunks.length - 1 ? Infinity : (chunks[i + 1].start + c.end) / 2;
    for (const w of c.words) { const mid = (w.s + w.e) / 2; if (mid >= lo && mid < hi) out.push(w); }
  });
  return out.sort((a, b) => a.s - b.s);
}
