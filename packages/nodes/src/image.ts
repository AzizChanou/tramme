// A picture placed in a frame centred on the layer origin. The asset's
// `box` (region of interest, image px) drives the framing: 'cover' fills the
// frame with the box, 'contain' shows the whole box; `focus` is the point of
// the box kept at the frame centre. In 'cover' the picture never shows past
// its own edges, whatever the zoom and offset.

import type { NodeType, Vec2 } from '@tramme/core';

type Img = CanvasImageSource & { width: number; height: number; naturalWidth?: number; naturalHeight?: number };

interface ImageProps {
  image: string | null;
  size: Vec2;
  fit: 'cover' | 'contain' | 'fill' | 'none';
  focus: Vec2;
  zoom: number;
  offset: Vec2;
  crop: boolean;
  box: [number, number, number, number] | null;
}

export const image: NodeType<ImageProps> = {
  type: 'image', title: 'Image', category: 'Media',
  props: {
    image: { type: 'asset', default: null, nullable: true, assetType: 'image', label: 'Image' },
    size: { type: 'vec2', default: [400, 400], label: 'Frame', unit: 'px' },
    fit: { type: 'enum', default: 'cover', options: ['cover', 'contain', 'fill', 'none'], label: 'Fit mode' },
    focus: { type: 'vec2', default: [0.5, 0.5], label: 'Focal point', step: 0.01, description: 'point of the source area kept at the center of the frame (0..1)' },
    zoom: { type: 'number', default: 1, label: 'Zoom', min: 0, step: 0.01, unit: 'x' },
    offset: { type: 'vec2', default: [0, 0], label: 'Offset', unit: 'px' },
    crop: { type: 'bool', default: true, label: 'Crop to frame' },
    box: { type: 'json', default: null, nullable: true, label: 'Source area', description: "[x0, y0, x1, y1] in image pixels; the asset's by default" },
  },
  path({ size: [w, h] }) { const p = new Path2D(); p.rect(-w / 2, -h / 2, w, h); return p; },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  render: {
    canvas2d(ctx, p, host) {
      if (!p.image) return;
      const [w, h] = p.size;
      if (w <= 0 || h <= 0) return;
      const img = host.asset<Img>(p.image);
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const [x0, y0, x1, y1] = p.box ?? host.assetInfo(p.image).box ?? [0, 0, iw, ih];
      const bw = x1 - x0, bh = y1 - y0, x = -w / 2, y = -h / 2;
      let sx: number, sy: number;
      if (p.fit === 'fill') { sx = (w / bw) * p.zoom; sy = (h / bh) * p.zoom; }
      else {
        const s = (p.fit === 'cover' ? Math.max(w / bw, h / bh) : p.fit === 'contain' ? Math.min(w / bw, h / bh) : 1) * p.zoom;
        sx = sy = s;
      }
      let ox = x + w / 2 - (x0 + bw * p.focus[0]) * sx + p.offset[0];
      let oy = y + h / 2 - (y0 + bh * p.focus[1]) * sy + p.offset[1];
      if (p.fit === 'cover') {
        ox = Math.min(x, Math.max(x + w - iw * sx, ox));
        oy = Math.min(y, Math.max(y + h - ih * sy, oy));
      }
      if (p.crop) { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); }
      ctx.drawImage(img, ox, oy, iw * sx, ih * sy);
    },
  },
};
