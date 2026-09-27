// Import of a Lottie animation into an tramme document. Shape layers (groups,
// rectangles, ellipses, paths, fills, strokes, gradients), solids, images,
// text and precomps come in with their keyframes and eases. Lottie parenting
// (transform only, stacking unchanged) becomes wrapper groups whose transform
// links to the parent's. Masks, mattes other than a single alpha shape,
// trim paths, repeaters and expressions are reported, not converted.

import type { Asset, Composition, TrammeDoc, Keyframe, Layer, Prop, Vec2 } from '@tramme/core';
import { fromBase64 } from './bytes.ts';

type L = Record<string, any>;

export interface ImportResult {
  doc: TrammeDoc;
  /** files to write next to the document (embedded images) */
  files: { path: string; data: Uint8Array }[];
  warnings: string[];
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const hex = (c: number[]) => '#' + c.slice(0, 3).map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
  + (c.length > 3 && c[3] < 1 ? Math.round(c[3] * 255).toString(16).padStart(2, '0').toUpperCase() : '');

const staticIs = (p: L | undefined, v: number[] | number) => !p || (p.a !== 1 && JSON.stringify([p.k].flat().slice(0, Array.isArray(v) ? v.length : 1)) === JSON.stringify([v].flat()));
const isIdentity = (tr: L) => staticIs(tr.p, [0, 0]) && staticIs(tr.a, [0, 0]) && staticIs(tr.s, [100, 100]) && staticIs(tr.r, 0) && staticIs(tr.o, 100) && !tr.sk?.k;

class Importer {
  json: L;
  fps: number;
  ip: number;
  warnings: string[] = [];
  files: ImportResult['files'] = [];
  assets: Record<string, Asset> = {};
  compositions: Record<string, Composition> = {};
  private used = new Set<string>();
  /** Lottie precomp asset id -> composition id */
  private precomps = new Map<string, string>();

  constructor(json: L) {
    this.json = json;
    this.fps = json.fr || 30;
    this.ip = json.ip || 0;
  }
  warn(s: string) { if (!this.warnings.includes(s)) this.warnings.push(s); }
  id(base: string): string {
    let b = String(base || 'layer').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'layer';
    if (/^\d/.test(b)) b = `l${b}`;
    let id = b;
    for (let i = 2; this.used.has(id); i++) id = `${b}-${i}`;
    this.used.add(id);
    return id;
  }
  t(frame: number) { return r4((frame - this.ip) / this.fps); }

  /** a Lottie property as an tramme property */
  prop(p: L | undefined, map: (v: any) => unknown): Prop | undefined {
    if (!p) return undefined;
    if (p.x) this.warn('Lottie expressions ignored');
    const k = p.k;
    const animated = p.a === 1 || (Array.isArray(k) && k.length && typeof k[0] === 'object' && k[0] !== null && 't' in k[0]);
    if (!animated) return map(k) as Prop;
    const keys: Keyframe[] = [];
    let prev: any = null;
    for (let i = 0; i < k.length; i++) {
      const key = k[i];
      const s = key.s ?? prev?.e ?? prev?.s;
      if (s === undefined) continue;
      const out: Keyframe = { t: this.t(key.t), v: map(Array.isArray(s) && s.length === 1 && typeof s[0] === 'number' ? s[0] : s) };
      if (i < k.length - 1) {
        if (key.h === 1) out.ease = 'hold';
        else if (key.o && key.i) {
          const f = (v: any) => r4(Array.isArray(v) ? v[0] : v);
          const e: [number, number, number, number] = [f(key.o.x), f(key.o.y), f(key.i.x), f(key.i.y)];
          if (!(e[0] === e[1] && e[2] === e[3])) out.ease = [Math.max(0, Math.min(1, e[0])), e[1], Math.max(0, Math.min(1, e[2])), e[3]];
        }
      }
      keys.push(out);
      prev = key;
    }
    return keys.length === 1 ? (keys[0].v as Prop) : { $k: keys };
  }

  vec = (v: any): Vec2 => [r4(Number(v?.[0] ?? v ?? 0)), r4(Number(v?.[1] ?? 0))];

  transform(ks: L | undefined, anchorShift: Vec2 = [0, 0]): Layer['transform'] {
    if (!ks) return undefined;
    let position = this.prop(ks.p?.s ? undefined : ks.p, this.vec);
    if (ks.p?.s) {
      const x = this.prop(ks.p.x, (v) => r4(Number(v))), y = this.prop(ks.p.y, (v) => r4(Number(v)));
      if (typeof x === 'number' && typeof y === 'number') position = [x, y];
      else { this.warn('position with separate dimensions: approximated'); position = [typeof x === 'number' ? x : 0, typeof y === 'number' ? y : 0]; }
    }
    if (ks.rx || ks.ry) this.warn('3D layers: X and Y rotations ignored');
    const tr: NonNullable<Layer['transform']> = {
      anchor: this.prop(ks.a, (v) => { const [x, y] = this.vec(v); return [r4(x + anchorShift[0]), r4(y + anchorShift[1])]; }) as Prop<Vec2>,
      position: position as Prop<Vec2>,
      scale: this.prop(ks.s, (v) => { const [x, y] = this.vec(v); return [r4(x / 100), r4(y / 100)]; }) as Prop<Vec2>,
      rotation: this.prop(ks.r ?? ks.rz, (v) => r4(Number(v))) as Prop<number>,
      opacity: this.prop(ks.o, (v) => r4(Number(v) / 100)) as Prop<number>,
    };
    for (const k of Object.keys(tr) as (keyof typeof tr)[]) if (tr[k] === undefined) delete tr[k];
    return tr;
  }

  // ── shapes ─────────────────────────────────────────────────
  paint(item: L): Prop | null {
    if (item.ty === 'fl' || item.ty === 'st') return this.prop(item.c, (c) => hex(c)) as Prop;
    if (item.ty === 'gf' || item.ty === 'gs') {
      const n = item.g?.p ?? 2, k = item.g?.k?.k ?? [];
      if (item.g?.k?.a === 1) this.warn('animated gradient: frozen');
      const stops: [number, string][] = [];
      for (let i = 0; i < n; i++) stops.push([r4(k[i * 4]), hex([k[i * 4 + 1], k[i * 4 + 2], k[i * 4 + 3]])]);
      const s = this.vec(item.s?.k), e = this.vec(item.e?.k);
      return item.t === 2
        ? { type: 'radial', center: s, radius: r4(Math.hypot(e[0] - s[0], e[1] - s[1])), stops }
        : { type: 'linear', from: s, to: e, stops };
    }
    return null;
  }

  /** a Lottie shape group as tramme layers (returns ids, bottom first) */
  shapes(items: L[], layers: Record<string, Layer>, inherited: { fill?: L; stroke?: L } = {}): string[] {
    const fill = items.find((i) => i.ty === 'fl' || i.ty === 'gf') ?? inherited.fill;
    const stroke = items.find((i) => i.ty === 'st' || i.ty === 'gs') ?? inherited.stroke;
    const ids: string[] = [];
    for (const it of items) {
      if (it.hd) continue;
      if (it.ty === 'gr') {
        const tr = (it.it || []).find((x: L) => x.ty === 'tr');
        const children = this.shapes((it.it || []).filter((x: L) => x.ty !== 'tr'), layers, { fill, stroke });
        if (!children.length) continue;
        // a group that does not transform anything is flattened into its parent
        if (!tr || isIdentity(tr)) { ids.push(...children.slice().reverse()); continue; }
        const id = this.id(it.nm || 'group');
        layers[id] = { type: 'group', name: it.nm, ...(tr ? { transform: this.transform(tr) } : {}), children };
        ids.push(id);
      } else if (it.ty === 'rc' || it.ty === 'el' || it.ty === 'sh') {
        const id = this.id(it.nm || (it.ty === 'rc' ? 'rectangle' : it.ty === 'el' ? 'ellipse' : 'trace'));
        const props: Record<string, unknown> = {};
        let transform: Layer['transform'];
        if (it.ty === 'sh') props.path = this.prop(it.ks, (v) => ({ v: (v.v || []).map(this.vec), i: (v.i || []).map(this.vec), o: (v.o || []).map(this.vec), closed: !!v.c }));
        else {
          props.size = this.prop(it.s, this.vec);
          if (it.ty === 'rc' && it.r) props.radius = this.prop(it.r, (v) => r4(Number(v)));
          transform = { position: this.prop(it.p, this.vec) as Prop<Vec2> };
        }
        props.fill = fill ? this.paint(fill) : null;
        if (stroke) {
          props.stroke = this.paint(stroke);
          props.strokeWidth = this.prop(stroke.w, (v) => r4(Number(v)));
          const cap = ({ 1: 'butt', 2: 'round', 3: 'square' } as Record<number, string>)[stroke.lc];
          const join = ({ 1: 'miter', 2: 'round', 3: 'bevel' } as Record<number, string>)[stroke.lj];
          if (it.ty === 'sh') { if (cap) props.lineCap = cap; if (join) props.lineJoin = join; }
        }
        if (fill && fill.o && !(fill.o.a === 0 && fill.o.k === 100)) this.warn('fill opacity: carried by the color only when fixed');
        layers[id] = { type: it.ty === 'rc' ? 'shape.rect' : it.ty === 'el' ? 'shape.ellipse' : 'shape.path', name: it.nm, ...(transform ? { transform } : {}), props: props as Record<string, Prop> };
        ids.push(id);
      } else if (['tm', 'rp', 'mm', 'sr', 'rd', 'pb', 'tw', 'zz', 'op'].includes(it.ty)) {
        this.warn(`Lottie shape item "${it.ty}" not converted`);
      }
    }
    return ids.reverse();
  }

  // ── layers ─────────────────────────────────────────────────
  composition(id: string, name: string, src: L[], size: Vec2, duration: number): void {
    const layers: Record<string, Layer> = {};
    const byInd = new Map<number, { id: string; lottie: L; shift: Vec2 }>();
    const made: { id: string; lottie: L }[] = [];
    for (const ly of src) {
      const lid = this.id(ly.nm || `layer-${ly.ind}`);
      const res = this.layer(ly, lid, layers);
      if (!res) continue;
      byInd.set(ly.ind, { id: lid, lottie: ly, shift: res.shift });
      made.push({ id: lid, lottie: ly });
    }
    // track mattes: the layer above (td) clips the next one (tt = 1)
    for (let i = 0; i < made.length; i++) {
      const { id: lid, lottie } = made[i];
      if (lottie.tt) {
        const matte = made[i - 1];
        const m = matte && layers[matte.id];
        if (lottie.tt === 1 && m && m.type !== 'group') { m.visible = false; layers[lid].clip = matte.id; }
        else this.warn(`matte of "${lottie.nm ?? lid}" (type ${lottie.tt}) not converted`);
      }
    }
    // parenting: wrapper groups that follow the parent's transform
    const order: string[] = [];
    for (const { id: lid, lottie } of made.slice().reverse()) {
      let top = lid;
      for (let p = lottie.parent; p !== undefined; p = byInd.get(p)?.lottie.parent) {
        const parent = byInd.get(p);
        if (!parent) break;
        const g = this.id(`${parent.id}-follow`);
        const [sx, sy] = parent.shift;
        layers[g] = {
          type: 'group', name: `↳ ${parent.lottie.nm ?? parent.id}`, children: [top],
          transform: {
            anchor: sx || sy ? { $expr: `add(prop('${parent.id}.transform.anchor'), [${-sx}, ${-sy}])` } : { $link: `${parent.id}.transform.anchor` },
            position: { $link: `${parent.id}.transform.position` },
            scale: { $link: `${parent.id}.transform.scale` },
            rotation: { $link: `${parent.id}.transform.rotation` },
          },
        };
        top = g;
      }
      order.push(top);
    }
    this.compositions[id] = { name, width: size[0], height: size[1], fps: this.fps, duration: r4(duration), background: null, layers, order };
  }

  /** one Lottie layer; returns the anchor shift used to centre its content */
  layer(ly: L, id: string, layers: Record<string, Layer>): { shift: Vec2 } | null {
    const base: Partial<Layer> = { name: ly.nm, in: this.t(ly.ip ?? 0), out: this.t(ly.op ?? 0) };
    if (ly.hd) base.visible = false;
    if (ly.td) base.visible = false;
    if (ly.bm) base.blend = ({ 1: 'multiply', 2: 'screen', 3: 'overlay', 4: 'darken', 5: 'lighten', 16: 'add' } as Record<number, Layer['blend']>)[ly.bm] ?? 'normal';
    if (ly.ddd) this.warn('3D layers: converted flat');
    if (ly.hasMask || ly.masksProperties?.length) this.warn(`masks of "${ly.nm ?? id}" not converted`);
    const effects = this.effects(ly);
    if (effects.length) base.effects = effects;
    if (ly.sr && ly.sr !== 1 && ly.ty !== 0) this.warn(`time stretch of "${ly.nm ?? id}" ignored`);
    switch (ly.ty) {
      case 4: {
        const children = this.shapes(ly.shapes || [], layers);
        layers[id] = { ...base, type: 'group', transform: this.transform(ly.ks), children } as Layer;
        return { shift: [0, 0] };
      }
      case 3:
        layers[id] = { ...base, type: 'group', visible: false, transform: this.transform(ly.ks), children: [] } as Layer;
        return { shift: [0, 0] };
      case 1: {
        const shift: Vec2 = [-(ly.sw ?? 0) / 2, -(ly.sh ?? 0) / 2];
        layers[id] = { ...base, type: 'shape.rect', transform: this.transform(ly.ks, shift), props: { size: [ly.sw ?? 0, ly.sh ?? 0], fill: (ly.sc || '#000000').toUpperCase() } } as Layer;
        return { shift };
      }
      case 2: {
        const a = (this.json.assets || []).find((x: L) => x.id === ly.refId);
        if (!a) return null;
        const assetId = this.image(a);
        const shift: Vec2 = [-(a.w ?? 0) / 2, -(a.h ?? 0) / 2];
        layers[id] = { ...base, type: 'image', transform: this.transform(ly.ks, shift), props: { image: assetId, size: [a.w ?? 0, a.h ?? 0], fit: 'fill', crop: false } } as Layer;
        return { shift };
      }
      case 0: {
        const a = (this.json.assets || []).find((x: L) => x.id === ly.refId);
        if (!a?.layers) return null;
        let compId = this.precomps.get(a.id);
        if (!compId) {
          compId = `c-${this.id(a.id)}`;
          this.precomps.set(a.id, compId);
          this.composition(compId, a.nm || a.id, a.layers, [ly.w ?? this.json.w, ly.h ?? this.json.h], (this.json.op - this.ip) / this.fps);
        }
        const shift: Vec2 = [-(ly.w ?? this.json.w) / 2, -(ly.h ?? this.json.h) / 2];
        const sr = ly.sr || 1, st = (ly.st || 0);
        const props: Record<string, Prop> = { comp: compId };
        if (ly.tm) props.remap = this.prop(ly.tm, (v) => r4(Number(v))) as Prop;
        else {
          const inT = this.t(ly.ip ?? 0);
          if (sr !== 1) props.speed = r4(1 / sr);
          const start = r4((inT - this.t(st)) / sr);
          if (start) props.start = start;
        }
        layers[id] = { ...base, type: 'comp', transform: this.transform(ly.ks, shift), props } as Layer;
        return { shift };
      }
      case 5: {
        const d = ly.t?.d?.k?.[0]?.s;
        if (!d) return null;
        if ((ly.t?.d?.k?.length ?? 0) > 1) this.warn(`animated text of "${ly.nm ?? id}": first state only`);
        const font = (this.json.fonts?.list || []).find((f: L) => f.fName === d.f);
        if (font && !/^(sans-serif|serif|monospace|system-ui)$/i.test(font.fFamily)) this.warn(`font "${font.fFamily}": to provide as an asset (sans-serif fallback)`);
        const weight = /black|heavy/i.test(font?.fStyle ?? '') ? 900 : /extrabold/i.test(font?.fStyle ?? '') ? 800 : /bold/i.test(font?.fStyle ?? '') ? 700 : /semibold/i.test(font?.fStyle ?? '') ? 600 : /medium/i.test(font?.fStyle ?? '') ? 500 : /light/i.test(font?.fStyle ?? '') ? 300 : 400;
        layers[id] = {
          ...base, type: 'text', transform: this.transform(ly.ks),
          props: {
            text: String(d.t ?? '').replace(/\r/g, '\n'), size: d.s ?? 48, weight, tracking: r4((d.tr ?? 0) / 1000),
            align: (['left', 'right', 'center'] as const)[d.j ?? 0] ?? 'left', color: hex(d.fc ?? [1, 1, 1]),
            ...(d.lh && d.s ? { lineHeight: r4(d.lh / d.s) } : {}),
          },
        } as Layer;
        return { shift: [0, 0] };
      }
      default:
        this.warn(`Lottie layer of type ${ly.ty} ("${ly.nm ?? id}") not converted`);
        return null;
    }
  }

  /** Lottie effects with an tramme equivalent: Gaussian blur and drop shadow (lottie-web's mappings, inverted) */
  effects(ly: L): NonNullable<Layer['effects']> {
    const out: NonNullable<Layer['effects']> = [];
    for (const [i, ef] of (ly.ef || []).entries()) {
      const p = (k: number) => ef.ef?.[k]?.v;
      if (ef.ty === 29) {
        out.push({ id: `blur${i}`, type: 'fx.blur', props: { radius: this.prop(p(0), (v) => r4(Number(v) * 0.3)) as Prop } });
      } else if (ef.ty === 25) {
        const c = p(0)?.k ?? [0, 0, 0, 1], op = Number(p(1)?.k ?? 255) / 255;
        const ang = ((Number(p(2)?.k ?? 135) - 90) * Math.PI) / 180, dist = Number(p(3)?.k ?? 0);
        out.push({ id: `shadow${i}`, type: 'fx.shadow', props: {
          color: hex([c[0], c[1], c[2], op]), offset: [r4(dist * Math.cos(ang)), r4(dist * Math.sin(ang))],
          blur: this.prop(p(4), (v) => r4(Number(v) / 2)) as Prop,
        } });
      } else this.warn(`Lottie effect "${ef.nm ?? ef.ty}" of "${ly.nm ?? ''}" not converted`);
    }
    return out;
  }

  image(a: L): string {
    const id = `img-${this.id(a.id)}`;
    if (this.assets[id]) return id;
    const p: string = a.p ?? '';
    const m = /^data:([^;]+);base64,(.*)$/.exec(p);
    if (m) {
      const ext = m[1].split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg');
      const path = `assets/${id}.${ext}`;
      this.files.push({ path, data: fromBase64(m[2]) });
      this.assets[id] = { type: 'image', src: path, name: a.id };
    } else {
      this.assets[id] = { type: 'image', src: `${a.u ?? ''}${p}`, name: a.id };
    }
    return id;
  }
}

/** an tramme document from a Lottie animation */
export function fromLottie(json: Record<string, any>): ImportResult {
  const x = new Importer(json);
  const duration = ((json.op ?? 0) - (json.ip ?? 0)) / (json.fr || 30);
  x.composition('main', json.nm || 'Lottie', json.layers || [], [json.w, json.h], duration);
  const doc: TrammeDoc = {
    schema: 'tramme/1',
    meta: { title: json.nm || 'Imported animation', description: 'Imported from Lottie.' },
    tokens: {}, assets: x.assets, root: 'main', compositions: x.compositions,
  };
  return { doc, files: x.files, warnings: x.warnings };
}
