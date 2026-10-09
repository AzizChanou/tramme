import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { TOOLS } from '@tramme/assistant';
import { serveTools, type Turn } from '../src/agents.ts';

// the tools as the command lines (Codex, Gemini CLI) reach them: an MCP server
// whose calls go to the editor (here a stand-in that answers at once)
describe('the tools served to the command lines', () => {
  const sent: Record<string, unknown>[] = [];
  const turn: Turn = {
    send: (ev) => {
      sent.push(ev);
      if (ev.type === 'tool') setTimeout(() => turn.pending.get(String(ev.callId))?.({ content: [{ type: 'text', text: `ran ${ev.name}` }, { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }] }), 5);
    },
    pending: new Map(), abort: new AbortController(), key: 'k', stop: () => {},
  };
  let server: http.Server, url = '';
  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const text = Buffer.concat(chunks).toString('utf8');
      await serveTools(turn, req, res, text ? JSON.parse(text) : undefined);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp/k`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('lists every tool of the assistant and relays a call to the editor and back', async () => {
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    expect(tools.find((t) => t.name === 'render_still')?.inputSchema.required).toContain('t');
    const r = await client.callTool({ name: 'get_document', arguments: { path: '/tokens' } });
    expect(r.content).toEqual([{ type: 'text', text: 'ran get_document' }, { type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }]);
    expect(sent.find((e) => e.type === 'tool')).toMatchObject({ name: 'get_document', input: { path: '/tokens' } });
    await client.close();
  });
});
