// Local server for offline rendering and the editor:
//   /__tramme/          the render page and its bundle (esbuild, built on start)
//   /__tramme/ws        WebSocket sink for raw frames
//   /project/            the document's folder
//   mounts               extra folders from tramme.config.json next to the document,
//                        e.g. { "mounts": { "/": "../other-project" } } for code nodes
// Handlers added with use() answer before the static files (the editor's API).
// Byte ranges are served so <audio>/<video> can seek.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { WebSocketServer } from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.wasm': 'application/wasm',
};

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>tramme · render</title>
<style>html,body{margin:0;background:#000}canvas{display:block}</style></head>
<body><canvas id="out"></canvas><script type="module" src="/__tramme/render/page.js"></script></body></html>`;

export interface ProjectConfig { dir: string; mounts: [string, string][] }

/** mounts of tramme.config.json beside the document (paths relative to that file) */
export function readConfig(docFile: string): ProjectConfig {
  const dir = path.dirname(docFile);
  // the former names (trame.config.json, emotion.config.json) are read as well
  const f = ['tramme.config.json', 'trame.config.json', 'emotion.config.json'].map((n) => path.join(dir, n)).find((x) => fs.existsSync(x)) ?? path.join(dir, 'tramme.config.json');
  const mounts: [string, string][] = [['/project/', dir]];
  if (fs.existsSync(f)) {
    const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const [prefix, rel] of Object.entries<string>(cfg.mounts || {})) mounts.push([prefix.endsWith('/') ? prefix : prefix + '/', path.resolve(dir, rel)]);
  }
  // longest prefix first
  mounts.sort((a, b) => b[0].length - a[0].length);
  return { dir, mounts };
}

export type Handler = (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => Promise<boolean> | boolean;

export async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}
export function sendJson(res: http.ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}

export class Server {
  port = 0;
  readonly config: ProjectConfig;
  /** receives each binary WebSocket message; the page waits for the ack before sending the next */
  sink: ((buf: Buffer) => Promise<void> | void) | null = null;
  private http: http.Server;
  private handlers: Handler[] = [];
  private files = new Map<string, { text: string; type: string }>();
  private contexts: esbuild.BuildContext[] = [];

  constructor(config: ProjectConfig) {
    this.config = config;
    this.http = http.createServer((req, res) => this.handle(req, res).catch((e) => {
      console.error(e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String((e as Error).message || e));
    }));
    const wss = new WebSocketServer({ server: this.http, path: '/__tramme/ws', maxPayload: 512 * 1024 * 1024 });
    wss.on('connection', (sock) => {
      let chain = Promise.resolve();
      sock.on('message', (data: Buffer) => {
        chain = chain.then(() => this.sink?.(data)).then(() => sock.send('ok')).catch((e) => console.error(e));
      });
    });
  }

  use(h: Handler) { this.handlers.push(h); return this; }

  /**
   * Bundle an entry with esbuild and serve its outputs under /__tramme/<name>/
   * (main.js, main.css...). watch: rebuild on change (editor development).
   */
  async bundle(name: string, entry: string, { watch = false } = {}) {
    const store = (r: esbuild.BuildResult) => {
      for (const f of r.outputFiles || []) {
        const ext = path.extname(f.path);
        this.files.set(`/__tramme/${name}/${path.basename(f.path)}`, { text: f.text, type: MIME[ext] || 'text/plain' });
      }
    };
    const options: esbuild.BuildOptions = {
      entryPoints: [entry], bundle: true, format: 'esm', platform: 'browser', target: 'chrome120',
      outdir: path.join(HERE, '.out', name), write: false, sourcemap: 'inline', logLevel: 'error',
      jsx: 'automatic', jsxImportSource: 'preact', loader: { '.ttf': 'file', '.woff2': 'file' },
    };
    if (!watch) { store(await esbuild.build(options)); return; }
    const ctx = await esbuild.context({ ...options, plugins: [{ name: 'store', setup: (b) => b.onEnd((r) => { if (!r.errors.length) store(r); }) }] });
    await ctx.rebuild();
    await ctx.watch();
    this.contexts.push(ctx);
  }

  async start(port = 0): Promise<number> {
    await this.bundle('render', path.join(HERE, 'page.ts'));
    await new Promise<void>((resolve, reject) => {
      this.http.once('error', reject);
      this.http.listen(port, '127.0.0.1', () => resolve());
    });
    this.port = (this.http.address() as { port: number }).port;
    return this.port;
  }

  close() {
    for (const c of this.contexts) c.dispose();
    this.http.close();
  }

  /** filesystem path behind a URL path, or null outside every mount */
  resolve(urlPath: string): string | null {
    for (const [prefix, dir] of this.config.mounts) {
      if (urlPath.startsWith(prefix)) {
        const f = path.join(dir, urlPath.slice(prefix.length));
        return f.startsWith(dir) ? f : null;
      }
    }
    return null;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url || '/', 'http://x');
    for (const h of this.handlers) if (await h(req, res, url)) return;
    if (url.pathname === '/__tramme/' || url.pathname === '/__tramme/index.html') {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' }); res.end(PAGE); return;
    }
    if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    const built = this.files.get(url.pathname);
    if (built) { res.writeHead(200, { 'content-type': built.type, 'cache-control': 'no-store' }); res.end(built.text); return; }
    let rel: string;
    try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); res.end(); return; }
    const file = this.resolve(rel);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end(`404 ${rel}`); return;
    }
    serveFile(req, res, file);
  }
}

export function serveFile(req: http.IncomingMessage, res: http.ServerResponse, file: string) {
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const headers = { 'content-type': type, 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
  const size = fs.statSync(file).size;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return; }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res); return;
  }
  res.writeHead(200, { ...headers, 'content-length': size });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(file).pipe(res);
}
