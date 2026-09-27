// Asset bytes for the exporters, in browsers and Node: media type, pixel
// size read from the image header (PNG, JPEG, GIF, WebP), base64.

import type { TrammeDoc } from '@tramme/core';

export interface AssetFile { data: Uint8Array; mime: string; width: number; height: number }
/** the bytes of an asset by id, or null when it cannot be read */
export type AssetReader = (id: string) => AssetFile | null;

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};
export const mimeOfName = (name: string) => MIME[name.split(/[?#]/)[0].split('.').pop()!.toLowerCase()] ?? 'application/octet-stream';

export function toBase64(d: Uint8Array): string {
  let s = '';
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
  return btoa(s);
}
export const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b[0] === 0x89 && b[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) };
  if (b[0] === 0x47 && b[1] === 0x49) return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  if (b[0] === 0x52 && b[8] === 0x57 && b[12] === 0x56) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (kind === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff };
    if (kind === 'VP8L') { const v = dv.getUint32(21, true); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = dv.getUint16(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

/** an asset as read from its bytes */
export function assetFile(type: string, name: string, data: Uint8Array): AssetFile {
  const size = type === 'image' ? imageSize(data) : null;
  return { data, mime: mimeOfName(name), width: size?.width ?? 0, height: size?.height ?? 0 };
}

/**
 * readAsset for the exporters in a browser: images and fonts of the document
 * fetched first (relative srcs resolve against base), then read at once.
 */
export async function fetchAssetReader(doc: TrammeDoc, base: string): Promise<AssetReader> {
  const files = new Map<string, AssetFile>();
  await Promise.all(Object.entries(doc.assets).filter(([, a]) => a.type === 'image' || a.type === 'font').map(async ([id, a]) => {
    const r = await fetch(new URL(a.src, base));
    if (r.ok) files.set(id, assetFile(a.type, a.src, new Uint8Array(await r.arrayBuffer())));
  }));
  return (id) => files.get(id) ?? null;
}
