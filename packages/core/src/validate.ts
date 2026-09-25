// Validation in two passes: the structure (zod), then the meaning against the
// registry: layer tree, references (clips, assets, tokens, links), property
// values against the node schemas, keyframes, expressions that compile.
// Errors carry the JSON Pointer of the faulty value, the same paths as ops.

import { parseColor } from './color.ts';
import { compileExpr } from './expr.ts';
import { pointer } from './ops.ts';
import { asExpr, asKeyframed, asLink, propKind, staticValue } from './props.ts';
import { MOTION_BLUR_SCHEMA, TRANSFORM_SCHEMA, type PropDef, type PropSchema, type Registry } from './registry.ts';
import { DocSchema } from './schema.ts';
import type { Composition, TrammeDoc } from './types.ts';

export interface Issue { path: string; message: string }

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec2 = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(isNum);
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

export function validate(doc: unknown, registry: Registry): Issue[] {
  const parsed = DocSchema.safeParse(doc);
  if (!parsed.success) {
    return parsed.error.issues.map((i) => ({ path: pointer(...(i.path as (string | number)[])), message: i.message }));
  }
  return new Checker(doc as TrammeDoc, registry).run();
}

/** throws with every issue listed */
export function assertValid(doc: unknown, registry: Registry): asserts doc is TrammeDoc {
  const issues = validate(doc, registry);
  if (issues.length) throw new Error(`invalid document:\n${issues.map((i) => `  ${i.path || '/'}: ${i.message}`).join('\n')}`);
}

class Checker {
  issues: Issue[] = [];
  doc: TrammeDoc;
  reg: Registry;
  constructor(doc: TrammeDoc, reg: Registry) { this.doc = doc; this.reg = reg; }

  err(path: string, message: string) { this.issues.push({ path, message }); }

  run(): Issue[] {
    const { doc } = this;
    if (!doc.compositions[doc.root]) this.err('/root', `unknown root composition "${doc.root}"`);
    (doc.plugins || []).forEach((id, i) => {
      if (doc.assets[id]?.type !== 'module') this.err(`/plugins/${i}`, `plugin "${id}" must be an asset of type module`);
    });
    for (const [name, tk] of Object.entries(doc.tokens)) this.token(name, tk.type, tk.value);
    for (const [cid, comp] of Object.entries(doc.compositions)) this.comp(cid, comp);
    this.nestingCycles();
    return this.issues;
  }

  /** a composition must not contain itself, directly or through others */
  nestingCycles() {
    const refs = new Map<string, Set<string>>();
    for (const [cid, comp] of Object.entries(this.doc.compositions)) {
      const out = new Set<string>();
      for (const layer of Object.values(comp.layers)) {
        if (!this.reg.hasNode(layer.type)) continue;
        for (const [name, def] of Object.entries(this.reg.node(layer.type).props)) {
          const v = staticValue(layer.props?.[name]);
          if (def.type === 'comp' && typeof v === 'string') out.add(v);
        }
      }
      refs.set(cid, out);
    }
    const state = new Map<string, number>();
    const visit = (c: string, path: string[]): void => {
      if (state.get(c) === 2) return;
      if (state.get(c) === 1) { this.err(`/compositions/${path[0]}`, `compositions nested in a loop: ${[...path, c].join(' → ')}`); return; }
      state.set(c, 1);
      for (const n of refs.get(c) || []) if (this.doc.compositions[n]) visit(n, [...path, c]);
      state.set(c, 2);
    };
    for (const c of refs.keys()) visit(c, []);
  }

  token(name: string, type: string, value: unknown) {
    const p = pointer('tokens', name, 'value');
    if (typeof value === 'string' && value.startsWith('@')) {
      const target = this.doc.tokens[value.slice(1)];
      if (!target) this.err(p, `alias to an unknown token ${value}`);
      else if (target.type !== type) this.err(p, `alias to a token of type ${target.type}`);
      return;
    }
    const def: PropDef = { type: type === 'string' ? 'string' : (type as PropDef['type']), default: null };
    const bad = this.valueIssue(def, value);
    if (bad) this.err(p, bad);
  }

  comp(cid: string, comp: Composition) {
    const base = ['compositions', cid];
    // the tree: each layer reached exactly once, from the root order
    const seen = new Map<string, string>();
    const walk = (ids: string[], where: (string | number)[], depth: number) => {
      ids.forEach((lid, i) => {
        const p = pointer(...base, ...where, i);
        const layer = comp.layers[lid];
        if (!layer) return this.err(p, `unknown layer "${lid}"`);
        if (seen.has(lid)) return this.err(p, `layer "${lid}" placed twice (already in ${seen.get(lid)})`);
        seen.set(lid, pointer(...base, ...where));
        if (layer.children) {
          if (this.reg.hasNode(layer.type) && !this.reg.node(layer.type).container) {
            this.err(pointer(...base, 'layers', lid, 'children'), `${layer.type} does not accept children`);
          }
          if (depth < 64) walk(layer.children, ['layers', lid, 'children'], depth + 1);
        }
      });
    };
    walk(comp.order, ['order'], 0);
    for (const lid of Object.keys(comp.layers)) {
      if (!seen.has(lid)) this.err(pointer(...base, 'layers', lid), `layer "${lid}" missing from the tree (neither in order nor in a group)`);
    }

    const markers = new Set<string>();
    (comp.markers || []).forEach((m, i) => {
      if (markers.has(m.id)) this.err(pointer(...base, 'markers', i, 'id'), `duplicate marker id "${m.id}"`);
      markers.add(m.id);
    });

    if (comp.background !== undefined && comp.background !== null) {
      this.prop(cid, pointer(...base, 'background'), { type: 'color', default: null, nullable: true }, comp.background);
    }
    if (comp.motionBlur) this.props(cid, pointer(...base, 'motionBlur'), MOTION_BLUR_SCHEMA, comp.motionBlur);
    this.effects(cid, pointer(...base, 'effects'), comp.effects, 'finish');

    for (const [lid, layer] of Object.entries(comp.layers)) {
      const lp = pointer(...base, 'layers', lid);
      if (layer.in !== undefined && layer.out !== undefined && layer.out <= layer.in) this.err(lp + '/out', 'out must come after in');
      if (layer.clip !== undefined) {
        const target = comp.layers[layer.clip];
        if (!target) this.err(lp + '/clip', `unknown clip layer "${layer.clip}"`);
        else if (layer.clip === lid) this.err(lp + '/clip', 'a layer cannot clip itself');
        else if (this.reg.hasNode(target.type) && !this.reg.node(target.type).path) {
          this.err(lp + '/clip', `${target.type} has no outline: it cannot be used as a clip`);
        }
      }
      if (!this.reg.hasNode(layer.type)) { this.err(lp + '/type', `unknown node type "${layer.type}"`); continue; }
      const node = this.reg.node(layer.type);
      if (layer.transform) this.props(cid, lp + '/transform', TRANSFORM_SCHEMA, layer.transform);
      if (layer.props) this.props(cid, lp + '/props', node.props, layer.props);
      this.effects(cid, lp + '/effects', layer.effects, 'layer');
    }
  }

  effects(cid: string, path: string, effects: { id: string; type: string; props?: Record<string, unknown> }[] | undefined, stage: 'layer' | 'finish') {
    const ids = new Set<string>();
    (effects || []).forEach((e, i) => {
      const p = `${path}/${i}`;
      if (ids.has(e.id)) this.err(p + '/id', `duplicate effect id "${e.id}"`);
      ids.add(e.id);
      if (!this.reg.hasEffect(e.type)) return this.err(p + '/type', `unknown effect type "${e.type}"`);
      if (this.reg.effect(e.type).stage !== stage) return this.err(p + '/type', stage === 'layer' ? `${e.type} applies to the composition, not to a layer` : `${e.type} applies to a layer, not to the composition`);
      if (e.props) this.props(cid, p + '/props', this.reg.effect(e.type).props, e.props);
    });
  }

  props(cid: string, path: string, schema: PropSchema, values: object) {
    for (const [name, v] of Object.entries(values)) {
      const def = schema[name];
      if (!def) { this.err(`${path}/${name}`, `unknown property "${name}"`); continue; }
      this.prop(cid, `${path}/${name}`, def, v);
    }
  }

  prop(cid: string, path: string, def: PropDef, v: unknown) {
    const kind = propKind(v);
    const mods = isObj(v) ? v.$mod : undefined;
    if ((kind !== 'static' || mods !== undefined) && def.animatable === false) return this.err(path, 'property cannot be animated: static value expected');
    if (mods !== undefined) this.mods(path + '/$mod', def, mods);
    switch (kind) {
      case 'static': {
        const isWrapped = isObj(v) && '$v' in v;
        if (isObj(v) && !isWrapped && Object.keys(v).some((k) => k.startsWith('$'))) {
          const extra = Object.keys(v).filter((k) => k.startsWith('$') && k !== '$mod');
          return this.err(path, extra.length ? `unknown reserved key ${extra.join(', ')}` : '$mod on a fixed value: write { "$v": value, "$mod": [...] }');
        }
        const bad = this.valueIssue(def, staticValue(v));
        if (bad) this.err(isWrapped ? path + '/$v' : path, bad);
        break;
      }
      case 'keyframes': {
        const kp = asKeyframed(v);
        if (!Array.isArray(kp.$k) || kp.$k.length === 0) return this.err(path + '/$k', 'at least one keyframe expected');
        let prev = -Infinity;
        kp.$k.forEach((k, i) => {
          const kpth = `${path}/$k/${i}`;
          if (!isObj(k) || !isNum(k.t)) return this.err(kpth, 'keyframe { t, v, ease? } expected');
          if (k.t < prev) this.err(kpth + '/t', 'keyframes must be sorted by time');
          prev = k.t;
          const bad = this.valueIssue(def, k.v);
          if (bad) this.err(kpth + '/v', bad);
          if (k.ease !== undefined) { const be = this.easeIssue(k.ease); if (be) this.err(kpth + '/ease', be); }
        });
        if (kp.$expr !== undefined) this.expr(path + '/$expr', kp.$expr);
        break;
      }
      case 'expression':
        this.expr(path + '/$expr', asExpr(v).$expr);
        break;
      case 'link': {
        const target = asLink(v).$link;
        if (typeof target !== 'string') return this.err(path + '/$link', 'address expected');
        if (target.startsWith('@')) {
          if (!this.doc.tokens[target.slice(1)]) this.err(path + '/$link', `unknown token ${target}`);
        } else {
          const bad = this.addressIssue(cid, target);
          if (bad) this.err(path + '/$link', bad);
        }
        break;
      }
    }
  }

  mods(path: string, def: PropDef, mods: unknown) {
    if (!Array.isArray(mods)) return this.err(path, 'list of modifiers expected');
    if (def.type !== 'number' && def.type !== 'vec2') return this.err(path, `modifiers apply to numbers and vectors, not to ${def.type}`);
    mods.forEach((m, i) => {
      const p = `${path}/${i}`;
      if (!isObj(m) || typeof m.type !== 'string') return this.err(p, 'modifier { type, ...params } expected');
      if (!this.reg.hasModifier(m.type)) return this.err(p + '/type', `unknown modifier "${m.type}"`);
      const schema = this.reg.modifier(m.type).params;
      for (const [k, val] of Object.entries(m)) {
        if (k === 'type') continue;
        const d = schema[k];
        if (!d) { this.err(`${p}/${k}`, `unknown parameter "${k}"`); continue; }
        const bad = this.valueIssue(d, val);
        if (bad) this.err(`${p}/${k}`, bad);
      }
    });
  }

  expr(path: string, src: unknown) {
    if (typeof src !== 'string') return this.err(path, 'JavaScript source expected');
    try { compileExpr(src); } catch (e) { this.err(path, (e as Error).message); }
  }

  addressIssue(cid: string, address: string): string | null {
    const comp = this.doc.compositions[cid];
    const [lid, a, b, ...rest] = address.split('.');
    if (lid === '$comp') return null; // composition settings: checked at evaluation
    const layer = comp.layers[lid];
    if (!layer) return `unknown layer "${lid}"`;
    if (a === 'transform') return TRANSFORM_SCHEMA[b] && !rest.length ? null : `unknown transform.${b}`;
    if (b !== undefined) return `invalid address "${address}"`;
    if (!this.reg.hasNode(layer.type)) return null;
    return this.reg.node(layer.type).props[a] ? null : `${layer.type} has no property "${a}"`;
  }

  easeIssue(e: unknown): string | null {
    if (e === 'linear' || e === 'hold') return null;
    if (typeof e === 'string' && e.startsWith('@')) {
      const tk = this.doc.tokens[e.slice(1)];
      if (!tk) return `unknown curve token ${e}`;
      return tk.type === 'ease' ? null : `${e} is not a curve`;
    }
    if (Array.isArray(e) && e.length === 4 && e.every(isNum)) {
      return e[0] >= 0 && e[0] <= 1 && e[2] >= 0 && e[2] <= 1 ? null : 'x1 and x2 must stay between 0 and 1';
    }
    return "curve expected: 'linear', 'hold', [x1, y1, x2, y2] or '@token'";
  }

  colorIssue(v: unknown): string | null {
    if (typeof v !== 'string') return 'color expected';
    if (v.startsWith('@')) {
      const tk = this.doc.tokens[v.slice(1)];
      if (!tk) return `unknown token ${v}`;
      return tk.type === 'color' ? null : `${v} is not a color`;
    }
    try { parseColor(v); return null; } catch (e) { return (e as Error).message; }
  }

  valueIssue(def: PropDef, v: unknown): string | null {
    if (v === null) return def.nullable || def.type === 'paint' ? null : 'null value not allowed';
    switch (def.type) {
      case 'number': return isNum(v) ? null : 'number expected';
      case 'vec2': return isVec2(v) ? null : '[x, y] expected';
      case 'bool': return typeof v === 'boolean' ? null : 'boolean expected';
      case 'string': case 'text': return typeof v === 'string' ? null : 'text expected';
      case 'enum': return typeof v === 'string' && def.options?.includes(v) ? null : `one of ${def.options?.join(', ')}`;
      case 'color': return this.colorIssue(v);
      case 'ease': return this.easeIssue(v);
      case 'json': return null;
      case 'comp': return typeof v === 'string' && this.doc.compositions[v] ? null : `unknown composition "${String(v)}"`;
      case 'asset': {
        if (typeof v !== 'string') return 'asset id expected';
        const a = this.doc.assets[v];
        if (!a) return `unknown asset "${v}"`;
        return !def.assetType || a.type === def.assetType ? null : `asset of type ${def.assetType} expected ("${v}" is ${a.type})`;
      }
      case 'assets': {
        if (!Array.isArray(v)) return 'list of asset ids expected';
        for (const id of v) {
          const issue = this.valueIssue({ ...def, type: 'asset' }, id);
          if (issue) return issue;
        }
        return null;
      }
      case 'paint': {
        if (typeof v === 'string') return this.colorIssue(v);
        if (!isObj(v) || !Array.isArray(v.stops)) return 'color or gradient expected';
        if (v.type === 'linear' && !(isVec2(v.from) && isVec2(v.to))) return 'linear gradient: from and to [x, y]';
        if (v.type === 'radial' && !(isVec2(v.center) && isNum(v.radius))) return 'radial gradient: center [x, y] and radius';
        if (v.type !== 'linear' && v.type !== 'radial') return "gradient: type 'linear' or 'radial'";
        for (const s of v.stops) {
          if (!Array.isArray(s) || !isNum(s[0])) return 'stops [position, color] expected';
          const c = this.colorIssue(s[1]);
          if (c) return c;
        }
        return null;
      }
      case 'path': {
        if (!isObj(v) || !Array.isArray(v.v) || !v.v.every(isVec2)) return 'path { v: [[x, y], ...], i?, o?, closed? } expected';
        for (const k of ['i', 'o'] as const) {
          if (v[k] !== undefined && (!Array.isArray(v[k]) || v[k].length !== v.v.length || !v[k].every(isVec2))) return `${k}: one tangent per vertex`;
        }
        return null;
      }
    }
  }
}
