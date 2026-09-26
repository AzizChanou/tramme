// A picture computed by a GLSL fragment shader, rendered on a shared WebGL2
// canvas and drawn into the layer's frame (centred on the origin). The code
// defines `vec4 shade(vec2 uv)` (uv 0..1, y down, straight alpha) and may use
// uTime (layer time, s), uSize (px), uColorA, uColorB (rgba) and uParams
// (p1..p4). Programs are compiled once per source.

import { parseColor, type NodeType, type Vec2 } from '@tramme/core';

export const DEFAULT_SHADER = `// uv: 0..1, y pointing down; uTime: layer time (s)
vec4 shade(vec2 uv) {
  float w = sin(uv.x * 6.2832 * uParams.x + uTime * uParams.y);
  float k = smoothstep(0.0, 1.0, uv.y + 0.12 * w);
  return vec4(mix(uColorA.rgb, uColorB.rgb, k), 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
uniform float uTime;
uniform vec2 uSize;
uniform vec4 uColorA, uColorB, uParams;
out vec4 fragColor;
`;
const TAIL = `
void main() {
  vec2 uv = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) / uSize;
  vec4 c = clamp(shade(uv), 0.0, 1.0);
  fragColor = vec4(c.rgb * c.a, c.a);
}`;
const VERT = `#version 300 es
void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

interface GL { canvas: OffscreenCanvas | HTMLCanvasElement; gl: WebGL2RenderingContext; programs: Map<string, WebGLProgram | Error>; vao: WebGLVertexArrayObject }
let shared: GL | null = null;

function context(): GL {
  if (shared) return shared;
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error('WebGL2 unavailable for shaders');
  shared = { canvas, gl, programs: new Map(), vao: gl.createVertexArray()! };
  return shared;
}

function program(g: GL, code: string): WebGLProgram {
  const hit = g.programs.get(code);
  if (hit instanceof Error) throw hit;
  if (hit) return hit;
  const { gl } = g;
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader : ${gl.getShaderInfoLog(s)?.trim()}`);
    return s;
  };
  try {
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, HEAD + code + TAIL));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`shader : ${gl.getProgramInfoLog(p)}`);
    g.programs.set(code, p);
    return p;
  } catch (e) {
    g.programs.set(code, e as Error);
    throw e;
  }
}

const rgba = (c: string) => { const [r, g, b, a] = parseColor(c); return [r / 255, g / 255, b / 255, a]; };

interface ShaderProps { code: string; size: Vec2; colorA: string; colorB: string; p1: number; p2: number; p3: number; p4: number; resolution: number }

export const shader: NodeType<ShaderProps> = {
  type: 'shader', title: 'Shader', category: 'Generative',
  description: 'image computed by a GLSL fragment shader',
  props: {
    code: { type: 'text', default: DEFAULT_SHADER, label: 'GLSL code', animatable: false, format: 'code' },
    size: { type: 'vec2', default: [1080, 1080], unit: 'px', label: 'Size' },
    colorA: { type: 'color', default: '#1C1917', label: 'Color A' },
    colorB: { type: 'color', default: '#E5B965', label: 'Color B' },
    p1: { type: 'number', default: 1.5, step: 0.05, label: 'p1', group: 'Settings' },
    p2: { type: 'number', default: 1, step: 0.05, label: 'p2', group: 'Settings' },
    p3: { type: 'number', default: 0, step: 0.05, label: 'p3', group: 'Settings' },
    p4: { type: 'number', default: 0, step: 0.05, label: 'p4', group: 'Settings' },
    resolution: { type: 'number', default: 1, min: 0.1, max: 2, step: 0.05, label: 'Resolution', description: 'GPU render size factor', animatable: false },
  },
  path({ size: [w, h] }) { const p = new Path2D(); p.rect(-w / 2, -h / 2, w, h); return p; },
  bounds: ({ size: [w, h] }) => ({ x: -w / 2, y: -h / 2, w, h }),
  render: {
    canvas2d(ctx, p, host) {
      const [w, h] = p.size;
      if (w <= 0 || h <= 0) return;
      const g = context(), { gl } = g;
      const pw = Math.max(1, Math.round(w * p.resolution)), ph = Math.max(1, Math.round(h * p.resolution));
      if (g.canvas.width !== pw || g.canvas.height !== ph) { g.canvas.width = pw; g.canvas.height = ph; }
      const prog = program(g, p.code);
      gl.viewport(0, 0, pw, ph);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(prog);
      gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), host.t - (host.layerIn ?? 0));
      gl.uniform2f(gl.getUniformLocation(prog, 'uSize'), pw, ph);
      gl.uniform4fv(gl.getUniformLocation(prog, 'uColorA'), rgba(p.colorA));
      gl.uniform4fv(gl.getUniformLocation(prog, 'uColorB'), rgba(p.colorB));
      gl.uniform4f(gl.getUniformLocation(prog, 'uParams'), p.p1, p.p2, p.p3, p.p4);
      gl.bindVertexArray(g.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      ctx.drawImage(g.canvas, -w / 2, -h / 2, w, h);
    },
  },
};
