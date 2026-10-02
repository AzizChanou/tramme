// The viewport's picture: the same Renderer as the export, fed with the
// document on screen. Playback follows the audio clock when there is sound.
// For speed, the preview renders at the size it is displayed (GPU raster),
// with one sub-frame while playing or dragging; once the picture stays still
// for a moment, it is drawn again with the full motion blur. While playing or
// dragging it also renders smaller, at a size that adapts to the frame rate
// the machine actually reaches; it is sharp again as soon as it stops.

/** render sizes the preview moves between (fractions of the composition) */
const NOTCHES = [0.25, 0.375, 0.5, 0.75, 1];
const notchAtMost = (x: number) => [...NOTCHES].reverse().find((k) => k <= x + 1e-6) ?? NOTCHES[0];

/** what the preview renders now, for the viewport and the settings: sizes as fractions of the composition */
export const previewInfo = signal({ scale: 1, still: 1, motion: 0.5 });

import { effect, signal } from '@preact/signals';
import { audioClips, type TrammeDoc, type EvaluatedFrame } from '@tramme/core';
import { editorRegistry } from './vocabulary.ts';
import { Renderer } from '@tramme/render';
import { comp, compIdOf, S, setRegistry, setTime, viewDoc } from './state.ts';
import { prefs } from './settings.ts';
import { syncPluginTours } from './tours/index.ts';

class Preview {
  readonly canvas: HTMLCanvasElement;
  renderer: Renderer | null = null;
  private applied: TrammeDoc | null = null;
  private wanted: TrammeDoc | null = null;
  private busy = false;
  private frameQueued = false;
  private audio: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private sources: AudioBufferSourceNode[] = [];
  /** sound of video layers: media elements playing their cut, and the timers that start and stop them */
  private media: HTMLAudioElement[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private clock = { at: 0, t0: 0, audio: false };
  private refineTimer: ReturnType<typeof setTimeout> | null = null;
  /** last rendered frame time (ms), shown in the transport */
  lastMs = 0;
  /** frames drawn and time spent drawing them, for measurements */
  stats = { frames: 0, ms: 0 };
  /** render size while moving, learnt from the frame rate during playback; ceiling: a size found too slow */
  private motion = { scale: 0.5, ceiling: 2, calm: 0, intervals: [] as number[], last: 0 };
  /** when the time last changed while paused (scrubbing the playhead) */
  private scrubAt = 0;
  /** the sharp frame being drawn in steps, cancelled by any change */
  private job: (() => EvaluatedFrame | null) | null = null;
  /** frame of the composition last drawn during playback (exact frames) */
  private playedFrame = -1;
  /** the document's motion blur sub-frames, from the last frame drawn */
  private docSamples = 1;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'picture';
  }

  async start() {
    try {
      this.renderer = await Renderer.open(S.doc.peek(), editorRegistry(), new URL(S.docUrl.peek(), location.href).href, this.canvas, { compId: compIdOf(S.doc.peek()), raster: 'gpu', scale: S.previewScale.peek(), preserve: false, isolate: true });
      this.applied = S.doc.peek();
      setRegistry(this.renderer.registry);
      this.pluginTours();
      S.renderError.value = null;
    } catch (e) {
      S.renderError.value = (e as Error).message;
      return;
    }
    effect(() => { this.wanted = viewDoc.value; void S.compId.value; this.sync(); });
    let lastT = -1;
    effect(() => {
      const t = S.time.value, playing = S.playing.value;
      if (!playing && t !== lastT) this.scrubAt = performance.now();
      if (!playing) this.playedFrame = -1;
      lastT = t;
      this.invalidate();
    });
    effect(() => { if (S.playing.value) this.play(); else this.stopAudio(); });
    effect(() => { void S.previewScale.value; void prefs.value; this.invalidate(); });
  }

  /** the tours exported by the project's plugins join the editor's */
  private pluginTours() {
    const r = this.renderer;
    if (!r) return;
    const doc = this.applied ?? S.doc.peek();
    syncPluginTours((doc.plugins ?? []).map((id) => { try { return { id, module: r.assets.get(id) }; } catch { return { id, module: null }; } }));
  }

  /** apply the latest wanted document, one at a time (asset loading is async) */
  private async sync() {
    if (this.busy || !this.renderer) return;
    const doc = this.wanted;
    const compId = doc ? compIdOf(doc) : S.compId.peek();
    if (!doc || (doc === this.applied && this.renderer.compId === compId)) return;
    this.busy = true;
    try {
      // a drag's draft comes from a valid document: no need to validate it again
      await this.renderer.setDoc(doc, { compId, trusted: doc === S.draft.peek() });
      this.applied = doc;
      setRegistry(this.renderer.registry);
      this.pluginTours();
      S.renderError.value = null;
    } catch (e) {
      S.renderError.value = (e as Error).message;
      this.applied = doc;
    } finally {
      this.busy = false;
    }
    this.invalidate();
    if (this.wanted !== this.applied) this.sync();
  }

  /** load a module asset again (a plugin edited on disk) */
  async reload(assetIds: string[]) {
    if (!this.renderer) return;
    await this.renderer.setDoc(this.applied!, { compId: compIdOf(this.applied!), reload: assetIds });
    setRegistry(this.renderer.registry);
    this.pluginTours();
    this.invalidate();
  }

  /** a small picture of the current frame, for the home screen */
  async thumbnail(t: number, width = 480): Promise<Blob | null> {
    const r = this.renderer;
    if (!r) return null;
    // every video frame exact, then drawn once more right before reading (the canvas keeps nothing between tasks)
    await r.renderComplete(t);
    r.render(t);
    const k = Math.min(1, width / this.canvas.width);
    const small = document.createElement('canvas');
    small.width = Math.round(this.canvas.width * k); small.height = Math.round(this.canvas.height * k);
    const ctx = small.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    // read right after drawing, before the WebGL canvas is presented
    ctx.drawImage(this.canvas, 0, 0, small.width, small.height);
    this.invalidate();
    return new Promise((res) => small.toBlob(res, 'image/webp', 0.82));
  }

  invalidate() {
    if (this.refineTimer) { clearTimeout(this.refineTimer); this.refineTimer = null; }
    this.job = null;
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame(() => {
      this.frameQueued = false;
      this.draw();
    });
  }

  /** render size once still: the size on screen, or the composition's full size (settings) */
  private stillScale() { return prefs.peek().still === 'full' ? 1 : S.previewScale.peek(); }

  /** render size while moving: learnt from the frame rate (automatic), or fixed in the settings */
  private motionScale(still: number) {
    const m = prefs.peek().motion;
    if (m === 'full') return still;
    if (m === 'half') return notchAtMost(still / 2);
    if (m === 'quarter') return notchAtMost(still / 4);
    return Math.min(still, this.motion.scale);
  }

  /** sub-frames of the sharp picture: the document's, at most 4, or 1 (settings) */
  private sharpSamples(): number | undefined {
    const b = prefs.peek().blur;
    return b === 'off' ? 1 : b === 'limited' ? Math.min(4, this.docSamples) : undefined;
  }

  private setScale(r: Renderer, k: number, still: number) {
    if (Math.abs(r.scale - k) > 1e-6) r.setScale(k);
    const info = previewInfo.peek();
    if (info.scale !== k || info.still !== still || info.motion !== this.motionScale(still)) previewInfo.value = { scale: k, still, motion: this.motionScale(still) };
  }

  /** one sub-frame, at the motion size while playing, dragging or scrubbing; the sharp picture follows once still */
  private draw() {
    const r = this.renderer;
    if (!r) return;
    const playing = S.playing.peek();
    if (playing) { this.advance(); this.adapt(this.stillScale()); } else this.motion.last = 0;
    // playback at the composition's own frames (as the export): nothing to draw between two of them
    let t = S.time.peek();
    if (playing && prefs.peek().exactFrames) {
      const fps = comp.peek().fps, f = Math.floor(t * fps + 1e-6);
      if (f === this.playedFrame) { this.invalidate(); return; }
      this.playedFrame = f;
      t = f / fps;
    }
    const moving = playing || S.draft.peek() !== null;
    const still = this.stillScale();
    const scrubbing = !playing && performance.now() - this.scrubAt < 250;
    this.setScale(r, moving || scrubbing ? this.motionScale(still) : still, still);
    const t0 = performance.now();
    try {
      const frame = r.render(t, { samples: 1, checker: true });
      this.docSamples = frame.motionBlur.samples;
      // a video frame still decoding: drawn again as soon as it is there
      if (r.incomplete) r.settle().then((waited) => { if (waited && !S.playing.peek()) this.invalidate(); });
      // a layer or effect that failed is drawn as a red frame: say which and why
      if (r.errors.size) S.renderError.value = `render: ${[...r.errors].map(([id, m]) => `${id}: ${m}`).join(' · ')}`;
      else if (S.renderError.peek()?.startsWith('render')) S.renderError.value = null;
      // still for a moment: the sharp picture, with its motion blur, at the still size
      const blurred = (this.sharpSamples() ?? frame.motionBlur.samples) > 1;
      if (!moving && (blurred || r.scale < still)) {
        this.refineTimer = setTimeout(() => { this.refineTimer = null; requestAnimationFrame(() => this.refine()); }, 180);
      }
    } catch (e) {
      S.renderError.value = `render: ${(e as Error).message}`;
    }
    this.lastMs = performance.now() - t0;
    this.stats.frames++;
    this.stats.ms += this.lastMs;
    if (S.playing.peek()) this.invalidate();
  }

  /**
   * The picture at full size and with its motion blur, drawn in slices of
   * about 10 ms over several animation frames: the interface never freezes,
   * and any change in between cancels it.
   */
  private refine() {
    const r = this.renderer;
    if (!r) return;
    const still = this.stillScale(), t = S.time.peek();
    try {
      // a new size clears the canvas: show a quick frame at that size first
      if (Math.abs(r.scale - still) > 1e-6) { this.setScale(r, still, still); r.render(t, { samples: 1, checker: true }); }
      const job = r.renderSteps(t, { checker: true, samples: this.sharpSamples() });
      this.job = job;
      const run = () => {
        if (this.job !== job) return;
        const t0 = performance.now();
        let done: EvaluatedFrame | null = null;
        while (!(done = job()) && performance.now() - t0 < 10) { /* next sub-frame */ }
        this.stats.frames++;
        this.stats.ms += performance.now() - t0;
        if (!done) { requestAnimationFrame(run); return; }
        this.job = null;
        // a video frame was missing: the sharp picture again once it is decoded
        if (r.incomplete) r.settle().then((waited) => { if (waited && !this.job && !S.playing.peek()) this.refine(); });
      };
      run();
    } catch (e) {
      S.renderError.value = `render: ${(e as Error).message}`;
    }
  }

  /** playback too slow: render smaller; comfortably fast: a little larger again, never back to a size found too slow */
  private adapt(target: number) {
    const m = this.motion, now = performance.now();
    if (m.last) m.intervals.push(now - m.last);
    m.last = now;
    if (m.intervals.length < 24) return;
    const avg = m.intervals.reduce((a, b) => a + b, 0) / m.intervals.length;
    m.intervals = [];
    const i = NOTCHES.indexOf(m.scale);
    // frames lost (under about 45 per second): smaller. The screen keeps its pace (60 Hz gives 16.7 ms): larger, step by step
    if (avg > 22 && i > 0) { m.ceiling = Math.min(m.ceiling, m.scale); m.scale = NOTCHES[i - 1]; m.calm = 0; }
    else if (avg < 18 && ++m.calm >= 2 && i < NOTCHES.length - 1 && NOTCHES[i + 1] < m.ceiling && NOTCHES[i + 1] <= target) { m.scale = NOTCHES[i + 1]; m.calm = 0; }
    else if (avg >= 18) m.calm = 0;
  }

  // ── playback ───────────────────────────────────────────────
  private now() {
    return this.clock.audio && this.audio ? this.audio.currentTime : performance.now() / 1000;
  }

  private advance() {
    const c = comp.peek();
    let t = this.clock.t0 + (this.now() - this.clock.at);
    if (t >= c.duration) {
      if (S.loop.peek()) { t = t % c.duration; this.play(t); }
      else { setTime(c.duration); S.playing.value = false; return; }
    }
    S.time.value = t;
  }

  private async play(from = S.time.peek()) {
    this.stopAudio();
    const doc = viewDoc.peek();
    // audio layers and the sound of videos, each from its in point to its out point (the cuts)
    const clips = audioClips(doc, compIdOf(doc)).filter((c) => c.at + c.duration > from);
    if (clips.length && !this.audio) this.audio = new AudioContext({ sampleRate: 48000 });
    if (this.audio) await this.audio.resume();
    this.clock = { at: this.now(), t0: from, audio: false };
    if (!this.audio || !this.renderer || !clips.length) return;
    const r = this.renderer, ctx = this.audio;
    const sounds = clips.filter((c) => doc.assets[c.asset].type !== 'video');
    const bufs = await Promise.all(sounds.map((c) => this.buffer(r.assets.url(c.asset))));
    if (!S.playing.peek()) return;
    const startAt = ctx.currentTime + 0.03;
    this.clock = { at: startAt, t0: from, audio: true };
    const gainNode = (db: number) => { const g = ctx.createGain(); g.gain.value = Math.pow(10, db / 20); g.connect(ctx.destination); return g; };
    sounds.forEach((c, i) => {
      const buf = bufs[i];
      if (!buf) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(gainNode(c.gainDb));
      const skip = Math.max(0, from - c.at);
      const offset = c.offset + skip, length = c.duration - skip;
      if (offset >= buf.duration || length <= 0) return;
      src.start(startAt + Math.max(0, c.at - from), offset, length);
      this.sources.push(src);
    });
    // a video's sound streams from its file (never decoded whole): one element per cut, started and stopped on the clock
    for (const c of clips.filter((x) => doc.assets[x.asset].type === 'video')) {
      const el = new Audio(r.assets.url(c.asset));
      el.preload = 'auto';
      ctx.createMediaElementSource(el).connect(gainNode(c.gainDb));
      const skip = Math.max(0, from - c.at);
      const begin = () => { el.currentTime = c.offset + skip; el.play().catch(() => {}); };
      const wait = Math.max(0, c.at - from) * 1000 + 30;
      this.timers.push(setTimeout(begin, wait), setTimeout(() => el.pause(), wait + (c.duration - skip) * 1000));
      this.media.push(el);
    }
  }

  private stopAudio() {
    for (const s of this.sources) { try { s.stop(); } catch { /* not started */ } }
    this.sources = [];
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const el of this.media) { el.pause(); el.removeAttribute('src'); el.load(); }
    this.media = [];
  }

  private buffer(url: string) {
    let p = this.buffers.get(url);
    if (!p) {
      p = fetch(url).then((r) => r.arrayBuffer()).then((b) => this.audio!.decodeAudioData(b)).catch(() => null);
      this.buffers.set(url, p);
    }
    return p;
  }
}

export const preview = new Preview();
