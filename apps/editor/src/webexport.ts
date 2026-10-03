// Exports in the browser: a second Renderer (the same engine as the preview,
// on its own hidden canvas) draws each frame; WebCodecs encodes the videos
// (Mediabunny writes MP4 and WebM), gifenc the GIF, fflate zips the PNG
// sequence. The audio layers are mixed in an OfflineAudioContext. Lottie and
// SVG come from @tramme/interop.

import { AudioBufferSource, BufferTarget, CanvasSource, canEncodeAudio, getFirstEncodableVideoCodec, Mp4OutputFormat, Output, Quality, VideoSample, VideoSampleSource, WebMOutputFormat } from 'mediabunny';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { zipSync } from 'fflate';
import type { TrammeDoc, Registry } from '@tramme/core';
import { fetchAssetReader, toLottie, toSvg } from '@tramme/interop';
import { encodeWav, mixComposition, Renderer } from '@tramme/render';

import type { WebFormat } from './formats.ts';
import { t } from './i18n/index.ts';

export interface WebExportOptions {
  compId: string;
  registry: Registry;
  /** sub-frames; the composition's motion blur when omitted */
  samples?: number;
  /** time of the SVG */
  t?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface WebExportResult { blob: Blob; ext: string; warnings: string[] }

/** the composition's sounds (audio layers, sound of videos), through the mixer of the preview, or null */
const mixAudio = (r: Renderer) => mixComposition(r.doc, r.compId, (id) => r.assets.url(id));

const wav = (buf: AudioBuffer) => new Blob([encodeWav(buf) as BlobPart], { type: 'audio/wav' });

/** a packet in Annex B (start codes), rather than with its NAL units prefixed by their length */
const isAnnexB = (d: Uint8Array) => d[0] === 0 && d[1] === 0 && (d[2] === 1 || (d[2] === 0 && d[3] === 1));

/**
 * H.264 in an MP4: the encoder hands its frames in Annex B, with the parameter
 * sets in band, and the muxer writes the configuration box (avcC) from them.
 * The avcC some encoders give of their own is malformed (Media Foundation under
 * Windows: each SPS and PPS with its header byte twice, reserved bits cleared):
 * Chrome and VLC play such a file, the strict players (Windows, QuickTime,
 * phones, TVs) refuse it.
 */
const AVC_FROM_STREAM = {
  onEncoderConfig: (config: VideoEncoderConfig) => { config.avc = { ...config.avc, format: 'annexb' }; },
  onEncodedPacket: (packet: { data: Uint8Array }, meta?: EncodedVideoChunkMetadata) => {
    if (meta?.decoderConfig && isAnnexB(packet.data)) delete meta.decoderConfig.description;
  },
};

const aborted = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException(t('export.exportCancelled'), 'AbortError'); };

export async function exportInBrowser(doc: TrammeDoc, base: string, format: WebFormat, opts: WebExportOptions): Promise<WebExportResult> {
  if (format === 'lottie' || format === 'svg') {
    const readAsset = await fetchAssetReader(doc, base);
    if (format === 'lottie') {
      const { lottie, warnings } = toLottie(doc, opts.registry, { compId: opts.compId, readAsset });
      return { blob: new Blob([JSON.stringify(lottie)], { type: 'application/json' }), ext: 'lottie.json', warnings };
    }
    const { svg, warnings } = toSvg(doc, opts.registry, opts.t ?? 0, { compId: opts.compId, readAsset });
    return { blob: new Blob([svg], { type: 'image/svg+xml' }), ext: 'svg', warnings };
  }

  const canvas = document.createElement('canvas');
  const r = await Renderer.open(doc, opts.registry, base, canvas, { compId: opts.compId });
  try {
    const { fps, duration } = r.comp;
    // the render size (the width is rounded to a multiple of 8)
    const W = canvas.width, H = canvas.height;
    if (format === 'wav') {
      const sound = await mixAudio(r);
      if (!sound) throw new Error(t('export.noSoundLayerIn'));
      return { blob: wav(sound), ext: 'wav', warnings: [] };
    }
    const frames = Math.round(duration * fps);
    // straight RGBA of frame f (alpha kept)
    const rgba = new Uint8Array(W * H * 4);
    // every video frame exact before reading it
    const readFrame = async (f: number) => {
      await r.renderComplete(f / fps, { samples: opts.samples, toFbo: true });
      return r.compositor.readRGBA(rgba, r.lastSeed);
    };

    if (format === 'png') {
      const files: Record<string, [Uint8Array, { level: 0 }]> = {};
      const c2 = document.createElement('canvas');
      c2.width = W; c2.height = H;
      const ctx = c2.getContext('2d')!;
      for (let f = 0; f < frames; f++) {
        aborted(opts.signal);
        ctx.putImageData(new ImageData(new Uint8ClampedArray(await readFrame(f)), W, H), 0, 0);
        const png = await new Promise<Blob>((res, rej) => c2.toBlob((b) => (b ? res(b) : rej(new Error(t('export.pngFailed')))), 'image/png'));
        files[`${String(f).padStart(5, '0')}.png`] = [new Uint8Array(await png.arrayBuffer()), { level: 0 }];
        opts.onProgress?.(f + 1, frames);
      }
      return { blob: new Blob([zipSync(files) as BlobPart], { type: 'application/zip' }), ext: 'png.zip', warnings: [] };
    }

    if (format === 'gif') {
      // GIF delays are in hundredths of a second: at most 50 frames a second
      const step = Math.ceil(fps / 50), delay = Math.round((1000 * step) / fps);
      const gif = GIFEncoder();
      const total = Math.ceil(frames / step);
      for (let f = 0, i = 0; f < frames; f += step, i++) {
        aborted(opts.signal);
        const px = await readFrame(f);
        const palette = quantize(px, 256, { format: 'rgba4444', oneBitAlpha: true });
        const index = applyPalette(px, palette, 'rgba4444');
        const transparentIndex = palette.findIndex((p) => p[3] === 0);
        gif.writeFrame(index, W, H, { palette, delay, transparent: transparentIndex >= 0, transparentIndex: Math.max(0, transparentIndex) });
        opts.onProgress?.(i + 1, total);
        if (i % 4 === 3) await new Promise((res) => setTimeout(res));
      }
      gif.finish();
      const warnings = step > 1 ? [t('export.fromFpsBroughtDown', { from: fps, to: Math.round(fps / step) })] : [];
      return { blob: new Blob([gif.bytes() as BlobPart], { type: 'image/gif' }), ext: 'gif', warnings };
    }

    if (typeof VideoEncoder === 'undefined') throw new Error(t('export.webcodecsUnavailableInThis'));
    const webm = format === 'webm';
    const codec = await getFirstEncodableVideoCodec(webm ? ['vp9', 'vp8', 'av1'] : ['avc', 'vp9', 'av1'], { width: W, height: H });
    if (!codec) throw new Error(t('export.noVideoCodecAvailable', { w: W, h: H }));
    const target = new BufferTarget();
    const output = new Output({ format: webm ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const quality = new Quality('very-high');
    // MP4: the visible canvas (opaque); WebM: straight RGBA frames, alpha kept
    const video = webm ? new VideoSampleSource({ codec, quality, keyFrameInterval: 2, alpha: 'keep' }) : new CanvasSource(canvas, { codec, quality, keyFrameInterval: 2, ...(codec === 'avc' ? AVC_FROM_STREAM : {}) });
    output.addVideoTrack(video, { frameRate: fps });
    const sound = await mixAudio(r);
    let audio: AudioBufferSource | null = null;
    if (sound) {
      const audioCodec = webm ? 'opus' : (await canEncodeAudio('aac')) ? 'aac' : 'opus';
      audio = new AudioBufferSource({ codec: audioCodec, quality: new Quality('high') });
      output.addAudioTrack(audio);
    }
    await output.start();
    try {
      for (let f = 0; f < frames; f++) {
        aborted(opts.signal);
        if (video instanceof VideoSampleSource) {
          const sample = new VideoSample(await readFrame(f), { format: 'RGBA', codedWidth: W, codedHeight: H, timestamp: f / fps, duration: 1 / fps });
          await video.add(sample);
          sample.close();
        } else {
          await r.renderComplete(f / fps, { samples: opts.samples });
          await video.add(f / fps, 1 / fps);
        }
        opts.onProgress?.(f + 1, frames);
      }
      if (audio && sound) await audio.add(sound);
      await output.finalize();
    } catch (e) {
      await output.cancel();
      throw e;
    }
    return { blob: new Blob([target.buffer!], { type: webm ? 'video/webm' : 'video/mp4' }), ext: webm ? 'webm' : 'mp4', warnings: [] };
  } finally {
    r.dispose();
  }
}
