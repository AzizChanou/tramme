// Export to Lottie (bodymovin 5): a composition and the compositions it
// nests become a Lottie animation that lottie-web and the native players read.
//   - keyframes with Bézier eases map one to one (same tangent model);
//     expressions, links and modifiers are baked frame by frame
//   - shapes become shape layers (rect, ellipse, path, fill, stroke, gradients)
//   - text becomes a text layer (static weight); images are embedded
//   - groups become null parents; nested compositions become precomps
//   - clips become alpha track mattes; blur and drop shadow become Lottie effects
// What Lottie cannot express (code, shaders, particles, finishing effects) is
// left out and reported in `warnings`.

import { drawingAt, Evaluator, getAt, localFrame, modsOf, parseColor, pointer, propKind, resolveTokens, type Composition, type TrammeDoc, type Keyframe, type Layer, type PathValue, type PropDef, type Registry } from '@tramme/core';
import { toBase64 } from './bytes.ts';

type Json = Record<string, any>;

export interface LottieOptions {
  compId?: string;
  /** bytes of an asset file, for embedding images (Node: read from disk) */
  readAsset?: (assetId: string) => { data: Uint8Array; mime: string; width: number; height: number } | null;
}

export interface LottieResult { lottie: Json; warnings: string[] }

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const rgba01 = (css: string) => { const [r, g, b, a] = parseColor(css); return [r3(r / 255), r3(g / 255), r3(b / 255), r3(a)]; };

class Exporter {
  doc: TrammeDoc;
  ev: Evaluator;
  reg: Registry;
  opts: LottieOptions;
  warnings: string[] = [];
  assets: Json[] = [];
  fonts = new Map<string, Json>();
  private precomps = new Set<string>();

  constructor(doc: TrammeDoc, reg: Registry, opts: LottieOptions) {
    this.doc = doc; this.reg = reg; this.opts = opts;
    this.ev = new Evaluator(doc, reg);
  }

  warn(s: string) { if (!this.warnings.includes(s)) this.warnings.push(s); }

  // ── properties ─────────────────────────────────────────────
  /**
   * A Lottie property from an tramme one: keyframes as keyframes when they
   * are plain, a baked track otherwise, a static value when nothing moves.
   */
  prop(compId: string, address: string, raw: unknown, def: PropDef, map: (v: unknown) => number[] | number, range: [number, number], spatial = false): Json {
    const comp = this.doc.compositions[compId];
    const fps = comp.fps;
    const kind = raw === undefined ? 'static' : propKind(raw);
    const plain = kind === 'keyframes' && !(raw as any).$expr && !modsOf(raw) && ['number', 'vec2', 'color'].includes(def.type);
    if (kind === 'static' && !modsOf(raw)) return { a: 0, k: map(this.ev.value(address, range[0], compId)) };
    if (plain) {
      const keys = (raw as { $k: Keyframe[] }).$k;
      if (keys.length === 1) return { a: 0, k: map(resolveTokens(def.type, keys[0].v, this.doc.tokens)) };
      return {
        a: 1,
        k: keys.map((key, i) => {
          const s = map(resolveTokens(def.type, key.v, this.doc.tokens));
          const out: Json = { t: r3(key.t * fps), s: Array.isArray(s) ? s : [s] };
          if (i < keys.length - 1) {
            const e = this.bezier(key.ease);
            if (e === 'hold') out.h = 1;
            else { out.o = { x: [e[0]], y: [e[1]] }; out.i = { x: [e[2]], y: [e[3]] }; }
            if (spatial) { out.to = [0, 0, 0]; out.ti = [0, 0, 0]; }
          }
          return out;
        }),
      };
    }
    return this.bake(compId, address, map, range, spatial);
  }

  bezier(e: Keyframe['ease']): [number, number, number, number] | 'hold' {
    if (e === undefined || e === 'linear') return [0, 0, 1, 1];
    if (e === 'hold') return 'hold';
    if (typeof e === 'string') { const v = this.doc.tokens[e.slice(1)]?.value; return Array.isArray(v) ? (v as any) : [0, 0, 1, 1]; }
    return e;
  }

  /** sample every frame, then keep only the frames needed for linear keys to stay within 0.01 of every sample */
  bake(compId: string, address: string, map: (v: unknown) => number[] | number, [a, b]: [number, number], spatial: boolean): Json {
    const fps = this.doc.compositions[compId].fps;
    const f0 = Math.floor(a * fps), f1 = Math.ceil(b * fps);
    const vals: number[][] = [];
    for (let f = f0; f <= f1; f++) {
      const v = map(this.ev.value(address, f / fps, compId));
      vals.push(Array.isArray(v) ? v : [v]);
    }
    const same = (x: number[], y: number[]) => x.every((n, i) => Math.abs(n - y[i]) < 1e-4);
    if (vals.every((v) => same(v, vals[0]))) return { a: 0, k: vals[0].length === 1 ? vals[0][0] : vals[0] };
    const kept = [0];
    const fits = (a: number, b: number) => {
      for (let j = a + 1; j < b; j++) {
        const u = (j - a) / (b - a);
        if (vals[j].some((v, k) => Math.abs(v - (vals[a][k] + (vals[b][k] - vals[a][k]) * u)) > 0.01)) return false;
      }
      return true;
    };
    for (let i = 1; i < vals.length; i++) {
      // extend the current straight run as long as it fits, keep the frame before it breaks
      if (i < vals.length - 1 && fits(kept[kept.length - 1], i + 1)) continue;
      kept.push(i);
    }
    const keys = kept.map((i, n) => {
      const key: Json = { t: f0 + i, s: vals[i].map(r3) };
      if (n < kept.length - 1) { key.o = { x: [0], y: [0] }; key.i = { x: [1], y: [1] }; if (spatial) { key.to = [0, 0, 0]; key.ti = [0, 0, 0]; } }
      return key;
    });
    return { a: 1, k: keys };
  }

  // ── layers ─────────────────────────────────────────────────
  transform(compId: string, id: string, layer: Layer, range: [number, number], extraAnchor: [number, number] = [0, 0], scaleBy: [number, number] = [1, 1]): Json {
    const t = layer.transform || {};
    const d = (k: string): PropDef => ({ anchor: { type: 'vec2', default: [0, 0] }, position: { type: 'vec2', default: [0, 0] }, scale: { type: 'vec2', default: [1, 1] }, rotation: { type: 'number', default: 0 }, opacity: { type: 'number', default: 1 } } as Record<string, PropDef>)[k];
    const A = `${id}.transform.`;
    return {
      // anchor' = (anchor + extra) / scaleBy: the inner framing of images and nested compositions
      a: this.prop(compId, A + 'anchor', t.anchor, d('anchor'), (v) => { const [x, y] = v as number[]; return [r3((x + extraAnchor[0]) / scaleBy[0]), r3((y + extraAnchor[1]) / scaleBy[1]), 0]; }, range, true),
      p: this.prop(compId, A + 'position', t.position, d('position'), (v) => [r3((v as number[])[0]), r3((v as number[])[1]), 0], range, true),
      s: this.prop(compId, A + 'scale', t.scale, d('scale'), (v) => [r3((v as number[])[0] * 100 * scaleBy[0]), r3((v as number[])[1] * 100 * scaleBy[1]), 100], range),
      r: this.prop(compId, A + 'rotation', t.rotation, d('rotation'), (v) => r3(v as number), range),
      o: this.prop(compId, A + 'opacity', t.opacity, d('opacity'), (v) => r3((v as number) * 100), range),
    };
  }

  /** Lottie layers of a composition (top first, as Lottie wants) */
  layers(compId: string): Json[] {
    const comp = this.doc.compositions[compId];
    const out: Json[] = [];
    let ind = 0;
    const walk = (ids: string[], parent: number | null, range: [number, number]) => {
      for (let i = ids.length - 1; i >= 0; i--) {
        const id = ids[i], layer = comp.layers[id];
        if (!layer || layer.visible === false) continue;
        const r: [number, number] = [Math.max(range[0], layer.in ?? 0), Math.min(range[1], layer.out ?? comp.duration)];
        if (r[1] <= r[0]) continue;
        const made = this.layer(compId, id, layer, r, ++ind);
        if (!made) continue;
        if (parent !== null) made.parent = parent;
        if (layer.clip && comp.layers[layer.clip]) {
          const matte = this.layer(compId, layer.clip, comp.layers[layer.clip], r, ++ind);
          if (matte) {
            matte.td = 1;
            if (parent !== null) matte.parent = parent;
            out.push(matte);
            made.tt = 1;
          } else this.warn(`clip of "${layer.name ?? id}" not exported`);
        }
        out.push(made);
        if (layer.children?.length) walk(layer.children, made.ind, r);
      }
    };
    walk(comp.order, null, [0, comp.duration]);
    return out;
  }

  base(compId: string, id: string, layer: Layer, range: [number, number], ind: number, ty: number): Json {
    const fps = this.doc.compositions[compId].fps;
    const out: Json = { ddd: 0, ind, ty, nm: layer.name ?? id, sr: 1, ao: 0, ip: r3(range[0] * fps), op: r3(range[1] * fps), st: 0, bm: BLEND[layer.blend ?? 'normal'] ?? 0 };
    const fx = this.effects(compId, id, layer, range);
    if (fx.length) out.ef = fx;
    return out;
  }

  layer(compId: string, id: string, layer: Layer, range: [number, number], ind: number): Json | null {
    const name = layer.name ?? id;
    if (!this.reg.hasNode(layer.type)) { this.warn(`unknown type "${layer.type}": "${name}" left out`); return null; }
    const P = (n: string) => layer.props?.[n];
    const def = (n: string) => this.reg.node(layer.type).props[n];
    const at = (n: string) => this.ev.value(`${id}.${n}`, range[0], compId);
    switch (layer.type) {
      case 'group': return { ...this.base(compId, id, layer, range, ind, 3), ks: this.transform(compId, id, layer, range) };
      case 'shape.rect': case 'shape.ellipse': case 'shape.path': {
        const geo: Json = layer.type === 'shape.rect'
          ? { ty: 'rc', d: 1, p: { a: 0, k: [0, 0] }, s: this.prop(compId, `${id}.size`, P('size'), def('size'), (v) => (v as number[]).map(r3), range), r: this.prop(compId, `${id}.radius`, P('radius'), def('radius'), (v) => r3(v as number), range) }
          : layer.type === 'shape.ellipse'
            ? { ty: 'el', d: 1, p: { a: 0, k: [0, 0] }, s: this.prop(compId, `${id}.size`, P('size'), def('size'), (v) => (v as number[]).map(r3), range) }
            : { ty: 'sh', d: 1, ks: this.pathProp(compId, id, P('path'), range) };
        const items: Json[] = [geo];
        const fill = this.paint(compId, id, 'fill', range, false);
        const stroke = this.paint(compId, id, 'stroke', range, true);
        if (stroke) items.push(stroke);
        if (fill) items.push(fill);
        items.push({ ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } });
        return { ...this.base(compId, id, layer, range, ind, 4), ks: this.transform(compId, id, layer, range), shapes: [{ ty: 'gr', nm: name, it: items }] };
      }
      case 'text': return this.text(compId, id, layer, range, ind);
      case 'image': return this.image(compId, id, layer, range, ind);
      case 'sequence': return this.sequence(compId, id, layer, range, ind);
      case 'comp': {
        const target = at('comp') as string | null;
        const nested = target ? this.doc.compositions[target] : null;
        if (!nested) return null;
        this.precomp(target!);
        const fps = this.doc.compositions[compId].fps;
        const out: Json = { ...this.base(compId, id, layer, range, ind, 0), refId: `comp_${target}`, w: nested.width, h: nested.height, ks: this.transform(compId, id, layer, range, [nested.width / 2, nested.height / 2]) };
        const p = { start: at('start') as number, speed: at('speed') as number, loop: at('loop') as boolean, remap: at('remap') as number | null };
        const simple = propKind(P('start') ?? 0) === 'static' && propKind(P('speed') ?? 1) === 'static' && !p.loop && p.remap === null && P('remap') === undefined;
        if (simple && p.speed > 0) { out.st = r3(((layer.in ?? 0) - p.start / p.speed) * fps); out.sr = r3(1 / p.speed); }
        else {
          // local time, baked as a Lottie time remap (seconds)
          const keys: Json[] = [];
          for (let f = Math.floor(range[0] * fps); f <= Math.ceil(range[1] * fps); f++) {
            const t = f / fps;
            let lt: number = (this.ev.value(`${id}.remap`, t, compId) as number | null) ?? (this.ev.value(`${id}.start`, t, compId) as number) + (t - (layer.in ?? 0)) * (this.ev.value(`${id}.speed`, t, compId) as number);
            if (p.loop) lt = ((lt % nested.duration) + nested.duration) % nested.duration;
            keys.push({ t: f, s: [r3(lt)], o: { x: [0], y: [0] }, i: { x: [1], y: [1] }, h: 1 });
          }
          out.tm = { a: 1, k: keys };
        }
        return out;
      }
      case 'audio': return null;
      default: {
        // a plugin node may give its Lottie shapes, from its props at the in point
        const ex = this.reg.node(layer.type).export?.lottie;
        if (ex) {
          if (Object.values(layer.props ?? {}).some((v) => propKind(v) !== 'static')) this.warn(`animated properties of "${name}": frozen at its first frame in Lottie`);
          const items = ex(this.ev.layerAt(id, range[0], compId).props) as Json[];
          items.push({ ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } });
          return { ...this.base(compId, id, layer, range, ind, 4), ks: this.transform(compId, id, layer, range), shapes: [{ ty: 'gr', nm: name, it: items }] };
        }
      }
        this.warn(`"${name}" (${layer.type}) has no Lottie equivalent: left out`);
        return null;
    }
  }

  pathProp(compId: string, id: string, raw: unknown, range: [number, number]): Json {
    const toL = (v: unknown) => {
      const p = v as PathValue, z = p.v.map(() => [0, 0]);
      return { c: !!p.closed, v: p.v.map((q) => q.map(r3)), i: (p.i ?? z).map((q) => q.map(r3)), o: (p.o ?? z).map((q) => q.map(r3)) };
    };
    if (raw === undefined || propKind(raw) === 'static') return { a: 0, k: toL(this.ev.value(`${id}.path`, range[0], compId)) };
    const kf = (raw as { $k?: Keyframe[] }).$k;
    if (propKind(raw) === 'keyframes' && kf && !(raw as any).$expr && !modsOf(raw)) {
      const fps = this.doc.compositions[compId].fps;
      return {
        a: 1, k: kf.map((key, i) => {
          const out: Json = { t: r3(key.t * fps), s: [toL(key.v)] };
          if (i < kf.length - 1) { const e = this.bezier(key.ease); if (e === 'hold') out.h = 1; else { out.o = { x: [e[0]], y: [e[1]] }; out.i = { x: [e[2]], y: [e[3]] }; } }
          return out;
        }),
      };
    }
    this.warn(`path of "${id}" driven by an expression: frozen at its first frame`);
    return { a: 0, k: toL(this.ev.value(`${id}.path`, range[0], compId)) };
  }

  /** fill or stroke item of a shape: colour or gradient */
  paint(compId: string, id: string, name: 'fill' | 'stroke', range: [number, number], stroke: boolean): Json | null {
    const layer = this.doc.compositions[compId].layers[id];
    const raw = layer.props?.[name];
    const value = this.ev.value(`${id}.${name}`, range[0], compId) as any;
    if (value === null || value === undefined) return null;
    const width = stroke ? this.prop(compId, `${id}.strokeWidth`, layer.props?.strokeWidth, { type: 'number', default: 2 }, (v) => r3(v as number), range) : null;
    const isPath = layer.type === 'shape.path';
    const lineCap = isPath ? { butt: 1, round: 2, square: 3 }[String(this.ev.value(`${id}.lineCap`, range[0], compId))] ?? 1 : 1;
    const lineJoin = isPath ? { miter: 1, round: 2, bevel: 3 }[String(this.ev.value(`${id}.lineJoin`, range[0], compId))] ?? 1 : 1;
    const strokeExtra = stroke ? { w: width, lc: lineCap, lj: lineJoin, ml: 4 } : {};
    if (typeof value === 'string') {
      const c = this.prop(compId, `${id}.${name}`, raw, { type: 'paint', default: null }, (v) => rgba01(v as string), range);
      return { ty: stroke ? 'st' : 'fl', c, o: { a: 0, k: r3(rgba01(value)[3] * 100) }, r: 1, ...strokeExtra };
    }
    if (propKind(raw) !== 'static') this.warn(`animated gradient of "${layer.name ?? id}": frozen at its first frame`);
    const stops = value.stops as [number, string][];
    const cols = stops.flatMap(([o, c]) => [r3(o), ...rgba01(c).slice(0, 3)]);
    const alphas = stops.flatMap(([o, c]) => [r3(o), rgba01(c)[3]]);
    const g = { p: stops.length, k: { a: 0, k: [...cols, ...alphas] } };
    const [s, e] = value.type === 'linear' ? [value.from, value.to] : [value.center, [value.center[0] + value.radius, value.center[1]]];
    return { ty: stroke ? 'gs' : 'gf', o: { a: 0, k: 100 }, r: 1, s: { a: 0, k: s.map(r3) }, e: { a: 0, k: e.map(r3) }, t: value.type === 'linear' ? 1 : 2, g, ...strokeExtra };
  }

  text(compId: string, id: string, layer: Layer, range: [number, number], ind: number): Json {
    const v = (n: string) => this.ev.value(`${id}.${n}`, range[0], compId) as any;
    const fontId = v('font') as string | null;
    const family = fontId ? this.doc.assets[fontId]?.family || fontId : 'sans-serif';
    // Lottie has one weight per text: take where an animated weight settles
    const wraw = layer.props?.weight as { $k?: Keyframe[] } | undefined;
    const weight = Math.round(wraw?.$k ? Number(wraw.$k.at(-1)!.v) : v('weight'));
    const style = weight >= 700 ? 'Bold' : weight >= 600 ? 'SemiBold' : weight >= 500 ? 'Medium' : weight <= 300 ? 'Light' : 'Regular';
    const fName = `${family}-${style}`.replace(/\s+/g, '');
    if (!this.fonts.has(fName)) this.fonts.set(fName, { fName, fFamily: family, fStyle: style, ascent: 75 });
    if (propKind(layer.props?.weight ?? 0) !== 'static') this.warn(`animated weight of "${layer.name ?? id}": Lottie keeps a fixed weight`);
    const color = v('color');
    const size = v('size') as number;
    const doc: Json = {
      s: size, f: fName, t: String(v('text')).replace(/\n/g, '\r'),
      j: { left: 0, right: 1, center: 2 }[v('align') as string] ?? 0,
      tr: r3((v('tracking') as number) * 1000), lh: r3(size * (v('lineHeight') as number)), ls: 0,
      fc: typeof color === 'string' ? rgba01(color).slice(0, 3) : [1, 1, 1],
    };
    return { ...this.base(compId, id, layer, range, ind, 5), ks: this.transform(compId, id, layer, range), t: { d: { k: [{ s: doc, t: 0 }] }, p: {}, m: { g: 1, a: { a: 0, k: [0, 0] } }, a: [] } };
  }

  /** a bitmap asset of the animation, once; null when the file cannot be read */
  bitmap(assetId: string): { refId: string; width: number; height: number } | null {
    const file = this.opts.readAsset?.(assetId);
    if (!file) return null;
    const refId = `img_${assetId}`;
    if (!this.assets.some((a) => a.id === refId)) this.assets.push({ id: refId, w: file.width, h: file.height, u: '', p: `data:${file.mime};base64,${toBase64(file.data)}`, e: 1 });
    return { refId, width: file.width, height: file.height };
  }

  /** drawn animation: a precomposition holding one image layer per run of the same drawing */
  sequence(compId: string, id: string, layer: Layer, range: [number, number], ind: number): Json | null {
    const fps = this.doc.compositions[compId].fps;
    const v = (n: string, t = range[0]) => this.ev.value(`${id}.${n}`, t, compId) as any;
    const frames = v('frames') as string[];
    const [w, h] = v('size') as number[], fit = v('fit');
    if (!frames.length || w <= 0 || h <= 0) return null;
    const runs: { d: number; f0: number; f1: number }[] = [];
    for (let f = Math.floor(range[0] * fps); f < Math.ceil(range[1] * fps); f++) {
      const t = f / fps;
      const d = drawingAt({ count: frames.length, hold: v('hold'), sheet: v('sheet'), loop: v('loop'), offset: v('offset', t), drawing: v('drawing', t) }, localFrame(t, layer.in ?? 0, fps));
      const last = runs.at(-1);
      if (last && last.d === d && last.f1 === f) last.f1 = f + 1;
      else runs.push({ d, f0: f, f1: f + 1 });
    }
    const inner: Json[] = [];
    for (const r of runs) {
      if (r.d < 0) continue;
      const bmp = this.bitmap(frames[r.d]);
      if (!bmp) { this.warn(`drawing "${frames[r.d]}" not embedded`); continue; }
      const s = fit === 'fill' ? [w / bmp.width, h / bmp.height] : (() => { const k = fit === 'cover' ? Math.max(w / bmp.width, h / bmp.height) : fit === 'contain' ? Math.min(w / bmp.width, h / bmp.height) : 1; return [k, k]; })();
      inner.push({
        ddd: 0, ind: inner.length + 1, ty: 2, nm: `${frames[r.d]}`, refId: bmp.refId, sr: 1, ao: 0, ip: r.f0, op: r.f1, st: 0, bm: 0,
        ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [w / 2, h / 2, 0] }, a: { a: 0, k: [bmp.width / 2, bmp.height / 2, 0] }, s: { a: 0, k: [r3(s[0] * 100), r3(s[1] * 100), 100] } },
      });
    }
    if (fit === 'cover') this.warn(`"${layer.name ?? id}": sequence set to "Fill", drawings not cropped to the frame in Lottie`);
    const refId = `seq_${compId}_${id}`;
    this.assets.push({ id: refId, nm: layer.name ?? id, fr: fps, layers: inner });
    return { ...this.base(compId, id, layer, range, ind, 0), refId, w, h, ks: this.transform(compId, id, layer, range, [w / 2, h / 2]) };
  }

  image(compId: string, id: string, layer: Layer, range: [number, number], ind: number): Json | null {
    const v = (n: string) => this.ev.value(`${id}.${n}`, range[0], compId) as any;
    const assetId = v('image') as string | null;
    const file = assetId ? this.opts.readAsset?.(assetId) : null;
    if (!assetId || !file) { this.warn(`image of "${layer.name ?? id}" not embedded`); return null; }
    const refId = `img_${assetId}`;
    if (!this.assets.some((a) => a.id === refId)) {
      this.assets.push({ id: refId, w: file.width, h: file.height, u: '', p: `data:${file.mime};base64,${toBase64(file.data)}`, e: 1 });
    }
    // the image node's framing (fit, focus, zoom, offset) as an inner offset and scale
    const [w, h] = v('size') as number[];
    const box = (v('box') as number[] | null) ?? this.doc.assets[assetId].box ?? [0, 0, file.width, file.height];
    const bw = box[2] - box[0], bh = box[3] - box[1], fit = v('fit'), zoom = v('zoom'), focus = v('focus'), off = v('offset');
    const s = fit === 'fill' ? [(w / bw) * zoom, (h / bh) * zoom] : (() => { const k = (fit === 'cover' ? Math.max(w / bw, h / bh) : fit === 'contain' ? Math.min(w / bw, h / bh) : 1) * zoom; return [k, k]; })();
    let ox = -(box[0] + bw * focus[0]) * s[0] + off[0], oy = -(box[1] + bh * focus[1]) * s[1] + off[1];
    if (fit === 'cover') { ox = Math.min(-w / 2, Math.max(w / 2 - file.width * s[0], ox)); oy = Math.min(-h / 2, Math.max(h / 2 - file.height * s[1], oy)); }
    // our transform on top, the framing as anchor and scale: the bitmap sits at (0,0) in Lottie
    const out: Json = { ...this.base(compId, id, layer, range, ind, 2), refId, ks: this.transform(compId, id, layer, range, [-ox, -oy], [s[0], s[1]]) };
    if (v('crop')) {
      const x0 = (-w / 2 - ox) / s[0], y0 = (-h / 2 - oy) / s[1], x1 = (w / 2 - ox) / s[0], y1 = (h / 2 - oy) / s[1];
      out.hasMask = true;
      out.masksProperties = [{ inv: false, mode: 'a', o: { a: 0, k: 100 }, x: { a: 0, k: 0 }, pt: { a: 0, k: { c: true, v: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], i: [[0, 0], [0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0], [0, 0]] } } }];
    }
    return out;
  }

  effects(compId: string, id: string, layer: Layer, range: [number, number]): Json[] {
    const out: Json[] = [];
    for (const fx of layer.effects || []) {
      if (fx.enabled === false) continue;
      const address = (n: string) => `${id}.effects.${fx.id}.${n}`;
      const def = (n: string) => this.reg.effect(fx.type).props[n];
      // an effect parameter as a Lottie property, animated like any other
      const p = (n: string, map: (v: unknown) => number | number[]) => this.prop(compId, address(n), fx.props?.[n], def(n), map, range);
      const v = (n: string) => this.ev.value(address(n), range[0], compId) as any;
      if (fx.type === 'fx.blur') {
        out.push({ ty: 29, nm: 'Gaussian Blur', ef: [
          // lottie-web: sigma = 0.3 x blurriness; CSS blur(r): sigma = r
          { ty: 0, nm: 'Blurriness', v: p('radius', (x) => r3((x as number) / 0.3)) },
          { ty: 7, nm: 'Blur Dimensions', v: { a: 0, k: 1 } },
          { ty: 7, nm: 'Repeat Edge Pixels', v: { a: 0, k: 0 } },
        ] });
      } else if (fx.type === 'fx.shadow') {
        if (propKind(fx.props?.offset ?? 0) !== 'static' || propKind(fx.props?.color ?? '') !== 'static') this.warn(`animated shadow of "${layer.name ?? id}": offset and color frozen`);
        const [dx, dy] = v('offset') as number[];
        const c = rgba01(v('color'));
        out.push({ ty: 25, nm: 'Drop Shadow', ef: [
          { ty: 2, nm: 'Shadow Color', v: { a: 0, k: c } },
          { ty: 0, nm: 'Opacity', v: { a: 0, k: r3(c[3] * 255) } },
          // lottie-web: angle (direction - 90 deg), distance along it
          { ty: 1, nm: 'Direction', v: { a: 0, k: r3((Math.atan2(dy, dx) * 180) / Math.PI + 90) } },
          { ty: 0, nm: 'Distance', v: { a: 0, k: r3(Math.hypot(dx, dy)) } },
          // lottie-web: sigma = softness / 4; CSS drop-shadow blur b: sigma = b / 2
          { ty: 0, nm: 'Softness', v: p('blur', (x) => r3((x as number) * 2)) },
        ] });
      } else this.warn(`effect ${fx.type} of "${layer.name ?? id}" has no Lottie equivalent: left out`);
    }
    return out;
  }

  precomp(compId: string) {
    if (this.precomps.has(compId)) return;
    this.precomps.add(compId);
    const c = this.doc.compositions[compId];
    const layers = this.layers(compId);
    if (c.background) {
      layers.push({ ddd: 0, ind: layers.length + 1, ty: 1, nm: 'Background', sr: 1, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [c.width / 2, c.height / 2, 0] }, a: { a: 0, k: [c.width / 2, c.height / 2, 0] }, s: { a: 0, k: [100, 100, 100] } }, ao: 0, sw: c.width, sh: c.height, sc: toHex(c.background, this.doc), ip: 0, op: c.duration * c.fps, st: 0, bm: 0 });
    }
    this.assets.push({ id: `comp_${compId}`, nm: c.name, fr: c.fps, layers });
  }
}

const BLEND: Record<string, number> = { normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5, add: 16 };

function toHex(color: unknown, doc: TrammeDoc): string {
  const c = resolveTokens('color', color, doc.tokens) as string;
  const [r, g, b] = parseColor(c);
  return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
}

/** a Lottie animation of one composition (the root by default) */
export function toLottie(doc: TrammeDoc, registry: Registry, opts: LottieOptions = {}): LottieResult {
  const compId = opts.compId ?? doc.root;
  const comp: Composition = doc.compositions[compId];
  const x = new Exporter(doc, registry, opts);
  const layers = x.layers(compId);
  if (comp.background) {
    layers.push({ ddd: 0, ind: layers.length + 1, ty: 1, nm: 'Background', sr: 1, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [comp.width / 2, comp.height / 2, 0] }, a: { a: 0, k: [comp.width / 2, comp.height / 2, 0] }, s: { a: 0, k: [100, 100, 100] } }, ao: 0, sw: comp.width, sh: comp.height, sc: toHex(comp.background, doc), ip: 0, op: comp.duration * comp.fps, st: 0, bm: 0 });
  }
  if ((comp.effects || []).some((e) => e.enabled !== false)) x.warn('finishing effects (grain, glow, vignette): not exported to Lottie');
  if (comp.motionBlur && Number(getAt(doc, pointer('compositions', compId, 'motionBlur', 'samples'))) > 1) x.warn('motion blur: not exported to Lottie');
  const lottie: Json = {
    v: '5.7.4', fr: comp.fps, ip: 0, op: Math.round(comp.duration * comp.fps), w: comp.width, h: comp.height,
    nm: doc.meta.title, ddd: 0, assets: x.assets, layers,
  };
  if (x.fonts.size) lottie.fonts = { list: [...x.fonts.values()] };
  return { lottie, warnings: x.warnings };
}
