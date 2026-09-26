// Loads every asset of a document before the first frame, so rendering
// never waits and never depends on timing. Paths resolve against the
// document's URL. sync() follows edits: only new or changed assets load.

import type { Asset, TrammeDoc } from '@tramme/core';
import { VideoFrames } from './video.ts';

export class AssetStore {
  private loaded = new Map<string, { key: string; entry: Asset; value: unknown }>();
  private doc: TrammeDoc;
  private base: string;
  /** bumped when a module reloads, so a changed plugin file is imported again */
  private version = 0;

  constructor(doc: TrammeDoc, docUrl: string) {
    this.doc = doc;
    this.base = docUrl;
  }

  info(id: string): Asset {
    const a = this.doc.assets[id];
    if (!a) throw new Error(`unknown asset: ${id}`);
    return a;
  }

  url(id: string): string {
    return new URL(this.info(id).src, this.base).href;
  }

  get<T>(id: string): T {
    const e = this.loaded.get(id);
    if (!e) throw new Error(`asset not loaded: ${id}`);
    return e.value as T;
  }

  has(id: string) { return this.loaded.has(id); }

  /** load what the document needs and is not loaded yet; `reload` forces some ids (a module edited on disk) */
  async sync(doc: TrammeDoc, reload: string[] = []): Promise<void> {
    this.doc = doc;
    for (const id of this.loaded.keys()) if (!doc.assets[id]) this.loaded.delete(id);
    if (reload.length) this.version++;
    await Promise.all(Object.entries(doc.assets).map(async ([id, a]) => {
      const have = this.loaded.get(id);
      if (have && !reload.includes(id)) {
        if (have.entry === a) return;
        const key = JSON.stringify(a);
        if (have.key === key) { have.entry = a; return; }
      }
      const key = JSON.stringify(a);
      try {
        this.loaded.set(id, { key, entry: a, value: await this.load(id, a) });
      } catch (e) {
        throw new Error(`asset "${id}" (${a.src}): ${(e as Error).message}`);
      }
    }));
    await document.fonts.ready;
  }

  private async load(id: string, a: Asset): Promise<unknown> {
    const url = this.url(id);
    switch (a.type) {
      case 'image': {
        // an ImageBitmap, not the <img>: Chrome resamples an <img> with its
        // own filter when it is scaled down, a bitmap like any canvas pixels
        const img = new Image();
        img.src = url;
        await img.decode();
        return createImageBitmap(img);
      }
      case 'font': {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const family = a.family || id;
        const face = new FontFace(family, await r.arrayBuffer(), { weight: a.weight || '400', style: a.style || 'normal' });
        await face.load();
        document.fonts.add(face);
        return family;
      }
      case 'module':
        return import(/* @vite-ignore */ this.version ? `${url}${url.includes('?') ? '&' : '?'}v=${this.version}` : url);
      case 'video':
        return VideoFrames.open(url);
      case 'json': {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }
      default:
        return url;
    }
  }
}
