// Runtime page driven by the CLI through Puppeteer: loads one document,
// validates it, loads its assets and exposes window.TRAMME.
//   /__tramme/?doc=/project/film.tramme.json[&comp=main]

import type { TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { encodeWav, mixComposition, Renderer, type RenderOptions } from '@tramme/render';

const q = new URLSearchParams(location.search);
const docUrl = new URL(q.get('doc') || '', location.href).href;
let renderer: Renderer;

async function init() {
  const r = await fetch(docUrl);
  if (!r.ok) throw new Error(`document not found: ${docUrl}`);
  const doc = (await r.json()) as TrammeDoc;
  renderer = await Renderer.open(doc, builtinRegistry(), docUrl, document.getElementById('out') as HTMLCanvasElement, { compId: q.get('comp') || doc.root });
}

const canvas = () => document.getElementById('out') as HTMLCanvasElement;

const dataUrl = (c: HTMLCanvasElement, type = 'image/png', quality?: number) => new Promise<string>((resolve, reject) => c.toBlob((b) => {
  if (!b) return reject(new Error('toBlob failed'));
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result as string);
  fr.readAsDataURL(b);
}, type, quality));

const api = {
  ready: init(),
  info() {
    const c = renderer.comp;
    return {
      title: renderer.doc.meta.title, comp: renderer.compId,
      width: c.width, height: c.height, fps: c.fps, duration: c.duration,
      frames: Math.round(c.duration * c.fps), markers: c.markers || [],
    };
  },
  /** switch to another version of the document (validated, new assets loaded) */
  async load(doc: TrammeDoc, compId?: string) {
    await renderer.setDoc(doc, { compId: compId || doc.root });
    return api.info();
  },
  /** PNG of one frame as a data URL; maxWidth scales it down (previews for the assistant) */
  async still(t: number, opts: RenderOptions = {}, maxWidth?: number): Promise<string> {
    await renderer.renderComplete(t, opts);
    const out = canvas();
    if (!maxWidth || out.width <= maxWidth) return dataUrl(out);
    const k = maxWidth / out.width, small = document.createElement('canvas');
    small.width = Math.round(out.width * k); small.height = Math.round(out.height * k);
    const ctx = small.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(out, 0, 0, small.width, small.height);
    return dataUrl(small);
  },
  /** the sound over [from, to] through the mixer of the editor, as a WAV in base64; null when there is none */
  async mix(from: number, to: number): Promise<string | null> {
    const buf = await mixComposition(renderer.doc, renderer.compId, (id) => renderer.assets.url(id), { from, to });
    if (!buf) return null;
    const bytes = encodeWav(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  /** stream frames [f0, f1) over the WebSocket: 'yuv' (4:2:0 BT.709) or 'rgba' (straight alpha); returns ms per frame */
  async capture(f0: number, f1: number, opts: RenderOptions = {}, kind: 'yuv' | 'rgba' = 'yuv'): Promise<number> {
    const { width: W, height: H, fps } = renderer.comp;
    const ws = new WebSocket(`ws://${location.host}/__tramme/ws`);
    ws.binaryType = 'arraybuffer';
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let waiting: (() => void) | null = null;
    ws.onmessage = () => { const r = waiting; waiting = null; r?.(); };
    const size = kind === 'rgba' ? W * H * 4 : (W * H * 3) / 2;
    const bufs = [new Uint8Array(size), new Uint8Array(size)];
    const t0 = performance.now();
    const progress = (window as any).__trammeProgress as ((done: number, total: number) => void) | undefined;
    let inflight: Promise<void> | null = null;
    for (let f = f0; f < f1; f++) {
      await renderer.renderComplete(f / fps, { ...opts, toFbo: true });
      const buf = bufs[f & 1];
      if (kind === 'rgba') renderer.compositor.readRGBA(buf, renderer.lastSeed);
      else renderer.compositor.readYUV(buf, renderer.lastSeed);
      if (inflight) await inflight; // one frame in flight while the next renders
      inflight = new Promise((r) => { waiting = r; });
      ws.send(buf);
      progress?.(f - f0 + 1, f1 - f0);
      if ((f - f0) % 30 === 29 || f === f1 - 1) {
        const n = f - f0 + 1;
        console.log(`image ${f + 1}/${f1}  ${((performance.now() - t0) / n).toFixed(0)} ms/image`);
      }
    }
    if (inflight) await inflight;
    ws.close();
    return (performance.now() - t0) / Math.max(1, f1 - f0);
  },
};

(window as any).TRAMME = api;
api.ready.catch((e) => console.error('[tramme]', e?.stack || e));
