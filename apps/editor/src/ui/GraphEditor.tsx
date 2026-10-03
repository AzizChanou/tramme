// Graph editor: value curves of the selected layers' animated properties.
// A segment's ease is a cubic Bézier normalised to the segment (time and
// value), so its two handles are drawn in value space and dragging them
// rewrites the ease of that segment. Keys move in time and value.

import { signal } from '@preact/signals';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Evaluator, getAt, modsOf, resolveTokens, sampleKeyframes, type Bezier, type EaseSpec, type Keyframe, type Op, type PropType } from '@tramme/core';
import { comp, commit, draft, cancelDraft, S, setTime, viewDoc, uiTime } from '../state.ts';
import { assetData } from '../preview.ts';
import { animatedProps, keysOf, layerName, propPath, rulerLabel, snap, timecode } from '../model.ts';
import { Icon } from './icons.tsx';
import { propLabel } from './Timeline.tsx';
import { t } from '../i18n/index.ts';

const hidden = signal<Set<string>>(new Set());
const COLORS = ['#ff7a7a', '#7ad67a', '#7aa8ff', '#f2b54d', '#e07a8e', '#4fd1c5'];

interface Channel { id: string; layer: string; prop: string; comp: number; type: PropType; keys: Keyframe[]; label: string; color: string; modified: boolean }

const PRESETS: [string, EaseSpec][] = [
  [t('common.linear'), 'linear'], [t('common.hold'), 'hold'], [t('curves.smooth'), [0.42, 0, 0.58, 1]], [t('common.in'), [0.42, 0, 1, 1]], [t('common.out'), [0, 0, 0.58, 1]],
];

function bezierOf(spec: EaseSpec | undefined, tokens: Record<string, { type: string; value: unknown }>): Bezier | 'hold' {
  if (spec === undefined || spec === 'linear') return [1 / 3, 1 / 3, 2 / 3, 2 / 3];
  if (spec === 'hold') return 'hold';
  if (typeof spec === 'string') { const v = tokens[spec.slice(1)]?.value; return Array.isArray(v) ? (v as Bezier) : [1 / 3, 1 / 3, 2 / 3, 2 / 3]; }
  return spec;
}

const num = (v: unknown, i: number) => (Array.isArray(v) ? Number(v[i]) : Number(v));

export function GraphEditor() {
  const c = comp.value, doc = viewDoc.value, now = uiTime.value, compId = S.compId.value;
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 240 });
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(host.current!);
    return () => ro.disconnect();
  }, []);

  // channels of the selected layers' numeric animated props
  const reg = S.registry.value;
  const channels: Channel[] = [];
  let ci = 0;
  for (const id of S.selection.value) {
    const l = c.layers[id];
    if (!l) continue;
    for (const [prop, keys] of animatedProps(l)) {
      const def = prop.startsWith('transform.') ? { type: prop === 'transform.rotation' || prop === 'transform.opacity' ? 'number' : 'vec2' } : reg.hasNode(l.type) ? reg.node(l.type).props[prop] : null;
      if (!def || (def.type !== 'number' && def.type !== 'vec2')) continue;
      const dims = def.type === 'vec2' ? 2 : 1;
      for (let k = 0; k < dims; k++) {
        channels.push({
          id: `${id}|${prop}|${k}`, layer: id, prop, comp: k, type: def.type as PropType, keys,
          label: `${S.selection.value.length > 1 ? layerName(id, l) + ' · ' : ''}${propLabel(l.type, prop)}${dims > 1 ? (k ? ' Y' : ' X') : ''}`,
          color: COLORS[ci++ % COLORS.length],
          modified: !!modsOf(getAt(doc, propPath(compId, id, prop))),
        });
      }
    }
  }
  const shown = channels.filter((ch) => !hidden.value.has(ch.id));
  const props = new Set(shown.map((ch) => `${ch.layer}|${ch.prop}`));
  const normalized = props.size > 1;

  // view ranges
  const allT = shown.flatMap((ch) => ch.keys.map((k) => k.t));
  let ta = allT.length ? Math.min(...allT) : 0, tb = allT.length ? Math.max(...allT) : c.duration;
  if (tb - ta < 0.2) { ta -= 0.5; tb += 0.5; }
  // modifiers keep moving after the last key (springs settle, loops repeat): show the whole composition
  if (shown.some((ch) => ch.modified)) { ta = 0; tb = c.duration; }
  const tp = (tb - ta) * 0.08; ta = Math.max(0, ta - tp); tb = Math.min(c.duration, tb + tp);
  const ev = useMemo(() => new Evaluator(doc, reg, { data: assetData }), [doc, reg]);
  const finalValue = (ch: Channel, tt: number) => { try { return num(ev.value(`${ch.layer}.${ch.prop}`, tt, compId), ch.comp); } catch { return NaN; } };
  const range = (ch: Channel): [number, number] => {
    const vs: number[] = [];
    for (let i = 0; i <= 120; i++) {
      const tt = ta + ((tb - ta) * i) / 120;
      vs.push(num(sampleKeyframes(ch.type, ch.keys, tt, doc.tokens), ch.comp));
      if (ch.modified) { const f = finalValue(ch, tt); if (Number.isFinite(f)) vs.push(f); }
    }
    for (const k of ch.keys) vs.push(num(resolveTokens(ch.type, k.v, doc.tokens), ch.comp));
    let a = Math.min(...vs), b = Math.max(...vs);
    if (b - a < 1e-6) { a -= 1; b += 1; }
    return [a, b];
  };
  const ranges = new Map(shown.map((ch) => [ch.id, range(ch)]));
  let va = Math.min(...[...ranges.values()].map((r) => r[0]), 0), vb = Math.max(...[...ranges.values()].map((r) => r[1]), 1);
  if (!shown.length) { va = 0; vb = 1; }
  if (!normalized && shown.length) { va = Math.min(...[...ranges.values()].map((r) => r[0])); vb = Math.max(...[...ranges.values()].map((r) => r[1])); }
  const vp = (vb - va) * 0.12; va -= vp; vb += vp;

  const padL = 16, padR = 56, padT = 14, padB = 22;
  const W = size.w, H = size.h;
  const X = (time: number) => padL + ((time - ta) / (tb - ta)) * (W - padL - padR);
  const Tm = (x: number) => ta + ((x - padL) / (W - padL - padR)) * (tb - ta);
  const norm = (ch: Channel, v: number) => { if (!normalized) return v; const [a, b] = ranges.get(ch.id)!; return (v - a) / (b - a); };
  const denorm = (ch: Channel, n: number) => { if (!normalized) return n; const [a, b] = ranges.get(ch.id)!; return a + n * (b - a); };
  const nva = normalized ? -0.12 : va, nvb = normalized ? 1.12 : vb;
  const Y = (v: number) => padT + (1 - (v - nva) / (nvb - nva)) * (H - padT - padB);
  const V = (y: number) => nva + (1 - (y - padT) / (H - padT - padB)) * (nvb - nva);

  /** the final motion, modifiers included, as the engine renders it */
  const finalPath = (ch: Channel) => {
    const n = Math.max(40, Math.round((W - padL - padR) / 3));
    let d = '';
    for (let i = 0; i <= n; i++) {
      const tt = ta + ((tb - ta) * i) / n;
      const f = finalValue(ch, tt);
      if (!Number.isFinite(f)) return '';
      d += `${i ? 'W' : 'M'}${X(tt).toFixed(1)},${Y(norm(ch, f)).toFixed(1)}`;
    }
    return d;
  };
  const path = (ch: Channel) => {
    const n = Math.max(40, Math.round((W - padL - padR) / 3));
    let d = '';
    for (let i = 0; i <= n; i++) {
      const tt = ta + ((tb - ta) * i) / n;
      const v = norm(ch, num(sampleKeyframes(ch.type, ch.keys, tt, doc.tokens), ch.comp));
      d += `${i ? 'W' : 'M'}${X(tt).toFixed(1)},${Y(v).toFixed(1)}`;
    }
    return d;
  };

  // ── edits ──────────────────────────────────────────────────
  const keysPath = (ch: Channel) => `${propPath(compId, ch.layer, ch.prop)}/$k`;
  const rawKeys = (ch: Channel) => keysOf(getAt(S.doc.peek(), propPath(compId, ch.layer, ch.prop))) ?? ch.keys;

  const dragKey = (e: PointerEvent, ch: Channel, i: number) => {
    e.stopPropagation();
    const kid = `${ch.layer}|${ch.prop}|${i}`;
    S.keys.value = [kid];
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    const keys0 = rawKeys(ch);
    const v0 = resolveTokens(ch.type, keys0[i].v, doc.tokens);
    let ops: Op[] = [];
    const move = (ev: PointerEvent) => {
      const x = ev.clientX - svg.left, y = ev.clientY - svg.top;
      let nt = snap(Tm(x), c.fps), nv = denorm(ch, V(y));
      if (ev.shiftKey) { if (Math.abs(ev.movementX) > Math.abs(ev.movementY)) nv = num(v0, ch.comp); else nt = keys0[i].t; }
      const v = ch.type === 'vec2' ? (v0 as number[]).map((x0, k) => (k === ch.comp ? +nv.toFixed(3) : x0)) : +nv.toFixed(4);
      const next = keys0.map((k, j) => (j === i ? { ...k, t: +Math.max(0, nt).toFixed(5), v } : k)).sort((a, b) => a.t - b.t);
      ops = [{ op: 'replace', path: keysPath(ch), value: next }];
      draft(ops);
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (ops.length) { commit(t('curves.editKeyframe'), ops); S.keys.value = []; } else cancelDraft();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  const dragHandle = (e: PointerEvent, ch: Channel, i: number, which: 0 | 1) => {
    e.stopPropagation();
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    const keys0 = rawKeys(ch);
    const a = keys0[i], b = keys0[i + 1];
    const va0 = norm(ch, num(resolveTokens(ch.type, a.v, doc.tokens), ch.comp)), vb0 = norm(ch, num(resolveTokens(ch.type, b.v, doc.tokens), ch.comp));
    const dv = Math.abs(vb0 - va0) > 1e-9 ? vb0 - va0 : (nvb - nva) * 0.25;
    const bz = bezierOf(a.ease, doc.tokens);
    if (bz === 'hold') return;
    let ops: Op[] = [];
    const move = (ev: PointerEvent) => {
      const x = ev.clientX - svg.left, y = ev.clientY - svg.top;
      const nx = Math.min(1, Math.max(0, (Tm(x) - a.t) / (b.t - a.t)));
      const ny = (V(y) - va0) / dv;
      const next: Bezier = which === 0 ? [nx, ny, bz[2], bz[3]] : [bz[0], bz[1], nx, ny];
      const r = next.map((q) => +q.toFixed(3)) as Bezier;
      ops = [{ op: 'replace', path: `${keysPath(ch)}/${i}`, value: { ...a, ease: r } }];
      draft(ops);
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (ops.length) commit(t('curves.segmentCurve'), ops); else cancelDraft();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  const applyEase = (spec: EaseSpec) => {
    const ops: Op[] = [];
    for (const kid of S.keys.peek()) {
      const [layer, prop, idx] = kid.split('|');
      const keys = keysOf(getAt(S.doc.peek(), propPath(compId, layer, prop)));
      const i = Number(idx);
      if (!keys || i >= keys.length - 1) continue;
      const { ease: _, ...rest } = keys[i];
      ops.push({ op: 'replace', path: `${propPath(compId, layer, prop)}/$k/${i}`, value: spec === 'linear' ? rest : { ...rest, ease: spec } });
    }
    if (ops.length) commit(t('common.curve'), ops);
  };

  // grid
  const tStep = [1 / c.fps, 0.1, 0.25, 0.5, 1, 2, 5, 10].find((s) => (s / (tb - ta)) * (W - padL - padR) > 60) ?? 10;
  const vSpan = nvb - nva;
  const vStep = Math.pow(10, Math.floor(Math.log10(vSpan / 4)));
  const vStep2 = [1, 2, 5].map((m) => m * vStep).find((s) => vSpan / s <= 6) ?? vStep * 10;
  const selKeys = new Set(S.keys.value);
  const sel1 = S.keys.value.length > 0;

  return (
    <div class="graph" ref={host}>
      {channels.length === 0 ? (
        <div class="empty" style={{ height: '100%' }}><Icon name="curve" />{t('curves.selectAnAnimatedLayer')}</div>
      ) : (
        <>
          <svg onPointerDown={(e) => { if (e.target === e.currentTarget) { S.keys.value = []; const r = (e.currentTarget as SVGElement).getBoundingClientRect(); setTime(snap(Tm(e.clientX - r.left), c.fps)); } }}>
            {Array.from({ length: Math.floor((tb - ta) / tStep) + 2 }, (_, i) => Math.ceil(ta / tStep) * tStep + i * tStep).filter((x) => x <= tb).map((x) => (
              <g key={`t${x}`}><line class="grid" x1={X(x)} y1={padT} x2={X(x)} y2={H - padB} /><text class="glabel" x={X(x) + 3} y={H - 7}>{rulerLabel(x, c.fps)}</text></g>
            ))}
            {!normalized && Array.from({ length: Math.floor(vSpan / vStep2) + 2 }, (_, i) => Math.ceil(nva / vStep2) * vStep2 + i * vStep2).filter((v) => v <= nvb).map((v) => (
              <g key={`v${v}`}><line class={`grid${Math.abs(v) < 1e-9 ? ' zero' : ''}`} x1={padL} y1={Y(v)} x2={W - padR} y2={Y(v)} /><text class="glabel" x={W - 6} y={Y(v) + 3} text-anchor="end">{+v.toFixed(3)}</text></g>
            ))}
            {normalized && [0, 1].map((v) => <line key={v} class="grid zero" x1={padL} y1={Y(v)} x2={W - padR} y2={Y(v)} />)}
            {shown.map((ch) => <path key={ch.id} class="curve" d={path(ch)} stroke={ch.color} opacity={ch.modified ? 0.45 : 1} />)}
            {shown.filter((ch) => ch.modified).map((ch) => <path key={`${ch.id}.f`} class="curve" d={finalPath(ch)} stroke={ch.color} stroke-dasharray="4 3" />)}
            {shown.map((ch) => ch.keys.map((k, i) => {
              const kid = `${ch.layer}|${ch.prop}|${i}`;
              const x = X(k.t), y = Y(norm(ch, num(resolveTokens(ch.type, k.v, doc.tokens), ch.comp)));
              const next = ch.keys[i + 1];
              const bz = next ? bezierOf(k.ease, doc.tokens) : 'hold';
              const handles = next && bz !== 'hold' && (selKeys.has(kid) || selKeys.has(`${ch.layer}|${ch.prop}|${i + 1}`)) ? (() => {
                const y2v = norm(ch, num(resolveTokens(ch.type, next.v, doc.tokens), ch.comp));
                const y1v = norm(ch, num(resolveTokens(ch.type, k.v, doc.tokens), ch.comp));
                const dv = Math.abs(y2v - y1v) > 1e-9 ? y2v - y1v : (nvb - nva) * 0.25;
                const h1 = [X(k.t + bz[0] * (next.t - k.t)), Y(y1v + bz[1] * dv)], h2 = [X(k.t + bz[2] * (next.t - k.t)), Y(y1v + bz[3] * dv)];
                return <g>
                  <line class="handle-line" x1={x} y1={y} x2={h1[0]} y2={h1[1]} />
                  <line class="handle-line" x1={X(next.t)} y1={Y(y2v)} x2={h2[0]} y2={h2[1]} />
                  <circle class="handle" cx={h1[0]} cy={h1[1]} r={4} onPointerDown={(e) => dragHandle(e as unknown as PointerEvent, ch, i, 0)} />
                  <circle class="handle" cx={h2[0]} cy={h2[1]} r={4} onPointerDown={(e) => dragHandle(e as unknown as PointerEvent, ch, i, 1)} />
                </g>;
              })() : null;
              return <g key={`${ch.id}.${i}`}>
                {handles}
                <rect class={`key${selKeys.has(kid) ? ' selected' : ''}`} x={x - 4.5} y={y - 4.5} width={9} height={9} transform={`rotate(45 ${x} ${y})`}
                  onPointerDown={(e) => dragKey(e as unknown as PointerEvent, ch, i)} onDblClick={() => setTime(k.t)}>
                  <title>{`${timecode(k.t, c.fps)} · ${JSON.stringify(k.v)}`}</title>
                </rect>
              </g>;
            }))}
            <line x1={X(now)} y1={0} x2={X(now)} y2={H} stroke="var(--danger)" stroke-width={1} />
          </svg>
          <div class="graph-side">
            {channels.map((ch) => (
              <button key={ch.id} class={hidden.value.has(ch.id) ? '' : 'on'} onClick={() => { const s = new Set(hidden.value); s.has(ch.id) ? s.delete(ch.id) : s.add(ch.id); hidden.value = s; }}>
                <i style={{ background: hidden.value.has(ch.id) ? 'transparent' : ch.color, boxShadow: `inset 0 0 0 1.5px ${ch.color}` }} />{ch.label}
              </button>
            ))}
            {normalized && <div class="faint" style={{ fontSize: 10, padding: '4px 8px 2px' }}>{t('curves.normalizedValues')}</div>}
          </div>
          <div class="graph-presets">
            {[...PRESETS, ...Object.entries(doc.tokens).filter(([, tk]) => tk.type === 'ease').map(([n]) => [n, `@${n}`] as [string, EaseSpec])].map(([label, spec]) => (
              <button key={label} class="btn sm ghost" disabled={!sel1} title={sel1 ? t('curves.applyNameToThe', { name: label }) : t('curves.selectAKeyframe')} onClick={() => applyEase(spec)}>{label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

