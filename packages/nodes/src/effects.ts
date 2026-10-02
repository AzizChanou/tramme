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

// ── GLSL effects: run on the GPU (see gpu.ts in the renderer) ──

/** a track matte: the layer shows only where another layer is (its alpha or its brightness) */
export const matte: EffectType<{ source: string | null; mode: 'alpha' | 'alpha-inverted' | 'luma' | 'luma-inverted' }> = {
  type: 'fx.matte', title: 'Track matte', category: 'Effects', stage: 'layer',
  description: 'shows the layer only where another layer is: through text, a shape, a mask',
  props: {
    source: { type: 'layer', default: null, nullable: true, label: 'Matte layer', animatable: false, description: 'usually hidden; drawn at the same instant' },
    mode: { type: 'enum', default: 'alpha', options: ['alpha', 'alpha-inverted', 'luma', 'luma-inverted'], label: 'Mode', animatable: false },
  },
  gl: {
    code: `vec4 effect(vec2 uv) {
  vec4 c = texture(uImage, uv), m = texture(u_source, uv);
  float luma = m.a > 0.0 ? dot(m.rgb / m.a, vec3(0.2126, 0.7152, 0.0722)) * m.a : 0.0;
  float k = u_mode < 0.5 ? m.a : u_mode < 1.5 ? 1.0 - m.a : u_mode < 2.5 ? luma : 1.0 - luma;
  return c * k;
}`,
  },
};

/** a displacement: the pixels of the layer moved by the colours of another layer (red: x, green: y) */
export const displace: EffectType<{ source: string | null; amount: number }> = {
  type: 'fx.displace', title: 'Displacement', category: 'Effects', stage: 'layer',
  description: 'bends the layer with the colours of another layer: glass, heat haze, liquid',
  props: {
    source: { type: 'layer', default: null, nullable: true, label: 'Map layer', animatable: false, description: 'mid grey moves nothing; red pushes along x, green along y' },
    amount: { type: 'number', default: 40, step: 1, unit: 'px', label: 'Amount' },
  },
  gl: {
    code: `vec4 effect(vec2 uv) {
  vec4 m = texture(u_source, uv);
  vec2 d = m.a > 0.0 ? (m.rg / m.a - 0.5) * 2.0 * m.a : vec2(0.0);
  return texture(uImage, uv + d * u_amount * uScale / uRes * vec2(1.0, -1.0));
}`,
  },
};

/** colour fringes towards the edges of the frame, like a lens */
export const chromatic: EffectType<{ amount: number }> = {
  type: 'look.chromatic', title: 'Chromatic aberration', category: 'Finishing', stage: 'finish',
  description: 'red and blue drift apart towards the edges, like a cheap lens or a glitch',
  props: { amount: { type: 'number', default: 4, min: 0, max: 60, step: 0.5, unit: 'px', label: 'Spread' } },
  gl: {
    code: `vec4 effect(vec2 uv) {
  vec2 dir = (uv - 0.5) * u_amount * uScale / uRes * 2.0;
  vec4 c = texture(uImage, uv);
  return vec4(texture(uImage, uv + dir).r, c.g, texture(uImage, uv - dir).b, c.a);
}`,
  },
};

/** a colour grade in linear light: exposure of the shadows and highlights, saturation, temperature */
export const grade: EffectType<{ lift: number; gain: number; saturation: number; temperature: number }> = {
  type: 'look.grade', title: 'Colour grade', category: 'Finishing', stage: 'finish',
  description: 'warms or cools, lifts the shadows, tames the highlights and sets the saturation of the whole picture',
  props: {
    lift: { type: 'number', default: 0, min: -0.2, max: 0.2, step: 0.005, label: 'Shadows' },
    gain: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, unit: 'x', label: 'Highlights' },
    saturation: { type: 'number', default: 1, min: 0, max: 2, step: 0.01, unit: 'x', label: 'Saturation' },
    temperature: { type: 'number', default: 0, min: -1, max: 1, step: 0.01, label: 'Temperature', description: 'negative cools, positive warms' },
  },
  gl: {
    code: `vec4 effect(vec2 uv) {
  vec4 c = texture(uImage, uv);
  if (c.a <= 0.0) return c;
  vec3 s = c.rgb / c.a;
  s = s * u_gain + u_lift * (1.0 - s);
  s *= vec3(1.0 + 0.12 * u_temperature, 1.0, 1.0 - 0.12 * u_temperature);
  float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
  s = max(mix(vec3(l), s, u_saturation), 0.0);
  return vec4(s * c.a, c.a);
}`,
  },
};
