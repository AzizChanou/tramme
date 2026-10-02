// The local companion: `tramme agent` runs Claude with the Agent SDK on this
// machine (the Claude Code login, no API key) for the editor open in the
// browser, deployed or local. The editor sends the user's message; Claude's
// tool calls come back to the editor, which runs them (document, renderer,
// project files) and posts the results. Nothing here touches the project.
//
// Listening on 127.0.0.1 only. Every request carries the pairing token shown
// at startup; pages of other origins than the allowed ones are refused. A page
// of an origin named with --origin (the editor `npm run dev` serves, a deployed
// editor) receives the token by itself (/pair); any other local page has to be
// given it by hand.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createSdkMcpServer, query, tool, type Query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { ADAPTIVE, COMPANION_PORT, DEFAULT_EFFORT, EFFORTS, MODELS, TOOLS, type Effort, type ToolResult } from '@tramme/assistant';

const CONFIG = path.join(os.homedir(), '.tramme', 'companion.json');
/** the pairing kept under the tool's former name: still valid, so the editor stays paired */
const LEGACY_CONFIGS = ['.trame', '.emotion'].map((d) => path.join(os.homedir(), d, 'companion.json'));
const TOOL_TIMEOUT = 15 * 60_000;

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

type Out = Record<string, unknown>;

interface Turn {
  send: (ev: Out) => void;
  pending: Map<string, (r: ToolResult) => void>;
  abort: AbortController;
  query: Query | null;
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

  function tools(t: Turn) {
    return createSdkMcpServer({
      name: 'tramme',
      version: '1.0.0',
      alwaysLoad: true,
      tools: TOOLS.map((def) => tool(def.name, def.description, def.schema.shape, async (input: unknown) => {
        const callId = crypto.randomUUID();
        t.send({ type: 'tool', callId, name: def.name, input });
        const r = await new Promise<ToolResult>((resolve) => {
          const timer = setTimeout(() => { t.pending.delete(callId); resolve({ content: [{ type: 'text', text: 'the editor did not answer' }], isError: true }); }, TOOL_TIMEOUT);
          t.pending.set(callId, (x) => { clearTimeout(timer); resolve(x); });
        });
        return {
          content: r.content.map((c) => (c.type === 'image' ? { type: 'image' as const, data: c.data, mimeType: c.mimeType } : { type: 'text' as const, text: c.text })),
          isError: !!r.isError,
        };
      })),
    });
  }

  async function runTurn(body: { prompt?: string; system?: string; model?: string; effort?: string; sessionId?: string; images?: { mediaType: string; data: string }[] }, res: http.ServerResponse) {
    if (typeof body.prompt !== 'string' || typeof body.system !== 'string') throw new Error('prompt and system expected');
    const model = MODELS.some(([id]) => id === body.model) ? body.model! : MODELS[0][0];
    const effort: Effort = EFFORTS.find((e) => e === body.effort) ?? DEFAULT_EFFORT;
    // one conversation at a time: a new message stops the previous one
    if (turn) { turn.abort.abort(); turn.query?.interrupt().catch(() => {}); }
    res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
    const t: Turn = { send: (ev) => { if (!res.writableEnded) res.write(JSON.stringify(ev) + '\n'); }, pending: new Map(), abort: new AbortController(), query: null };
    turn = t;
    res.on('close', () => { if (!res.writableFinished) { t.abort.abort(); t.query?.interrupt().catch(() => {}); } });
    let message = 0;
    const thinking = new Set<string>();
    try {
      // images joined to the message: one user message of image blocks and the text
      const images = Array.isArray(body.images) ? body.images.slice(0, 20) : [];
      const prompt = images.length
        ? (async function* () {
          yield {
            type: 'user' as const,
            parent_tool_use_id: null,
            message: { role: 'user' as const, content: [...images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType as 'image/jpeg', data: i.data } })), { type: 'text' as const, text: body.prompt! }] },
          } as SDKUserMessage;
        })()
        : body.prompt;
      t.query = query({
        prompt,
        options: {
          model,
          systemPrompt: body.system,
          // only tramme's tools, run by the editor: no files, no shell, no settings, no account connectors
          tools: [],
          mcpServers: { tramme: tools(t) },
          strictMcpConfig: true,
          settingSources: [],
          canUseTool: async (name: string, input: Record<string, unknown>) => (name.startsWith('mcp__tramme__')
            ? { behavior: 'allow' as const, updatedInput: input }
            : { behavior: 'deny' as const, message: `Tool ${name} is not available in tramme.` }),
          // thinking shown to the user as it goes (summarized)
          ...(ADAPTIVE.has(model) ? { thinking: { type: 'adaptive' as const, display: 'summarized' as const }, effort } : {}),
          includePartialMessages: true,
          abortController: t.abort,
          cwd: os.tmpdir(),
          ...(body.sessionId ? { resume: body.sessionId } : {}),
        },
      });
      for await (const m of t.query as AsyncIterable<SDKMessage>) {
        const msg = m as any;
        if (msg.type === 'system' && msg.subtype === 'init') t.send({ type: 'session', id: msg.session_id, model });
        else if (msg.parent_tool_use_id) continue;
        else if (msg.type === 'stream_event') {
          const ev = msg.event;
          if (ev.type === 'message_start') message++;
          const key = `${message}:${ev.index}`;
          if (ev.type === 'content_block_start' && ev.content_block?.type === 'text') t.send({ type: 'text-start', key, text: ev.content_block.text ?? '' });
          else if (ev.type === 'content_block_start' && /thinking/.test(ev.content_block?.type ?? '')) { thinking.add(key); t.send({ type: 'thinking-start', key }); }
          else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') t.send({ type: 'text', key, delta: ev.delta.text });
          else if (ev.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') t.send({ type: 'thinking', key, delta: ev.delta.thinking });
          else if (ev.type === 'content_block_stop' && thinking.delete(key)) t.send({ type: 'thinking-stop', key });
        } else if (msg.type === 'result' && msg.subtype !== 'success') {
          t.send({ type: 'error', message: (msg.errors ?? []).join('\n') || `Claude stopped (${msg.subtype})` });
        }
      }
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
        'access-control-allow-methods': 'GET, POST',
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
    if (!authOk(req.headers.authorization)) { json(401, { error: 'invalid companion token' }); return; }
    try {
      if (req.method === 'GET' && url.pathname === '/health') json(200, { ok: true, app: 'tramme-companion', version: 1, models: MODELS });
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
        if (turn) { turn.abort.abort(); turn.query?.interrupt().catch(() => {}); }
        json(200, { ok: true });
      } else json(404, { error: 'unknown route' });
    } catch (e) {
      if (!res.headersSent) json(400, { error: (e as Error).message });
      else res.end();
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve()); });
  console.log(`tramme companion ready on http://127.0.0.1:${port}`);
  if (origins.size) console.log(`automatic pairing for: ${[...origins].join(', ')}`);
  console.log(`pairing token: ${secret}`);
  console.log(`(for another local page: paste it once in the editor, Assistant panel)`);
}
