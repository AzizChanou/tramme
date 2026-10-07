// The app's icon (apps/editor/icon.svg) as the PNGs phones and search engines
// ask for: the home screen (apple-touch-icon, 180), the web manifest (192,
// 512). Drawn at their size from the vector, on a full square of its own dark
// background (the systems round the corners themselves).

import type { APIRoute, GetStaticPaths } from 'astro';
import sharp from 'sharp';
import svg from '../../../../editor/icon.svg?raw';

const SIZES = [180, 192, 512];

export const getStaticPaths = (() => SIZES.map((size) => ({ params: { size: String(size) } }))) satisfies GetStaticPaths;

export const GET: APIRoute = async ({ params }) => {
  const size = Number(params.size);
  // the icon is drawn on a 24-unit box: rendered at the size asked, not scaled up
  const png = await sharp(Buffer.from(svg), { density: (72 * size) / 24 }).resize(size, size).flatten({ background: '#0e1215' }).png().toBuffer();
  return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
};
