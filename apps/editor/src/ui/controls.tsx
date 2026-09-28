// Small controls shared by the panels: menus, popovers, scrubbable numbers,
// colour pickers with tokens, segmented controls, resizers.

import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { isColor, parseColor, toCss, type Token } from '@tramme/core';
import { Icon, type IconName } from './icons.tsx';
import { t } from '../i18n/index.ts';

// ── context menu ─────────────────────────────────────────────
export type MenuItem =
  | { label: string; icon?: IconName; hint?: string; disabled?: boolean; onClick: () => void }
  | { section: string }
  | 'sep';

const menuState = signal<{ x: number; y: number; items: MenuItem[] } | null>(null);

export function openMenu(e: { clientX: number; clientY: number } | DOMRect, items: MenuItem[]) {
  const x = 'clientX' in e ? e.clientX : e.left;
  const y = 'clientY' in e ? e.clientY : e.bottom + 4;
  menuState.value = { x, y, items };
}

export function MenuHost() {
  const m = menuState.value;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    if (!m || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(m.x, innerWidth - r.width - 8), y: Math.min(m.y, innerHeight - r.height - 8) });
  }, [m]);
  useEffect(() => {
    if (!m) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) menuState.value = null; };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') menuState.value = null; };
    setTimeout(() => { addEventListener('pointerdown', close); addEventListener('keydown', key); });
    return () => { removeEventListener('pointerdown', close); removeEventListener('keydown', key); };
  }, [m]);
  if (!m) return null;
  // when some items have an icon, the others keep its place: labels stay aligned
  const iconed = m.items.some((it) => it !== 'sep' && !('section' in it) && it.icon);
  return (
    <div class="menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      {m.items.map((it, i) => it === 'sep' ? <hr key={i} /> : 'section' in it ? <div class="menu-label" key={i}>{it.section}</div> : (
        <button key={i} disabled={it.disabled} role="menuitem" onClick={() => { menuState.value = null; it.onClick(); }}>
          {it.icon ? <Icon name={it.icon} /> : iconed && <span class="menu-icon-space" />}{it.label}{it.hint && <span class="hint">{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}

// ── popover ──────────────────────────────────────────────────
export function Popover({ anchor, onClose, children, class: cls = '', align = 'left' }: { anchor: HTMLElement; onClose: () => void; children: ComponentChildren; class?: string; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect(), r = ref.current!.getBoundingClientRect();
    let x = align === 'right' ? a.right - r.width : a.left;
    let y = a.bottom + 6;
    if (y + r.height > innerHeight - 8) y = Math.max(8, a.top - r.height - 6);
    x = Math.max(8, Math.min(x, innerWidth - r.width - 8));
    setPos({ x, y });
  }, [anchor]);
  useEffect(() => {
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('pointerdown', close); addEventListener('keydown', key);
    return () => { removeEventListener('pointerdown', close); removeEventListener('keydown', key); };
  }, [anchor, onClose]);
  // at the page's level: a panel with CSS containment would otherwise place it from its own corner
  return createPortal(<div ref={ref} class={`popover ${cls}`} style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999 }}>{children}</div>, document.body);
}

// ── numbers ──────────────────────────────────────────────────
const fmtNum = (v: number, step: number) => {
  const d = step >= 1 ? 1 : step >= 0.1 ? 2 : 3;
  return String(+v.toFixed(d));
};
/** '12', '1,5', '100+20', '50*2': simple arithmetic only */
export function parseNumber(s: string): number | null {
  const t = s.replace(/,/g, '.').replace(/\s+/g, '');
  if (!/^[-+*/().\d]+$/.test(t)) return null;
  try { const v = Function(`"use strict";return (${t});`)(); return Number.isFinite(v) ? v : null; } catch { return null; }
}

/** start a horizontal scrub: calls onMove with the accumulated value, onEnd once */
export function scrub(e: PointerEvent, start: number, step: number, onMove: (v: number) => void, onEnd: (v: number | null) => void, clamp?: (v: number) => number) {
  const x0 = e.clientX;
  let moved = false, v = start;
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture?.(e.pointerId);
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - x0;
    if (!moved && Math.abs(dx) < 3) return;
    if (!moved) document.body.style.cursor = 'ew-resize';
    moved = true;
    // Shift: 10x faster, Alt: 10x finer; values snap to the step in use
    const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1;
    const snapTo = step * (ev.altKey ? 0.1 : 1);
    v = Math.round((start + dx * step * k) / snapTo) * snapTo;
    if (clamp) v = clamp(v);
    onMove(v);
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    document.body.style.cursor = '';
    onEnd(moved ? v : null);
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}

export interface NumberProps {
  value: number;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  axis?: string;
  /** live value during a scrub */
  onDraft?: (v: number) => void;
  onCommit: (v: number) => void;
  onCancel?: () => void;
  disabled?: boolean;
}

export function NumberField({ value, step = 1, min, max, unit, axis, onDraft, onCommit, onCancel, disabled }: NumberProps) {
  const [text, setText] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const startScrub = (e: PointerEvent) => {
    if (disabled || e.button !== 0 || document.activeElement === input.current) return;
    e.preventDefault();
    scrub(e, value, step, (v) => onDraft?.(v), (v) => {
      if (v === null) { input.current?.focus(); input.current?.select(); onCancel?.(); }
      else onCommit(v);
    }, clamp);
  };
  const commitText = () => {
    if (text === null) return;
    const v = parseNumber(text);
    setText(null);
    if (v !== null && v !== value) onCommit(clamp(v));
  };
  return (
    <div class="field num">
      {axis && <span class="axis" onPointerDown={startScrub}>{axis}</span>}
      <input
        ref={input} disabled={disabled}
        value={text ?? fmtNum(value, step)}
        onPointerDown={startScrub}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commitText(); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Escape') { setText(null); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const k = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * step * (e.key === 'ArrowUp' ? 1 : -1);
            setText(null); onCommit(clamp(value + k));
          }
        }}
      />
      {unit && <span class="unit">{unit}</span>}
    </div>
  );
}

export function TextInput({ value, onCommit, placeholder, mono, area, code }: { value: string; onCommit: (v: string) => void; placeholder?: string; mono?: boolean; area?: boolean; code?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const done = () => { if (text !== null && text !== value) onCommit(text); setText(null); };
  if (area || code) {
    return (
      <div class={`field area${code ? ' code' : ''}`}>
        <textarea value={text ?? value} placeholder={placeholder} spellcheck={false} rows={code ? Math.min(12, Math.max(3, (text ?? value).split('\n').length + 1)) : 2}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} onBlur={done}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' && (e.ctrlKey || e.metaKey)) || (e.key === 'Enter' && !code && !e.shiftKey)) { e.preventDefault(); done(); (e.target as HTMLElement).blur(); }
            if (e.key === 'Escape') { setText(null); (e.target as HTMLElement).blur(); }
            if (e.key === 'Tab' && code) { e.preventDefault(); const el = e.target as HTMLTextAreaElement; const s = el.selectionStart; el.setRangeText('  ', s, el.selectionEnd, 'end'); setText(el.value); }
          }} />
      </div>
    );
  }
  return (
    <div class="field">
      <input value={text ?? value} placeholder={placeholder} spellcheck={false} class={mono ? 'mono' : ''}
        onInput={(e) => setText((e.target as HTMLInputElement).value)} onBlur={done}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setText(null); (e.target as HTMLInputElement).blur(); } }} />
    </div>
  );
}

export function Select({ value, options, onChange }: { value: string; options: (string | [string, string])[]; onChange: (v: string) => void }) {
  return (
    <div class="field">
      <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        {options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{l}</option>; })}
      </select>
    </div>
  );
}

export function Seg({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div class="seg">
      {options.map(([v, l]) => <button key={v} class={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export const Toggle = ({ on, onChange, title }: { on: boolean; onChange: (v: boolean) => void; title?: string }) =>
  <button class={`toggle${on ? ' on' : ''}`} role="switch" aria-checked={on} title={title} onClick={() => onChange(!on)} />;

// ── colours ──────────────────────────────────────────────────
export function resolveColor(v: string, tokens: Record<string, Token>): string {
  if (v?.startsWith('@')) { const t = tokens[v.slice(1)]; return typeof t?.value === 'string' ? resolveColor(t.value, tokens) : '#000000'; }
  return isColor(v) ? v : '#000000';
}
const toHex6 = (css: string) => { try { const [r, g, b] = parseColor(css); return toCss([r, g, b, 1]); } catch { return '#000000'; } };

export function Swatch({ color, onClick, title }: { color: string; onClick?: (e: MouseEvent) => void; title?: string }) {
  return <button class="swatch" title={title} onClick={(e) => onClick?.(e as unknown as MouseEvent)}><i style={{ background: color }} /></button>;
}

/** a colour value: hex, rgba or '@token' */
export function ColorField({ value, tokens, onCommit, onDraft }: { value: string; tokens: Record<string, Token>; onCommit: (v: string) => void; onDraft?: (v: string) => void }) {
  const [open, setOpen] = useState<HTMLElement | null>(null);
  const resolved = resolveColor(value, tokens);
  const isToken = value?.startsWith('@');
  return (
    <>
      <Swatch color={resolved} onClick={(e) => setOpen(open ? null : (e.currentTarget as HTMLElement))} title={t('common.pickAColor')} />
      <TextInput value={value ?? ''} mono onCommit={(v) => { const t = v.trim(); if (t.startsWith('@') ? tokens[t.slice(1)] : isColor(t)) onCommit(t); }} />
      {open && (
        <Popover anchor={open} onClose={() => setOpen(null)} class="color-pop">
          <div class="row">
            <input type="color" value={toHex6(resolved)} onInput={(e) => onDraft?.((e.target as HTMLInputElement).value.toUpperCase())} onChange={(e) => onCommit((e.target as HTMLInputElement).value.toUpperCase())} />
            <TextInput value={isToken ? resolved : value} mono onCommit={(v) => isColor(v.trim()) && onCommit(v.trim())} />
          </div>
          {Object.entries(tokens).some(([, t]) => t.type === 'color') && <>
            <div class="faint" style={{ fontSize: '10.5px' }}>{t('common.colorTokens')}</div>
            <div class="tokens">
              {Object.entries(tokens).filter(([, t]) => t.type === 'color').map(([name]) => (
                <button key={name} title={`@${name}`} class={value === `@${name}` ? 'on' : ''} style={{ background: resolveColor(`@${name}`, tokens) }} onClick={() => { onCommit(`@${name}`); setOpen(null); }} />
              ))}
            </div>
          </>}
        </Popover>
      )}
    </>
  );
}

// ── resizable panes ──────────────────────────────────────────
const stored = (key: string, d: number) => { try { const v = Number(localStorage.getItem('tramme.' + key)); return v > 0 ? v : d; } catch { return d; } };

/** a size in px persisted per viewer, and the handle that changes it */
export function useSize(key: string, initial: number, min: number, max: number) {
  const [size, setSize] = useState(() => stored(key, initial));
  const handle = (axis: 'x' | 'y', sign: 1 | -1) => ({
    onPointerDown: (e: PointerEvent) => {
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      el.classList.add('dragging');
      const p0 = axis === 'x' ? e.clientX : e.clientY, s0 = size;
      let s = s0;
      const move = (ev: PointerEvent) => { s = Math.min(max, Math.max(min, s0 + sign * ((axis === 'x' ? ev.clientX : ev.clientY) - p0))); setSize(s); };
      const up = () => {
        el.classList.remove('dragging');
        removeEventListener('pointermove', move); removeEventListener('pointerup', up);
        try { localStorage.setItem('tramme.' + key, String(s)); } catch { /* private mode */ }
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    },
  });
  return [size, handle] as const;
}

/** a dialog over the page; Escape or a click outside closes it */
export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div class="modal-back" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <div class="modal-head"><span>{title}</span><button class="icon-btn sm" title={t('common.close')} onClick={onClose}><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  );
}
