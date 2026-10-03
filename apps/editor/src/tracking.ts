// Tracked callouts in the editor. The track tool follows something filmed
// (framed by a rectangle drawn over it, a region of the picture or its name)
// through a video once, at authoring time, and saves where it is over time as
// a JSON asset; the callout tool puts brackets and a label on it, a callout
// layer that reads the track as it renders. Tools of the editor's vocabulary:
// the assistant runs them (use_tool), the user too (/ menu).

import { ALL_FORMATS, CanvasSink, Input, UrlSource, type InputVideoTrack } from 'mediabunny';
import { applyMat, Evaluator, following, grayFrame, invertMat, isTrack, layerMatrix, matMul, pictureRect, pointer, trackId, type Box, type Composition, type GrayFrame, type Mat2D, type Op, type ToolContext, type ToolType, type Track, type Vec2 } from '@tramme/core';
import { t } from './i18n/index.ts';
import { freshId, parentOf, siblingsOf, slug } from './model.ts';
import { canvas, CUT, distance, histogram, objectsIn, readJson } from './perception.ts';
import { compOf, r } from './recipes.ts';
import { sheetOf } from './review.ts';

/** the long side of the pictures the tracker looks at (px) */
const LOOK = 320;

/** words for what the detector knows (its labels are COCO's) */
const SAME: Record<string, string> = {
  people: 'person', man: 'person', woman: 'person', boy: 'person', girl: 'person', kid: 'person', child: 'person', guy: 'person',
  bike: 'bicycle', motorbike: 'motorcycle', phone: 'cell phone', board: 'surfboard', table: 'dining table', sofa: 'couch', plane: 'airplane',
  personne: 'person', homme: 'person', femme: 'person', enfant: 'person', voiture: 'car', chien: 'dog', chat: 'cat', 'vélo': 'bicycle',
  moto: 'motorcycle', bateau: 'boat', planche: 'surfboard', bouteille: 'bottle', 'téléphone': 'cell phone', camion: 'truck',
};

/** a region written by hand: x, y, width, height in % of the picture ("40, 30, 20, 25"), or as fractions of it */
export function parseRegion(v: string | unknown[]): Box {
  const n = (Array.isArray(v) ? v : String(v).split(/[\s,;]+/).filter(Boolean)).map((x) => Number(String(x).replace('%', '')));
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x) || x < 0) || !(n[2] > 0 && n[3] > 0)) throw new Error('region: x, y, width, height expected, in % of the picture ("40, 30, 20, 25")');
  const k = n.some((x) => x > 1) ? 100 : 1;
  return n.map((x) => x / k) as Box;
}

/** a layer's matrix in the composition at time t: its own, then its parents' */
function worldMatrix(ev: Evaluator, c: Composition, compId: string, id: string, at: number): Mat2D {
  let m = layerMatrix(ev.layerAt(id, at, compId).transform);
  for (let p = parentOf(c, id); p; p = parentOf(c, p)) m = matMul(layerMatrix(ev.layerAt(p, at, compId).transform), m);
  return m;
}

/** points of the composition at time t as a box of the video's picture (fractions), through where the video layer shows it */
export function toPicture(ev: Evaluator, c: Composition, compId: string, videoId: string, at: number, points: Vec2[], picW: number, picH: number): Box {
  const L = ev.layerAt(videoId, at, compId), [w, h] = L.props.size as Vec2, rect = pictureRect(String(L.props.fit), w, h, picW, picH);
  const inv = invertMat(worldMatrix(ev, c, compId, videoId, at));
  if (!inv) throw new Error(`${videoId} is flattened (a scale of 0)`);
  const uv = points.map((p) => applyMat(inv, p)).map(([x, y]) => [(x - rect.x) / rect.w, (y - rect.y) / rect.h]);
  const x0 = Math.max(0, Math.min(...uv.map((p) => p[0]))), y0 = Math.max(0, Math.min(...uv.map((p) => p[1])));
  const x1 = Math.min(1, Math.max(...uv.map((p) => p[0]))), y1 = Math.min(1, Math.max(...uv.map((p) => p[1])));
  if (x1 - x0 <= 0 || y1 - y0 <= 0) throw new Error('the frame is outside the picture of the video');
  return [x0, y0, x1 - x0, y1 - y0];
}

/** the video layer a tool works on: the one given, the selected one, or the only one */
function videoLayer(ctx: ToolContext, wanted?: string): string {
  const c = compOf(ctx), videos = Object.keys(c.layers).filter((id) => c.layers[id].type === 'video');
  const id = wanted ?? ctx.selection.find((s) => c.layers[s]?.type === 'video') ?? (videos.length === 1 ? videos[0] : undefined);
  if (!id) throw new Error(videos.length ? `which video? Select it or name it (${videos.join(', ')})` : 'the composition has no video layer');
  if (c.layers[id]?.type !== 'video') throw new Error(`${id} is not a video layer`);
  return id;
}

/** an object named, found by the detector in the picture at file time t: its box (fractions) and its label */
async function detected(vt: InputVideoTrack, at: number, object: string): Promise<{ box: Box; label: string }> {
  const W = vt.displayWidth, H = vt.displayHeight, k = Math.min(1, 512 / Math.max(W, H)), w = Math.round(W * k), h = Math.round(H * k);
  const f = await new CanvasSink(vt, { width: w, height: h, fit: 'fill' }).getCanvas(at);
  if (!f) throw new Error(`no picture at ${r(at)} s of the file`);
  const pic = canvas(w, h);
  pic.g.drawImage(f.canvas as CanvasImageSource, 0, 0, w, h);
  const want = SAME[object.trim().toLowerCase()] ?? object.trim().toLowerCase(), all = await objectsIn(pic.c, 0.5);
  const best = all.filter((d) => d.label === want).sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (!best) throw new Error(`no ${object} found at the current time (${all.length ? `seen: ${[...new Set(all.map((d) => d.label))].join(', ')}` : 'nothing recognised'}): draw a rectangle over it instead`);
  return { box: [best.x, best.y, best.w, best.h], label: best.label };
}

/** a strip of a few looks with the box drawn on them, each labelled, to check the track at a glance (JPEG data URL) */
function strip(kept: Map<number, HTMLCanvasElement>, boxes: (Box | null)[], label: (i: number) => string): string | null {
  const seen = [...kept.keys()].filter((i) => boxes[i]).sort((a, b) => a - b);
  const pick = seen.length <= 4 ? seen : [0, 1, 2, 3].map((k) => seen[Math.round((k * (seen.length - 1)) / 3)]);
  if (!pick.length) return null;
  const cells = pick.map((i) => {
    const look = kept.get(i)!, g = look.getContext('2d')!, [bx, by, bw, bh] = boxes[i]!;
    g.strokeStyle = '#E5402A'; g.lineWidth = 2;
    g.strokeRect(bx * look.width, by * look.height, bw * look.width, bh * look.height);
    return { image: look, label: label(i) };
  });
  return sheetOf(cells, cells[0].image.width, cells[0].image.height, cells.length);
}

interface TrackArgs { video?: string; rectangle?: string; region?: string | unknown[]; object?: string; name?: string; from?: number; to?: number; every?: number }

const track: ToolType<TrackArgs> = {
  name: 'track', title: 'Track an object', description: 'follows something filmed through a video (a car, a person, a product) from a rectangle drawn over it at the current time, a region of the picture or its name, and saves where it is over time: callouts and expressions follow it',
  input: {
    type: 'object',
    properties: {
      video: { type: 'string', format: 'layer', layerType: 'video', title: 'Video' },
      rectangle: { type: 'string', format: 'layer', title: 'Frame', description: 'a rectangle drawn over the object at the current time (the selected rectangle by default)' },
      region: { type: ['string', 'array'], title: 'Region', description: 'or where it is in the picture at the current time: x, y, width, height in % of the picture ("40, 30, 20, 25")' },
      object: { type: 'string', title: 'Object', description: 'or what it is, found at the current time: person, car, dog, bicycle, surfboard, bottle…' },
      name: { type: 'string', title: 'Name', description: 'of the track: the object by default; the same name replaces it' },
      from: { type: 'number', minimum: 0, title: 'From (s)', description: 'composition time; the start of the video layer by default' },
      to: { type: 'number', minimum: 0, title: 'To (s)', description: 'composition time; the end of the video layer by default' },
      every: { type: 'number', minimum: 0.04, maximum: 1, title: 'Every (s)', description: 'time between two looks (0.1 s by default; shorter for fast motion, but slower)' },
    },
  },
  ai: { when: 'a label, brackets or a pointer that must stay on something moving in the footage: look at the frame first (media_frame), give the object (person, car, dog…) or its region in % of the picture at a moment where it shows clearly, then check the strip it returns and add a callout', avoid: 'objects smaller than about 3 % of the picture, or hidden for long stretches; tracking a whole long video when one shot is enough (from, to)' },
  async run(a, ctx) {
    const c = compOf(ctx), videoId = videoLayer(ctx, a.video), vl = c.layers[videoId], asset = String(vl.props?.video ?? '');
    if (!ctx.doc.assets[asset]) throw new Error(`${videoId} plays no video file`);
    const start = Number(vl.props?.start ?? 0) || 0, vin = vl.in ?? 0, vout = vl.out ?? c.duration, now = ctx.time;
    const from = Math.max(vin, a.from ?? vin), to = Math.min(vout, a.to ?? vout), every = a.every ?? 0.1, file = (at: number) => start + at - vin;
    if (now < from || now > to) throw new Error(`track: the current time (${r(now)} s) is outside the span followed (${r(from)} to ${r(to)} s of "${videoId}"): put the playhead where the object shows`);
    const ev = new Evaluator(ctx.doc, ctx.registry);
    const rect = a.rectangle ?? (a.region === undefined && !a.object ? ctx.selection.find((id) => c.layers[id]?.type === 'shape.rect') : undefined);
    if (rect && c.layers[rect]?.type !== 'shape.rect') throw new Error(`${rect} is not a rectangle`);
    if (!rect && a.region === undefined && !a.object) throw new Error('track: frame the object first: draw a rectangle over it at the current time and select it, or give its region or what it is');
    // looks every `every` seconds of the file, the current time among them
    const t0 = file(now), before = Math.floor((t0 - file(from)) / every + 1e-9), after = Math.floor((file(to) - t0) / every + 1e-9);
    const times = Array.from({ length: before + after + 1 }, (_, i) => +(t0 + (i - before) * every).toFixed(4));
    if (times.length > 3000) throw new Error(`track: ${times.length} looks are too many: follow a shorter span (from, to) or look less often (every)`);
    const input = new Input({ source: new UrlSource(ctx.assetUrl(asset)), formats: ALL_FORMATS });
    try {
      const vt = await input.getPrimaryVideoTrack();
      if (!vt) throw new Error('this file has no picture');
      const W = vt.displayWidth, H = vt.displayHeight;
      // where the object is now, as fractions of the picture
      let box: Box, how: string, what = a.object ?? '';
      if (rect) {
        const L = ev.layerAt(rect, now, ctx.compId), [rw, rh] = L.props.size as Vec2, m = worldMatrix(ev, c, ctx.compId, rect, now);
        box = toPicture(ev, c, ctx.compId, videoId, now, ([[-rw / 2, -rh / 2], [rw / 2, -rh / 2], [-rw / 2, rh / 2], [rw / 2, rh / 2]] as Vec2[]).map((p) => applyMat(m, p)), W, H);
        how = `the rectangle "${rect}"`;
      } else if (a.region !== undefined) { box = parseRegion(a.region); how = 'the region given'; }
      else { const d = await detected(vt, t0, a.object!); box = d.box; what = d.label; how = `the ${d.label} found`; }
      // the file at a small size, as luma, and where its shots change
      const k = Math.min(1, LOOK / Math.max(W, H)), sw = Math.round(W * k), sh = Math.round(H * k);
      const look = canvas(sw, sh), sink = new CanvasSink(vt, { width: sw, height: sh, fit: 'fill', poolSize: 2 });
      const frames: GrayFrame[] = [], cuts: boolean[] = [], kept = new Map<number, HTMLCanvasElement>(), keepEvery = Math.max(1, Math.floor(times.length / 12));
      let was: Float32Array | null = null;
      for await (const f of sink.canvasesAtTimestamps(times)) {
        if (ctx.signal.aborted) throw new Error('stopped');
        ctx.progress?.(frames.length + 1, times.length, t('tracking.reading'));
        // no picture at that time (past the end): the last one stays
        if (f) look.g.drawImage(f.canvas as CanvasImageSource, 0, 0, sw, sh);
        if (frames.length % keepEvery === 0) { const copy = canvas(sw, sh); copy.g.drawImage(look.c, 0, 0); kept.set(frames.length, copy.c); }
        const hist = histogram(look.g, sw, sh);
        cuts.push(!!was && distance(was, hist) > CUT);
        was = hist;
        frames.push(grayFrame(look.g.getImageData(0, 0, sw, sh).data, sw, sh));
      }
      // following, a few frames at a time so the editor stays alive; a cut ends it
      const steps = following(frames, before, { x: box[0] * sw, y: box[1] * sh, w: box[2] * sw, h: box[3] * sh }, { cuts });
      let s = steps.next();
      while (!s.done) {
        if (s.value % 8 === 0) {
          ctx.progress?.(s.value, frames.length, t('tracking.following'));
          await new Promise((done) => setTimeout(done, 0));
          if (ctx.signal.aborted) throw new Error('stopped');
        }
        s = steps.next();
      }
      const boxes = s.value.map((f) => (f ? ([f.box.x / sw, f.box.y / sh, f.box.w / sw, f.box.h / sh].map((x) => Math.round(x * 1e4) / 1e4) as Box) : null));
      const name = slug(a.name || what || 'object').slice(0, 24) || 'object', id = trackId(asset, name);
      const data: Track = { version: 1, kind: 'track', source: asset, name, width: W, height: H, frames: times.map((at, i) => ({ t: at, box: boxes[i] })) };
      const path = await ctx.writeFile(`assets/tracks/${asset}-${name}.json`, JSON.stringify(data));
      const had = ctx.doc.assets[id], entry = { type: 'json' as const, src: path, name: `Track · ${name}` };
      // what was seen, in composition time
      const seen = times.filter((_, i) => boxes[i]).map((at) => r(vin + at - start)), share = Math.round((100 * seen.length) / times.length);
      const image = strip(kept, boxes, (i) => `${(vin + times[i] - start).toFixed(2)} s`);
      return {
        ops: had?.type === 'json' && had.src === entry.src ? [] : [{ op: had ? 'replace' : 'add', path: pointer('assets', id), value: entry }],
        reload: had ? [id] : [],
        label: t('tracking.trackLabel', { name }),
        text: `Track "${name}" of "${asset}" saved as asset "${id}", from ${how} at ${r(now)} s: seen in ${seen.length} of ${times.length} looks (${share} %)${seen.length ? `, from ${seen[0]} to ${seen.at(-1)} s in the composition` : ''}. ${image ? 'Check it on the strip (the red box on a few looks). ' : ''}Put brackets and a label on it with use_tool "callout" { "track": "${id}", "label": "…" }; in expressions: track('${videoId}', '${name}').center, .box, .size, .found.`,
        notice: t('tracking.done', { name, share, from: seen[0] ?? r(from), to: seen.at(-1) ?? r(to) }),
        ...(image ? { images: [{ url: image, caption: t('tracking.trackLabel', { name }) }] } : {}),
      };
    } finally {
      input.dispose();
    }
  },
};

interface CalloutArgs { track?: string; label?: string; detail?: string; side?: 'auto' | 'right' | 'left' | 'above' | 'below'; line?: boolean; video?: string; at?: number; duration?: number }

const callout: ToolType<CalloutArgs> = {
  name: 'callout', title: 'Callout', description: 'brackets and a label on something tracked in a video, following it (a car, a person, a product); after the track tool',
  input: {
    type: 'object',
    properties: {
      track: { type: 'string', format: 'asset', assetType: 'json', title: 'Track', description: 'the latest track by default' },
      label: { type: 'string', title: 'Label', description: 'e.g. "EV.00 · THE CAR"; the name of the track by default' },
      detail: { type: 'string', title: 'Detail', description: 'after the label, lighter: "1990s estate · powder blue"' },
      side: { enum: ['auto', 'right', 'left', 'above', 'below'], title: 'Side' },
      line: { type: 'boolean', title: 'Line', description: 'a line from the object to its label' },
      video: { type: 'string', format: 'layer', layerType: 'video', title: 'Video', description: 'the layer the object is filmed in (the one playing the tracked file by default)' },
      at: { type: 'number', minimum: 0, title: 'Start (s)', description: 'composition time; when the object is first seen by default' },
      duration: { type: 'number', minimum: 0.2, title: 'Duration (s)', description: 'as long as the object is seen by default' },
    },
  },
  ai: { when: 'naming or pointing at what was tracked: short labels in capitals, a detail after it; a line when the label would sit over something that matters', avoid: 'two callouts on the same object; labels over about 32 characters' },
  async run(a, ctx) {
    const c = compOf(ctx), tracks = Object.keys(ctx.doc.assets).filter((id) => id.startsWith('track-') && ctx.doc.assets[id].type === 'json');
    const id = a.track ?? tracks.at(-1);
    if (!id) throw new Error('no track yet: follow the object with the track tool first');
    if (!ctx.doc.assets[id]) throw new Error(`unknown asset: ${id}`);
    const data = await readJson(ctx, id);
    if (!isTrack(data)) throw new Error(`${id} is not a track`);
    const tr = data, playing = Object.keys(c.layers).filter((lid) => c.layers[lid].type === 'video' && c.layers[lid].props?.video === tr.source);
    const videoId = a.video ?? ctx.selection.find((s) => playing.includes(s)) ?? playing[0];
    if (!videoId || !playing.includes(videoId)) throw new Error(`no video layer of this composition plays ${tr.source ?? 'the file tracked'}${a.video ? ` ("${a.video}" plays another one)` : ''}`);
    const vl = c.layers[videoId], start = Number(vl.props?.start ?? 0) || 0, vin = vl.in ?? 0, vout = vl.out ?? c.duration;
    // when the object shows, in composition time, while its layer plays
    const seen = tr.frames.filter((f) => f.box).map((f) => vin + f.t - start).filter((at) => at >= vin && at < vout);
    if (!seen.length && a.at === undefined) throw new Error(`the object of ${id} is never seen while "${videoId}" plays`);
    const step = tr.frames.length > 1 ? (tr.frames.at(-1)!.t - tr.frames[0].t) / (tr.frames.length - 1) : 0.1;
    const at = r(a.at ?? Math.min(...seen)), end = r(Math.min(vout, a.duration ? at + a.duration : Math.max(...seen) + step));
    const label = a.label ?? (tr.name ?? 'object').toUpperCase(), lid = freshId(c.layers, 'callout');
    // right above its video, in the same group
    const { path, list } = siblingsOf(c, videoId), k = list.indexOf(videoId) + 1;
    const ops: Op[] = [
      { op: 'add', path: pointer('compositions', ctx.compId, 'layers', lid), value: {
        type: 'callout', name: label, in: at, out: end,
        props: { source: videoId, track: id, label, ...(a.detail ? { detail: a.detail } : {}), ...(a.side ? { side: a.side } : {}), ...(a.line ? { line: true } : {}), size: Math.round(Math.min(c.width, c.height) * 0.026) },
      } },
      { op: 'replace', path: pointer('compositions', ctx.compId, ...path), value: [...list.slice(0, k), lid, ...list.slice(k)] },
    ];
    return {
      ops, label: t('tracking.calloutLabel', { label }),
      text: `Callout "${label}" (layer "${lid}", type callout) right above "${videoId}", from ${at} to ${end} s: brackets on the object of ${id} and its label beside them, following it, fading where it is lost. It reads the track through the video layer: move or retime the video and it follows.`,
    };
  },
};

export const TRACKING_TOOLS: ToolType[] = [track, callout];
