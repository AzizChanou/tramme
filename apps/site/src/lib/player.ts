// The site's players: the editor's engine (packages/render) playing a tramme
// document on a canvas, in a loop. Loaded once a player comes near the
// screen; the poster stays until the first frame is drawn.
//
// On the [data-player] element:
//   data-src        the document's URL (its assets resolve next to it)
//   data-max-scale  render size as a fraction of the composition, at most (default 1)
//   data-fps        frames drawn per second, at most (default: every animation frame)
//   data-start      where playback starts, in seconds (default 0)
// and optionally a [data-toggle] button inside for play / pause.

import type { TrammeDoc } from '@tramme/core';
import { builtinRegistry } from '@tramme/nodes';
import { Renderer } from '@tramme/render';

const base = builtinRegistry();
const docs = new Map<string, Promise<TrammeDoc>>();
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

function loadDoc(url: string): Promise<TrammeDoc> {
  let p = docs.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<TrammeDoc>;
    });
    docs.set(url, p);
  }
  return p;
}

export class Player {
  readonly root: HTMLElement;
  private canvas: HTMLCanvasElement;
  private toggle: HTMLButtonElement | null;
  private renderer: Renderer | null = null;
  private maxScale: number;
  private interval: number;
  private t = 0;
  private playing = false;
  private onScreen = true;
  private last = 0;
  private drawnAt = 0;
  private raf = 0;
  private sharpTimer: ReturnType<typeof setTimeout> | null = null;
  /** the latest load wins */
  private loading = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.canvas = root.querySelector('canvas')!;
    this.toggle = root.querySelector('[data-toggle]');
    this.maxScale = Number(root.dataset.maxScale ?? 1);
    this.interval = root.dataset.fps ? 1000 / Number(root.dataset.fps) : 0;
    this.toggle?.addEventListener('click', () => (this.playing ? this.pause() : this.play()));
    new IntersectionObserver(([e]) => {
      this.onScreen = e.isIntersecting;
      if (this.onScreen && this.playing) { this.last = performance.now(); this.tick(); }
    }).observe(root);
    new ResizeObserver(() => this.fit()).observe(this.canvas);
    document.addEventListener('visibilitychange', () => {
      this.onScreen = !document.hidden;
      if (this.onScreen && this.playing) { this.last = performance.now(); this.tick(); }
    });
  }

  async load(url: string) {
    const n = ++this.loading;
    this.root.dataset.state = 'loading';
    this.pause();
    try {
      const doc = await loadDoc(url);
      const comp = doc.compositions[doc.root];
      const r = await Renderer.open(doc, base, new URL(url, location.href).href, this.canvas, { raster: 'gpu', preserve: false, scale: this.scaleFor(comp.width) });
      if (n !== this.loading) { r.dispose(); return; }
      this.renderer?.dispose();
      this.renderer = r;
      this.t = Number(this.root.dataset.start ?? 0) % r.comp.duration;
      this.root.dataset.state = 'ready';
      if (reduced.matches) this.still(r.comp.duration * 0.6);
      else this.play();
    } catch (e) {
      if (n !== this.loading) return;
      console.error(e);
      this.root.dataset.state = 'error';
    }
  }

  play() {
    if (!this.renderer || this.playing) return;
    this.playing = true;
    this.root.dataset.playing = '';
    this.toggle?.setAttribute('aria-label', 'Pause');
    this.last = performance.now();
    this.tick();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    delete this.root.dataset.playing;
    this.toggle?.setAttribute('aria-label', 'Play');
    cancelAnimationFrame(this.raf);
    // once still, the frame again with the document's motion blur
    if (this.sharpTimer) clearTimeout(this.sharpTimer);
    this.sharpTimer = setTimeout(() => { if (!this.playing) this.draw(true); }, 160);
  }

  private still(t: number) {
    this.t = t;
    this.draw(true);
  }

  private tick = () => {
    cancelAnimationFrame(this.raf);
    if (!this.playing || !this.onScreen) return;
    this.raf = requestAnimationFrame((now) => {
      this.t = (this.t + Math.min(0.1, (now - this.last) / 1000)) % this.renderer!.comp.duration;
      this.last = now;
      if (now - this.drawnAt >= this.interval - 2) { this.drawnAt = now; this.draw(false); }
      this.tick();
    });
  };

  private draw(sharp: boolean) {
    const r = this.renderer;
    if (!r) return;
    r.render(this.t, sharp ? {} : { samples: 1 });
    this.root.dataset.drawn = '';
    // a video frame still decoding: drawn again once it is there
    if (r.incomplete) void r.settle().then((again) => { if (again && !this.playing) this.draw(sharp); });
  }

  /** render scale for the canvas's size on screen, in eighths, within the limit */
  private scaleFor(compWidth: number) {
    const k = Math.ceil(((this.canvas.clientWidth * devicePixelRatio) / compWidth) * 8) / 8;
    return Math.min(this.maxScale, Math.max(0.125, k));
  }

  private fit() {
    const r = this.renderer;
    if (!r || !this.canvas.clientWidth) return;
    r.setScale(this.scaleFor(r.comp.width));
    if (!this.playing) this.draw(true);
  }
}

const players = new WeakMap<HTMLElement, Player>();

/** the player of a [data-player] element, made (and its document loaded) on first use */
export function playerOf(root: HTMLElement): Player {
  let p = players.get(root);
  if (!p) {
    p = new Player(root);
    players.set(root, p);
    void p.load(root.dataset.src!);
  }
  return p;
}

