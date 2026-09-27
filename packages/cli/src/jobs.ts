// Render jobs shared by the command line and the editor's export.

import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'puppeteer-core';
import { audioClips as clipsOf, type TrammeDoc } from '@tramme/core';
import { openDoc, type DocInfo } from './browser.ts';
import { encoder, frameKind, mixAudio, type AudioClip, type VideoFormat } from './media.ts';
import type { Server } from './server.ts';

export interface VideoJob {
  /** URL path of the document on the server: /project/film.tramme.json */
  docUrl: string;
  doc: TrammeDoc;
  compId?: string;
  format?: VideoFormat;
  samples?: number;
  from?: number;
  to?: number;
  crf?: number;
  mute?: boolean;
  /** target file (a folder for png) */
  out: string;
}

/** audio layers of the composition as ffmpeg clips (times relative to the first rendered frame) */
export function audioClips(server: Server, doc: TrammeDoc, docUrl: string, compId: string, fps: number, f0: number): AudioClip[] {
  // audio layers and the sound of video layers, each with its length (the cuts of an edit)
  return clipsOf(doc, compId).map((c) => {
    const src = new URL(doc.assets[c.asset].src, `http://x${docUrl}`).pathname;
    const f = server.resolve(decodeURIComponent(src));
    if (!f || !fs.existsSync(f)) throw new Error(`sound not found: ${src}`);
    return { file: f, at: c.at - f0 / fps, start: c.offset, duration: c.duration, gainDb: c.gainDb };
  });
}

export async function renderVideo(server: Server, page: Page, job: VideoJob, onProgress?: (done: number, total: number) => void) {
  const format = job.format ?? 'mp4';
  const info: DocInfo = await openDoc(page, server.port, job.docUrl, job.compId);
  const f0 = Math.round((job.from ?? 0) * info.fps);
  const f1 = job.to !== undefined ? Math.min(info.frames, Math.round(job.to * info.fps)) : info.frames;
  const audio = job.mute ? [] : audioClips(server, job.doc, job.docUrl, info.comp, info.fps, f0);
  const enc = encoder({ format, W: info.width, H: info.height, fps: info.fps, frames: f1 - f0, out: job.out, audio, crf: job.crf });
  server.sink = enc.write;
  if (onProgress) await page.exposeFunction('__trammeProgress', onProgress).catch(() => {});
  const t0 = Date.now();
  try {
    const ms: number = await page.evaluate((a) => (window as any).TRAMME.capture(a.f0, a.f1, a.opts, a.kind), { f0, f1, opts: { samples: job.samples }, kind: frameKind(format) });
    await enc.end();
    return { info, frames: f1 - f0, audio: audio.length, msPerFrame: ms, seconds: (Date.now() - t0) / 1000 };
  } finally {
    server.sink = null;
  }
}

/** the composition's sound alone, as a WAV */
export async function renderAudio(server: Server, doc: TrammeDoc, docUrl: string, compId: string, out: string) {
  const comp = doc.compositions[compId];
  const clips = audioClips(server, doc, docUrl, compId, comp.fps, 0);
  if (!clips.length) throw new Error('no sound layer in this composition');
  await mixAudio(clips, comp.duration, out);
  return { clips: clips.length, file: path.resolve(out) };
}
