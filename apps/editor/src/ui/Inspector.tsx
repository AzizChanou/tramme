// Inspector generated from the node schemas: one row per property, a field
// by type, and the property's state (static, keyframes, expression, link)
// shown by colour and switched from its menu.

import { useMemo, useState } from 'preact/hooks';
import { Evaluator, getAt, pointer, propKind, sheetIssues, TRANSFORM_SCHEMA, MOTION_BLUR_SCHEMA, CAMERA_SCHEMA, SOUND_MIX_SCHEMA, type TrammeDoc, type Paint, type Prop, type PropDef, type PropSchema, type Token } from '@tramme/core';
import { comp, commit, draft, cancelDraft, S, viewDoc, select, uiTime } from '../state.ts';
import { assetData } from '../preview.ts';
import { addModifierOps, editAtOps, fixedOps, folderOf, imagesIn, keyAtOps, keyIndexAt, keysOf, removeKeyOps, removeModifierOps, setAtOps, snap, freshId, fmtSeconds } from '../model.ts';
import { modsOf, modifierParams } from '@tramme/core';
import { ColorField, NumberField, openMenu, Popover, Select, Seg, TextInput, Toggle, type MenuItem } from './controls.tsx';
import { Icon, kindColor, kindIcon } from './icons.tsx';
import { m, t, tr } from '../i18n/index.ts';

const UNIT: Record<string, string> = { px: 'px', deg: '°', '%': '%', em: 'em', s: 's', x: '×', dB: 'dB' };

interface Ctx {
  doc: TrammeDoc;
  compId: string;
  t: number;
  fps: number;
  ev: Evaluator;
  tokens: Record<string, Token>;
}

function evalSafe(ev: Evaluator, address: string, t: number, compId: string): { v?: unknown; error?: string } {
  try { return { v: ev.value(address, t, compId) }; } catch (e) { return { error: (e as Error).message }; }
}

// ── one property row ─────────────────────────────────────────
function PropRow({ ctx, label, def, path, address }: { ctx: Ctx; label: string; def: PropDef; path: string; address: string }) {
  const raw = getAt(ctx.doc, path) as Prop | undefined;
  const kind = raw === undefined ? 'static' : propKind(raw);
  const keys = keysOf(raw);
  const { v, error } = evalSafe(ctx.ev, address, ctx.t, ctx.compId);
  const value = v === undefined ? def.default : v;
  const here = keyIndexAt(keys, ctx.t, ctx.fps);
  const tKey = snap(ctx.t, ctx.fps);
  const animatable = def.animatable !== false;

  const live = (x: unknown) => draft(editAtOps(ctx.doc, path, x, ctx.t, ctx.fps));
  const set = (x: unknown) => commit(`${label}`, editAtOps(ctx.doc, path, x, ctx.t, ctx.fps));
  const setRaw = (p: Prop | undefined, what: string) =>
    commit(what, p === undefined ? (raw === undefined ? [] : [{ op: 'remove', path }]) : setAtOps(ctx.doc, path, p));

  const toggleKey = () => {
    if (!keys) commit(t('inspector.animateName', { name: label }), setAtOps(ctx.doc, path, { $k: [{ t: tKey, v: value }] }));
    else if (here >= 0) commit(t('inspector.deleteTheKeyframeOf', { name: label }), removeKeyOps(ctx.doc, path, here));
    else commit(t('inspector.keyframeOfName', { name: label }), keyAtOps(ctx.doc, path, tKey, value, ctx.fps));
  };

  const menu = (e: MouseEvent) => {
    const items: MenuItem[] = [];
    if (animatable) {
      if (keys) {
        const prev = [...keys].reverse().find((k) => k.t < ctx.t - 0.5 / ctx.fps);
        const next = keys.find((k) => k.t > ctx.t + 0.5 / ctx.fps);
        items.push({ label: t('inspector.previousKeyframe'), icon: 'prev', disabled: !prev, onClick: () => { S.time.value = prev!.t; } });
        items.push({ label: t('inspector.nextKeyframe'), icon: 'next', disabled: !next, onClick: () => { S.time.value = next!.t; } });
        items.push('sep');
      }
      items.push({ section: t('inspector.value') });
      items.push({ label: t('inspector.static'), icon: kind === 'static' ? 'check' : undefined, onClick: () => commit(t('inspector.nameStaticValue', { name: label }), fixedOps(ctx.doc, path, value)) });
      items.push({ label: t('inspector.animatedKeyframeHere'), icon: kind === 'keyframes' ? 'check' : 'diamond', onClick: () => kind !== 'keyframes' && setRaw({ $k: [{ t: tKey, v: value }] }, t('inspector.animateName', { name: label })) });
      items.push({ label: kind === 'keyframes' && (raw as any).$expr ? t('inspector.removeExpression') : t('inspector.expression'), icon: kind === 'expression' ? 'check' : 'fx', onClick: () => {
        if (kind === 'keyframes') { const { $expr, ...rest } = raw as any; setRaw($expr === undefined ? { ...rest, $expr: 'value' } : rest, t('inspector.expressionOnName', { name: label })); }
        else if (kind !== 'expression') setRaw({ $expr: JSON.stringify(value) }, t('inspector.expressionOnName', { name: label }));
      } });
      items.push({ label: t('inspector.linkToAnotherProperty'), icon: kind === 'link' ? 'check' : 'link', onClick: () => kind !== 'link' && setRaw({ $link: '' } as Prop, t('inspector.linkName', { name: label })) });
      if (def.type === 'number' || def.type === 'vec2') {
        items.push('sep', { section: t('inspector.addAModifier') });
        for (const mod of S.registry.value.listModifiers()) {
          items.push({ label: tr(mod.title), icon: 'wand', hint: mod.type, onClick: () => commit(t('inspector.modifierOnName', { modifier: tr(mod.title), name: label }), addModifierOps(ctx.doc, path, { type: mod.type }, value)) });
        }
      }
      items.push('sep');
    }
    items.push({ label: t('inspector.defaultValue'), icon: 'undo', disabled: raw === undefined, onClick: () => setRaw(undefined, t('inspector.nameDefault', { name: label })) });
    openMenu(e, items);
  };

  const hasExpr = kind === 'expression' || (kind === 'keyframes' && (raw as { $expr?: string }).$expr !== undefined);
  const cls = hasExpr ? ' expr' : kind === 'keyframes' ? ' keyed' : kind === 'link' ? ' linked' : '';
  const editable = kind === 'static' || kind === 'keyframes';
  const scrubLabel = def.type === 'number' && editable;

  return (
    <div class={`prop${cls}`}>
      {animatable ? (
        <button class={`kbtn${keys ? ' has' : ''}${here >= 0 ? ' here' : ''}`} title={keys ? (here >= 0 ? t('common.deleteKeyframe') : t('inspector.addAKeyframeHere')) : t('inspector.animate')} onClick={toggleKey}>
          <svg viewBox="0 0 10 10"><path d="M5 .8 9.2 5 5 9.2.8 5z" fill={keys ? 'none' : 'none'} stroke="currentColor" stroke-width="1.3" /></svg>
        </button>
      ) : <span />}
      <span class={`plabel${scrubLabel ? '' : ' static'}`} title={tr(def.description) || label}>{label}</span>
      <div class="pvalue">
        {editable
          ? <Field def={def} value={value} ctx={ctx} label={label} onDraft={live} onCommit={set} />
          : kind === 'expression'
            ? <span class="prop-note">{short(value)}</span>
            : <span class="prop-note">{short(value)}</span>}
      </div>
      <button class={`icon-btn xs more${kind !== 'static' ? ' on' : ''}`} title={t('inspector.options')} onClick={menu}><Icon name="more" /></button>
      {(kind === 'expression' || (kind === 'keyframes' && (raw as any).$expr !== undefined)) && (
        <div class="prop-extra">
          <TextInput code value={(raw as any).$expr} onCommit={(src) => setRaw({ ...(raw as object), $expr: src } as Prop, t('inspector.expressionOfName', { name: label }))} />
          {error ? <div class="prop-note err">{error}</div> : <div class="prop-note">= {short(value)}</div>}
        </div>
      )}
      {kind === 'link' && (
        <div class="prop-extra">
          <LinkField ctx={ctx} def={def} value={(raw as any).$link} onCommit={(a) => setRaw({ $link: a } as Prop, t('inspector.linkOfName', { name: label }))} />
          {error ? <div class="prop-note err">{error}</div> : <div class="prop-note">= {short(value)}</div>}
        </div>
      )}
      {modsOf(raw) && <ModStack ctx={ctx} path={path} raw={raw} label={label} />}
      {error && editable && <div class="prop-extra"><div class="prop-note err">{error}</div></div>}
      {!error && <PropCheck ctx={ctx} path={path} value={value} />}
    </div>
  );
}

/** a reading of a value the schema alone cannot judge (an exposure sheet) */
function PropCheck({ ctx, path, value }: { ctx: Ctx; path: string; value: unknown }) {
  if (!path.endsWith('/props/sheet') || typeof value !== 'string' || !value.trim()) return null;
  const frames = getAt(ctx.doc, path.replace(/sheet$/, 'frames'));
  const issues = sheetIssues(value, Array.isArray(frames) ? frames.length : 0);
  return issues.length ? <div class="prop-extra"><div class="prop-note err">{issues.slice(0, 3).join(' ; ')}</div></div> : null;
}

/** the drawings of a sequence: picked one by one or a whole folder at once */
function AssetsField({ def, value, ctx, onCommit }: { def: PropDef; value: unknown; ctx: Ctx; onCommit: (v: unknown) => void }) {
  const ids = Array.isArray(value) ? (value as string[]) : [];
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const base = new URL(S.docUrl.peek(), location.href);
  const url = (id: string) => { const a = ctx.doc.assets[id]; return a ? new URL(a.src, base).href : ''; };
  const kind = def.assetType ?? 'image';
  const folders = new Map<string, string[]>();
  for (const [id, a] of Object.entries(ctx.doc.assets)) if (a.type === kind) { const f = folderOf(a.src); folders.set(f, [...(folders.get(f) ?? []), id]); }
  const toggle = (id: string) => onCommit(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  return (
    <div class="assets-field">
      <button class="btn sm" onClick={(e) => setAnchor(anchor ? null : (e.currentTarget as HTMLElement))}>
        <Icon name="image" />{ids.length ? (ids.length > 1 ? t('inspector.nDrawings', { n: ids.length }) : t('inspector.n1Drawing')) : t('inspector.choose')}
      </button>
      {ids.length > 0 && (
        <div class="assets-strip">
          {ids.slice(0, 10).map((id, i) => <img key={`${id}${i}`} src={url(id)} alt="" title={`${i + 1} · ${ctx.doc.assets[id]?.name ?? id}`} />)}
          {ids.length > 10 && <span class="faint mono">+{ids.length - 10}</span>}
        </div>
      )}
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} class="assets-pick" align="right">
          <div style={{ fontWeight: 600 }}>{t('inspector.drawings')}</div>
          {!folders.size && <div class="faint">{t('inspector.noImagesInThe')}</div>}
          {[...folders].map(([folder, list]) => (
            <div key={folder} class="assets-folder">
              <div class="assets-folder-head">
                <Icon name="folder" /><span>{folder.replace(/^assets\/?/, '') || 'assets'}</span><span class="faint">{list.length}</span>
                <span class="grow" />
                <button class="btn sm ghost" onClick={() => onCommit(imagesIn(ctx.doc, folder))}>{t('inspector.wholeFolder')}</button>
              </div>
              <div class="assets-grid">
                {imagesIn(ctx.doc, folder).map((id) => {
                  const n = ids.indexOf(id);
                  return (
                    <button key={id} class={n >= 0 ? 'on' : ''} title={ctx.doc.assets[id].name ?? id} onClick={() => toggle(id)}>
                      <img src={url(id)} alt="" loading="lazy" />{n >= 0 && <span class="num">{n + 1}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {ids.length > 0 && <button class="btn sm ghost" onClick={() => onCommit([])}><Icon name="x" />{t('inspector.removeAllDrawings')}</button>}
        </Popover>
      )}
    </div>
  );
}

const MOD_LABEL: Record<string, string> = { cycle: m('inspector.cycle'), pingpong: m('inspector.pingPong'), offset: m('inspector.accumulate'), first: m('inspector.first'), last: m('inspector.last') };

/** the modifier stack of a property: one block per modifier with its parameters */
function ModStack({ ctx, path, raw, label }: { ctx: Ctx; path: string; raw: Prop | undefined; label: string }) {
  const reg = S.registry.value;
  const mods = modsOf(raw)!;
  const setParam = (i: number, k: string, v: unknown, what: string, live = false) => {
    const ops = [{ op: 'add' as const, path: `${path}/$mod/${i}/${k}`, value: v }];
    if (live) draft(ops); else commit(what, ops);
  };
  return (
    <div class="prop-extra">
      {mods.map((m, i) => {
        const mt = reg.hasModifier(m.type) ? reg.modifier(m.type) : null;
        const params = mt ? modifierParams(mt, m) : {};
        const title = mt ? tr(mt.title) : m.type;
        return (
          <div key={i} class="mod">
            <div class="mod-head">
              <Icon name="wand" size={12} /><span>{title}</span><span class="grow" />
              <button class="icon-btn xs" title={t('common.remove')} onClick={() => commit(t('inspector.removeModifierName', { modifier: title, name: label }), removeModifierOps(ctx.doc, path, i))}><Icon name="x" /></button>
            </div>
            {mt && Object.entries(mt.params).map(([k, d]) => (
              <div key={k} class="mod-param">
                <span class="faint">{tr(d.label) || k}</span>
                {d.type === 'enum'
                  ? <Seg value={String(params[k])} options={d.options!.map((o) => [o, t(MOD_LABEL[o] ?? ENUM_LABEL[o] ?? o)])} onChange={(v) => setParam(i, k, v, `${title} : ${tr(d.label) || k}`)} />
                  : d.type === 'layer'
                    ? <LayerParam ctx={ctx} path={`${path}/$mod/${i}/${k}`} value={params[k] == null ? '' : String(params[k])} onCommit={(v) => setParam(i, k, v, `${title} : ${tr(d.label) || k}`)} />
                    : <NumberField value={Number(params[k])} step={d.step ?? 0.1} min={d.min} max={d.max}
                      onDraft={(v) => setParam(i, k, v, '', true)} onCommit={(v) => setParam(i, k, v, `${title} : ${tr(d.label) || k}`)} onCancel={cancelDraft} />}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

const short = (v: unknown) => {
  if (typeof v === 'number') return String(+v.toFixed(3));
  if (Array.isArray(v) && v.every((x) => typeof x === 'number')) return `[${v.map((x) => +x.toFixed(2)).join(', ')}]`;
  const s = JSON.stringify(v);
  return s && s.length > 60 ? s.slice(0, 58) + '…' : s;
};

/** a modifier parameter that names a layer of the composition (a pointer, a target) */
function LayerParam({ ctx, path, value, onCommit }: { ctx: Ctx; path: string; value: string; onCommit: (v: string | null) => void }) {
  const id = `mod-layers-${path.replace(/\W/g, '-')}`;
  return (
    <div class="field">
      <input list={id} class="mono" spellcheck={false} value={value} placeholder={t('inspector.layerId')}
        onChange={(e) => onCommit((e.target as HTMLInputElement).value.trim() || null)} />
      <datalist id={id}>
        {Object.entries(ctx.doc.compositions[ctx.compId].layers).map(([lid, l]) => <option key={lid} value={lid} label={l.name || lid} />)}
      </datalist>
    </div>
  );
}

/** addresses a link may point to: tokens of the type, and properties of the same type */
function LinkField({ ctx, def, value, onCommit }: { ctx: Ctx; def: PropDef; value: string; onCommit: (a: string) => void }) {
  const options = useMemo(() => {
    const out: string[] = [];
    const tokenType = def.type === 'paint' ? 'color' : def.type;
    for (const [n, t] of Object.entries(ctx.tokens)) if (t.type === tokenType) out.push(`@${n}`);
    const c = ctx.doc.compositions[ctx.compId];
    for (const [id, l] of Object.entries(c.layers)) {
      for (const [n, d] of Object.entries(TRANSFORM_SCHEMA)) if (d.type === def.type) out.push(`${id}.transform.${n}`);
      if (S.registry.value.hasNode(l.type)) for (const [n, d] of Object.entries(S.registry.value.node(l.type).props)) if (d.type === def.type) out.push(`${id}.${n}`);
    }
    return out;
  }, [ctx.doc, ctx.compId, def.type]);
  const id = `links-${def.type}`;
  return (
    <div class="field">
      <input list={id} value={value} class="mono" spellcheck={false} placeholder={t('inspector.layerPropertyOrToken')}
        onChange={(e) => onCommit((e.target as HTMLInputElement).value.trim())} />
      <datalist id={id}>{options.map((o) => <option key={o} value={o} />)}</datalist>
    </div>
  );
}

// ── fields by type ───────────────────────────────────────────
function Field({ def, value, ctx, label, onDraft, onCommit }: { def: PropDef; value: unknown; ctx: Ctx; label: string; onDraft: (v: unknown) => void; onCommit: (v: unknown) => void }) {
  const unit = def.unit ? UNIT[def.unit] : undefined;
  switch (def.type) {
    case 'number':
      return <NumberField value={Number(value)} step={def.step ?? (def.unit === 'px' ? 1 : 0.01)} min={def.min} max={def.max} unit={unit} onDraft={onDraft} onCommit={onCommit} onCancel={cancelDraft} />;
    case 'vec2': {
      const [x, y] = (value as number[]) ?? [0, 0];
      const step = def.step ?? (def.unit === 'px' ? 1 : 0.01);
      return <>
        <NumberField axis="X" value={x} step={step} onDraft={(v) => onDraft([v, y])} onCommit={(v) => onCommit([v, y])} onCancel={cancelDraft} />
        <NumberField axis="Y" value={y} step={step} onDraft={(v) => onDraft([x, v])} onCommit={(v) => onCommit([x, v])} onCancel={cancelDraft} />
      </>;
    }
    case 'bool':
      return <div style={{ display: 'flex' }}><Toggle on={!!value} onChange={onCommit} /></div>;
    case 'enum':
      return (def.options!.length <= 3
        ? <Seg value={String(value)} options={def.options!.map((o) => [o, t(ENUM_LABEL[o] ?? o)])} onChange={onCommit} />
        : <Select value={String(value)} options={def.options!.map((o) => [o, t(ENUM_LABEL[o] ?? o)])} onChange={onCommit} />);
    case 'string':
      return <TextInput value={String(value ?? '')} onCommit={onCommit} />;
    case 'text':
      return def.format === 'code'
        ? <TextInput code value={String(value ?? '')} onCommit={onCommit} />
        : <TextInput area value={String(value ?? '')} onCommit={onCommit} />;
    case 'comp': {
      const opts = Object.entries(ctx.doc.compositions).filter(([id]) => id !== ctx.compId).map(([id, c]) => [id, c.name] as [string, string]);
      return <Select value={String(value ?? '')} options={[['', t('inspector.none')], ...opts]} onChange={(v) => onCommit(v || null)} />;
    }
    case 'layer': {
      // a layer of the same composition (mattes, displacement maps)
      const layers = ctx.doc.compositions[ctx.compId]?.layers ?? {};
      const opts = Object.entries(layers).map(([id, l]) => [id, l.name ?? id] as [string, string]);
      return <Select value={String(value ?? '')} options={[['', t('inspector.none')], ...opts]} onChange={(v) => onCommit(v || null)} />;
    }
    case 'color':
      return value === null ? <NullPaint onSet={() => onCommit('#FFFFFF')} /> : <ColorField value={rawColor(value)} tokens={ctx.tokens} onDraft={onDraft} onCommit={onCommit} />;
    case 'paint':
      return <PaintField value={value as Paint} ctx={ctx} onCommit={onCommit} onDraft={onDraft} />;
    case 'assets':
      return <AssetsField def={def} value={value} ctx={ctx} onCommit={onCommit} />;
    case 'asset': {
      const opts = Object.entries(ctx.doc.assets).filter(([, a]) => !def.assetType || a.type === def.assetType).map(([id, a]) => [id, a.name || id] as [string, string]);
      return <Select value={String(value ?? '')} options={[...(def.nullable ? [['', t('inspector.none')] as [string, string]] : []), ...opts]} onChange={(v) => onCommit(v || null)} />;
    }
    case 'ease': {
      const eases = Object.entries(ctx.tokens).filter(([, t]) => t.type === 'ease').map(([n]) => [`@${n}`, n] as [string, string]);
      const v = typeof value === 'string' ? value : JSON.stringify(value);
      return <Select value={v} options={[['linear', t('common.linear')], ['hold', t('common.hold')], ...eases]} onChange={onCommit} />;
    }
    default:
      return <JsonField value={value} label={label} onCommit={onCommit} />;
  }
}

const ENUM_LABEL: Record<string, string> = {
  left: m('inspector.left'), center: m('inspector.center'), right: m('inspector.right'), cover: m('inspector.cover'), contain: m('inspector.contain'), fill: m('inspector.stretch'), none: m('inspector.none'),
  butt: m('inspector.butt'), round: m('inspector.round'), square: m('common.square'), miter: m('inspector.miter'), bevel: m('inspector.bevel'), alphabetic: m('inspector.alphabetic'), top: m('inspector.top'), middle: m('inspector.middle'), bottom: m('inspector.bottom'),
  normal: m('inspector.normal'), multiply: m('inspector.multiply'), screen: m('inspector.screen'), overlay: m('inspector.overlay'), darken: m('inspector.darken'), lighten: m('inspector.lighten'), add: m('inspector.additive'),
  both: m('inspector.both'), lift: m('inspector.lift'), push: m('inspector.push'),
};

const rawColor = (v: unknown) => (typeof v === 'string' ? v : '#000000');
const NullPaint = ({ onSet }: { onSet: () => void }) => <button class="btn sm ghost" onClick={onSet}><Icon name="plus" />{t('inspector.add')}</button>;

function JsonField({ value, onCommit }: { value: unknown; label: string; onCommit: (v: unknown) => void }) {
  const [bad, setBad] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <TextInput code value={JSON.stringify(value ?? null, null, 1).replace(/\n\s*/g, ' ')} onCommit={(s) => {
        try { onCommit(JSON.parse(s)); setBad(false); } catch { setBad(true); }
      }} />
      {bad && <div class="prop-note err">{t('inspector.invalidJson')}</div>}
    </div>
  );
}

function PaintField({ value, ctx, onCommit, onDraft }: { value: Paint; ctx: Ctx; onCommit: (v: unknown) => void; onDraft: (v: unknown) => void }) {
  const kind = value === null || value === undefined ? 'none' : typeof value === 'string' ? 'color' : value.type;
  const switchTo = (k: string) => {
    if (k === kind) return;
    const base = typeof value === 'string' ? value : value && typeof value === 'object' ? value.stops[0]?.[1] ?? '#FFFFFF' : '#FFFFFF';
    if (k === 'none') onCommit(null);
    else if (k === 'color') onCommit(base);
    else if (k === 'linear') onCommit({ type: 'linear', from: [-100, 0], to: [100, 0], stops: [[0, base], [1, '#000000']] });
    else onCommit({ type: 'radial', center: [0, 0], radius: 100, stops: [[0, base], [1, '#000000']] });
  };
  const menu = (e: MouseEvent) => openMenu(e, [
    { label: t('inspector.none'), onClick: () => switchTo('none') }, { label: t('inspector.color'), onClick: () => switchTo('color') },
    { label: t('inspector.linearGradient'), onClick: () => switchTo('linear') }, { label: t('inspector.radialGradient'), onClick: () => switchTo('radial') },
  ]);
  if (kind === 'none') return <button class="btn sm ghost" style={{ justifyContent: 'flex-start' }} onClick={menu}>{t('inspector.none')}<Icon name="chevronDown" /></button>;
  if (kind === 'color') return <><ColorField value={value as string} tokens={ctx.tokens} onDraft={onDraft} onCommit={onCommit} /><button class="icon-btn sm" style={{ flex: 'none' }} title={t('inspector.fillType')} onClick={menu}><Icon name="chevronDown" /></button></>;
  const g = value as Exclude<Paint, string | null>;
  const css = `linear-gradient(90deg, ${g.stops.map(([o, c]) => `${c.startsWith('@') ? (ctx.tokens[c.slice(1)]?.value as string) : c} ${o * 100}%`).join(', ')})`;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <div style={{ flex: 1, height: 18, borderRadius: 4, background: css, boxShadow: 'inset 0 0 0 1px var(--edge)' }} />
        <button class="icon-btn sm" title={t('inspector.fillType')} onClick={menu}><Icon name="chevronDown" /></button>
      </div>
      {g.stops.map(([o, c], i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <div style={{ width: 64, flex: 'none' }}><NumberField value={o} step={0.01} min={0} max={1} onCommit={(v) => onCommit({ ...g, stops: g.stops.map((s, j) => (j === i ? [v, s[1]] : s)) })} /></div>
          <ColorField value={c} tokens={ctx.tokens} onCommit={(v) => onCommit({ ...g, stops: g.stops.map((s, j) => (j === i ? [s[0], v] : s)) })} />
        </div>
      ))}
      {g.type === 'linear'
        ? <>
          <div style={{ display: 'flex', gap: 4 }}><span class="faint" style={{ width: 28 }}>{t('inspector.from')}</span><NumberField axis="X" value={g.from[0]} onCommit={(v) => onCommit({ ...g, from: [v, g.from[1]] })} /><NumberField axis="Y" value={g.from[1]} onCommit={(v) => onCommit({ ...g, from: [g.from[0], v] })} /></div>
          <div style={{ display: 'flex', gap: 4 }}><span class="faint" style={{ width: 28 }}>{t('inspector.to')}</span><NumberField axis="X" value={g.to[0]} onCommit={(v) => onCommit({ ...g, to: [v, g.to[1]] })} /><NumberField axis="Y" value={g.to[1]} onCommit={(v) => onCommit({ ...g, to: [g.to[0], v] })} /></div>
        </>
        : <div style={{ display: 'flex', gap: 4 }}><NumberField axis="X" value={g.center[0]} onCommit={(v) => onCommit({ ...g, center: [v, g.center[1]] })} /><NumberField axis="Y" value={g.center[1]} onCommit={(v) => onCommit({ ...g, center: [g.center[0], v] })} /><NumberField axis="R" value={g.radius} min={0} onCommit={(v) => onCommit({ ...g, radius: v })} /></div>}
    </div>
  );
}

// ── sections ─────────────────────────────────────────────────
function Section({ title, children, right, id }: { title: string; children: preact.ComponentChildren; right?: preact.ComponentChildren; id: string }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('tramme.sec.' + id) !== '0'; } catch { return true; } });
  const toggle = () => { setOpen(!open); try { localStorage.setItem('tramme.sec.' + id, open ? '0' : '1'); } catch { /* private */ } };
  return (
    <div class="section">
      <div class={`section-head${open ? ' open' : ''}`} onClick={toggle}>
        <Icon name="chevron" class="chev" /><span>{title}</span><span class="grow" />
        <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 2 }}>{right}</span>
      </div>
      {open && <div class="section-body">{children}</div>}
    </div>
  );
}

function SchemaRows({ ctx, schema, basePath, baseAddress, only }: { ctx: Ctx; schema: PropSchema; basePath: string; baseAddress: string; only?: (n: string, d: PropDef) => boolean }) {
  return <>{Object.entries(schema).filter(([n, d]) => !only || only(n, d)).map(([name, def]) => (
    <PropRow key={name} ctx={ctx} label={tr(def.label) || name} def={def} path={`${basePath}/${name}`} address={`${baseAddress}.${name}`} />
  ))}</>;
}

/** node props grouped by their schema `group` */
function grouped(schema: PropSchema, fallback: string): [string, PropSchema][] {
  const out = new Map<string, PropSchema>();
  for (const [n, d] of Object.entries(schema)) {
    const g = d.group || fallback;
    if (!out.has(g)) out.set(g, {});
    out.get(g)![n] = d;
  }
  return [...out];
}

// ── layer inspector ──────────────────────────────────────────
function LayerInspector({ ctx, id }: { ctx: Ctx; id: string }) {
  const c = ctx.doc.compositions[ctx.compId];
  const layer = c.layers[id];
  if (!layer) return null;
  const reg = S.registry.value;
  const node = reg.hasNode(layer.type) ? reg.node(layer.type) : null;
  const lp = pointer('compositions', ctx.compId, 'layers', id);
  const setField = (k: string, v: unknown, label: string) => commit(label, v === undefined ? (k in layer ? [{ op: 'remove', path: `${lp}/${k}` }] : []) : [{ op: 'add', path: `${lp}/${k}`, value: v }]);
  const clipCandidates = Object.entries(c.layers).filter(([lid, l]) => lid !== id && reg.hasNode(l.type) && reg.node(l.type).path);
  return (
    <>
      <div class="insp-head">
        <div class="kind" style={{ color: kindColor(layer.type) }}><Icon name={kindIcon(layer.type)} /></div>
        <div class="names">
          <input class="lname" value={layer.name ?? id} spellcheck={false}
            onChange={(e) => setField('name', (e.target as HTMLInputElement).value || undefined, t('common.rename'))}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <div class="type">{node ? tr(node.title) : layer.type} · <span class="mono">{id}</span></div>
        </div>
      </div>
      <Section id="layer" title={t('inspector.layer')}>
        <div class="prop"><span /><span class="plabel static">{t('common.in')}</span><div class="pvalue">
          <NumberField value={layer.in ?? 0} step={1 / ctx.fps} min={0} unit="s" onCommit={(v) => setField('in', +snap(v, ctx.fps).toFixed(4), t('common.inPoint'))} />
        </div><span /></div>
        <div class="prop"><span /><span class="plabel static">{t('common.out')}</span><div class="pvalue">
          <NumberField value={layer.out ?? c.duration} step={1 / ctx.fps} min={0} unit="s" onCommit={(v) => setField('out', +snap(v, ctx.fps).toFixed(4), t('common.outPoint'))} />
        </div><span /></div>
        <div class="prop"><span /><span class="plabel static">{t('inspector.visible')}</span><div class="pvalue"><div style={{ display: 'flex' }}><Toggle on={layer.visible !== false} onChange={(v) => setField('visible', v ? undefined : false, v ? t('common.show') : t('common.hide'))} /></div></div><span /></div>
        <div class="prop"><span /><span class="plabel static">{t('inspector.blend')}</span><div class="pvalue">
          <Select value={layer.blend ?? 'normal'} options={['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'add'].map((b) => [b, t(ENUM_LABEL[b])])} onChange={(v) => setField('blend', v === 'normal' ? undefined : v, t('inspector.blendMode'))} />
        </div><span /></div>
        <div class="prop"><span /><span class="plabel static">{t('inspector.clip')}</span><div class="pvalue">
          <Select value={layer.clip ?? ''} options={[['', t('inspector.none')], ...clipCandidates.map(([lid, l]) => [lid, l.name || lid] as [string, string])]} onChange={(v) => setField('clip', v || undefined, t('inspector.clip'))} />
        </div><span /></div>
      </Section>
      {node?.render.canvas2d || node?.container || !node ? (
        <Section id="transform" title={t('inspector.transform')}>
          <SchemaRows ctx={ctx} schema={TRANSFORM_SCHEMA} basePath={`${lp}/transform`} baseAddress={`${id}.transform`} />
        </Section>
      ) : null}
      {node && grouped(node.props, node.title).map(([g, schema]) => (
        <Section key={g} id={`${layer.type}.${g}`} title={tr(g)}>
          <SchemaRows ctx={ctx} schema={schema} basePath={`${lp}/props`} baseAddress={id} />
        </Section>
      ))}
      {!node && <div class="empty"><Icon name="alert" />{t('inspector.unknownTypeTypeAdd', { type: layer.type })}</div>}
      {node && layer.type !== 'audio' && <EffectsSection ctx={ctx} base={lp} address={`${id}.effects`} effects={layer.effects || []} stage="layer" title={t('inspector.effects')} />}
    </>
  );
}

/** a list of effects (layer or composition) with their props, add / toggle / remove / reorder */
function EffectsSection({ ctx, base, address, effects, stage, title }: { ctx: Ctx; base: string; address: string; effects: import('@tramme/core').Effect[]; stage: 'layer' | 'finish'; title: string }) {
  const reg = S.registry.value;
  const add = (e: MouseEvent) => openMenu(e, reg.listEffects().filter((x) => x.stage === stage).map((fx) => ({
    label: tr(fx.title), icon: 'effects' as const,
    onClick: () => {
      const id = freshId(Object.fromEntries(effects.map((x) => [x.id, 1])), fx.type.split('.').pop()!);
      const value = { id, type: fx.type, props: {} };
      commit(t('inspector.addName', { name: tr(fx.title) }), effects.length ? [{ op: 'add', path: `${base}/effects/-`, value }] : [{ op: 'add', path: `${base}/effects`, value: [value] }]);
    },
  })));
  return (
    <Section id={`fx.${stage}`} title={title} right={<button class="icon-btn sm" title={t('inspector.addAnEffect')} onClick={add}><Icon name="plus" /></button>}>
      {effects.length === 0 && <div class="faint" style={{ padding: '2px 0 4px' }}>{t('inspector.noEffects')}</div>}
      {effects.map((fx, i) => {
        const def = reg.hasEffect(fx.type) ? reg.effect(fx.type) : null;
        return (
          <div key={fx.id} class="fx">
            <div class="fx-head">
              <Toggle on={fx.enabled !== false} onChange={(v) => commit(v ? t('inspector.enableEffect') : t('inspector.disableEffect'), setAtOps(ctx.doc, `${base}/effects/${i}/enabled`, v))} />
              <span class="fx-title">{def ? tr(def.title) : fx.type}</span>
              <button class="icon-btn xs" title={t('inspector.moveUp')} disabled={i === 0} onClick={() => commit(t('inspector.effectOrder'), [{ op: 'move', from: `${base}/effects/${i}`, path: `${base}/effects/${i - 1}` }])}><Icon name="chevronDown" class="flip" /></button>
              <button class="icon-btn xs" title={t('common.remove')} onClick={() => commit(t('common.removeName', { name: def ? tr(def.title) : fx.type }), [{ op: 'remove', path: `${base}/effects/${i}` }])}><Icon name="x" /></button>
            </div>
            {def && fx.enabled !== false && <SchemaRows ctx={ctx} schema={def.props} basePath={`${base}/effects/${i}/props`} baseAddress={`${address}.${fx.id}`} />}
          </div>
        );
      })}
    </Section>
  );
}

// ── composition inspector ────────────────────────────────────
function CompInspector({ ctx }: { ctx: Ctx }) {
  const c = ctx.doc.compositions[ctx.compId];
  const cp = pointer('compositions', ctx.compId);
  const reg = S.registry.value;
  const setComp = (k: string, v: unknown, label: string) => commit(label, [{ op: 'replace', path: `${cp}/${k}`, value: v }]);
  return (
    <>
      <div class="insp-head">
        <div class="kind"><Icon name="film" /></div>
        <div class="names">
          <input class="lname" value={c.name} spellcheck={false} onChange={(e) => setComp('name', (e.target as HTMLInputElement).value, t('inspector.renameComposition'))} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <div class="type">{t('common.composition')} · {c.width}×{c.height} · {t('common.nFps', { n: c.fps })} · {fmtSeconds(c.duration)}</div>
        </div>
      </div>
      <Section id="comp" title={t('common.composition')}>
        <div class="prop"><span /><span class="plabel static">{t('inspector.size')}</span><div class="pvalue">
          <NumberField axis={t('inspector.w')} value={c.width} step={8} min={8} onCommit={(v) => setComp('width', Math.max(8, Math.round(v / 8) * 8), t('inspector.width'))} />
          <NumberField axis={t('inspector.h')} value={c.height} step={2} min={2} onCommit={(v) => setComp('height', Math.max(2, Math.round(v / 2) * 2), t('inspector.height'))} />
        </div><span /></div>
        <div class="prop"><span /><span class="plabel static">{t('common.frameRate')}</span><div class="pvalue"><Select value={String(c.fps)} options={['24', '25', '30', '50', '60'].map((f) => [f, t('common.nFps', { n: f })])} onChange={(v) => setComp('fps', Number(v), t('common.frameRate'))} /></div><span /></div>
        <div class="prop"><span /><span class="plabel static">{t('common.duration')}</span><div class="pvalue"><NumberField value={c.duration} step={1 / c.fps} min={1 / c.fps} unit="s" onCommit={(v) => setComp('duration', +v.toFixed(4), t('common.duration'))} /></div><span /></div>
        <PropRow ctx={ctx} label={t('inspector.background')} def={{ type: 'color', default: null, nullable: true }} path={`${cp}/background`} address="$comp.background" />
      </Section>
      <Section id="blur" title={t('common.motionBlur')}>
        {c.motionBlur
          ? <SchemaRows ctx={ctx} schema={MOTION_BLUR_SCHEMA} basePath={`${cp}/motionBlur`} baseAddress="$comp.motionBlur" />
          : <button class="btn sm" onClick={() => commit(t('common.motionBlur'), [{ op: 'add', path: `${cp}/motionBlur`, value: { samples: 8, shutter: 0.5 } }])}><Icon name="plus" />{t('common.enable')}</button>}
      </Section>
      <Section id="camera" title={t('inspector.camera')}>
        {c.camera
          ? <SchemaRows ctx={ctx} schema={CAMERA_SCHEMA} basePath={`${cp}/camera`} baseAddress="$comp.camera" />
          : <button class="btn sm" onClick={() => commit(t('inspector.camera'), [{ op: 'add', path: `${cp}/camera`, value: {} }])}><Icon name="plus" />{t('common.enable')}</button>}
      </Section>
      <Section id="sound" title={t('settings.sound')}>
        <SchemaRows ctx={ctx} schema={SOUND_MIX_SCHEMA} basePath={`${cp}/sound`} baseAddress="$comp.sound" />
      </Section>
      <EffectsSection ctx={ctx} base={cp} address="$comp.effects" effects={c.effects || []} stage="finish" title={t('inspector.finishingEffects')} />
    </>
  );
}

export function Inspector() {
  const doc = viewDoc.value, c = comp.value, now = uiTime.value, reg = S.registry.value;
  const compId = S.compId.value;
  const ev = useMemo(() => new Evaluator(doc, reg, { data: assetData }), [doc, reg]);
  const ctx: Ctx = { doc, compId, t: now, fps: c.fps, ev, tokens: doc.tokens };
  const sel = S.selection.value.filter((id) => c.layers[id]);
  if (sel.length > 1) {
    return (
      <div class="inspector">
        <div class="empty"><Icon name="layers" />{t('inspector.nLayersSelected', { n: sel.length })}<button class="btn sm" onClick={() => select([sel[0]])}>{t('inspector.inspectTheFirst')}</button></div>
      </div>
    );
  }
  return <div class="inspector">{sel.length ? <LayerInspector ctx={ctx} id={sel[0]} /> : <CompInspector ctx={ctx} />}</div>;
}

