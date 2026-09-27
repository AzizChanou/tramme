// ffmpeg side: encoders for raw frames streamed from the render page, with
// the document's audio layers mixed at their in points.
//   mp4   H.264 High, BT.709, MP3 320 kb/s (frames in YUV 4:2:0)
//   mov   ProRes 4444 with alpha, PCM audio (frames in straight RGBA)
//   webm  VP9 with alpha, Opus audio
//   gif   two-pass palette, no audio
//   png   numbered PNG sequence with alpha, no audio

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';

export const FFMPEG = ffmpegPath as unknown as string;
export type VideoFormat = 'mp4' | 'mov' | 'webm' | 'gif' | 'png';
export const VIDEO_FORMATS: VideoFormat[] = ['mp4', 'mov', 'webm', 'gif', 'png'];

/** pixel layout the page must send for a format */
export const frameKind = (f: VideoFormat): 'yuv' | 'rgba' => (f === 'mp4' ? 'yuv' : 'rgba');

const COLOR = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

export interface AudioClip {
  file: string;
  /** seconds on the timeline (relative to the first rendered frame) */
  at: number;
  /** seconds into the file */
  start: number;
  /** seconds played (the layer's length): a cut ends there */
  duration: number;
  gainDb: number;
}

/** filter graph mixing the clips into [aout]; inputs start at index 1 (0 is the video) */
function audioGraph(clips: AudioClip[]): string {
  const chains = clips.map((c, i) => {
    const delay = Math.max(0, Math.round(c.at * 1000));
    const trim = c.start + Math.max(0, -c.at), len = Math.max(0, c.duration - Math.max(0, -c.at));
    return `[${i + 1}:a]atrim=start=${trim.toFixed(4)}:duration=${len.toFixed(4)},asetpts=PTS-STARTPTS,adelay=${delay}|${delay},volume=${c.gainDb}dB[a${i}]`;
  });
  const mix = clips.length === 1 ? '[a0]anull[aout]' : `${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length}:normalize=0[aout]`;
  return [...chains, mix].join(';');
}

export interface EncoderJob { format: VideoFormat; W: number; H: number; fps: number; frames: number; out: string; audio?: AudioClip[]; crf?: number }

/** ffmpeg reading raw frames on stdin; out is the target file (a folder for png) */
export function encoder({ format, W, H, fps, frames, out, audio = [], crf = 16 }: EncoderJob) {
  fs.mkdirSync(format === 'png' ? out : path.dirname(out), { recursive: true });
  const dur = (frames / fps).toFixed(6);
  const pix = format === 'mp4' ? ['-pix_fmt', 'yuv420p', ...COLOR] : ['-pix_fmt', 'rgba'];
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', ...pix, '-s', `${W}x${H}`, '-r', String(fps), '-i', '-'];
  const withAudio = audio.length > 0 && (format === 'mp4' || format === 'mov' || format === 'webm');
  if (withAudio) {
    for (const c of audio) args.push('-i', c.file);
    args.push('-filter_complex', audioGraph(audio), '-map', '0:v', '-map', '[aout]');
  } else if (format !== 'gif') args.push('-map', '0:v');
  const toTv = ['-vf', 'scale=out_color_matrix=bt709:out_range=tv'];
  switch (format) {
    case 'mp4':
      args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...COLOR, '-g', String(fps * 2), '-bf', '2',
        // MP3 rather than AAC: VS Code's player cannot decode AAC
        ...(withAudio ? ['-c:a', 'libmp3lame', '-b:a', '320k', '-ar', '48000'] : []), '-t', dur, '-movflags', '+faststart', out);
      break;
    case 'mov':
      args.push(...toTv, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0', ...COLOR,
        ...(withAudio ? ['-c:a', 'pcm_s24le', '-ar', '48000'] : []), '-t', dur, out);
      break;
    case 'webm':
      args.push(...toTv, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '22', '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', ...COLOR,
        ...(withAudio ? ['-c:a', 'libopus', '-b:a', '192k', '-ar', '48000'] : []), '-t', dur, out);
      break;
    case 'gif':
      args.push('-filter_complex', '[0:v]split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle', '-loop', '0', out);
      break;
    case 'png':
      args.push('-f', 'image2', '-start_number', '0', '-c:v', 'png', '-pix_fmt', 'rgba', path.join(out, '%05d.png'));
      break;
  }
  const ff = spawn(FFMPEG, args, { stdio: ['pipe', 'inherit', 'inherit'] });
  ff.stdin.on('error', (e) => console.error('ffmpeg stdin', e.message));
  const done = new Promise<void>((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg failed (code ' + c + ')')))));
  return {
    write: (buf: Buffer) => new Promise<void>((res) => { if (!ff.stdin.write(buf)) ff.stdin.once('drain', () => res()); else res(); }),
    end: async () => { ff.stdin.end(); await done; },
  };
}

/** the document's sound alone, mixed to a WAV file */
export function mixAudio(clips: AudioClip[], duration: number, out: string): Promise<void> {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=stereo:d=${duration.toFixed(4)}`];
  for (const c of clips) args.push('-i', c.file);
  const graph = clips.map((c, i) => {
    const delay = Math.max(0, Math.round(c.at * 1000));
    return `[${i + 1}:a]atrim=start=${(c.start + Math.max(0, -c.at)).toFixed(4)}:duration=${Math.max(0, c.duration - Math.max(0, -c.at)).toFixed(4)},asetpts=PTS-STARTPTS,adelay=${delay}|${delay},volume=${c.gainDb}dB[a${i}]`;
  });
  graph.push(`[0:a]${clips.map((_, i) => `[a${i}]`).join('')}amix=inputs=${clips.length + 1}:normalize=0:duration=first[aout]`);
  args.push('-filter_complex', graph.join(';'), '-map', '[aout]', '-c:a', 'pcm_s24le', '-ar', '48000', out);
  const ff = spawn(FFMPEG, args, { stdio: ['ignore', 'inherit', 'inherit'] });
  return new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg failed (code ' + c + ')')))));
}
