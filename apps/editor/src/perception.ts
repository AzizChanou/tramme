// What the material holds, found at authoring time and saved as JSON assets
// the render and the assistant read: the music (tempo, beats, bars, sections,
// loudness per band) and the shots of a video. Tools of the editor's
// vocabulary, run by the assistant (use_tool) or from the / menu.

import { ALL_FORMATS, AudioBufferSink, CanvasSink, Input, UrlSource } from 'mediabunny';
import { analyseAudio, pointer, type Op, type ToolContext, type ToolType } from '@tramme/core';
import { t } from './i18n/index.ts';

const RATE = 16000;

/** the sound of a media file, mono, decoded a minute at a time */
async function decodeMono(url: string, signal: AbortSignal): Promise<Float32Array> {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('this file has no sound');
    if (!(await track.canDecode())) throw new Error(`sound codec not supported by this browser (${track.codec ?? 'unknown'})`);
    const duration = await input.computeDuration(), sink = new AudioBufferSink(track);
    const out = new Float32Array(Math.ceil(duration * RATE));
    for (let from = 0; from < duration; from += 60) {
      if (signal.aborted) throw new Error('stopped');
      const to = Math.min(duration, from + 60);
      const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil((to - from) * RATE)), RATE);
      for await (const b of sink.buffers(from, to)) {
        const src = ctx.createBufferSource();
        src.buffer = b.buffer;
        src.connect(ctx.destination);
        src.start(Math.max(0, b.timestamp - from), Math.max(0, from - b.timestamp));
      }
      out.set((await ctx.startRendering()).getChannelData(0).subarray(0, out.length - Math.round(from * RATE)), Math.round(from * RATE));
    }
    return out;
  } finally {
    input.dispose();
  }
}

/** the media asset a tool works on: the one given, or the first sound, or the first video */
function mediaOf(ctx: ToolContext, asset: string | undefined, kinds: string[]): string {
  if (asset) {
    const a = ctx.doc.assets[asset];
    if (!a || !kinds.includes(a.type)) throw new Error(`${asset}: a ${kinds.join(' or ')} asset is expected`);
    return asset;
  }
  for (const k of kinds) { const id = Object.entries(ctx.doc.assets).find(([, a]) => a.type === k)?.[0]; if (id) return id; }
  throw new Error(`the project has no ${kinds.join(' or ')}`);
}

/** the analyses of the project (the JSON assets these tools save), loaded for the checks and the sounds' moments */
export async function analyses(ctx: ToolContext): Promise<(id: string) => unknown> {
  const loaded = new Map<string, unknown>();
  await Promise.all(Object.entries(ctx.doc.assets).filter(([id, a]) => a.type === 'json' && /^(analysis|subjects|shots)-/.test(id)).map(async ([id]) => {
    try { loaded.set(id, await (await fetch(ctx.assetUrl(id), { cache: 'no-store' })).json()); } catch { /* unreadable: left out */ }
  }));
  return (id) => loaded.get(id);
}

/** saves an analysis beside the media and declares it as an asset */
async function save(ctx: ToolContext, asset: string, kind: string, data: unknown, name: string): Promise<{ id: string; ops: Op[]; reload: string[] }> {
  const id = `${kind}-${asset}`.slice(0, 64);
  // asset ids are letters, digits, _ and -: safe in a path as they are
  const path = await ctx.writeFile(`assets/analysis/${asset}-${kind}.json`, JSON.stringify(data));
  const had = !!ctx.doc.assets[id];
  return { id, ops: [{ op: had ? 'replace' : 'add', path: pointer('assets', id), value: { type: 'json', src: path, name } }], reload: had ? [id] : [] };
}

const list = (xs: number[], max = 64) => `${xs.slice(0, max).map((x) => x.toFixed(2)).join(', ')}${xs.length > max ? ` … (${xs.length} in all)` : ''}`;

const beats: ToolType<{ asset?: string }> = {
  name: 'beats', title: 'Analyse the music', description: 'finds the tempo, the beats, the bars, the sections and the loudness of a sound or video, so the animation can follow the music',
  input: { type: 'object', properties: { asset: { type: 'string', format: 'asset', assetType: ['audio', 'video'], title: 'Sound' } } },
  ai: { when: 'before cutting to the beat or making things move with the music: then place cuts and entrances on the beats or bars it lists, and use the react modifier or audio() in expressions' },
  async run({ asset: wanted }, ctx) {
    const asset = mediaOf(ctx, wanted, ['audio', 'video']), a = ctx.doc.assets[asset];
    const analysis = analyseAudio(await decodeMono(ctx.assetUrl(asset), ctx.signal), RATE);
    analysis.source = asset;
    const { id, ops, reload } = await save(ctx, asset, 'analysis', analysis, `Analysis · ${a.name ?? asset}`);
    const layers = Object.entries(ctx.doc.compositions[ctx.compId].layers).filter(([, l]) => (l.type === 'audio' || l.type === 'video') && l.props?.[l.type] === asset).map(([lid]) => lid);
    const src = layers[0] ?? id;
    return {
      ops, reload, label: `Analysis of ${a.name ?? asset}`,
      text: [
        `Analysis of "${asset}" saved as asset "${id}" (${analysis.duration} s, times in the file${layers.length ? `; layer ${layers.join(', ')} plays it` : ''}).`,
        analysis.tempo ? `Tempo ${analysis.tempo} bpm, ${analysis.beats.length} beats, ${analysis.downbeats.length} bars.` : 'No steady pulse found (speech, ambience or free tempo): use the hits and the loudness.',
        analysis.downbeats.length ? `Bars at: ${list(analysis.downbeats)}` : '',
        analysis.beats.length ? `Beats at: ${list(analysis.beats, 96)}` : '',
        `Hits at: ${list(analysis.onsets, 48)}`,
        analysis.sections.length ? `Sections (the energy changes for good): ${analysis.sections.map((s) => `${s.t.toFixed(2)} s → level ${s.level}`).join(', ')}` : 'No clear section change.',
        `Follow it: modifier { "type": "react", "source": "${src}", "signal": "beat" | "bar" | "hit" | "rms" | "low" | "mid" | "high", "amount": 0.06, "decay": 0.18 }, or in an expression audio('${src}').pulse(0.2), .energy('low'), .beat, .bar, .phase, .section. With a layer id as source, times follow that layer; cut or enter on the bars for the strongest effect.`,
      ].filter(Boolean).join('\n'),
      notice: analysis.tempo
        ? t('perception.beatsDone', { tempo: analysis.tempo, beats: analysis.beats.length, bars: analysis.downbeats.length, sections: analysis.sections.length })
        : t('perception.noPulse', { hits: analysis.onsets.length }),
    };
  },
};

/** how different two small pictures are: their colour histograms, 0 (same) to 1 */
export function histogram(g: CanvasRenderingContext2D, w: number, h: number): Float32Array {
  const px = g.getImageData(0, 0, w, h).data, bins = new Float32Array(48), n = w * h;
  for (let i = 0; i < px.length; i += 4) { bins[px[i] >> 4]++; bins[16 + (px[i + 1] >> 4)]++; bins[32 + (px[i + 2] >> 4)]++; }
  for (let k = 0; k < 48; k++) bins[k] /= n;
  return bins;
}
export const distance = (a: Float32Array, b: Float32Array) => { let s = 0; for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]); return s / 6; };

const shots: ToolType<{ asset?: string; sensitivity?: number }> = {
  name: 'shots', title: 'Find the shots', description: 'finds the cuts between shots in a video',
  input: {
    type: 'object',
    properties: {
      asset: { type: 'string', format: 'asset', assetType: 'video', title: 'Video' },
      sensitivity: { type: 'number', minimum: 0.1, maximum: 1, title: 'Sensitivity', description: 'higher finds softer cuts (0.5 by default)' },
    },
  },
  ai: { when: 'before dressing a montage or footage edited elsewhere: titles and transitions land on the cuts it lists' },
  async run({ asset: wanted, sensitivity = 0.5 }, ctx) {
    const asset = mediaOf(ctx, wanted, ['video']), a = ctx.doc.assets[asset];
    const input = new Input({ source: new UrlSource(ctx.assetUrl(asset)), formats: ALL_FORMATS });
    const diffs: { t: number; d: number }[] = [];
    let duration = 0;
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error('this file has no picture');
      duration = await input.computeDuration();
      const W = 48, H = 27, step = 0.2, sink = new CanvasSink(track, { width: W, height: H, fit: 'fill', poolSize: 2 });
      const g = Object.assign(document.createElement('canvas'), { width: W, height: H }).getContext('2d', { willReadFrequently: true })!;
      const times = Array.from({ length: Math.floor(duration / step) }, (_, i) => +(i * step).toFixed(3));
      let prev: Float32Array | null = null, i = 0;
      for await (const frame of sink.canvasesAtTimestamps(times)) {
        if (ctx.signal.aborted) throw new Error('stopped');
        const at = times[i++];
        if (!frame) continue;
        g.drawImage(frame.canvas as CanvasImageSource, 0, 0, W, H);
        const h = histogram(g, W, H);
        if (prev) diffs.push({ t: at, d: distance(prev, h) });
        prev = h;
      }
    } finally {
      input.dispose();
    }
    // a cut: a jump well above its neighbourhood, at least 0.6 s from the previous one
    const threshold = 0.5 - 0.35 * sensitivity, cuts: number[] = [];
    diffs.forEach(({ t: at, d }, k) => {
      const around = diffs.slice(Math.max(0, k - 5), k + 6).filter((_, j) => j !== Math.min(5, k)).map((x) => x.d);
      const base = around.length ? around.reduce((s, x) => s + x, 0) / around.length : 0;
      if (d > threshold && d > base * 2.5 && (!cuts.length || at - cuts.at(-1)! >= 0.6)) cuts.push(+(at - 0.1).toFixed(2));
    });
    const bounds = [0, ...cuts, +duration.toFixed(2)];
    const data = { version: 1, kind: 'shots', source: asset, duration: +duration.toFixed(3), cuts, shots: bounds.slice(1).map((to, k) => ({ from: bounds[k], to })) };
    const { id, ops, reload } = await save(ctx, asset, 'shots', data, `Shots · ${a.name ?? asset}`);
    return {
      ops, reload, label: `Shots of ${a.name ?? asset}`,
      text: `${cuts.length} cut(s) in "${asset}" (times in the file), saved as asset "${id}": ${cuts.length ? list(cuts) : 'a single shot'}. Shots: ${data.shots.slice(0, 40).map((s) => `${s.from.toFixed(2)}-${s.to.toFixed(2)}`).join(', ')}.`,
      notice: t('perception.shotsDone', { cuts: cuts.length }),
    };
  },
};

// ── people in the picture ────────────────────────────────────
interface Detection { label: string; score: number; box: { xmin: number; ymin: number; xmax: number; ymax: number } }
type Detector = (image: unknown, opts: { threshold: number }) => Promise<Detection[]>;

/** a model loaded on first use and kept; a failed load is tried again next time */
export function onDemand<T>(what: string, load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () => (loading ??= load().catch((e) => { loading = null; throw new Error(`${what} could not load: ${(e as Error).message}`); }));
}

/** a small object detector (YOLOS tiny, a few MB), downloaded once and run in the browser: on the GPU (WebGPU), on the processor without one (much slower) */
const loadDetector = onDemand('the detection model', () => import('@huggingface/transformers').then(async ({ pipeline, RawImage }) => {
  const make = (opts: object) => pipeline('object-detection', 'Xenova/yolos-tiny', opts as never);
  const detect = (await ('gpu' in navigator ? make({ device: 'webgpu', dtype: 'fp32' }).catch(() => make({ dtype: 'q8' })) : make({ dtype: 'q8' }))) as unknown as Detector;
  return { detect, fromCanvas: (c: HTMLCanvasElement) => RawImage.fromCanvas(c) };
}));

export interface PersonBox { x: number; y: number; w: number; h: number; label: string; score: number }

/** the people in a picture (a canvas about 512 px wide is enough): boxes in 0..1 of its size */
export async function peopleIn(canvas: HTMLCanvasElement, threshold = 0.6): Promise<PersonBox[]> {
  const { detect, fromCanvas } = await loadDetector();
  const found = await detect(fromCanvas(canvas), { threshold });
  return found.filter((d) => d.label === 'person').map((d) => ({
    x: +(d.box.xmin / canvas.width).toFixed(3), y: +(d.box.ymin / canvas.height).toFixed(3),
    w: +((d.box.xmax - d.box.xmin) / canvas.width).toFixed(3), h: +((d.box.ymax - d.box.ymin) / canvas.height).toFixed(3), label: d.label, score: +d.score.toFixed(2),
  }));
}

/** where the people are, summed up for the assistant: their extent and the free sides */
function layoutOf(frames: { boxes: { x: number; y: number; w: number; h: number }[] }[]): string {
  const all = frames.flatMap((f) => f.boxes);
  if (!all.length) return 'Nobody found: the whole frame is free.';
  const x0 = Math.min(...all.map((b) => b.x)), x1 = Math.max(...all.map((b) => b.x + b.w)), y0 = Math.min(...all.map((b) => b.y)), y1 = Math.max(...all.map((b) => b.y + b.h));
  const free = [x0 > 0.3 && `left (x < ${x0.toFixed(2)})`, x1 < 0.7 && `right (x > ${x1.toFixed(2)})`, y0 > 0.2 && `top (y < ${y0.toFixed(2)})`, y1 < 0.8 && `bottom (y > ${y1.toFixed(2)})`].filter(Boolean);
  return `People seen over the whole span within x ${x0.toFixed(2)}..${x1.toFixed(2)}, y ${y0.toFixed(2)}..${y1.toFixed(2)} of the picture (0..1, the head in the top quarter of each box). ${free.length ? `Free for text: ${free.join(', ')}.` : 'No side stays free: put text above or below the head, on a band or a box.'}`;
}

const subjects: ToolType<{ asset?: string; every?: number }> = {
  name: 'subjects', title: 'Find the people', description: 'finds where the people are in a video or an image over time, so text and graphics stay off faces',
  input: {
    type: 'object',
    properties: {
      asset: { type: 'string', format: 'asset', assetType: ['video', 'image'], title: 'Video or image' },
      every: { type: 'number', minimum: 0.2, maximum: 5, title: 'Every (s)', description: 'time between two looks (0.5 s by default)' },
    },
  },
  ai: { when: 'before placing titles, captions or graphics over filmed people: the check tool then warns when text covers a face' },
  async run({ asset: wanted, every = 0.5 }, ctx) {
    const asset = mediaOf(ctx, wanted, ['video', 'image']), a = ctx.doc.assets[asset];
    const canvas = document.createElement('canvas'), g = canvas.getContext('2d', { willReadFrequently: true })!;
    const frames: { t: number; boxes: PersonBox[] }[] = [];
    const look = async (t: number, source: CanvasImageSource, w: number, h: number) => {
      const k = Math.min(1, 512 / Math.max(w, h));
      canvas.width = Math.round(w * k); canvas.height = Math.round(h * k);
      g.drawImage(source, 0, 0, canvas.width, canvas.height);
      frames.push({ t: +t.toFixed(3), boxes: await peopleIn(canvas) });
    };
    let width = 0, height = 0;
    if (a.type === 'image') {
      const img = new Image();
      img.src = ctx.assetUrl(asset);
      await img.decode();
      width = img.naturalWidth; height = img.naturalHeight;
      await look(0, img, width, height);
    } else {
      const input = new Input({ source: new UrlSource(ctx.assetUrl(asset)), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error('this file has no picture');
        width = track.displayWidth; height = track.displayHeight;
        const duration = await input.computeDuration(), step = Math.max(every, duration / 240);
        const times = Array.from({ length: Math.max(1, Math.floor(duration / step)) }, (_, i) => +(i * step).toFixed(3));
        const sink = new CanvasSink(track, { width: Math.round(width * Math.min(1, 512 / Math.max(width, height))), height: Math.round(height * Math.min(1, 512 / Math.max(width, height))), poolSize: 2 });
        let i = 0;
        for await (const f of sink.canvasesAtTimestamps(times)) {
          if (ctx.signal.aborted) throw new Error('stopped');
          const at = times[i++];
          if (f) await look(at, f.canvas as CanvasImageSource, (f.canvas as HTMLCanvasElement).width, (f.canvas as HTMLCanvasElement).height);
        }
      } finally {
        input.dispose();
      }
    }
    const data = { version: 1, kind: 'subjects', source: asset, width, height, frames };
    const { id, ops, reload } = await save(ctx, asset, 'subjects', data, `People · ${a.name ?? asset}`);
    const seen = frames.filter((f) => f.boxes.length).length;
    return {
      ops, reload, label: `People in ${a.name ?? asset}`,
      text: `People found in ${seen} of ${frames.length} look(s) at "${asset}", saved as asset "${id}". ${layoutOf(frames)} The check tool now warns when text covers a face.`,
      notice: t('perception.subjectsDone', { seen, looks: frames.length }),
    };
  },
};

// ── colours of the picture ───────────────────────────────────
/** the main colours of a picture: k-means on its pixels, the largest groups first */
export function dominant(px: Uint8ClampedArray, k = 5): { rgb: [number, number, number]; share: number }[] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 128) pts.push([px[i], px[i + 1], px[i + 2]]);
  if (!pts.length) return [];
  // seeds spread along the brightness, then a few rounds of assignment
  const sorted = [...pts].sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  let centres = Array.from({ length: k }, (_, i) => [...sorted[Math.floor(((i + 0.5) * sorted.length) / k)]] as [number, number, number]);
  let counts: number[] = [];
  for (let round = 0; round < 8; round++) {
    const sums = centres.map(() => [0, 0, 0]);
    counts = centres.map(() => 0);
    for (const p of pts) {
      let best = 0, bd = Infinity;
      centres.forEach((c, j) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; best = j; } });
      sums[best][0] += p[0]; sums[best][1] += p[1]; sums[best][2] += p[2]; counts[best]++;
    }
    centres = centres.map((c, j) => (counts[j] ? [sums[j][0] / counts[j], sums[j][1] / counts[j], sums[j][2] / counts[j]] : c) as [number, number, number]);
  }
  return centres.map((c, j) => ({ rgb: c.map(Math.round) as [number, number, number], share: counts[j] / pts.length })).filter((c) => c.share > 0.01).sort((a, b) => b.share - a.share);
}

const hex = ([r, g, b]: [number, number, number]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
const saturation = ([r, g, b]: [number, number, number]) => { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx ? (mx - mn) / mx : 0; };
const luma = ([r, g, b]: [number, number, number]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const palette: ToolType<{ asset?: string; t?: number; tokens?: boolean }> = {
  name: 'palette', title: 'Colours of a picture', description: 'takes the main colours of an image or a video frame and offers them as colour tokens (plate, ink, accent)',
  input: {
    type: 'object',
    properties: {
      asset: { type: 'string', format: 'asset', assetType: ['image', 'video'], title: 'Image or video' },
      t: { type: 'number', minimum: 0, title: 'Time in the video (s)' },
      tokens: { type: 'boolean', title: 'Make tokens', description: 'set plate, ink and accent from these colours (yes by default)' },
    },
  },
  ai: { when: 'dressing footage or a photo: graphics in the colours of the picture look designed for it' },
  async run({ asset: wanted, t: at = 0, tokens = true }, ctx) {
    const asset = mediaOf(ctx, wanted, ['image', 'video']), a = ctx.doc.assets[asset];
    const g = Object.assign(document.createElement('canvas'), { width: 96, height: 96 }).getContext('2d', { willReadFrequently: true })!;
    if (a.type === 'image') {
      const img = new Image();
      img.src = ctx.assetUrl(asset);
      await img.decode();
      g.drawImage(img, 0, 0, 96, 96);
    } else {
      const input = new Input({ source: new UrlSource(ctx.assetUrl(asset)), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error('this file has no picture');
        const f = await new CanvasSink(track, { width: 96, height: 96, fit: 'fill' }).getCanvas(at);
        if (!f) throw new Error(`no frame at ${at} s`);
        g.drawImage(f.canvas as CanvasImageSource, 0, 0, 96, 96);
      } finally { input.dispose(); }
    }
    const colours = dominant(g.getImageData(0, 0, 96, 96).data);
    if (!colours.length) throw new Error('no colour found');
    // the plate: the largest dark or light group; the ink: the most contrasting; the accent: the most saturated of the rest
    const plate = colours[0].rgb, ink = [...colours].sort((x, y) => Math.abs(luma(y.rgb) - luma(plate)) - Math.abs(luma(x.rgb) - luma(plate)))[0].rgb;
    const inkSafe: [number, number, number] = Math.abs(luma(ink) - luma(plate)) < 0.45 ? (luma(plate) > 0.5 ? [17, 17, 17] : [255, 255, 255]) : ink;
    const accent = [...colours].filter((c) => c.rgb !== plate).sort((x, y) => saturation(y.rgb) * (0.5 + y.share) - saturation(x.rgb) * (0.5 + x.share))[0]?.rgb ?? inkSafe;
    const ops: Op[] = tokens ? [
      ...colours.map((c, i) => ({ op: 'add' as const, path: pointer('tokens', `picture${i + 1}`), value: { type: 'color', value: hex(c.rgb), description: `${Math.round(c.share * 100)} % of ${asset}` } })),
      { op: 'add', path: pointer('tokens', 'plate'), value: { type: 'color', value: hex(plate) } },
      { op: 'add', path: pointer('tokens', 'ink'), value: { type: 'color', value: hex(inkSafe) } },
      { op: 'add', path: pointer('tokens', 'accent'), value: { type: 'color', value: hex(accent) } },
    ] : [];
    return {
      ops, label: `Colours of ${a.name ?? asset}`,
      text: `Main colours of "${asset}"${a.type === 'video' ? ` at ${at} s` : ''}: ${colours.map((c) => `${hex(c.rgb)} (${Math.round(c.share * 100)} %)`).join(', ')}. ${tokens ? `Tokens set: picture1..${colours.length}, plate ${hex(plate)}, ink ${hex(inkSafe)}, accent ${hex(accent)}.` : ''}`,
      notice: t('perception.paletteDone', { colours: colours.map((c) => hex(c.rgb)).join(' ') }),
    };
  },
};

export const PERCEPTION_TOOLS: ToolType[] = [beats, shots, subjects, palette];
