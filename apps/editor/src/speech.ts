// What a sound or a video says, word by word: its audio decoded here (never
// the whole file at once), cut into chunks of 28 s overlapping by 2 s, each
// chunk turned to words by the server (Whisper on Workers AI) or, when the
// server has none, by the local companion. The transcript becomes a JSON
// asset of the project, beside the media.

import { signal } from '@preact/signals';
import { ALL_FORMATS, AudioBufferSink, Input, UrlSource } from 'mediabunny';
import { mergeChunks, pointer, type Transcript, type TranscriptWord } from '@tramme/core';
import { aiStatus, companionLink, refreshStatus } from './ai/index.ts';
import { safeName, takenPaths, upload } from './files.ts';
import { commit, S, toast } from './state.ts';
import { m, t } from './i18n/index.ts';

const CHUNK = 28, STEP = 26, RATE = 16000;

/** transcriptions under way, with their progress (shown at the bottom of the screen) */
export const transcriptions = signal<{ id: string; name: string; done: number; total: number; stage: string }[]>([]);

/** 16-bit PCM WAV, mono, from samples between -1 and 1 */
function wav(samples: Float32Array, rate: number): Uint8Array {
  const out = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true);
  out.setUint32(28, rate * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Uint8Array(out.buffer);
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** the audio of [from, to) in 16 kHz mono */
async function chunkAudio(sink: AudioBufferSink, from: number, to: number): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil((to - from) * RATE)), RATE);
  for await (const b of sink.buffers(from, to)) {
    const src = ctx.createBufferSource();
    src.buffer = b.buffer;
    src.connect(ctx.destination);
    // a buffer that starts before `from` is placed earlier, its first part falls off
    src.start(Math.max(0, b.timestamp - from), Math.max(0, from - b.timestamp));
  }
  return (await ctx.startRendering()).getChannelData(0);
}

type Backend = 'server' | 'companion';

/** one chunk to words, by the server, or by the companion when the server cannot */
async function wordsOf(audio: string, language: string | undefined, prefer: Backend): Promise<{ words: TranscriptWord[]; language?: string; backend: Backend }> {
  const viaServer = async () => {
    const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ audio, language }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
    return { ...j, backend: 'server' as const };
  };
  const viaCompanion = async () => {
    const link = companionLink();
    const r = await fetch(`${link.url}/transcribe`, { method: 'POST', headers: { authorization: `Bearer ${link.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ audio, language }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? t('common.companionHttpStatus', { status: r.status }));
    return { ...j, backend: 'companion' as const };
  };
  if (prefer === 'companion') return viaCompanion();
  try { return await viaServer(); }
  catch (e) {
    if (aiStatus.peek().companion === 'checking') await refreshStatus();
    if (aiStatus.peek().companion !== 'ok') throw new Error(t('speech.errorTheLocalCompanion', { error: (e as Error).message }));
    return viaCompanion();
  }
}

/** the words of a media file at url, with their timing in the file */
export async function transcribeUrl(url: string, opts: { language?: string; onProgress?: (done: number, total: number, stage: string) => void } = {}): Promise<Transcript> {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error(t('speech.thisFileHasNo'));
    if (!(await track.canDecode())) throw new Error(t('speech.soundCannotBeDecoded', { codec: track.codec ?? t('common.unknown') }));
    const duration = await input.computeDuration();
    const sink = new AudioBufferSink(track);
    const starts: number[] = [];
    for (let s = 0; s < duration; s += STEP) { starts.push(s); if (s + CHUNK >= duration) break; }
    const chunks: { start: number; end: number; words: TranscriptWord[] }[] = [];
    let language = opts.language, backend: Backend = 'server';
    for (const [i, start] of starts.entries()) {
      const end = Math.min(duration, start + CHUNK);
      opts.onProgress?.(i, starts.length, backend === 'companion' ? m('speech.localCompanion') : m('speech.server'));
      const audio = base64(wav(await chunkAudio(sink, start, end), RATE));
      const r = await wordsOf(audio, language, backend);
      backend = r.backend;
      language ??= r.language;
      chunks.push({ start, end, words: r.words.map((w) => ({ w: w.w, s: +(start + w.s).toFixed(3), e: +(start + w.e).toFixed(3) })) });
    }
    opts.onProgress?.(starts.length, starts.length, m('speech.done'));
    return { version: 1, language, duration: +duration.toFixed(3), words: mergeChunks(chunks) };
  } finally {
    input.dispose();
  }
}

/** id of the transcript asset of a media asset */
export const transcriptIdOf = (assetId: string) => `transcription-${assetId}`.slice(0, 64);

/**
 * Transcribes a media asset of the open project: the words go to
 * assets/transcripts/<name>.json and an asset `transcription-<id>` points at
 * them. Returns the transcript asset id.
 */
/** transcriptions under way: asking again waits for the same one */
const running = new Map<string, Promise<string>>();

export function transcribeAsset(assetId: string, language?: string): Promise<string> {
  let job = running.get(assetId);
  if (!job) {
    job = transcribe(assetId, language).finally(() => running.delete(assetId));
    running.set(assetId, job);
  }
  return job;
}

async function transcribe(assetId: string, language?: string): Promise<string> {
  const doc = S.doc.peek(), a = doc.assets[assetId];
  if (!a || (a.type !== 'video' && a.type !== 'audio')) throw new Error(t('speech.aSoundOrA'));
  const job = { id: assetId, name: a.name || assetId, done: 0, total: 1, stage: m('speech.preparing') };
  transcriptions.value = [...transcriptions.peek().filter((j) => j.id !== assetId), job];
  try {
    const url = new URL(a.src, new URL(S.docUrl.peek(), location.href)).href;
    const tr = await transcribeUrl(url, { language, onProgress: (done, total, stage) => { transcriptions.value = transcriptions.peek().map((j) => (j.id === assetId ? { ...j, done, total, stage } : j)); } });
    tr.source = assetId;
    const name = safeName(`${(a.src.split('/').pop() ?? assetId).replace(/\.[^.]+$/, '')}.json`);
    const path = await upload(await takenPaths(), `assets/transcripts/${name}`, new Blob([JSON.stringify(tr)], { type: 'application/json' }));
    const id = transcriptIdOf(assetId), had = !!S.doc.peek().assets[id];
    commit(t('common.transcriptOfName', { name: a.name || assetId }), [{ op: had ? 'replace' : 'add', path: pointer('assets', id), value: { type: 'json', src: path, name: `${t('speech.transcript')} · ${a.name || assetId}` } }]);
    toast(t('speech.transcriptReadyNWords', { n: tr.words.length, language: tr.language ?? t('speech.languageDetected') }));
    return id;
  } finally {
    transcriptions.value = transcriptions.peek().filter((j) => j.id !== assetId);
  }
}
