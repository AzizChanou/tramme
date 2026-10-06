import { afterEach, describe, expect, it, vi } from 'vitest';
import { askOver, answerOver, type Asked } from '../src/vault/channel.ts';
import { upstream } from '../src/vault/upstream.ts';

/** the editor's side and the vault's, joined as the two windows are: the request goes over, its port with it */
const joined = (handle: (req: Request) => Promise<Response>) =>
  (asked: Asked, transfer: Transferable[]) => { answerOver(transfer[0] as MessagePort, asked, handle); };

describe('the channel between the editor and the key vault', () => {
  it('carries the request (method, headers, body) and streams the answer back', async () => {
    let seen: { method: string; path: string; type: string | null; body: string } | null = null;
    const post = joined(async (req) => {
      seen = { method: req.method, path: new URL(req.url).pathname, type: req.headers.get('content-type'), body: await req.text() };
      const parts = ['data: one\n\n', 'data: two\n\n'];
      return new Response(new ReadableStream({ pull(c) { const p = parts.shift(); if (p) c.enqueue(new TextEncoder().encode(p)); else c.close(); } }), { status: 201, headers: { 'x-tramme-model': 'm1' } });
    });
    const res = await askOver(post, '/api/claude/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
    expect(seen).toEqual({ method: 'POST', path: '/api/claude/v1/messages', type: 'application/json', body: '{"a":1}' });
    expect(res.status).toBe(201);
    expect(res.headers.get('x-tramme-model')).toBe('m1');
    expect(await res.text()).toBe('data: one\n\ndata: two\n\n');
  });

  it('a failure on the vault\'s side rejects the request', async () => {
    const post = joined(async () => { throw new Error('the vault broke'); });
    await expect(askOver(post, '/api/models')).rejects.toThrow('the vault broke');
  });

  it('aborting stops the request on the vault\'s side too', async () => {
    let stopped: Promise<void> | null = null;
    const post = joined(async (req) => {
      stopped = new Promise((resolve) => req.signal.addEventListener('abort', () => resolve()));
      // an answer that never ends, as a long stream would
      return new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([1])); } }));
    });
    const ask = new AbortController();
    const res = await askOver(post, '/api/llm/openai/chat/completions', { method: 'POST', body: '{}', signal: ask.signal });
    const reader = res.body!.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([1]));
    ask.abort();
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
    await stopped;
  });
});

describe('how the vault reaches a provider', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = () => {
    const calls: { url: string; headers: Headers }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { calls.push({ url, headers: new Headers(init.headers) }); return new Response('{}'); });
    return calls;
  };

  it('straight to the providers that take calls from a page, Anthropic told the page holds the key', async () => {
    const calls = stub();
    await upstream('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': 'k' }, body: '{}' });
    await upstream('https://api.openai.com/v1/models', { headers: { authorization: 'Bearer k' } });
    expect(calls.map((c) => c.url)).toEqual(['https://api.anthropic.com/v1/messages', 'https://api.openai.com/v1/models']);
    expect(calls[0].headers.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(calls[1].headers.has('anthropic-dangerous-direct-browser-access')).toBe(false);
  });

  it('through the relay for the others, the address in a header', async () => {
    const calls = stub();
    await upstream('https://api.z.ai/api/paas/v4/chat/completions', { method: 'POST', headers: { authorization: 'Bearer z' }, body: '{}' });
    await upstream('https://api.deepseek.com/v1/chat/completions', { method: 'POST', body: '{}' });
    expect(calls.map((c) => c.url)).toEqual(['/relay', '/relay']);
    expect(calls[0].headers.get('x-tramme-target')).toBe('https://api.z.ai/api/paas/v4/chat/completions');
    expect(calls[0].headers.get('authorization')).toBe('Bearer z');
    expect(calls[1].headers.get('x-tramme-target')).toBe('https://api.deepseek.com/v1/chat/completions');
  });
});
