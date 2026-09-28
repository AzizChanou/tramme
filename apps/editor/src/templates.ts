// Ready-made dressings for a talking video: captions, section titles, key
// words, a lower third. Each builds ordinary layers (text, shapes, captions)
// with keyframed entrances and exits, in the project's colours and font, laid
// out for the composition's format. The assistant uses them so the result is
// clean and consistent; the user can edit every layer afterwards.

import { pointer, type Op, type TrammeDoc } from '@tramme/core';
import { freshId } from './model.ts';
import { locale, t } from './i18n/index.ts';

export interface TemplateArgs {
  /** composition time (s) the dressing appears */
  at: number;
  /** seconds on screen (default per template) */
  duration?: number;
  text?: string;
  subtitle?: string;
  /** captions: transcript asset id */
  transcript?: string;
  /** where on screen */
  place?: 'top' | 'center' | 'bottom';
}

export interface Template {
  title: string;
  description: string;
  build(doc: TrammeDoc, compId: string, a: TemplateArgs): { label: string; ops: Op[] };
}

const OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
const IN: [number, number, number, number] = [0.7, 0, 0.84, 0];

/** the project's look: accent colour token, a font if there is one */
function look(doc: TrammeDoc) {
  const tokens = Object.entries(doc.tokens ?? {});
  const accent = doc.tokens?.accent?.type === 'color' ? '@accent' : tokens.find(([, t]) => t.type === 'color' && !/fond|bg|background|nuit/i.test(String(t.value)))?.[0];
  const font = Object.entries(doc.assets).find(([, a]) => a.type === 'font')?.[0] ?? null;
  return { accent: accent ? (accent.startsWith('@') ? accent : `@${accent}`) : '#2EC4B6', font };
}

/** a layer added at the top of the composition, its id kept free */
function adder(doc: TrammeDoc, compId: string) {
  const c = doc.compositions[compId];
  const taken: Record<string, unknown> = { ...c.layers };
  const ops: Op[] = [];
  const order = [...c.order];
  // layers written as plain JSON (the document's own form), checked when the proposal is validated
  const add = (base: string, layer: Record<string, unknown>, top = true) => {
    const id = freshId(taken, base);
    taken[id] = 1;
    ops.push({ op: 'add', path: pointer('compositions', compId, 'layers', id), value: layer });
    if (top) order.push(id);
    return id;
  };
  const done = () => [...ops, { op: 'replace' as const, path: pointer('compositions', compId, 'order'), value: order }];
  return { c, add, done };
}

/** keys of an entrance at `at` and an exit before `end` */
const fade = (at: number, end: number) => ({ $k: [{ t: at, v: 0, ease: OUT }, { t: at + 0.35, v: 1 }, { t: end - 0.3, v: 1, ease: IN }, { t: end, v: 0 }] });

export const TEMPLATES: Record<string, Template> = {
  captions: {
    title: 'Captions',
    description: 'the words said, a few at a time, the spoken word in color on its pill (transcript required)',
    build(doc, compId, a) {
      if (!a.transcript || !doc.assets[a.transcript]) throw new Error('captions: a transcription asset is expected (transcript)');
      const { c, add, done } = adder(doc, compId);
      const { accent, font } = look(doc);
      const u = Math.min(c.width, c.height), vertical = c.height > c.width;
      const y = a.place === 'top' ? c.height * 0.16 : a.place === 'center' ? c.height * 0.5 : c.height * (vertical ? 0.7 : 0.84);
      add('captions', {
        type: 'captions', name: t('templates.captions'), in: a.at, ...(a.duration ? { out: a.at + a.duration } : {}),
        transform: { position: [c.width / 2, Math.round(y)] },
        props: {
          transcript: a.transcript, start: 0, size: Math.round(u * (vertical ? 0.075 : 0.06)), weight: 800, width: Math.round(c.width * 0.82),
          maxWords: vertical ? 3 : 5, highlight: 'box', activeColor: accent, animation: 'pop', box: 'rgba(11,15,18,0.66)', boxPadding: [Math.round(u * 0.025), Math.round(u * 0.012)],
          ...(font ? { font } : {}),
        },
      });
      return { label: t('templates.captions'), ops: done() };
    },
  },

  title: {
    title: 'Section title',
    description: 'a title and, below it, a smaller line, with a colored bar that draws itself',
    build(doc, compId, a) {
      const { c, add, done } = adder(doc, compId);
      const { accent, font } = look(doc);
      const u = Math.min(c.width, c.height), end = a.at + (a.duration ?? 3);
      const y = a.place === 'bottom' ? c.height * 0.72 : a.place === 'top' ? c.height * 0.2 : c.height * 0.45;
      const size = Math.round(u * 0.085);
      const lift = (dy: number) => ({ $k: [{ t: a.at, v: [c.width / 2, Math.round(y + dy + size * 0.4)], ease: OUT }, { t: a.at + 0.6, v: [c.width / 2, Math.round(y + dy)] }] });
      add('title', { type: 'text', name: t('templates.title'), in: a.at, out: end, transform: { position: lift(0), opacity: fade(a.at, end) }, props: { text: a.text ?? t('templates.title'), size, weight: 800, align: 'center', color: '#FFFFFF', tracking: -0.01, ...(font ? { font } : {}) } });
      add('bar', {
        type: 'shape.rect', name: t('templates.bar'), in: a.at, out: end,
        transform: { position: [c.width / 2, Math.round(y + size * 0.42)], opacity: fade(a.at, end) },
        props: { size: { $k: [{ t: a.at + 0.15, v: [0, Math.round(u * 0.008)], ease: OUT }, { t: a.at + 0.85, v: [Math.round(u * 0.16), Math.round(u * 0.008)] }] }, radius: Math.round(u * 0.004), fill: accent },
      });
      if (a.subtitle) add('subtitle', { type: 'text', name: t('templates.subtitle'), in: a.at + 0.2, out: end, transform: { position: lift(size * 1.1), opacity: fade(a.at + 0.2, end) }, props: { text: a.subtitle, size: Math.round(size * 0.42), weight: 500, align: 'center', color: 'rgba(255,255,255,0.82)', ...(font ? { font } : {}) } });
      return { label: t('templates.titleText', { text: a.text ?? '' }), ops: done() };
    },
  },

  keyword: {
    title: 'Keyword',
    description: 'a word or a short phrase in large type, popping up the moment it is said',
    build(doc, compId, a) {
      const { c, add, done } = adder(doc, compId);
      const { accent, font } = look(doc);
      const u = Math.min(c.width, c.height), end = a.at + (a.duration ?? 1.6);
      const y = a.place === 'top' ? c.height * 0.24 : a.place === 'bottom' ? c.height * 0.66 : c.height * 0.42;
      add('keyword', {
        type: 'text', name: `${t('templates.keyword')} · ${a.text ?? ''}`, in: a.at, out: end,
        transform: {
          position: [c.width / 2, Math.round(y)],
          scale: { $k: [{ t: a.at, v: [0.6, 0.6], ease: [0.34, 1.56, 0.64, 1] }, { t: a.at + 0.32, v: [1, 1] }] },
          opacity: fade(a.at, end),
          rotation: { $v: 0, $mod: [{ type: 'wiggle', freq: 0.8, amp: 0.8 }] },
        },
        props: { text: (a.text ?? t('templates.word')).toLocaleUpperCase(locale), size: Math.round(u * 0.13), weight: 900, align: 'center', color: accent, tracking: -0.02, ...(font ? { font } : {}) },
        effects: [{ id: 'shadow', type: 'fx.shadow', props: { color: 'rgba(0,0,0,0.45)', blur: Math.round(u * 0.03), offset: [0, Math.round(u * 0.01)] } }],
      });
      return { label: t('templates.keywordText', { text: a.text ?? '' }), ops: done() };
    },
  },

  'lower-third': {
    title: 'Name and role lower third',
    description: 'bottom left, a name (text) and a role (subtitle) on a sliding band',
    build(doc, compId, a) {
      const { c, add, done } = adder(doc, compId);
      const { accent, font } = look(doc);
      const u = Math.min(c.width, c.height), end = a.at + (a.duration ?? 4);
      const x = Math.round(c.width * 0.07), y = Math.round(c.height * (c.height > c.width ? 0.78 : 0.8));
      const size = Math.round(u * 0.05), w = Math.round(Math.max((a.text ?? '').length, (a.subtitle ?? '').length * 0.5) * size * 0.6 + size * 1.6);
      const slide = (dx: number, t0: number) => ({ $k: [{ t: t0, v: [x - size * 2 + dx, y], ease: OUT }, { t: t0 + 0.55, v: [x + dx, y] }, { t: end - 0.35, v: [x + dx, y], ease: IN }, { t: end, v: [x - size * 2 + dx, y] }] });
      add('lower-third-band', { type: 'shape.rect', name: t('templates.lowerThird'), in: a.at, out: end, transform: { anchor: [-w / 2, 0], position: slide(0, a.at), opacity: fade(a.at, end) }, props: { size: [w, Math.round(size * (a.subtitle ? 2.5 : 1.6))], radius: Math.round(size * 0.2), fill: 'rgba(11,15,18,0.78)' } });
      add('lower-third-bar', { type: 'shape.rect', name: t('templates.lowerThirdBar'), in: a.at, out: end, transform: { anchor: [-Math.round(size * 0.08), 0], position: slide(0, a.at), opacity: fade(a.at, end) }, props: { size: [Math.round(size * 0.16), Math.round(size * (a.subtitle ? 2.5 : 1.6))], fill: accent } });
      add('lower-third-name', { type: 'text', name: t('templates.lowerThirdName'), in: a.at + 0.1, out: end, transform: { position: slide(size * 0.6, a.at + 0.1), opacity: fade(a.at + 0.1, end) }, props: { text: a.text ?? t('common.name'), size, weight: 700, color: '#FFFFFF', baseline: a.subtitle ? 'bottom' : 'middle', ...(font ? { font } : {}) } });
      if (a.subtitle) add('lower-third-role', { type: 'text', name: t('templates.lowerThirdRole'), in: a.at + 0.2, out: end, transform: { position: slide(size * 0.6, a.at + 0.2), opacity: fade(a.at + 0.2, end) }, props: { text: a.subtitle, size: Math.round(size * 0.62), weight: 500, color: 'rgba(255,255,255,0.78)', baseline: 'top', ...(font ? { font } : {}) } });
      return { label: t('templates.lowerThirdText', { text: a.text ?? '' }), ops: done() };
    },
  },
};
