// GLSL passes for effects, on one shared WebGL2 canvas. An effect writes
//   vec4 effect(vec2 uv)
// reading uImage (the picture it applies to: a layer drawn alone, or the
// whole frame), uRes (its size in pixels), uScale (pixels per composition
// pixel: sizes in props are composition pixels), uTime, and one uniform per
// property of its schema, declared here from the schema: u_<name> as float
// (number, bool, enum: the rank of the option), vec2, vec4 (colour, 0..1
// straight) or sampler2D (a layer, drawn alone at the same instant).
// Programs are compiled once per source.

import { parseColor, type PropSchema } from '@tramme/core';

const VERT = `#version 300 es
out vec2 vUv;
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

/** the declarations a schema gives a fragment */
export function uniformsOf(schema: PropSchema): string {
  return Object.entries(schema).map(([k, d]) => {
    const n = `u_${k.replace(/\W/g, '_')}`;
    if (d.type === 'number' || d.type === 'bool' || d.type === 'enum') return `uniform float ${n};`;
    if (d.type === 'vec2') return `uniform vec2 ${n};`;
    if (d.type === 'color') return `uniform vec4 ${n};`;
    if (d.type === 'layer') return `uniform sampler2D ${n};`;
    return '';
  }).filter(Boolean).join('\n');
}

/** the whole fragment program of an effect */
export const fragmentOf = (code: string, schema: PropSchema) => `#version 300 es
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uImage; uniform vec2 uRes; uniform float uScale; uniform float uTime;
${uniformsOf(schema)}
${code}
void main() { fragColor = effect(vUv); }`;

interface GL { canvas: OffscreenCanvas | HTMLCanvasElement; gl: WebGL2RenderingContext; programs: Map<string, WebGLProgram | Error>; vao: WebGLVertexArrayObject; textures: WebGLTexture[] }
let shared: GL | null = null;

function context(): GL {
  if (shared && !shared.gl.isContextLost()) return shared;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error('WebGL2 unavailable for GPU effects');
  shared = { canvas, gl, programs: new Map(), vao: gl.createVertexArray()!, textures: [] };
  return shared;
}

/** a compiled program, or the compile error (kept, so a broken effect is not compiled each frame) */
export function program(g: { gl: WebGL2RenderingContext; programs: Map<string, WebGLProgram | Error> }, frag: string, vert = VERT): WebGLProgram {
  const hit = g.programs.get(frag);
  if (hit instanceof Error) throw hit;
  if (hit) return hit;
  const { gl } = g;
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`GLSL: ${gl.getShaderInfoLog(s)?.trim()}`);
    return s;
  };
  try {
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vert));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`GLSL: ${gl.getProgramInfoLog(p)}`);
    g.programs.set(frag, p);
    return p;
  } catch (e) {
    g.programs.set(frag, e as Error);
    throw e;
  }
}

/** sets the uniforms of a schema's values; layer props are bound by the caller as textures (returned by name) */
export function setUniforms(gl: WebGL2RenderingContext, p: WebGLProgram, schema: PropSchema, props: Record<string, unknown>, firstUnit: number, textureOf: (name: string, value: unknown) => WebGLTexture | null) {
  let unit = firstUnit;
  for (const [k, d] of Object.entries(schema)) {
    const loc = gl.getUniformLocation(p, `u_${k.replace(/\W/g, '_')}`);
    if (!loc) continue;
    const v = props[k];
    if (d.type === 'number') gl.uniform1f(loc, Number(v) || 0);
    else if (d.type === 'bool') gl.uniform1f(loc, v ? 1 : 0);
    else if (d.type === 'enum') gl.uniform1f(loc, Math.max(0, d.options?.indexOf(String(v)) ?? 0));
    else if (d.type === 'vec2') { const a = (v as number[]) ?? [0, 0]; gl.uniform2f(loc, a[0], a[1]); }
    else if (d.type === 'color') { let c = [0, 0, 0, 0]; try { const [r, g, b, a] = parseColor(String(v)); c = [r / 255, g / 255, b / 255, a]; } catch { /* left transparent */ } gl.uniform4fv(loc, c); }
    else if (d.type === 'layer') {
      // the unit first: making the texture binds it to the active unit
      gl.activeTexture(gl.TEXTURE0 + unit);
      const tex = textureOf(k, v);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(loc, unit++);
    }
  }
}

function texture(gl: WebGL2RenderingContext, src: TexImageSource): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/**
 * Runs an effect's fragment over the pixels of a 2D canvas, in place: the
 * canvas is read as premultiplied sRGB and gets the result. `layers` gives
 * the pictures of the effect's layer props (canvases of the same size).
 */
export function glPass(ctx: CanvasRenderingContext2D, code: string, schema: PropSchema, props: Record<string, unknown>, t: number, scale: number, layers: Record<string, CanvasImageSource | null> = {}) {
  const g = context(), { gl } = g, { width: w, height: h } = ctx.canvas;
  if (g.canvas.width !== w || g.canvas.height !== h) { g.canvas.width = w; g.canvas.height = h; }
  const p = program(g, fragmentOf(code, schema));
  const made: WebGLTexture[] = [];
  try {
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(p);
    const image = texture(gl, ctx.canvas as TexImageSource);
    made.push(image);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, image);
    gl.uniform1i(gl.getUniformLocation(p, 'uImage'), 0);
    gl.uniform2f(gl.getUniformLocation(p, 'uRes'), w, h);
    gl.uniform1f(gl.getUniformLocation(p, 'uTime'), t);
    gl.uniform1f(gl.getUniformLocation(p, 'uScale'), scale);
    setUniforms(gl, p, schema, props, 1, (k) => {
      const src = layers[k];
      if (!src) return null;
      const tex = texture(gl, src as TexImageSource);
      made.push(tex);
      return tex;
    });
    gl.bindVertexArray(g.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'copy';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.drawImage(g.canvas as CanvasImageSource, 0, 0);
    ctx.restore();
  } finally {
    for (const tex of made) gl.deleteTexture(tex);
  }
}
