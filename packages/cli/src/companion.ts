// The local companion: `tramme agent` runs the agents installed on this
// machine, each on the user's own login and without an API key, for the
// editor open in the browser, deployed or local: Claude (the Agent SDK, the
// Claude Code login), Codex (a ChatGPT login) or the Gemini CLI (a Google
// login), see agents.ts. The editor sends the user's message; the agent's tool
// calls come back to the editor, which runs them (document, renderer, project
// files) and posts the results. Nothing here touches the project.
//
// Listening on 127.0.0.1 only. Every request carries the pairing token shown
// at startup; pages of other origins than the allowed ones are refused. A page
// of an origin named with --origin (the editor `npm run dev` serves, a deployed
// editor) receives the token by itself (/pair); any other local page has to be
// given it by hand. The command lines reach tramme's tools at /mcp/<key>, an
// address that only holds for the turn running.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { COMPANION_PORT, ENGINES, MODELS, type Engine, type ToolResult } from '@tramme/assistant';
import { engines, runEngine, serveTools, type Turn } from './agents.ts';

const CONFIG = path.join(os.homedir(), '.tramme', 'companion.json');
/** the pairing kept under the tool's former name: still valid, so the editor stays paired */
const LEGACY_CONFIGS = ['.trame', '.emotion'].map((d) => path.join(os.homedir(), d, 'companion.json'));

/** the pairing token, kept between runs so the editor stays paired */
function token(renew: boolean): string {
  try {
    if (!renew) {
      const file = [CONFIG, ...LEGACY_CONFIGS].find((f) => fs.existsSync(f)) ?? CONFIG;
      const t = JSON.parse(fs.readFileSync(file, 'utf8')).token;
      if (typeof t === 'string' && t.length >= 32) {
        if (file !== CONFIG) { fs.mkdirSync(path.dirname(CONFIG), { recursive: true }); fs.writeFileSync(CONFIG, JSON.stringify({ token: t }, null, 2) + '\n', { mode: 0o600 }); }
        return t;
      }
    }
  } catch { /* first run */ }
  const t = crypto.randomBytes(24).toString('hex');
  fs.mkdirSync(path.dirname(CONFIG), { recursive: true });
  fs.writeFileSync(CONFIG, JSON.stringify({ token: t }, null, 2) + '\n', { mode: 0o600 });
  return t;
}

export async function startCompanion(opts: { port?: number; origins?: string[]; renew?: boolean } = {}) {
  const port = opts.port ?? COMPANION_PORT;
  const secret = token(!!opts.renew);
  const origins = new Set((opts.origins ?? []).map((o) => o.replace(/\/+$/, '')));
  const originOk = (o: string | undefined) => !o || origins.has(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
  const paired = new Set<string>();
  const hostOk = (h: string | undefined) => !!h && (h === `127.0.0.1:${port}` || h === `localhost:${port}`);
  const authOk = (h: string | undefined) => {
    const given = Buffer.from(String(h ?? '').replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(secret);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
  };
  let turn: Turn | null = null;

  const readJson = (req: http.IncomingMessage) => new Promise<any>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > 20 * 1024 * 1024) { reject(new Error('request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('unreadable JSON')); } });
    req.on('error', reject);
  });

  /** stops the turn running, if any */
  const stopTurn = () => { turn?.stop(); };

  async function runTurn(body: { engine?: string; prompt?: string; system?: string; model?: string; effort?: string; sessionId?: string; images?: { mediaType: string; data: string }[] }, res: http.ServerResponse) {
    if (typeof body.prompt !== 'string' || typeof body.system !== 'string') throw new Error('prompt and system expected');
    const engine: Engine = ENGINES.find((e) => e === body.engine) ?? 'claude';
    // one conversation at a time: a new message stops the previous one
    stopTurn();
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
    const t: Turn = {
      send: (ev) => { if (!res.writableEnded) res.write(JSON.stringify(ev) + '\n'); },
      pending: new Map(), abort: new AbortController(), key: crypto.randomBytes(24).toString('hex'),
      stop: () => t.abort.abort(),
    };
    turn = t;
    res.on('close', () => { if (!res.writableFinished) t.stop(); });
    try {
      await runEngine(engine, t, {
        prompt: body.prompt, system: body.system, model: typeof body.model === 'string' ? body.model : '', effort: body.effort, sessionId: body.sessionId,
        images: Array.isArray(body.images) ? body.images.slice(0, 20) : [],
        mcpUrl: `http://127.0.0.1:${port}/mcp/${t.key}`,
      });
    } catch (e) {
      if (!t.abort.signal.aborted) t.send({ type: 'error', message: (e as Error).message });
    } finally {
      if (turn === t) turn = null;
      t.send({ type: 'done' });
      res.end();
    }
  }

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (!hostOk(req.headers.host) || !originOk(origin)) { res.writeHead(403).end(); return; }
    if (origin) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-methods': 'GET, POST, DELETE',
        'access-control-allow-headers': 'authorization, content-type',
        // a page served from the internet calling this machine (Chrome's private network access)
        'access-control-allow-private-network': 'true',
        'access-control-max-age': '600',
      }).end();
      return;
    }
    const json = (status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(data)); };
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    // pairing without copying the token: only for the origins named at startup
    if (req.method === 'GET' && url.pathname === '/pair') {
      const o = origin?.replace(/\/+$/, '');
      if (!o || !origins.has(o)) { json(403, { error: 'manual pairing: paste the token shown by the companion' }); return; }
      if (!paired.has(o)) { paired.add(o); console.log(`editor paired: ${o}`); }
      json(200, { token: secret });
      return;
    }
    // a command line reaching tramme's tools: only with the key of the turn running
    const mcp = /^\/mcp\/([a-f0-9]{48})$/.exec(url.pathname);
    if (mcp) {
      const key = Buffer.from(mcp[1]), want = Buffer.from(turn?.key ?? '');
      if (!turn || key.length !== want.length || !crypto.timingSafeEqual(key, want)) { json(404, { error: 'no turn running at this address' }); return; }
      try { await serveTools(turn, req, res, req.method === 'POST' ? await readJson(req) : undefined); } catch (e) { if (!res.headersSent) json(400, { error: (e as Error).message }); else res.end(); }
      return;
    }
    if (!authOk(req.headers.authorization)) { json(401, { error: 'invalid companion token' }); return; }
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        // the agents this computer has (each with its version), for the editor's model menu
        const found = await engines();
        json(200, { ok: true, app: 'tramme-companion', version: 2, models: MODELS, engines: Object.fromEntries(ENGINES.map((e) => [e, !!found[e]])), versions: found });
      }
      else if (req.method === 'POST' && url.pathname === '/turn') await runTurn(await readJson(req), res);
      else if (req.method === 'POST' && url.pathname === '/tool-result') {
        const b = await readJson(req) as { callId?: string; result?: ToolResult };
        const done = b.callId ? turn?.pending.get(b.callId) : undefined;
        if (!done || !b.result) { json(404, { error: 'unknown or expired tool call' }); return; }
        turn!.pending.delete(b.callId!);
        done(b.result);
        json(200, { ok: true });
      } else if (req.method === 'POST' && url.pathname === '/transcribe') {
        // speech to text on this machine, when the server has none
        const b = await readJson(req) as { audio?: string; language?: string };
        if (typeof b.audio !== 'string') { json(400, { error: 'audio expected (WAV in base64)' }); return; }
        const { transcribeLocal } = await import('./speech.ts');
        json(200, await transcribeLocal(b.audio, b.language));
      } else if (req.method === 'POST' && url.pathname === '/stop') {
        stopTurn();
        json(200, { ok: true });
      } else json(404, { error: 'unknown route' });
    } catch (e) {
      if (!res.headersSent) json(400, { error: (e as Error).message });
      else res.end();
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve()); });
  console.log(`tramme companion ready on http://127.0.0.1:${port}`);
  engines().then((found) => console.log(`agents: Claude${found.codex ? `, Codex ${found.codex}` : ''}${found.gemini ? `, Gemini CLI ${found.gemini}` : ''}`)).catch(() => {});
  if (origins.size) console.log(`automatic pairing for: ${[...origins].join(', ')}`);
  console.log(`pairing token: ${secret}`);
  console.log(`(for another local page: paste it once in the editor, Assistant panel)`);
}
