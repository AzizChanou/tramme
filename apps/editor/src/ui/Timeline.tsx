// Transport and timeline: one row per layer (its clip from in to out, its
// keyframes summarised), expandable into one row per animated property.
// Clips move and trim, keyframes select and drag, all snapped to frames.

import { signal } from '@preact/signals';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { layerActive, pointer, type Composition, type Keyframe, type Op } from '@tramme/core';
import { comp, commit, draft, cancelDraft, S, select, setTime, frameStep, uiTime, viewDoc } from '../state.ts';
import { animatedProps, flatTree, keysOf, layerName, parentOf, parseTime, propPath, rawProp, rulerLabel, shiftLayerOps, snap, timecode, type TreeItem } from '../model.ts';
import { openMenu, useSize } from './controls.tsx';
import { Icon, kindColor, kindIcon } from './icons.tsx';
import { preview } from '../preview.ts';
import { GraphEditor } from './GraphEditor.tsx';
import { m, t, tr } from '../i18n/index.ts';

export const pps = signal(0);              // pixels per second (0: fit)
const expanded = signal<Set<string>>(new Set());
const collapsedTl = signal<Set<string>>(new Set());

const TRACK_PAD = 12;

// ── transport ────────────────────────────────────────────────
export function Transport() {
  const c = comp.value, now = S.time.value, playing = S.playing.value;
  const [text, setText] = useState<string | null>(null);
  const frames = Math.round(c.duration * c.fps);
  const tab = S.bottomTab.value;
  return (
    <div class="transport" data-tour="transport">
      <div class="controls">
        <button class="icon-btn" title={t('timeline.startHome')} onClick={() => setTime(0)}><Icon name="start" /></button>
        <button class="icon-btn" title={t('timeline.previousFrame')} onClick={() => frameStep(-1)}><Icon name="prev" /></button>
        <button class="icon-btn play" title={t('timeline.playSpace')} onClick={() => { S.playing.value = !playing; }}><Icon name={playing ? 'pause' : 'play'} /></button>
        <button class="icon-btn" title={t('timeline.nextFrame')} onClick={() => frameStep(1)}><Icon name="next" /></button>
        <button class="icon-btn" title={t('timeline.endEnd')} onClick={() => setTime(c.duration)}><Icon name="end" /></button>
        <button class={`icon-btn${S.loop.value ? ' on' : ''}`} title={t('timeline.loop')} onClick={() => { S.loop.value = !S.loop.value; }}><Icon name="loop" /></button>
      </div>
      <div class="timecode">
        <input value={text ?? timecode(now, c.fps)} title={t('timeline.timeSFrame8')}
          onFocus={(e) => (e.target as HTMLInputElement).select()}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
          onBlur={() => { if (text !== null) { const v = parseTime(text, c.fps); if (v !== null) setTime(v); } setText(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { if (e.key === 'Escape') setText(null); (e.target as HTMLInputElement).blur(); } }} />
        <span class="total">{t('common.frameDoneTotal', { done: Math.min(frames, Math.round(now * c.fps) + 1), total: frames })}<span class="fps"> · {t('common.nFps', { n: c.fps })}</span></span>
      </div>
      <span class="grow" />
      <div class="tabs">
        <button data-tour="bottom-tab-timeline" class={`tab${tab === 'timeline' ? ' on' : ''}`} onClick={() => { S.bottomTab.value = 'timeline'; }}><Icon name="timeline" size={13} /> {t('common.timeline')}</button>
        <button data-tour="bottom-tab-graph" class={`tab${tab === 'graph' ? ' on' : ''}`} onClick={() => { S.bottomTab.value = 'graph'; }}><Icon name="curve" size={13} /> {t('common.curves')}</button>
      </div>
      <div class="tl-zoom" title={t('timeline.timelineZoomCtrlWheel')}>
        <Icon name="minus" size={12} />
        <input type="range" min={0} max={100} value={zoomToSlider(c)} onInput={(e) => { pps.value = sliderToZoom(c, Number((e.target as HTMLInputElement).value)); }} />
        <Icon name="plus" size={12} />
      </div>
      <span class="render-ms faint mono" style={{ fontSize: 10.5, minWidth: 54, textAlign: 'right' }} title={t('timeline.lastRenderTime')}>{preview.lastMs ? `${preview.lastMs.toFixed(0)} ms` : ''}</span>
    </div>
  );
}

let fitPps = 100;
const zoomToSlider = (c: Composition) => { const z = pps.value || fitPps; return Math.round((Math.log(z / fitPps) / Math.log(c.fps * 40 / fitPps)) * 100) || 0; };
const sliderToZoom = (c: Composition, s: number) => (s <= 0 ? 0 : fitPps * Math.pow(c.fps * 40 / fitPps, s / 100));

// ── timeline ─────────────────────────────────────────────────
interface Row { kind: 'layer'; item: TreeItem }
interface PropRowT { kind: 'prop'; item: TreeItem; name: string; keys: Keyframe[] }
type AnyRow = Row | PropRowT;

const PROP_LABEL: Record<string, string> = { 'transform.position': m('timeline.position'), 'transform.scale': m('timeline.scale'), 'transform.rotation': m('timeline.rotation'), 'transform.opacity': m('timeline.opacity'), 'transform.anchor': m('timeline.anchor') };
export function propLabel(type: string, name: string): string {
  if (PROP_LABEL[name]) return t(PROP_LABEL[name]);
  const reg = S.registry.peek();
  return tr(reg.hasNode(type) ? reg.node(type).props[name]?.label : undefined) || name;
}

function rulerStep(pxPerSec: number, fps: number): [number, number] {
  const steps = [1 / fps, 2 / fps, 5 / fps, 0.5, 1, 2, 5, 10, 30, 60];
  const major = steps.find((s) => s * pxPerSec >= 70) ?? 60;
  const minor = steps.slice().reverse().find((s) => s < major && s * pxPerSec >= 8 && Math.abs(major / s - Math.round(major / s)) < 1e-6) ?? major;
  return [major, minor];
}

export function Timeline() {
  const c = comp.value, doc = viewDoc.value, now = uiTime.value, compId = S.compId.value;
  const tracks = useRef<HTMLDivElement>(null);
  const names = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [scroll, setScroll] = useState(0);
  const [namesW, namesHandle] = useSize('tl.names', 220, 140, 420);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(tracks.current!);
    return () => ro.disconnect();
  }, []);
  fitPps = Math.max(1, (width - TRACK_PAD * 2) / c.duration);
  const k = pps.value || fitPps;
  const X = (time: number) => TRACK_PAD + time * k;
  const T = (x: number) => (x - TRACK_PAD) / k;
  const total = X(c.duration) + TRACK_PAD;

  const rows: AnyRow[] = [];
  for (const item of flatTree(c, collapsedTl.value)) {
    rows.push({ kind: 'layer', item });
    if (expanded.value.has(item.id)) for (const [name, keys] of animatedProps(item.layer)) rows.push({ kind: 'prop', item, name, keys });
  }
  const sel = S.selection.value, keySel = S.keys.value;
  const fps = c.fps;

  // ── interactions ───────────────────────────────────────────
  const scrubFrom = (e: PointerEvent) => {
    const r = tracks.current!.getBoundingClientRect();
    const at = (ev: PointerEvent) => setTime(snap(T(ev.clientX - r.left + tracks.current!.scrollLeft), fps));
    at(e);
    S.playing.value = false;
    const move = (ev: PointerEvent) => at(ev);
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  const dragClip = (e: PointerEvent, id: string, mode: 'move' | 'in' | 'out') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    if (!sel.includes(id)) select([id]);
    const x0 = e.clientX, d0 = S.doc.peek(), l = d0.compositions[compId].layers[id];
    let ops: Op[] = [];
    const move = (ev: PointerEvent) => {
      const dt = snap((ev.clientX - x0) / k, fps);
      if (mode === 'move') ops = dt ? shiftLayerOps(d0, compId, id, Math.max(dt, -(l.in ?? 0))) : [];
      else {
        const lp = pointer('compositions', compId, 'layers', id);
        const tin = l.in ?? 0, tout = l.out ?? c.duration;
        if (mode === 'in') ops = [{ op: 'add', path: `${lp}/in`, value: +Math.min(tout - 1 / fps, Math.max(0, tin + dt)).toFixed(4) }];
        else ops = [{ op: 'add', path: `${lp}/out`, value: +Math.max(tin + 1 / fps, tout + dt).toFixed(4) }];
      }
      if (ops.length) draft(ops); else cancelDraft();
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (ops.length) commit(mode === 'move' ? t('timeline.moveInTime') : mode === 'in' ? t('common.inPoint') : t('common.outPoint'), ops); else cancelDraft();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  const keyId = (id: string, name: string, i: number) => `${id}|${name}|${i}`;
  const dragKey = (e: PointerEvent, id: string, name: string, i: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const kid = keyId(id, name, i);
    let chosen = keySel.includes(kid) ? keySel : e.shiftKey ? [...keySel, kid] : [kid];
    S.keys.value = chosen;
    const x0 = e.clientX, d0 = S.doc.peek();
    let ops: Op[] = [];
    const move = (ev: PointerEvent) => {
      const dt = snap((ev.clientX - x0) / k, fps);
      ops = dt ? moveKeysOps(d0, compId, chosen, dt) : [];
      if (ops.length) draft(ops); else cancelDraft();
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (ops.length) {
        commit(chosen.length > 1 ? t('timeline.moveNKeyframes', { n: chosen.length }) : t('timeline.moveKeyframe'), ops);
        // indexes change once keys are re-sorted: clear the selection
        S.keys.value = [];
      } else cancelDraft();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  const keyMenu = (e: MouseEvent, id: string, name: string, i: number) => {
    e.preventDefault();
    const kid = keyId(id, name, i);
    const chosen = keySel.includes(kid) ? keySel : [kid];
    S.keys.value = chosen;
    const eases: [string, unknown][] = [[t('common.linear'), 'linear'], [t('common.hold'), 'hold'],
      ...Object.entries(doc.tokens).filter(([, tk]) => tk.type === 'ease').map(([n]) => [n, `@${n}`] as [string, unknown])];
    openMenu(e, [
      { section: t('timeline.curveToTheNext') },
      ...eases.map(([label, v]) => ({ label: String(label), onClick: () => commit(t('common.curve'), easeOps(S.doc.peek(), compId, chosen, v)) })),
      'sep',
      { label: t('common.delete'), icon: 'trash', hint: t('common.del'), onClick: () => deleteKeys() },
    ]);
  };

  const onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const r = tracks.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, at = T(mx + tracks.current!.scrollLeft);
    const next = Math.max(fitPps, Math.min(fps * 60, k * Math.exp(-e.deltaY * 0.002)));
    pps.value = next <= fitPps * 1.001 ? 0 : next;
    requestAnimationFrame(() => { if (tracks.current) tracks.current.scrollLeft = TRACK_PAD + at * next - mx; });
  };

  const toggle = (set: typeof expanded, id: string) => { const s = new Set(set.value); s.has(id) ? s.delete(id) : s.add(id); set.value = s; };

  const [major, minor] = rulerStep(k, fps);
  const ticks: { t: number; major: boolean }[] = [];
  const t0 = Math.max(0, T(scroll) - major), t1 = Math.min(c.duration, T(scroll + width) + major);
  for (let i = Math.floor(t0 / minor); i * minor <= t1 + 1e-9; i++) {
    const tt = i * minor;
    ticks.push({ t: tt, major: Math.abs(tt / major - Math.round(tt / major)) < 1e-6 });
  }

  return (
    <div class="timeline" data-tour="timeline" style={{ '--names': `${namesW}px` }} onWheel={onWheel}>
      <div class="tl-corner"><Icon name="layers" size={13} />{t('timeline.nLayers', { n: Object.keys(c.layers).length })}</div>
      <div class="tl-ruler" onPointerDown={scrubFrom}>
        <div style={{ position: 'absolute', inset: 0, transform: `translateX(${-scroll}px)` }}>
          {ticks.map((tk) => (
            <div key={tk.t} class={`tick${tk.major ? '' : ' minor'}`} style={{ left: X(tk.t) }}>{tk.major && <span>{rulerLabel(tk.t, fps)}</span>}</div>
          ))}
          {(c.markers || []).map((m) => (
            <div key={m.id} class={`tl-marker${m.kind === 'scene' ? ' scene' : ''}`} style={{ left: X(m.t) }} title={`${m.label ?? m.id} · ${timecode(m.t, fps)}`}
              onDblClick={(e) => { e.stopPropagation(); setTime(m.t); }}>
              {k * 0.4 > 30 && <span>{m.label ?? m.id}</span>}
            </div>
          ))}
          <Playhead x={X} />
        </div>
      </div>
      <div class="tl-names" ref={names} style={{ position: 'relative' }}>
        {rows.map((r) => r.kind === 'layer' ? (
          <div key={r.item.id} class={`tl-name${sel.includes(r.item.id) ? ' selected' : ''}`} style={{ paddingLeft: 6 + r.item.depth * 12 }} onClick={(e) => select(e.shiftKey ? [...sel, r.item.id] : [r.item.id])}>
            {r.item.layer.children
              ? <button class={`twist${collapsedTl.value.has(r.item.id) ? '' : ' open'}`} onClick={(e) => { e.stopPropagation(); toggle(collapsedTl, r.item.id); }}><Icon name="chevron" /></button>
              : animatedProps(r.item.layer).length
                ? <button class={`twist${expanded.value.has(r.item.id) ? ' open' : ''}`} title={t('timeline.animatedProperties')} onClick={(e) => { e.stopPropagation(); toggle(expanded, r.item.id); }}><Icon name="chevron" /></button>
                : <span style={{ width: 16, flex: 'none' }} />}
            <span style={{ color: kindColor(r.item.layer.type), display: 'grid' }}><Icon name={kindIcon(r.item.layer.type)} size={12} /></span>
            <span class="name">{layerName(r.item.id, r.item.layer)}</span>
          </div>
        ) : (
          <div key={`${r.item.id}.${r.name}`} class="tl-name sub" style={{ paddingLeft: 30 + r.item.depth * 12 }}>
            <span class="dot-key" />
            <span class="name">{propLabel(r.item.layer.type, r.name)}</span>
          </div>
        ))}
        <div class="resizer v" style={{ position: 'absolute', top: 0, bottom: 0, right: -1 }} {...namesHandle('x', 1)} />
      </div>
      <div class="tl-tracks" ref={tracks}
        onScroll={(e) => { const el = e.currentTarget as HTMLDivElement; setScroll(el.scrollLeft); if (names.current) names.current.scrollTop = el.scrollTop; }}
        onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('tl-row')) { S.keys.value = []; scrubFrom(e); } }}>
        <div style={{ position: 'relative', width: total, minHeight: '100%' }}>
          {rows.map((r) => {
            if (r.kind === 'layer') {
              const l = r.item.layer, id = r.item.id;
              // visible range: the layer's own, inside its parents'
              let a = l.in ?? 0, b = l.out ?? c.duration;
              for (let p = r.item.parent; p; p = parentOf(c, p)) { a = Math.max(a, c.layers[p].in ?? 0); b = Math.min(b, c.layers[p].out ?? c.duration); }
              if (b <= a) b = a;
              const keysAll = animatedProps(l).flatMap(([, ks]) => ks.map((kf) => kf.t));
              return (
                <div key={id} class="tl-row">
                  <div class={`clip${sel.includes(id) ? ' selected' : ''}`} style={{ left: X(a), width: Math.max(2, (b - a) * k), '--c': kindColor(l.type), opacity: l.visible === false ? 0.45 : layerActive(l, c, now) ? 1 : 0.8 }}
                    onPointerDown={(e) => dragClip(e, id, 'move')} onDblClick={() => setTime(a)}>
                    {(b - a) * k > 60 && <span class="label">{layerName(id, l)}</span>}
                    <span class="edge l" onPointerDown={(e) => dragClip(e, id, 'in')} />
                    <span class="edge r" onPointerDown={(e) => dragClip(e, id, 'out')} />
                  </div>
                  {[...new Set(keysAll)].map((kt) => <span key={kt} class="kf summary" style={{ left: X(kt) }} />)}
                </div>
              );
            }
            const { item, name, keys } = r;
            return (
              <div key={`${item.id}.${name}`} class="tl-row sub">
                {keys.slice(1).map((kf, i) => keys[i].ease !== 'hold' && <span key={`s${i}`} class="kf-span" style={{ left: X(keys[i].t), width: (kf.t - keys[i].t) * k }} />)}
                {keys.map((kf, i) => {
                  const kid = keyId(item.id, name, i);
                  return <span key={i} class={`kf${kf.ease === 'hold' ? ' hold' : ''}${keySel.includes(kid) ? ' selected' : ''}`} style={{ left: X(kf.t) }}
                    title={`${timecode(kf.t, fps)} · ${JSON.stringify(kf.v)}${kf.ease ? ` · ${JSON.stringify(kf.ease)}` : ''}`}
                    onPointerDown={(e) => dragKey(e, item.id, name, i)} onDblClick={() => setTime(kf.t)} onContextMenu={(e) => keyMenu(e, item.id, name, i)} />;
                })}
              </div>
            );
          })}
          <div class="tl-out" style={{ left: X(c.duration), width: TRACK_PAD }} />
          <Playhead x={X} />
        </div>
      </div>
    </div>
  );
}

/** the playhead alone follows every frame, without redrawing the timeline */
function Playhead({ x }: { x: (t: number) => number }) {
  // moved by the compositor (its own layer): the timeline is not repainted at each frame
  return <div class="playhead" style={{ transform: `translateX(${x(S.time.value)}px)` }} />;
}

// ── keyframe edits ───────────────────────────────────────────
function groupKeys(ids: string[]) {
  const by = new Map<string, Set<number>>();
  for (const kid of ids) {
    const [id, name, i] = kid.split('|');
    const key = `${id}|${name}`;
    if (!by.has(key)) by.set(key, new Set());
    by.get(key)!.add(Number(i));
  }
  return by;
}

export function moveKeysOps(doc: import('@tramme/core').TrammeDoc, compId: string, ids: string[], dt: number): Op[] {
  const ops: Op[] = [];
  for (const [key, idx] of groupKeys(ids)) {
    const [id, name] = key.split('|');
    const raw = rawProp(doc, compId, id, name);
    const keys = keysOf(raw);
    if (!keys) continue;
    const moved = keys.map((kf, i) => (idx.has(i) ? { ...kf, t: +Math.max(0, kf.t + dt).toFixed(5) } : kf)).sort((a, b) => a.t - b.t);
    ops.push({ op: 'replace', path: `${propPath(compId, id, name)}/$k`, value: moved });
  }
  return ops;
}

function easeOps(doc: import('@tramme/core').TrammeDoc, compId: string, ids: string[], ease: unknown): Op[] {
  const ops: Op[] = [];
  for (const [key, idx] of groupKeys(ids)) {
    const [id, name] = key.split('|');
    const keys = keysOf(rawProp(doc, compId, id, name));
    if (!keys) continue;
    for (const i of idx) {
      const { ease: _, ...rest } = keys[i];
      ops.push({ op: 'replace', path: `${propPath(compId, id, name)}/$k/${i}`, value: ease === 'linear' ? rest : { ...rest, ease } });
    }
  }
  return ops;
}

export function deleteKeys(): boolean {
  const ids = S.keys.peek();
  if (!ids.length) return false;
  const doc = S.doc.peek(), compId = S.compId.peek();
  const ops: Op[] = [];
  for (const [key, idx] of groupKeys(ids)) {
    const [id, name] = key.split('|');
    const keys = keysOf(rawProp(doc, compId, id, name));
    if (!keys) continue;
    const left = keys.filter((_, i) => !idx.has(i));
    const path = propPath(compId, id, name);
    ops.push(left.length ? { op: 'replace', path: `${path}/$k`, value: left } : { op: 'replace', path, value: keys[0].v });
  }
  S.keys.value = [];
  return commit(ids.length > 1 ? t('timeline.deleteNKeyframes', { n: ids.length }) : t('common.deleteKeyframe'), ops);
}

export function Bottom() {
  return S.bottomTab.value === 'graph' ? <GraphEditor /> : <Timeline />;
}
