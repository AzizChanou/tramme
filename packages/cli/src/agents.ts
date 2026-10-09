// The engines the companion runs a turn with, each on the user's own login:
// Claude (the Agent SDK, the Claude Code login), Codex (the Codex CLI, a
// ChatGPT login) and Gemini (the Gemini CLI, a Google login). Whatever the
// engine, the editor sees the same events (text, thinking, tool calls, errors)
// and runs the same tools: Claude gets them in process, the two command lines
// reach them as an MCP server the companion serves for the turn. Each engine
// gets tramme's tools and nothing else: no shell, no files, no web.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';
import spawn from 'cross-spawn';
import { createSdkMcpServer, query, tool, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ADAPTIVE, DEFAULT_EFFORT, EFFORTS, ENGINES, MODELS, TOOLS, type Effort, type Engine, type ToolResult } from '@tramme/assistant';

type Out = Record<string, unknown>;

/** one turn, whatever the engine: how it talks to the editor and how it stops */
export interface Turn {
  send: (ev: Out) => void;
  /** tool calls waiting for the editor's result */
  pending: Map<string, (r: ToolResult) => void>;
  abort: AbortController;
  /** the key of this turn's MCP address (the command lines reach the tools through it) */
  key: string;
  /** stops the engine (the Agent SDK's query, a command line's process) */
  stop: () => void;
}

export interface TurnRequest {
  prompt: string;
  system: string;
  /** the engine's model; empty: its own default */
  model: string;
  effort?: string;
  sessionId?: string;
  images: { mediaType: string; data: string }[];
  /** where the command lines reach tramme's tools this turn */
  mcpUrl: string;
}

const TOOL_TIMEOUT = 15 * 60_000;
/** where the command lines run: a folder of their own, so their sessions are found again (Gemini keeps them per folder) */
const WORKDIR = path.join(os.homedir(), '.tramme', 'engines');

/** a tool call handed to the editor, which runs it and posts the result back */
export async function callEditor(t: Turn, name: string, input: unknown): Promise<ToolResult> {
  const callId = crypto.randomUUID();
  t.send({ type: 'tool', callId, name, input });
  return new Promise<ToolResult>((resolve) => {
    const timer = setTimeout(() => { t.pending.delete(callId); resolve({ content: [{ type: 'text', text: 'the editor did not answer' }], isError: true }); }, TOOL_TIMEOUT);
    t.pending.set(callId, (x) => { clearTimeout(timer); resolve(x); });
  });
}

/** a tool's result in MCP's words (both SDKs take this shape) */
const asMcp = (r: ToolResult) => ({
  content: r.content.map((c) => (c.type === 'image' ? { type: 'image' as const, data: c.data, mimeType: c.mimeType } : { type: 'text' as const, text: c.text })),
  isError: !!r.isError,
});

/** tramme's tools as an MCP server over HTTP, for one request of a command line (stateless: a server per request) */
export async function serveTools(t: Turn, req: http.IncomingMessage, res: http.ServerResponse, body: unknown) {
  const server = new McpServer({ name: 'tramme', version: '1.0.0' });
  for (const def of TOOLS) server.registerTool(def.name, { description: def.description, inputSchema: def.schema.shape }, async (input: unknown) => asMcp(await callEditor(t, def.name, input)));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

// ── which engines this machine has ───────────────────────────

const COMMAND: Record<Exclude<Engine, 'claude'>, string> = { codex: 'codex', gemini: 'gemini' };

/** whether a command line answers, and its version */
function version(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    let out = '';
    let child: ReturnType<typeof spawn>;
    try { child = spawn(command, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }); } catch { resolve(null); return; }
    const timer = setTimeout(() => { kill(child); resolve(null); }, 15_000);
    child.stdout?.on('data', (c: Buffer) => { out += c.toString('utf8'); });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0 ? out.trim().split(/\r?\n/).pop() || '?' : null); });
  });
}

/** the engines installed here (Claude always: the Agent SDK ships with the companion), looked for again at most once a minute */
let found: { at: number; engines: Promise<Record<Engine, string | null>> } | null = null;
export function engines(): Promise<Record<Engine, string | null>> {
  if (!found || Date.now() - found.at > 60_000) {
    found = {
      at: Date.now(),
      engines: Promise.all([version(COMMAND.codex), version(COMMAND.gemini)]).then(([codex, gemini]) => ({ claude: 'agent-sdk', codex, gemini })),
    };
  }
  return found.engines;
}

/** a process and its children stopped (on Windows, the command line runs under cmd.exe) */
function kill(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else child.kill('SIGTERM');
}

// ── Claude: the Agent SDK ────────────────────────────────────

async function runClaude(t: Turn, r: TurnRequest) {
  const model = MODELS.some(([id]) => id === r.model) ? r.model : MODELS[0][0];
  const effort: Effort = EFFORTS.find((e) => e === r.effort) ?? DEFAULT_EFFORT;
  // images joined to the message: one user message of image blocks and the text
  const prompt = r.images.length
    ? (async function* () {
      yield {
        type: 'user' as const,
        parent_tool_use_id: null,
        message: { role: 'user' as const, content: [...r.images.map((i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mediaType as 'image/jpeg', data: i.data } })), { type: 'text' as const, text: r.prompt }] },
      } as SDKUserMessage;
    })()
    : r.prompt;
  const q = query({
    prompt,
    options: {
      model,
      systemPrompt: r.system,
      // only tramme's tools, run by the editor: no files, no shell, no settings, no account connectors
      tools: [],
      mcpServers: {
        tramme: createSdkMcpServer({
          name: 'tramme', version: '1.0.0', alwaysLoad: true,
          tools: TOOLS.map((def) => tool(def.name, def.description, def.schema.shape, async (input: unknown) => asMcp(await callEditor(t, def.name, input)))),
        }),
      },
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
      ...(r.sessionId ? { resume: r.sessionId } : {}),
    },
  });
  t.stop = () => { t.abort.abort(); q.interrupt().catch(() => {}); };
  let message = 0;
  const thinking = new Set<string>();
  for await (const m of q as AsyncIterable<SDKMessage>) {
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
}

// ── the command lines: Codex and Gemini ──────────────────────

/** a fresh folder for the turn's files (system prompt, settings, images), removed after it */
function turnFolder(engine: string): string {
  const dir = path.join(WORKDIR, engine, 'turns', crypto.randomUUID());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** the images joined to the message, as files */
function writeImages(dir: string, images: TurnRequest['images']): string[] {
  return images.slice(0, 20).map((img, i) => {
    const file = path.join(dir, `image-${i + 1}.${img.mediaType === 'image/png' ? 'png' : 'jpg'}`);
    fs.writeFileSync(file, Buffer.from(img.data, 'base64'));
    return file;
  });
}

/**
 * Runs a command line: the prompt on its standard input, its JSON lines read
 * as they come. Its last error lines say what went wrong when it fails (not
 * logged in, unknown model).
 */
function runLines(t: Turn, command: string, args: string[], opts: { cwd: string; env?: Record<string, string>; input: string; onLine: (j: any) => void }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    t.stop = () => { t.abort.abort(); kill(child); };
    let buf = '', errors = '';
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        try { opts.onLine(JSON.parse(line)); } catch { /* a line that is not an event */ }
      }
    });
    child.stderr!.on('data', (c: Buffer) => { errors = (errors + c.toString('utf8')).slice(-4000); });
    child.on('error', (e) => reject(new Error(`${command}: ${e.message}`)));
    child.on('close', (code) => {
      if (t.abort.signal.aborted || code === 0) resolve();
      else reject(new Error(errors.trim().split(/\r?\n/).filter(Boolean).slice(-6).join('\n') || `${command} stopped (code ${code})`));
    });
    child.stdin!.end(opts.input);
  });
}

/** a TOML string for a -c value (Windows paths keep their backslashes) */
const toml = (s: string) => `'${s.replace(/'/g, '')}'`;

async function runCodex(t: Turn, r: TurnRequest) {
  const dir = turnFolder('codex');
  try {
    const instructions = path.join(dir, 'instructions.md');
    fs.writeFileSync(instructions, r.system);
    const images = writeImages(dir, r.images).flatMap((f) => ['-i', f]);
    const level = EFFORTS.find((e) => e === r.effort);
    const config = [
      // tramme's instructions instead of a coding agent's, tramme's tools instead of the shell and the web
      `model_instructions_file=${toml(instructions)}`,
      'features.shell_tool=false', 'web_search="disabled"', 'approval_policy="never"',
      `mcp_servers.tramme.url=${toml(r.mcpUrl)}`, 'mcp_servers.tramme.tool_timeout_sec=900', 'mcp_servers.tramme.default_tools_approval_mode="approve"',
      'model_reasoning_summary="auto"',
      ...(level ? [`model_reasoning_effort="${level}"`] : []),
    ].flatMap((c) => ['-c', c]);
    const common = ['--json', '--skip-git-repo-check', '--ignore-user-config', '-s', 'read-only', '-C', path.join(WORKDIR, 'codex'), ...(r.model ? ['-m', r.model] : [])];
    // images first: -i takes every value up to the next option
    const args = r.sessionId
      ? ['exec', ...common, 'resume', r.sessionId, ...images, ...config, '-']
      : ['exec', ...images, ...common, ...config, '-'];
    let n = 0;
    await runLines(t, 'codex', args, {
      cwd: path.join(WORKDIR, 'codex'), input: r.prompt,
      onLine: (ev) => {
        if (ev.type === 'thread.started' && ev.thread_id) t.send({ type: 'session', id: ev.thread_id, model: r.model || 'codex' });
        else if (ev.type === 'item.completed' && ev.item) {
          const kind = ev.item.type ?? ev.item.item_type, text = String(ev.item.text ?? '');
          const key = `codex:${++n}`;
          if ((kind === 'agent_message' || kind === 'assistant_message') && text) t.send({ type: 'text-start', key, text });
          else if (kind === 'reasoning' && text) { t.send({ type: 'thinking-start', key }); t.send({ type: 'thinking', key, delta: text }); t.send({ type: 'thinking-stop', key }); }
          else if (kind === 'error' && ev.item.message) t.send({ type: 'error', message: String(ev.item.message) });
        } else if (ev.type === 'turn.failed') t.send({ type: 'error', message: String(ev.error?.message ?? 'Codex stopped') });
        else if (ev.type === 'error' && ev.message) t.send({ type: 'error', message: String(ev.message) });
      },
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

async function runGemini(t: Turn, r: TurnRequest) {
  const dir = turnFolder('gemini');
  const home = path.join(WORKDIR, 'gemini');
  try {
    const system = path.join(dir, 'system.md');
    fs.writeFileSync(system, r.system);
    // the turn's settings, those of its folder (a settings file elsewhere is refused when the user can write to it):
    // the allowlist holds tramme's tools only (named mcp_tramme_<tool>): no built-in tool (shell, files, web) is registered, every
    // other call is denied, and tramme's are allowed without asking; --allowed-mcp-server-names leaves out the user's other servers
    fs.mkdirSync(path.join(home, '.gemini'), { recursive: true });
    fs.writeFileSync(path.join(home, '.gemini', 'settings.json'), JSON.stringify({ tools: { core: ['mcp_tramme_*'] }, mcpServers: { tramme: { httpUrl: r.mcpUrl, trust: true, timeout: TOOL_TIMEOUT } } }, null, 2));
    // images: files of its folder, named in the prompt (@file)
    const images = writeImages(dir, r.images).map((f) => `@${path.relative(home, f).split(path.sep).join('/')}`);
    const session = r.sessionId ?? crypto.randomUUID();
    const args = ['-p', '', '-o', 'stream-json', '--allowed-mcp-server-names', 'tramme',
      ...(r.sessionId ? ['--resume', r.sessionId] : ['--session-id', session]), ...(r.model ? ['-m', r.model] : [])];
    let n = 0, open = '';
    await runLines(t, 'gemini', args, {
      cwd: home, input: images.length ? `${images.join(' ')}\n\n${r.prompt}` : r.prompt,
      // its folder trusted from the start, so its settings apply (--skip-trust comes after they are read)
      env: { GEMINI_SYSTEM_MD: system, GEMINI_CLI_TRUST_WORKSPACE: 'true' },
      onLine: (ev) => {
        if (ev.type === 'init') t.send({ type: 'session', id: ev.session_id ?? session, model: ev.model ?? (r.model || 'gemini') });
        else if (ev.type === 'message' && ev.role === 'assistant' && ev.content) {
          // the answer comes in pieces; a tool call between two pieces starts another message
          if (!open) { open = `gemini:${++n}`; t.send({ type: 'text-start', key: open, text: String(ev.content) }); }
          else t.send({ type: 'text', key: open, delta: String(ev.content) });
        } else if (ev.type === 'tool_use') open = '';
        else if (ev.type === 'error') t.send({ type: 'error', message: String(ev.message ?? ev.error?.message ?? 'Gemini stopped') });
        else if (ev.type === 'result' && ev.status === 'error') t.send({ type: 'error', message: String(ev.error?.message ?? 'Gemini stopped') });
      },
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const RUN: Record<Engine, (t: Turn, r: TurnRequest) => Promise<void>> = { claude: runClaude, codex: runCodex, gemini: runGemini };

/** a turn with the engine asked; the editor reads its events as they come */
export async function runEngine(engine: Engine, t: Turn, r: TurnRequest) {
  if (!ENGINES.includes(engine)) throw new Error(`unknown engine: ${engine}`);
  if (engine !== 'claude' && !(await engines())[engine]) throw new Error(`${COMMAND[engine]} is not installed on this computer (or not on its PATH)`);
  fs.mkdirSync(path.join(WORKDIR, engine), { recursive: true });
  await RUN[engine](t, r);
}
