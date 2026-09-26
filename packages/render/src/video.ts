// Video assets: frames decoded on demand with WebCodecs (Mediabunny), from
// the file served with range requests, so a long video is never loaded whole.
// Playback reads forward from a decoder kept open; a jump elsewhere starts a
// new read there. The last few frames stay at hand (motion blur sub-frames,
// small steps back).

import { ALL_FORMATS, BlobSource, CanvasSink, Input, UrlSource, type WrappedCanvas } from 'mediabunny';
import type { VideoAsset } from '@tramme/core';

const KEEP = 6;
/** a request this far ahead of the current read continues it rather than seeking */
const AHEAD = 2;

export class VideoFrames implements VideoAsset {
  width = 0;
  height = 0;
  duration = 0;
  hasAudio = false;
  private input: Input;
  private sink!: CanvasSink;
  private frames: WrappedCanvas[] = [];
  private reader: { it: AsyncGenerator<WrappedCanvas, void, unknown>; at: number } | null = null;
  private busy: Promise<void> = Promise.resolve();
  /** times asked for and not found (past the end, a gap): not asked again */
  private missed = new Set<number>();

  private constructor(url: string) {
    this.input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  }

  static async open(url: string): Promise<VideoFrames> {
    const v = new VideoFrames(url);
    const track = await v.input.getPrimaryVideoTrack();
    if (!track) throw new Error('no video track');
    if (!(await track.canDecode())) throw new Error(`video codec not supported by this browser (${track.codec ?? 'unknown'})`);
    v.width = track.displayWidth;
    v.height = track.displayHeight;
    v.duration = await v.input.computeDuration();
    v.hasAudio = !!(await v.input.getPrimaryAudioTrack());
    // a pool larger than the frames kept: a kept canvas is never reused under us
    v.sink = new CanvasSink(track, { poolSize: KEEP + 3 });
    return v;
  }

  private find(t: number): WrappedCanvas | undefined {
    return this.frames.find((f) => t + 1e-6 >= f.timestamp && t < f.timestamp + f.duration - 1e-6);
  }

  private keep(f: WrappedCanvas) {
    this.frames = [...this.frames.filter((x) => x.timestamp !== f.timestamp), f].sort((a, b) => a.timestamp - b.timestamp);
    if (this.frames.length > KEEP) this.frames.shift();
  }

  frameAt(t: number): { image: CanvasImageSource | null; exact: boolean } {
    const time = Math.min(Math.max(0, t), Math.max(0, this.duration - 1e-3));
    const hit = this.find(time);
    if (hit) return { image: hit.canvas as CanvasImageSource, exact: true };
    const missed = this.missed.has(Math.round(time * 1000));
    // the nearest frame decoded, while the right one comes
    let near: WrappedCanvas | undefined;
    for (const f of this.frames) if (!near || Math.abs(f.timestamp - time) < Math.abs(near.timestamp - time)) near = f;
    return { image: (near?.canvas as CanvasImageSource) ?? null, exact: missed };
  }

  /** decodes the frame shown at t (one request at a time, in order) */
  request(t: number): Promise<void> {
    const time = Math.min(Math.max(0, t), Math.max(0, this.duration - 1e-3));
    this.busy = this.busy.then(() => this.decode(time)).catch((e) => { console.warn('[tramme] video:', (e as Error).message); });
    return this.busy;
  }

  private async decode(t: number) {
    await this.read(t);
    if (!this.find(t)) {
      if (this.missed.size > 200) this.missed.clear();
      this.missed.add(Math.round(t * 1000));
    }
  }

  private async read(t: number) {
    if (this.find(t)) return;
    const r = this.reader;
    if (r && t >= r.at && t - r.at < AHEAD) {
      // reading forward: continue the open decoder up to t
      for (;;) {
        const next = await r.it.next();
        if (next.done) { this.reader = null; break; }
        this.keep(next.value);
        r.at = next.value.timestamp + next.value.duration;
        if (this.find(t)) return;
        if (next.value.timestamp > t) return;
      }
    }
    // elsewhere: a new read from t
    await this.reader?.it.return(undefined);
    const it = this.sink.canvases(t);
    const first = await it.next();
    if (first.done) { this.reader = null; return; }
    this.keep(first.value);
    this.reader = { it, at: first.value.timestamp + first.value.duration };
  }

  dispose() {
    this.reader?.it.return(undefined);
    this.input.dispose();
  }
}

/** what a video file holds, read from its header (a new project takes its size, cadence and length) */
export async function probeVideo(file: Blob): Promise<{ width: number; height: number; duration: number; fps: number; hasAudio: boolean; decodable: boolean; codec: string | null }> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('no video track in this file');
    const stats = await track.computePacketStats(120);
    return {
      width: track.displayWidth,
      height: track.displayHeight,
      duration: await input.computeDuration(),
      fps: stats.averagePacketRate,
      hasAudio: !!(await input.getPrimaryAudioTrack()),
      decodable: await track.canDecode(),
      codec: track.codec ?? null,
    };
  } finally { input.dispose(); }
}
