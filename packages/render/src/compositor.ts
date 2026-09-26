// WebGL2 compositor (same shaders as the Canvas2D + WebGL pipeline it was ported from).
// so a document renders exactly like the code it replaces).
//  1. accumulates N sub-frames in premultiplied linear light (motion blur, real alpha)
//  2. dual-Kawase bloom
//  3. background plate (vignette on the plate only) under the layers, or none (alpha)
//  4. grain on colour only, never on alpha; triangular dither
//  5. packs BT.709 YUV 4:2:0 on the GPU, or straight RGBA
// Output is straight alpha, divided back from the premultiplied sum.

const VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.,-1.), vec2(3.,-1.), vec2(-1.,3.));
out vec2 vUv;
void main(){ vec2 p = P[gl_VertexID]; vUv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

const HEAD = `#version 300 es
precision highp float;
precision highp int;
in vec2 vUv; out vec4 o;
vec3 toLin(vec3 c){ return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSRGB(vec3 c){ c = max(c, 0.); return mix(c*12.92, 1.055*pow(c, vec3(1./2.4))-0.055, step(0.0031308, c)); }
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
`;

// canvas pixels arrive premultiplied in sRGB: un-premultiply, linearize, re-premultiply
const FS_ACCUM = HEAD + `
uniform sampler2D uTex; uniform float uW;
void main(){
  vec4 pm = texture(uTex, vUv);
  float a = pm.a;
  vec3 s = a > 0. ? clamp(pm.rgb / a, 0., 1.) : vec3(0.);
  o = vec4(toLin(s) * a, a) * uW;
}`;

const FS_PREFILTER = HEAD + `
uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThresh; uniform float uKnee;
void main(){
  vec3 c = texture(uTex, vUv + uTexel*vec2(-1.,-1.)).rgb + texture(uTex, vUv + uTexel*vec2(1.,-1.)).rgb
         + texture(uTex, vUv + uTexel*vec2(-1.,1.)).rgb + texture(uTex, vUv + uTexel*vec2(1.,1.)).rgb;
  c *= 0.25;
  float br = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float soft = clamp(br - uThresh + uKnee, 0., 2.*uKnee); soft = soft*soft/(4.*uKnee + 1e-4);
  float k = max(soft, br - uThresh) / max(br, 1e-4);
  o = vec4(c*k, 1.);
}`;

const FS_DOWN = HEAD + `
uniform sampler2D uTex; uniform vec2 uTexel;
void main(){
  vec3 s = texture(uTex, vUv).rgb*4.;
  s += texture(uTex, vUv - uTexel).rgb; s += texture(uTex, vUv + uTexel).rgb;
  s += texture(uTex, vUv + vec2(uTexel.x,-uTexel.y)).rgb; s += texture(uTex, vUv - vec2(uTexel.x,-uTexel.y)).rgb;
  o = vec4(s/8., 1.);
}`;

const FS_UP = HEAD + `
uniform sampler2D uTex; uniform vec2 uTexel;
void main(){
  vec2 h = uTexel;
  vec3 s = texture(uTex, vUv + vec2(-h.x*2., 0.)).rgb;
  s += texture(uTex, vUv + vec2(-h.x, h.y)).rgb*2.;
  s += texture(uTex, vUv + vec2(0., h.y*2.)).rgb;
  s += texture(uTex, vUv + vec2(h.x, h.y)).rgb*2.;
  s += texture(uTex, vUv + vec2(h.x*2., 0.)).rgb;
  s += texture(uTex, vUv + vec2(h.x, -h.y)).rgb*2.;
  s += texture(uTex, vUv + vec2(0., -h.y*2.)).rgb;
  s += texture(uTex, vUv + vec2(-h.x, -h.y)).rgb*2.;
  o = vec4(s/12., 1.);
}`;

const FS_FINAL = HEAD + `
uniform sampler2D uScene, uBloom, uHud;
uniform vec2 uRes;
uniform vec3 uBg;
uniform float uBgOn, uBloomStr, uVignette, uGrain, uSeed, uExposure, uHudOn, uChecker, uDither;
void main(){
  vec2 uv = vUv;
  vec4 fg = texture(uScene, uv);                 // premultiplied, linear
  fg.rgb *= uExposure;
  vec3 bl = uBloomStr > 0. ? texture(uBloom, uv).rgb*uBloomStr : vec3(0.);
  vec2 cc = (uv - 0.5)*uRes/min(uRes.x, uRes.y);
  float vig = mix(1., smoothstep(1.35, 0.25, length(cc)), uVignette);
  // bloom is emissive: it adds light and extends coverage by its own strength
  vec3 col = fg.rgb + bl;
  float a = clamp(fg.a + (1. - fg.a)*clamp(max(bl.r, max(bl.g, bl.b)), 0., 1.), 0., 1.);
  vec3 st = a > 1e-5 ? col/a : vec3(0.);         // straight colour, linear
  st = st/(1. + max(st - 1., 0.)*0.6);          // soft shoulder, only above 1
  vec3 s = toSRGB(clamp(st, 0., 1.));
  // the layers go over the plate in sRGB, as a browser or an editing suite
  // composites an alpha render: static edges match the vector reference
  if (uBgOn > 0.5) { s = s*a + toSRGB(uBg*vig)*(1. - a); a = 1.; }
  if (uGrain > 0. && a > 0.) {
    float L = dot(s, vec3(0.2126, 0.7152, 0.0722));
    float g = h12(gl_FragCoord.xy + fract(uSeed*0.618)*917.) + h12(gl_FragCoord.xy*1.13 + fract(uSeed*0.371)*533.) - 1.;
    s += g*uGrain*(0.35 + 0.65*(1. - abs(L*2. - 1.)));
  }
  if (uHudOn > 0.5) {                            // overlays (safe zones, grid), straight alpha, over
    vec4 h = texture(uHud, uv);
    float oa = h.a + a*(1. - h.a);
    s = oa > 0. ? (h.rgb*h.a + s*a*(1. - h.a))/oa : vec3(0.);
    a = oa;
  }
  if (uDither > 0.5 && a > 0.) s += (h12(gl_FragCoord.xy*0.97 + uSeed*3.1) - 0.5)/255.;
  if (uChecker > 0.5) {                          // preview of alpha: checkerboard behind
    vec2 q = floor(gl_FragCoord.xy/16.);
    vec3 ck = vec3(mod(q.x + q.y, 2.) > 0.5 ? 0.30 : 0.22);
    s = mix(ck, s, a); a = 1.;
  }
  o = vec4(clamp(s, 0., 1.), a);
}`;

// planar YUV 4:2:0 (BT.709, limited range) packed in an RGBA8 target W/4 wide
// and 1.5 H tall: readPixels hands back exactly ffmpeg's rawvideo yuv420p.
const FS_YUV = HEAD + `
uniform sampler2D uImg; uniform float uSeed; uniform ivec2 uSize;
vec3 px(int x, int y){ return clamp(texelFetch(uImg, ivec2(x, uSize.y - 1 - y), 0).rgb, 0., 1.); }
float tri(vec2 p){ return (h12(p + uSeed) + h12(p*1.7 + uSeed*1.3) - 1.)/255.; }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  int W = uSize.x, H = uSize.y, TW = W/4;
  const vec3 K = vec3(0.2126, 0.7152, 0.0722);
  vec4 o4;
  if (p.y < H) {
    for (int k = 0; k < 4; k++) o4[k] = (16. + 219.*dot(px(4*p.x + k, p.y), K))/255.;
  } else {
    int CW = W/2, CH = H/2, UN = (CW*CH)/4;
    int i = (p.y - H)*TW + p.x;
    bool isU = i < UN;
    int idx = isU ? i : i - UN;
    for (int k = 0; k < 4; k++) {
      int b = idx*4 + k, row = b/CW, col = b - row*CW;
      int cx = col*2, cy = row*2;
      vec3 c = (px(cx, cy) + px(cx + 1, cy) + px(cx, cy + 1) + px(cx + 1, cy + 1))*0.25;
      float y = dot(c, K);
      float v = isU ? (c.b - y)/1.8556 : (c.r - y)/1.5748;
      o4[k] = (128. + 224.*v)/255.;
    }
  }
  o4 += vec4(tri(gl_FragCoord.xy), tri(gl_FragCoord.xy + 17.), tri(gl_FragCoord.xy + 31.), tri(gl_FragCoord.xy + 47.));
  o = o4;
}`;

// straight RGBA8, top row first (ffmpeg rawvideo rgba, PNG)
const FS_RGBA = HEAD + `
uniform sampler2D uImg; uniform float uSeed; uniform ivec2 uSize;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 c = texelFetch(uImg, ivec2(p.x, uSize.y - 1 - p.y), 0);
  if (c.a > 0.) c.rgb += (h12(gl_FragCoord.xy*0.97 + uSeed*3.1) - 0.5)/255.;
  o = clamp(c, 0., 1.);
}`;

type Program = WebGLProgram & { u(name: string): WebGLUniformLocation | null };
interface Target { fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

function compile(gl: WebGL2RenderingContext, fsSrc: string): Program {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    return s;
  };
  const p = gl.createProgram()! as Program;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
  const locs = new Map<string, WebGLUniformLocation | null>();
  p.u = (n) => { if (!locs.has(n)) locs.set(n, gl.getUniformLocation(p, n)); return locs.get(n)!; };
  return p;
}

export interface Finish {
  bloom: number;
  bloomThreshold: number;
  vignette: number;
  grain: number;
  exposure: number;
}

export interface Look {
  /** background plate, linear RGB, or null for a transparent render */
  bg: [number, number, number] | null;
  /** checkerboard behind transparent areas (preview only) */
  checker?: boolean;
}

export class Compositor {
  w = 0;
  h = 0;
  private gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private p: Record<'accum' | 'prefilter' | 'down' | 'up' | 'final' | 'yuv' | 'rgba', Program>;
  private srcTex!: WebGLTexture;
  private hudTex!: WebGLTexture;
  private accum!: Target;
  private bloom: Target[] = [];
  private finalFbo!: Target;
  private yuv!: Target;
  private rgba!: Target;

  /**
   * preserve: keep the picture after it is shown (reading the canvas later);
   * a preview reads it right after drawing and can do without (one copy less per frame).
   */
  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, w: number, h: number, { preserve = true }: { preserve?: boolean } = {}) {
    const gl = canvas.getContext('webgl2', {
      antialias: false, alpha: true, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: preserve,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGL2 unavailable');
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float unavailable');
    gl.getExtension('OES_texture_float_linear');
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
    this.p = {
      accum: compile(gl, FS_ACCUM), prefilter: compile(gl, FS_PREFILTER), down: compile(gl, FS_DOWN),
      up: compile(gl, FS_UP), final: compile(gl, FS_FINAL), yuv: compile(gl, FS_YUV), rgba: compile(gl, FS_RGBA),
    };
    this.allocate(w, h);
  }

  /** another size: new textures, same programs (no shader compiled again) */
  resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.release();
    this.allocate(w, h);
  }

  private allocate(w: number, h: number) {
    if (w % 8 || h % 2) throw new Error(`size ${w}x${h}: the width must be a multiple of 8 and the height even`);
    const gl = this.gl;
    this.w = w; this.h = h;
    this.bloom = [];
    this.srcTex = this.tex(w, h, gl.RGBA8);
    this.hudTex = this.tex(w, h, gl.RGBA8);
    this.accum = this.fbo(w, h);
    let bw = w, bh = h;
    for (let i = 0; i < 6; i++) { bw = Math.max(1, Math.round(bw / 2)); bh = Math.max(1, Math.round(bh / 2)); this.bloom.push(this.fbo(bw, bh)); }
    this.finalFbo = this.fbo(w, h); // float: no 8-bit rounding before packing
    this.yuv = this.fbo(w / 4, (h * 3) / 2, gl.RGBA8);
    this.rgba = this.fbo(w, h, gl.RGBA8);
  }

  private release() {
    const gl = this.gl;
    for (const t of [this.accum, ...this.bloom, this.finalFbo, this.yuv, this.rgba]) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); }
    gl.deleteTexture(this.srcTex); gl.deleteTexture(this.hudTex);
  }

  /** free the GPU resources */
  dispose() {
    const gl = this.gl;
    this.release();
    for (const p of Object.values(this.p)) gl.deleteProgram(p);
    gl.deleteVertexArray(this.vao);
  }

  private tex(w: number, h: number, internal: number): WebGLTexture {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  private fbo(w: number, h: number, internal: number = this.gl.RGBA16F): Target {
    const gl = this.gl, tex = this.tex(w, h, internal), fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex, w, h };
  }
  private upload(tex: WebGLTexture, src: TexImageSource, premultiply: boolean) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }
  private target(t: Target | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    gl.viewport(0, 0, t ? t.w : this.w, t ? t.h : this.h);
  }
  private bindTex(unit: number, tex: WebGLTexture) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); }
  private draw() { const gl = this.gl; gl.bindVertexArray(this.vao); gl.drawArrays(gl.TRIANGLES, 0, 3); }

  begin() {
    const gl = this.gl;
    this.target(this.accum);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** add one sub-frame (a 2D canvas, transparent where empty) with weight w */
  add(src: TexImageSource, w: number) {
    const gl = this.gl, p = this.p.accum;
    this.upload(this.srcTex, src, true);
    this.target(this.accum);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(p); this.bindTex(0, this.srcTex);
    gl.uniform1i(p.u('uTex'), 0); gl.uniform1f(p.u('uW'), w);
    this.draw();
    gl.disable(gl.BLEND);
  }

  /** compose the accumulated frame: to the canvas (toFbo false, dithered) or to the float target for reading */
  finish(fx: Finish, look: Look, seed: number, { hud = null as TexImageSource | null, toFbo = false } = {}) {
    const gl = this.gl, bl = this.bloom;
    if (fx.bloom > 0) {
      let p = this.p.prefilter;
      gl.useProgram(p); this.target(bl[0]); this.bindTex(0, this.accum.tex);
      gl.uniform1i(p.u('uTex'), 0);
      gl.uniform2f(p.u('uTexel'), 1 / this.w, 1 / this.h);
      gl.uniform1f(p.u('uThresh'), fx.bloomThreshold); gl.uniform1f(p.u('uKnee'), 0.25);
      this.draw();
      p = this.p.down; gl.useProgram(p); gl.uniform1i(p.u('uTex'), 0);
      for (let i = 1; i < bl.length; i++) {
        this.target(bl[i]); this.bindTex(0, bl[i - 1].tex);
        gl.uniform2f(p.u('uTexel'), 1 / bl[i - 1].w, 1 / bl[i - 1].h);
        this.draw();
      }
      p = this.p.up; gl.useProgram(p); gl.uniform1i(p.u('uTex'), 0);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = bl.length - 1; i > 0; i--) {
        this.target(bl[i - 1]); this.bindTex(0, bl[i].tex);
        gl.uniform2f(p.u('uTexel'), 0.5 / bl[i].w, 0.5 / bl[i].h);
        this.draw();
      }
      gl.disable(gl.BLEND);
    }
    if (hud) this.upload(this.hudTex, hud, false);
    const p = this.p.final; gl.useProgram(p); this.target(toFbo ? this.finalFbo : null);
    this.bindTex(0, this.accum.tex); this.bindTex(1, bl[0].tex); this.bindTex(2, this.hudTex);
    gl.uniform1i(p.u('uScene'), 0); gl.uniform1i(p.u('uBloom'), 1); gl.uniform1i(p.u('uHud'), 2);
    gl.uniform2f(p.u('uRes'), this.w, this.h);
    gl.uniform3fv(p.u('uBg'), look.bg || [0, 0, 0]);
    gl.uniform1f(p.u('uBgOn'), look.bg ? 1 : 0);
    gl.uniform1f(p.u('uBloomStr'), fx.bloom);
    gl.uniform1f(p.u('uVignette'), look.bg ? fx.vignette : 0);
    gl.uniform1f(p.u('uGrain'), fx.grain);
    gl.uniform1f(p.u('uSeed'), seed);
    gl.uniform1f(p.u('uExposure'), fx.exposure);
    gl.uniform1f(p.u('uHudOn'), hud ? 1 : 0);
    gl.uniform1f(p.u('uChecker'), look.checker && !toFbo ? 1 : 0);
    gl.uniform1f(p.u('uDither'), toFbo ? 0 : 1);
    this.draw();
  }

  /** YUV 4:2:0 bytes (w*h*1.5) of the last finish(..., { toFbo: true }) */
  readYUV(buf: Uint8Array, seed = 0) {
    const gl = this.gl, p = this.p.yuv;
    gl.useProgram(p); this.target(this.yuv); this.bindTex(0, this.finalFbo.tex);
    gl.uniform1i(p.u('uImg'), 0); gl.uniform1f(p.u('uSeed'), seed % 997); gl.uniform2i(p.u('uSize'), this.w, this.h);
    this.draw();
    gl.readPixels(0, 0, this.yuv.w, this.yuv.h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  }

  /** straight RGBA bytes (w*h*4), top row first, of the last finish(..., { toFbo: true }) */
  readRGBA(buf: Uint8Array, seed = 0) {
    const gl = this.gl, p = this.p.rgba;
    gl.useProgram(p); this.target(this.rgba); this.bindTex(0, this.finalFbo.tex);
    gl.uniform1i(p.u('uImg'), 0); gl.uniform1f(p.u('uSeed'), seed % 997); gl.uniform2i(p.u('uSize'), this.w, this.h);
    this.draw();
    gl.readPixels(0, 0, this.w, this.h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  }
}
