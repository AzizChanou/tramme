// Finishing effects applied by the compositor to the whole frame, after the
// sub-frames are averaged in linear light. Their props animate like any other.

import type { EffectType } from '@tramme/core';

export const vignette: EffectType = {
  type: 'look.vignette', title: 'Vignette', category: 'Finishing', stage: 'finish',
  description: 'darkens the edges of the background (the composition\'s color plate, not the layers)',
  props: { amount: { type: 'number', default: 0.18, label: 'Intensity', min: 0, max: 1, step: 0.01 } },
};

export const grain: EffectType = {
  type: 'look.grain', title: 'Grain', category: 'Finishing', stage: 'finish',
  props: {
    amount: { type: 'number', default: 0.012, label: 'Intensity', min: 0, max: 0.2, step: 0.001 },
    seed: { type: 'number', default: 1, label: 'Seed', step: 1, description: 'one seed per frame; fixing it gives a static grain' },
  },
};

export const bloom: EffectType = {
  type: 'look.bloom', title: 'Glow', category: 'Finishing', stage: 'finish',
  props: {
    amount: { type: 'number', default: 0, label: 'Intensity', min: 0, max: 2, step: 0.01 },
    threshold: { type: 'number', default: 0.85, label: 'Threshold', min: 0, max: 1, step: 0.01 },
  },
};

export const exposure: EffectType = {
  type: 'look.exposure', title: 'Exposure', category: 'Finishing', stage: 'finish',
  props: { value: { type: 'number', default: 1, label: 'Factor', min: 0, step: 0.01, unit: 'x' } },
};

// ── layer effects: the layer is drawn alone, then composited through these ──

export const blur: EffectType<{ radius: number }> = {
  type: 'fx.blur', title: 'Blur', category: 'Effects', stage: 'layer',
  props: { radius: { type: 'number', default: 12, min: 0, step: 0.5, unit: 'px', label: 'Radius' } },
  canvas2d: { filter: (p, k) => (p.radius > 0 ? `blur(${p.radius * k}px)` : '') },
};

export const shadow: EffectType<{ color: string; blur: number; offset: [number, number] }> = {
  type: 'fx.shadow', title: 'Drop shadow', category: 'Effects', stage: 'layer',
  props: {
    color: { type: 'color', default: 'rgba(0,0,0,0.45)', label: 'Color' },
    blur: { type: 'number', default: 24, min: 0, step: 0.5, unit: 'px', label: 'Blur' },
    offset: { type: 'vec2', default: [0, 12], unit: 'px', label: 'Offset' },
  },
  canvas2d: { filter: (p, k) => `drop-shadow(${p.offset[0] * k}px ${p.offset[1] * k}px ${p.blur * k}px ${p.color})` },
};

export const glow: EffectType<{ color: string; radius: number; strength: number }> = {
  type: 'fx.glow', title: 'Glow', category: 'Effects', stage: 'layer',
  props: {
    color: { type: 'color', default: '#FFFFFF', label: 'Color' },
    radius: { type: 'number', default: 18, min: 0, step: 0.5, unit: 'px', label: 'Radius' },
    strength: { type: 'number', default: 2, min: 1, max: 4, step: 1, label: 'Intensity' },
  },
  canvas2d: { filter: (p, k) => Array.from({ length: Math.max(1, Math.min(4, Math.round(p.strength))) }, () => `drop-shadow(0 0 ${p.radius * k}px ${p.color})`).join(' ') },
};

export const color: EffectType<{ brightness: number; contrast: number; saturation: number; hue: number }> = {
  type: 'fx.color', title: 'Color correction', category: 'Effects', stage: 'layer',
  props: {
    brightness: { type: 'number', default: 1, min: 0, step: 0.01, unit: 'x', label: 'Brightness' },
    contrast: { type: 'number', default: 1, min: 0, step: 0.01, unit: 'x', label: 'Contrast' },
    saturation: { type: 'number', default: 1, min: 0, step: 0.01, unit: 'x', label: 'Saturation' },
    hue: { type: 'number', default: 0, step: 1, unit: 'deg', label: 'Hue' },
  },
  canvas2d: { filter: (p) => `brightness(${p.brightness}) contrast(${p.contrast}) saturate(${p.saturation}) hue-rotate(${p.hue}deg)` },
};

export const tint: EffectType<{ color: string; amount: number }> = {
  type: 'fx.tint', title: 'Tint', category: 'Effects', stage: 'layer',
  props: {
    color: { type: 'color', default: '#E5B965', label: 'Color' },
    amount: { type: 'number', default: 1, min: 0, max: 1, step: 0.01, label: 'Amount' },
  },
  canvas2d: {
    apply(ctx, p) {
      if (p.amount <= 0) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = p.amount;
      ctx.fillStyle = p.color;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.restore();
    },
  },
};
