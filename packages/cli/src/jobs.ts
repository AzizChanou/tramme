// Render jobs shared by the command line and the editor's export.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'puppeteer-core';
import type { TrammeDoc } from '@tramme/core';
import { openDoc, type DocInfo } from './browser.ts';
import { encoder, frameKind, type VideoFormat } from './media.ts';
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

/**
 * The sound over [from, to] mixed by the page (the mixer of the editor's
 * preview and exports), written to `out` as a WAV; false when there is none.
 */
async function mixTo(page: Page, from: number, to: number, out: string): Promise<boolean> {
  const b64: string | null = await page.evaluate((a) => (window as any).TRAMME.mix(a.from, a.to), { from, to });
  if (!b64) return false;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  return true;
}

export async function renderVideo(server: Server, page: Page, job: VideoJob, onProgress?: (done: number, total: number) => void) {
  const format = job.format ?? 'mp4';
  const info: DocInfo = await openDoc(page, server.port, job.docUrl, job.compId);
  const f0 = Math.round((job.from ?? 0) * info.fps);
  const f1 = job.to !== undefined ? Math.min(info.frames, Math.round(job.to * info.fps)) : info.frames;
  const mix = path.join(os.tmpdir(), `tramme-mix-${process.pid}-${Date.now()}.wav`);
  const audio = !job.mute && (format === 'mp4' || format === 'mov' || format === 'webm') && await mixTo(page, f0 / info.fps, f1 / info.fps, mix) ? mix : undefined;
  const enc = encoder({ format, W: info.width, H: info.height, fps: info.fps, frames: f1 - f0, out: job.out, audio, crf: job.crf });
  server.sink = enc.write;
  if (onProgress) await page.exposeFunction('__trammeProgress', onProgress).catch(() => {});
  const t0 = Date.now();
  try {
    const ms: number = await page.evaluate((a) => (window as any).TRAMME.capture(a.f0, a.f1, a.opts, a.kind), { f0, f1, opts: { samples: job.samples }, kind: frameKind(format) });
    await enc.end();
    return { info, frames: f1 - f0, audio: !!audio, msPerFrame: ms, seconds: (Date.now() - t0) / 1000 };
  } finally {
    server.sink = null;
    if (audio) fs.rmSync(mix, { force: true });
  }
}

/** the composition's sound alone, as a WAV */
export async function renderAudio(server: Server, page: Page, docUrl: string, compId: string | undefined, out: string) {
  const info = await openDoc(page, server.port, docUrl, compId);
  if (!(await mixTo(page, 0, info.duration, out))) throw new Error('no sound layer in this composition');
  return { file: path.resolve(out) };
}
