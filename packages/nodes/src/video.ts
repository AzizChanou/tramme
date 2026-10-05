// A video in a frame centred on the layer origin. The layer's in point plays
// the file from `start`: several layers of the same file with different
// starts and lengths make the cuts of an edit. Its sound plays with it unless
// muted (mixed like an audio layer, in the preview and the exports).

import { pictureRect, type NodeType, type Vec2, type VideoAsset } from '@tramme/core';
import { SOUND_PROPS } from './sound.ts';

interface VideoProps {
  video: string | null;
  start: number;
  size: Vec2;
  fit: 'cover' | 'contain' | 'fill';
  focus: Vec2;
  gain: number;
  muted: boolean;
}

/** time in the file at composition time t */
export const videoTime = (p: { start: number }, t: number, layerIn: number) => p.start + (t - layerIn);

export const video: NodeType<VideoProps> = {
  type: 'video', title: 'Video', category: 'Media',
  props: {
    video: { type: 'asset', default: null, nullable: true, assetType: 'video', label: 'File', animatable: false },
    start: { type: 'number', default: 0, min: 0, step: 0.01, unit: 's', label: 'Start in the file', animatable: false, description: "the video time shown at the layer's in point (used for cuts)" },
    size: { type: 'vec2', default: [1920, 1080], label: 'Frame', unit: 'px' },
    fit: { type: 'enum', default: 'cover', options: ['cover', 'contain', 'fill'], label: 'Fit mode' },
    focus: { type: 'vec2', default: [0.5, 0.5], label: 'Focal point', step: 0.01, description: 'point of the picture kept at the center of the frame (0..1); animated, it follows the subject in a cropped frame' },
    muted: { type: 'bool', default: false, label: 'Muted', animatable: false, group: 'Sound' },
    ...SOUND_PROPS,
  },
  path({ size: [w, h] }) { const p = new Path2D(); p.rect(-w / 2, -h / 2, w, h); return p; },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  render: {
    canvas2d(ctx, p, host) {
      if (!p.video) return;
      const [w, h] = p.size;
      if (w <= 0 || h <= 0) return;
      const src = host.asset<VideoAsset>(p.video);
      const t = videoTime(p, host.t, host.layerIn ?? 0);
      const { image, exact } = src.frameAt(t);
      if (!exact) host.defer?.(src.request(t));
      if (!image || !src.width || !src.height) return;
      const r = pictureRect(p.fit, w, h, src.width, src.height);
      if (p.fit === 'cover') {
        ctx.beginPath(); ctx.rect(-w / 2, -h / 2, w, h); ctx.clip();
        // the point of the picture named by focus stays at the centre of the frame, without showing past the edges
        const s = Math.max(w / src.width, h / src.height);
        const ox = Math.min(0, Math.max(w - src.width * s, w / 2 - p.focus[0] * src.width * s));
        const oy = Math.min(0, Math.max(h - src.height * s, h / 2 - p.focus[1] * src.height * s));
        ctx.drawImage(image, ox, oy, src.width * s, src.height * s);
      } else {
        ctx.drawImage(image, r.x, r.y, r.w, r.h);
      }
    },
  },
};
