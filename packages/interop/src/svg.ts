// Export of one frame as SVG: shapes, paths, text (fonts embedded), images
// (embedded), groups and nested compositions stay vector; clips become
// clipPaths; layer effects become SVG filters; blend modes become
// mix-blend-mode. Nodes drawn by code (code, shader, particles) are left out
// and reported. Finishing effects (grain, bloom) and motion blur are not part
// of a vector frame.

import { drawingAt, Evaluator, localFrame, parseColor, type TrammeDoc, type EvaluatedLayer, type Paint, type PathValue, type Registry } from '@tramme/core';
import { toBase64 } from './bytes.ts';

export interface SvgOptions {
  compId?: string;
  readAsset?: (assetId: string) => { data: Uint8Array; mime: string; width: number; height: number } | null;
}

const n = (x: number) => String(Math.round(x * 1000) / 1000);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const b64 = toBase64;

/** colour and its opacity as SVG attributes */
function colorAttrs(css: string, name: 'fill' | 'stroke' | 'stop-color' | 'flood-color'): string {
  const [r, g, b, a] = parseColor(css);
  const hex = '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
  const op = name === 'stop-color' ? 'stop-opacity' : name === 'flood-color' ? 'flood-opacity' : `${name}-opacity`;
  return a < 1 ? `${name}="${hex}" ${op}="${n(a)}"` : `${name}="${hex}"`;
}

function matrix(tr: EvaluatedLayer['transform']): string {
  const r = (tr.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const a = cos * tr.scale[0], b = sin * tr.scale[0], c = -sin * tr.scale[1], d = cos * tr.scale[1];
  const e = tr.position[0] - tr.anchor[0] * a - tr.anchor[1] * c, f = tr.position[1] - tr.anchor[0] * b - tr.anchor[1] * d;
  return `matrix(${[a, b, c, d, e, f].map(n).join(' ')})`;
}

export function pathData(p: PathValue): string {
  if (!p.v.length) return '';
  const z = [0, 0];
  let d = `M${n(p.v[0][0])} ${n(p.v[0][1])}`;
  const seg = (a: number, b: number) => {
    const o = p.o?.[a] ?? z, i = p.i?.[b] ?? z, [ax, ay] = p.v[a], [bx, by] = p.v[b];
    d += !o[0] && !o[1] && !i[0] && !i[1] ? `L${n(bx)} ${n(by)}` : `C${n(ax + o[0])} ${n(ay + o[1])} ${n(bx + i[0])} ${n(by + i[1])} ${n(bx)} ${n(by)}`;
  };
  for (let k = 0; k < p.v.length - 1; k++) seg(k, k + 1);
  if (p.closed) { if (p.v.length > 1) seg(p.v.length - 1, 0); d += 'Z'; }
  return d;
}

const BLEND: Record<string, string> = { multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', add: 'plus-lighter' };

class SvgWriter {
  doc: TrammeDoc; ev: Evaluator; reg: Registry; opts: SvgOptions;
  defs: string[] = [];
  fonts = new Set<string>();
  warnings: string[] = [];
  private ids = 0;
  constructor(doc: TrammeDoc, reg: Registry, opts: SvgOptions) { this.doc = doc; this.reg = reg; this.opts = opts; this.ev = new Evaluator(doc, reg); }
  id(p: string) { return `${p}${++this.ids}`; }
  warn(s: string) { if (!this.warnings.includes(s)) this.warnings.push(s); }

  paint(p: Paint, attr: 'fill' | 'stroke'): string {
    if (p === null || p === undefined) return `${attr}="none"`;
    if (typeof p === 'string') return colorAttrs(p, attr);
    const id = this.id('g');
    const stops = p.stops.map(([o, c]) => `<stop offset="${n(o)}" ${colorAttrs(c, 'stop-color')}/>`).join('');
    this.defs.push(p.type === 'linear'
      ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${n(p.from[0])}" y1="${n(p.from[1])}" x2="${n(p.to[0])}" y2="${n(p.to[1])}">${stops}</linearGradient>`
      : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${n(p.center[0])}" cy="${n(p.center[1])}" r="${n(p.radius)}">${stops}</radialGradient>`);
    return `${attr}="url(#${id})"`;
  }

  strokeAttrs(p: Record<string, any>) {
    if (!p.stroke || !(p.strokeWidth > 0)) return '';
    return ` ${this.paint(p.stroke, 'stroke')} stroke-width="${n(p.strokeWidth)}"${p.lineCap && p.lineCap !== 'butt' ? ` stroke-linecap="${p.lineCap}"` : ''}${p.lineJoin && p.lineJoin !== 'miter' ? ` stroke-linejoin="${p.lineJoin}"` : ''}`;
  }

  /** the node's own drawing in its local space */
  content(L: EvaluatedLayer, compId: string, t: number): string {
    const p = L.props as Record<string, any>;
    switch (L.layer.type) {
      case 'shape.rect': {
        const [w, h] = p.size, r = Math.min(p.radius, Math.abs(w) / 2, Math.abs(h) / 2);
        return `<rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}"${r > 0 ? ` rx="${n(r)}"` : ''} ${this.paint(p.fill, 'fill')}${this.strokeAttrs(p)}/>`;
      }
      case 'shape.ellipse': return `<ellipse cx="0" cy="0" rx="${n(Math.abs(p.size[0]) / 2)}" ry="${n(Math.abs(p.size[1]) / 2)}" ${this.paint(p.fill, 'fill')}${this.strokeAttrs(p)}/>`;
      case 'shape.path': return `<path d="${pathData(p.path)}" ${this.paint(p.fill, 'fill')}${this.strokeAttrs(p)}/>`;
      case 'text': case 'text.counter': {
        if (L.layer.type === 'text.counter') this.warn(`counter "${L.layer.name ?? L.id}": exported as fixed text`);
        const family = p.font ? this.doc.assets[p.font]?.family || p.font : 'sans-serif';
        if (p.font) this.fonts.add(p.font);
        const text: string = L.layer.type === 'text' ? String(p.text) : String(p.progress >= 1 ? p.to : p.from);
        const anchor = p.align === 'center' ? 'middle' : p.align === 'right' ? 'end' : 'start';
        const lines = text.split('\n');
        const color = typeof p.color === 'string' ? colorAttrs(p.color, 'fill') : this.paint(p.color, 'fill');
        const attrs = `font-family="${esc(family)}, sans-serif" font-size="${n(p.size)}" font-weight="${Math.round(p.weight)}"${p.italic ? ' font-style="italic"' : ''}${p.tracking ? ` letter-spacing="${n(p.tracking * p.size)}"` : ''} text-anchor="${anchor}" ${color}`;
        if (lines.length === 1) return `<text x="0" y="0" ${attrs} xml:space="preserve">${esc(text)}</text>`;
        return `<text ${attrs} xml:space="preserve">${lines.map((l, i) => `<tspan x="0" y="${n(i * (p.lineHeight ?? 1.2) * p.size)}">${esc(l)}</tspan>`).join('')}</text>`;
      }
      case 'image': {
        if (!p.image) return '';
        const file = this.opts.readAsset?.(p.image);
        if (!file) { this.warn(`image "${p.image}" not embedded`); return ''; }
        const [w, h] = p.size;
        const box = p.box ?? this.doc.assets[p.image]?.box ?? [0, 0, file.width, file.height];
        const bw = box[2] - box[0], bh = box[3] - box[1];
        const s = p.fit === 'fill' ? [(w / bw) * p.zoom, (h / bh) * p.zoom] : (() => { const k = (p.fit === 'cover' ? Math.max(w / bw, h / bh) : p.fit === 'contain' ? Math.min(w / bw, h / bh) : 1) * p.zoom; return [k, k]; })();
        let ox = -(box[0] + bw * p.focus[0]) * s[0] + p.offset[0], oy = -(box[1] + bh * p.focus[1]) * s[1] + p.offset[1];
        if (p.fit === 'cover') { ox = Math.min(-w / 2, Math.max(w / 2 - file.width * s[0], ox)); oy = Math.min(-h / 2, Math.max(h / 2 - file.height * s[1], oy)); }
        let clip = '';
        if (p.crop) {
          const id = this.id('c');
          this.defs.push(`<clipPath id="${id}"><rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}"/></clipPath>`);
          clip = ` clip-path="url(#${id})"`;
        }
        return `<g${clip}><image href="data:${file.mime};base64,${b64(file.data)}" x="${n(ox)}" y="${n(oy)}" width="${n(file.width * s[0])}" height="${n(file.height * s[1])}" preserveAspectRatio="none"/></g>`;
      }
      case 'sequence': {
        const fps = this.doc.compositions[compId].fps;
        const d = drawingAt({ hold: p.hold, sheet: p.sheet, loop: p.loop, offset: p.offset, drawing: p.drawing, count: p.frames.length }, localFrame(t, L.layer.in ?? 0, fps));
        if (d < 0) return '';
        const file = this.opts.readAsset?.(p.frames[d]);
        if (!file) { this.warn(`drawing "${p.frames[d]}" not embedded`); return ''; }
        const [w, h] = p.size;
        const s = p.fit === 'fill' ? [w / file.width, h / file.height] : (() => { const k = p.fit === 'cover' ? Math.max(w / file.width, h / file.height) : p.fit === 'contain' ? Math.min(w / file.width, h / file.height) : 1; return [k, k]; })();
        let clip = '';
        if (p.fit === 'cover') {
          const id = this.id('c');
          this.defs.push(`<clipPath id="${id}"><rect x="${n(-w / 2)}" y="${n(-h / 2)}" width="${n(w)}" height="${n(h)}"/></clipPath>`);
          clip = ` clip-path="url(#${id})"`;
        }
        return `<g${clip}><image href="data:${file.mime};base64,${b64(file.data)}" x="${n((-file.width * s[0]) / 2)}" y="${n((-file.height * s[1]) / 2)}" width="${n(file.width * s[0])}" height="${n(file.height * s[1])}" preserveAspectRatio="none"/></g>`;
      }
      case 'comp': {
        const c = p.comp ? this.doc.compositions[p.comp] : null;
        if (!c) return '';
        let lt = p.remap ?? p.start + (t - (L.layer.in ?? 0)) * p.speed;
        if (p.loop && c.duration > 0) lt = ((lt % c.duration) + c.duration) % c.duration;
        let clip = '';
        if (p.crop) {
          const id = this.id('c');
          this.defs.push(`<clipPath id="${id}"><rect x="0" y="0" width="${c.width}" height="${c.height}"/></clipPath>`);
          clip = ` clip-path="url(#${id})"`;
        }
        return `<g transform="translate(${n(-c.width / 2)} ${n(-c.height / 2)})"${clip}>${this.composition(p.comp, lt, false)}</g>`;
      }
      case 'group': case 'audio': return '';
      default:
        this.warn(`"${L.layer.name ?? L.id}" (${L.layer.type}) is drawn by code: left out of the SVG`);
        return '';
    }
  }

  filter(L: EvaluatedLayer): string {
    const parts: string[] = [];
    let last = 'SourceGraphic', k = 0;
    const out = () => `f${++k}`;
    for (const fx of L.effects) {
      const p = fx.props as Record<string, any>;
      if (fx.type === 'fx.blur') { const o = out(); parts.push(`<feGaussianBlur in="${last}" stdDeviation="${n(p.radius)}" result="${o}"/>`); last = o; }
      else if (fx.type === 'fx.shadow') { const o = out(); parts.push(`<feDropShadow in="${last}" dx="${n(p.offset[0])}" dy="${n(p.offset[1])}" stdDeviation="${n(p.blur / 2)}" ${colorAttrs(p.color, 'flood-color')} result="${o}"/>`); last = o; }
      else if (fx.type === 'fx.glow') { for (let i = 0; i < Math.max(1, Math.round(p.strength)); i++) { const o = out(); parts.push(`<feDropShadow in="${last}" dx="0" dy="0" stdDeviation="${n(p.radius / 2)}" ${colorAttrs(p.color, 'flood-color')} result="${o}"/>`); last = o; } }
      else if (fx.type === 'fx.color') {
        const o1 = out(), o2 = out(), o3 = out();
        const b = p.brightness, c = p.contrast, ic = (1 - c) / 2;
        parts.push(`<feComponentTransfer in="${last}" result="${o1}"><feFuncR type="linear" slope="${n(b * c)}" intercept="${n(ic)}"/><feFuncG type="linear" slope="${n(b * c)}" intercept="${n(ic)}"/><feFuncB type="linear" slope="${n(b * c)}" intercept="${n(ic)}"/></feComponentTransfer>`);
        parts.push(`<feColorMatrix in="${o1}" type="saturate" values="${n(p.saturation)}" result="${o2}"/>`);
        parts.push(`<feColorMatrix in="${o2}" type="hueRotate" values="${n(p.hue)}" result="${o3}"/>`);
        last = o3;
      } else if (fx.type === 'fx.tint') {
        const o1 = out(), o2 = out(), o3 = out();
        parts.push(`<feFlood ${colorAttrs(p.color, 'flood-color')} result="${o1}"/>`, `<feComposite in="${o1}" in2="${last}" operator="in" result="${o2}"/>`);
        parts.push(`<feComposite in="${o2}" in2="${last}" operator="arithmetic" k2="${n(p.amount)}" k3="${n(1 - p.amount)}" result="${o3}"/>`);
        last = o3;
      } else this.warn(`effect ${fx.type}: left out of the SVG`);
    }
    if (!parts.length) return '';
    const id = this.id('fx');
    this.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">${parts.join('')}</filter>`);
    return ` filter="url(#${id})"`;
  }

  layer(L: EvaluatedLayer, compId: string, t: number): string {
    if (L.transform.opacity <= 0) return '';
    let clip = '';
    if (L.clip) {
      const id = this.id('c');
      this.defs.push(`<clipPath id="${id}"><g transform="${matrix(L.clip.transform)}">${this.content(L.clip, compId, t)}</g></clipPath>`);
      clip = ` clip-path="url(#${id})"`;
    }
    const style = L.layer.blend && BLEND[L.layer.blend] ? ` style="mix-blend-mode:${BLEND[L.layer.blend]}"` : '';
    const op = L.transform.opacity < 1 ? ` opacity="${n(L.transform.opacity)}"` : '';
    const inner = `<g transform="${matrix(L.transform)}">${this.content(L, compId, t)}${L.children.map((c) => this.layer(c, compId, t)).join('')}</g>`;
    const name = esc(L.layer.name ?? L.id);
    return `<g id="${esc(L.id)}" data-name="${name}"${clip}${op}${style}${this.filter(L)}>${inner}</g>`;
  }

  composition(compId: string, t: number, root: boolean): string {
    const f = this.ev.frame(t, compId);
    const c = f.comp;
    const bg = f.background ? `<rect width="${c.width}" height="${c.height}" ${colorAttrs(f.background, 'fill')}/>` : '';
    if (root && f.motionBlur.samples > 1) this.warn('motion blur: not shown in a vector image');
    if (root && f.effects.length) this.warn('finishing effects (grain, glow, vignette): not shown in SVG');
    return bg + f.layers.map((L) => this.layer(L, compId, t)).join('');
  }
}

/** one frame of a composition as an SVG document */
export function toSvg(doc: TrammeDoc, registry: Registry, t: number, opts: SvgOptions = {}): { svg: string; warnings: string[] } {
  const compId = opts.compId ?? doc.root;
  const c = doc.compositions[compId];
  const w = new SvgWriter(doc, registry, opts);
  const body = w.composition(compId, t, true);
  const fonts = [...w.fonts].map((id) => {
    const a = doc.assets[id], file = opts.readAsset?.(id);
    if (!file) return '';
    return `@font-face{font-family:"${esc(a.family || id)}";src:url(data:${file.mime};base64,${b64(file.data)});font-weight:${a.weight || '400'};font-style:${a.style || 'normal'};}`;
  }).join('');
  const defs = `${fonts ? `<style>${fonts}</style>` : ''}${w.defs.join('')}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${c.width}" height="${c.height}" viewBox="0 0 ${c.width} ${c.height}">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>\n`;
  return { svg, warnings: w.warnings };
}
