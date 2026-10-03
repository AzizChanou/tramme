// Text behind the subject: the person in a video cut out at authoring time
// (U²-Net makes the matte, the people detector keeps it to where people
// are), saved as a mask video timed like the file (white: the person), then
// the same video drawn again above itself through that mask (fx.matte, luma).
// Whatever lies between the video and its cut-out in the stack passes behind
// the person. The render only reads the mask: it stays a pure function of
// time, the same in the preview and in every export. A tool of the editor's
// vocabulary: the assistant runs it (use_tool), the user too (/ menu).

import { ALL_FORMATS, BufferTarget, CanvasSink, CanvasSource, getFirstEncodableVideoCodec, Input, Mp4OutputFormat, Output, Quality, UrlSource, type InputVideoTrack } from 'mediabunny';
import { pointer, type Op, type ToolType, type TrammeDoc } from '@tramme/core';
import { AVC_FROM_STREAM } from './avc.ts';
import { t } from './i18n/index.ts';
import { freshId, siblingsOf } from './model.ts';
import { canvas, CUT, distance, histogram, onDemand, peopleIn } from './perception.ts';

/** long side of the pictures the mattes are made at */
const PROC = 1024;
/** long side of the mask video, at most */
const MASK = 1280;
/** long side of the pictures the people are looked for in */
const LOOK = 512;
/** seconds between two looks for the people within a shot, by default: the detector is the slow part */
const LOOK_EVERY = 0.5;
/** the side of the square U²-Net looks at */
const SIDE = 320;

type Subject = 'person' | 'any';
interface Box { x: number; y: number; w: number; h: number }
/** a look for the people: when, in which shot, what was found */
export interface Look { t: number; shot: number; boxes: Box[] }

/**
 * U²-Net weights (Apache 2.0, from rembg, 4.6 MB each), at a fixed revision:
 * trained on people for a person, on salient objects for any subject. Small
 * convolutional networks, so they run on modest GPUs, where the larger
 * transformer mattes (BiRefNet) exceed WebGPU's limits.
 */
const MODELS: Record<Subject, string> = {
  person: 'https://huggingface.co/BritishWerewolf/U-2-Net-Human-Seg/resolve/e6d4c494535f62778e47f3676a5a3674de96b844/onnx/model.onnx',
  any: 'https://huggingface.co/BritishWerewolf/U-2-Netp/resolve/7112208dbac3a3642496c8d54e2f0f9bb3dc1dc8/onnx/model.onnx',
};

/** a file of the model hub, kept in the browser's cache (the one transformers.js uses) after the first download */
async function hubFile(url: string): Promise<ArrayBuffer> {
  const cache = await caches.open('transformers-cache').catch(() => null);
  const hit = await cache?.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  await cache?.put(url, res.clone()).catch(() => {});
  return res.arrayBuffer();
}

type Matting = (picture: HTMLCanvasElement) => Promise<Uint8ClampedArray>;
/** reports how far the work is (seconds of the span done, of all), at most once a percent */
type Progress = (done: number, total: number, step: string) => void;
const MATTING: Partial<Record<Subject, () => Promise<Matting>>> = {};

/** the matte of a picture, 0..255 per pixel at its size: on the GPU (WebGPU), on the processor when the GPU refuses the model */
function matting(subject: Subject): Promise<Matting> {
  return (MATTING[subject] ??= onDemand('the cut-out model', async () => {
    // transformers.js sets onnxruntime up (where its wasm files are): load it first
    await import('@huggingface/transformers');
    const ort = await import('onnxruntime-web/webgpu');
    const model = await hubFile(MODELS[subject]);
    const open = (ep: 'webgpu' | 'wasm') => ort.InferenceSession.create(model, { executionProviders: [ep] });
    let session = await ('gpu' in navigator ? open('webgpu').catch(() => open('wasm')) : open('wasm'));
    const square = canvas(SIDE, SIDE), probs = canvas(SIDE, SIDE), full = canvas(1, 1), x = new Float32Array(3 * SIDE * SIDE);
    const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
    const run = async () => {
      const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, SIDE, SIDE]) });
      return out[session.outputNames[0]].data as Float32Array;
    };
    let tried = false;
    return async (picture) => {
      // the picture squeezed into the square, scaled by its brightest value and normalised (as rembg does)
      square.g.drawImage(picture, 0, 0, SIDE, SIDE);
      const px = square.g.getImageData(0, 0, SIDE, SIDE).data, n = SIDE * SIDE;
      let top = 1;
      for (let i = 0; i < n; i++) top = Math.max(top, px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) x[k * n + i] = (px[i * 4 + k] / top - mean[k]) / std[k];
      let d: Float32Array;
      try { d = await run(); } catch (e) {
        // a GPU that accepts the session may still refuse a pass: once, the processor instead
        if (tried) throw e;
        tried = true;
        session = await open('wasm');
        d = await run();
      }
      tried = true;
      // probabilities (the network ends on a sigmoid), back to the picture's size
      const img = probs.g.createImageData(SIDE, SIDE);
      for (let i = 0; i < n; i++) { img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = d[i] * 255; img.data[i * 4 + 3] = 255; }
      probs.g.putImageData(img, 0, 0);
      if (full.c.width !== picture.width || full.c.height !== picture.height) Object.assign(full.c, { width: picture.width, height: picture.height });
      full.g.imageSmoothingQuality = 'high';
      full.g.drawImage(probs.c, 0, 0, picture.width, picture.height);
      const big = full.g.getImageData(0, 0, picture.width, picture.height).data, m = new Uint8ClampedArray(picture.width * picture.height);
      for (let i = 0; i < m.length; i++) m[i] = big[i * 4];
      return m;
    };
  }))();
}

/** where people are, 0..1 per pixel of a w × h picture: their boxes (0..1) widened for hair and arms, with feathered edges; 0 where nobody is */
export function gate(boxes: Box[], w: number, h: number): Float32Array {
  const out = new Float32Array(w * h), f = 0.04 * Math.max(w, h);
  const ramp = (d: number) => Math.min(1, Math.max(0, d / f + 0.5));
  for (const b of boxes) {
    const x0 = (b.x - 0.12 * b.w) * w, x1 = (b.x + 1.12 * b.w) * w, y0 = (b.y - 0.08 * b.h) * h, y1 = (b.y + 1.04 * b.h) * h;
    for (let y = Math.max(0, Math.floor(y0 - f)); y < Math.min(h, Math.ceil(y1 + f)); y++) {
      const ay = ramp(Math.min(y + 0.5 - y0, y1 - y - 0.5));
      for (let x = Math.max(0, Math.floor(x0 - f)); x < Math.min(w, Math.ceil(x1 + f)); x++) {
        const v = ay * ramp(Math.min(x + 0.5 - x0, x1 - x - 0.5)), i = y * w + x;
        if (v > out[i]) out[i] = v;
      }
    }
  }
  return out;
}

/** the matte kept where people are (no gate: everywhere), its faint haze cut and its nearly full values made full */
export function keep(matte: Uint8ClampedArray, where: Float32Array | null): Uint8ClampedArray {
  const out = new Uint8ClampedArray(matte.length);
  for (let i = 0; i < matte.length; i++) out[i] = ((matte[i] * (where ? where[i] : 1) - 16) * 255) / 224;
  return out;
}

/** a matte steadied by the previous one: small changes (flickering edges) averaged, large ones (a movement, a cut) taken as they are */
export function steady(prev: Uint8ClampedArray | null, cur: Uint8ClampedArray): Uint8ClampedArray {
  if (!prev || prev.length !== cur.length) return cur;
  const out = new Uint8ClampedArray(cur.length);
  for (let i = 0; i < cur.length; i++) out[i] = Math.abs(cur[i] - prev[i]) < 48 ? (cur[i] + prev[i]) >> 1 : cur[i];
  return out;
}

/**
 * The layers of a cut-out of `source` through the mask video `mask`: the mask
 * (hidden) and the person (the same video through it), right above the
 * source, following its frame and transform. Run again, it reuses them. A
 * layer given as `behind` goes just under them, so it passes behind the person.
 */
export function cutoutLayers(doc: TrammeDoc, compId: string, source: string, mask: string, behind?: string): { ops: Op[]; matte: string; front: string } {
  const c = doc.compositions[compId], l = c.layers[source];
  const ops: Op[] = [];
  let matte = Object.keys(c.layers).find((id) => c.layers[id].type === 'video' && c.layers[id].props?.video === mask);
  let front = matte && Object.keys(c.layers).find((id) => c.layers[id].effects?.some((e) => e.type === 'fx.matte' && e.props?.source === matte));
  const { path, list: was } = siblingsOf(c, source);
  let list = [...was];
  if (!matte || !front) {
    const taken: Record<string, unknown> = { ...c.layers };
    matte = freshId(taken, `${source}-mask`);
    taken[matte] = 1;
    front = freshId(taken, `${source}-subject`);
    const transform = Object.fromEntries(['anchor', 'position', 'scale', 'rotation', 'opacity', ...(l.transform?.depth !== undefined ? ['depth'] : [])].map((k) => [k, { $link: `${source}.transform.${k}` }]));
    const timing = { ...(l.in !== undefined ? { in: l.in } : {}), ...(l.out !== undefined ? { out: l.out } : {}) };
    // the mask is timed like the file: the same start, the same frame
    const frame = { start: l.props?.start ?? 0, size: { $link: `${source}.size` }, ...(l.props?.fit !== undefined ? { fit: l.props.fit } : {}), muted: true };
    const name = l.name ?? source;
    const effects = l.effects ?? [];
    ops.push(
      { op: 'add', path: pointer('compositions', compId, 'layers', matte), value: { type: 'video', name: t('perception.cutoutMask', { name }), visible: false, ...timing, transform, props: { video: mask, ...frame } } },
      { op: 'add', path: pointer('compositions', compId, 'layers', front), value: {
        type: 'video', name: t('perception.cutoutSubject', { name }), ...timing, ...(l.blend ? { blend: l.blend } : {}), transform,
        props: { ...l.props, ...frame },
        // the look of the source (its effects), then the mask
        effects: [...effects, { id: freshId(Object.fromEntries(effects.map((e) => [e.id, 1])), 'cutout'), type: 'fx.matte', props: { source: matte, mode: 'luma' } }],
      } },
    );
    list.splice(list.indexOf(source) + 1, 0, matte, front);
  }
  if (behind) {
    if (behind === source || behind === matte || behind === front) throw new Error(`${behind}: a layer other than the video and its cut-out is expected behind the subject`);
    if (!list.includes(behind)) throw new Error(`${behind}: put it in the same group as ${source} first`);
    list = list.filter((id) => id !== behind);
    list.splice(Math.min(list.indexOf(matte), list.indexOf(front)), 0, behind);
  }
  if (list.join() !== was.join()) ops.push({ op: 'replace', path: pointer('compositions', compId, ...path), value: list });
  return { ops, matte, front };
}

/** the people at time t in a shot: those of the nearest look in that shot (none when it was not looked at) */
export function peopleAt(looks: Look[], t: number, shot: number): Box[] {
  let best: Look | null = null;
  for (const l of looks) if (l.shot === shot && (!best || Math.abs(l.t - t) < Math.abs(best.t - t))) best = l;
  return best?.boxes ?? [];
}

/** a first, quick pass over [from, to) of a track: its shots (a frame's time → its shot) and the people, looked for at each cut and every `every` s within a shot */
async function lookForPeople(track: InputVideoTrack, from: number, to: number, every: number, [w, h]: number[], signal: AbortSignal, progress: Progress): Promise<{ shotAt: Map<number, number>; looks: Look[] }> {
  const look = canvas(w, h), sink = new CanvasSink(track, { width: w, height: h, fit: 'fill', poolSize: 2 });
  const shotAt = new Map<number, number>(), looks: Look[] = [];
  let shot = 0, seen: Float32Array | null = null, last = -Infinity;
  for await (const f of sink.canvases(from, to)) {
    if (signal.aborted) throw new Error('stopped');
    look.g.drawImage(f.canvas as CanvasImageSource, 0, 0);
    const hist = histogram(look.g, w, h), cut = !!seen && distance(seen, hist) > CUT;
    seen = hist;
    if (cut) shot++;
    shotAt.set(Math.round(f.timestamp * 1000), shot);
    progress(f.timestamp - from, to - from, t('perception.cutoutLooking'));
    if (cut || f.timestamp - last >= every) {
      looks.push({ t: f.timestamp, shot, boxes: await peopleIn(look.c) });
      last = f.timestamp;
    }
  }
  return { shotAt, looks };
}

/** the mask video of the subject in [from, to) of a file: white where it is, black elsewhere and outside that span, timed like the file */
async function matteVideo(url: string, from: number, to: number, subject: Subject, every: number, signal: AbortSignal, progress: Progress): Promise<{ blob: Blob; frames: number; empty: number }> {
  if (typeof VideoEncoder === 'undefined') throw new Error('this browser cannot encode video (WebCodecs)');
  const matte = await matting(subject);
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('this file has no picture');
    if (!(await track.canDecode())) throw new Error(`video codec not supported by this browser (${track.codec ?? 'unknown'})`);
    const duration = await input.computeDuration();
    const iw = track.displayWidth, ih = track.displayHeight;
    // even sizes: what the encoders take
    const sized = (side: number) => { const k = Math.min(1, side / Math.max(iw, ih)); return [Math.max(2, Math.round((iw * k) / 2) * 2), Math.max(2, Math.round((ih * k) / 2) * 2)]; };
    const [pw, ph] = sized(PROC), [W, H] = sized(MASK);
    const people = subject === 'person' ? await lookForPeople(track, from, to, every, sized(LOOK), signal, progress) : null;
    const picture = canvas(pw, ph), small = canvas(pw, ph), out = canvas(W, H);
    out.g.imageSmoothingQuality = 'high';
    const sink = new CanvasSink(track, { width: pw, height: ph, fit: 'fill', poolSize: 2 });
    const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width: W, height: H });
    if (!codec) throw new Error(`no video codec can encode ${W}×${H} in this browser`);
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const video = new CanvasSource(out.c, { codec, quality: new Quality('very-high'), keyFrameInterval: 2, ...(codec === 'avc' ? AVC_FROM_STREAM : {}) });
    output.addVideoTrack(video);
    await output.start();
    // one black frame over a span without the subject
    const black = async (at: number, until: number) => {
      if (until - at < 1e-3) return;
      out.g.fillStyle = '#000';
      out.g.fillRect(0, 0, W, H);
      await video.add(at, until - at);
    };
    const img = small.g.createImageData(pw, ph);
    let end = 0, frames = 0, empty = 0, prev: Uint8ClampedArray | null = null;
    try {
      for await (const f of sink.canvases(from, to)) {
        if (signal.aborted) throw new Error('stopped');
        await black(end, f.timestamp);
        picture.g.drawImage(f.canvas as CanvasImageSource, 0, 0);
        let where: Float32Array | null = null;
        if (people) {
          const boxes = peopleAt(people.looks, f.timestamp, people.shotAt.get(Math.round(f.timestamp * 1000)) ?? 0);
          if (!boxes.length) empty++;
          where = gate(boxes, pw, ph);
        }
        prev = steady(prev, keep(await matte(picture.c), where));
        for (let i = 0, d = img.data; i < prev.length; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = prev[i]; d[i * 4 + 3] = 255; }
        small.g.putImageData(img, 0, 0);
        out.g.drawImage(small.c, 0, 0, W, H);
        await video.add(f.timestamp, f.duration);
        end = f.timestamp + f.duration;
        frames++;
        progress(end - from, to - from, t('perception.cutoutMatting'));
      }
      if (!frames) throw new Error(`no picture between ${from.toFixed(2)} and ${to.toFixed(2)} s of the file`);
      await black(end, duration);
      await output.finalize();
    } catch (e) {
      await output.cancel();
      throw e;
    }
    return { blob: new Blob([target.buffer!], { type: 'video/mp4' }), frames, empty };
  } finally {
    input.dispose();
  }
}

const r2 = (x: number) => Math.round(x * 100) / 100;

const cutout: ToolType<{ layer?: string; subject?: Subject; behind?: string; from?: number; to?: number; every?: number }> = {
  name: 'cutout', title: 'Cut out the subject', description: 'cuts the person (or the main subject) out of a video so titles and graphics can pass behind them',
  input: {
    type: 'object',
    properties: {
      layer: { type: 'string', format: 'layer', layerType: 'video', title: 'Video layer', description: 'the footage to cut out (the selected video by default)' },
      subject: { enum: ['person', 'any'], default: 'person', title: 'Subject', description: 'person: only the people found in the picture (by default); any: the main subject, whatever it is (a car, an object)' },
      behind: { type: 'string', format: 'layer', title: 'Behind the subject', description: 'a layer (a title) put between the video and the subject' },
      from: { type: 'number', minimum: 0, title: 'From (s)', description: 'composition time (the start of the video layer by default)' },
      to: { type: 'number', minimum: 0, title: 'To (s)', description: 'composition time (the end of the video layer by default)' },
      every: { type: 'number', minimum: 0.1, maximum: 2, default: LOOK_EVERY, title: 'Every (s)', description: 'time between two looks for the people within a shot (0.5 s by default); shorter for quick inserts between shots, slower' },
    },
  },
  ai: {
    when: 'a title or graphics behind a filmed person (big words the person stands in front of): cut out the span where they show, then keep those layers between the video and its cut-out in the stack',
    avoid: 'cutting out a whole long video for a title of a few seconds: give from and to, every frame goes through the model (about a second each)',
  },
  async run({ layer: wanted, subject = 'person', behind, from, to, every = LOOK_EVERY }, ctx) {
    const c = ctx.doc.compositions[ctx.compId];
    const source = wanted ?? ctx.selection.find((id) => c.layers[id]?.type === 'video') ?? Object.keys(c.layers).find((id) => c.layers[id].type === 'video' && !c.layers[id].effects?.some((e) => e.type === 'fx.matte'));
    if (!source) throw new Error('the composition has no video layer');
    const l = c.layers[source];
    if (l?.type !== 'video') throw new Error(`${source}: a video layer is expected`);
    const asset = l.props?.video;
    if (typeof asset !== 'string' || !ctx.doc.assets[asset]) throw new Error(`${source}: this layer has no video file`);
    const start = typeof l.props?.start === 'number' ? l.props.start : 0, lin = l.in ?? 0, lout = l.out ?? c.duration;
    const a = Math.max(lin, from ?? lin), b = Math.min(lout, to ?? lout);
    if (b <= a) throw new Error(`nothing to cut out: ${source} shows from ${r2(lin)} to ${r2(lout)} s`);
    // one mask per layer: run again, it is rewritten. The layers are laid out first: a wrong input fails before the long work
    const mask = `cutout-${source}`.slice(0, 64);
    const { ops, matte, front } = cutoutLayers(ctx.doc, ctx.compId, source, mask, behind);
    let shown = '';
    const progress: Progress = (done, total, step) => {
      const at = `${step} ${Math.floor((100 * done) / total)}`;
      if (at !== shown) { shown = at; ctx.progress?.(done, total, step); }
    };
    const { blob, frames, empty } = await matteVideo(ctx.assetUrl(asset), start + a - lin, start + b - lin, subject, every, ctx.signal, progress);
    const src = await ctx.writeFile(`assets/cutout/${source}.mp4`, blob);
    const had = !!ctx.doc.assets[mask];
    const asAsset: Op = { op: had ? 'replace' : 'add', path: pointer('assets', mask), value: { type: 'video', src, name: t('perception.cutoutMask', { name: ctx.doc.assets[asset].name ?? asset }) } };
    const who = subject === 'person' ? 'person' : 'subject';
    return {
      ops: [asAsset, ...ops], reload: had ? [mask] : [], label: t('perception.cutoutLabel', { name: l.name ?? source }),
      text: [
        `${subject === 'person' ? 'People' : 'Main subject'} cut out of "${source}" from ${r2(a)} to ${r2(b)} s (${frames} frames${empty ? `, nobody found in ${empty} of them: the mask is empty there` : ''}): mask video saved as asset "${mask}", layers "${matte}" (the mask, hidden) and "${front}" (the same video through the mask) right above "${source}".`,
        `Layers between "${source}" and "${matte}" in the stack pass behind the ${who}: put the titles there.${behind ? ` "${behind}" is there now.` : ''} Outside ${r2(a)}–${r2(b)} s the mask is empty, so everything stays in front of the video.`,
        `The cut-out follows the frame and transform of "${source}" (links). If you trim or move "${source}" in time, give "${matte}" and "${front}" the same in, out and start, then run cutout again for a new span.`,
      ].join('\n'),
      notice: t('perception.cutoutDone', { frames, from: r2(a), to: r2(b) }),
    };
  },
};

export const CUTOUT_TOOLS: ToolType[] = [cutout];
