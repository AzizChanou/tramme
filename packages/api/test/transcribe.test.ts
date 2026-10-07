import { afterEach, describe, expect, it, vi } from 'vitest';
import { transcribe } from '../src/transcribe.ts';
import type { Keys } from '../src/keys.ts';

const keys = (have = true): Keys => ({
  get: (p) => (have && p === 'openai' ? 'sk-test' : undefined),
  how: () => 'connect it in Settings, Providers',
  custom: () => undefined,
  status: () => ({ providers: {} as never, custom: [] }),
});

const out = (input: string, init?: RequestInit) => fetch(input, init);
const WAV = Buffer.from('RIFF....WAVEfmt ').toString('base64');

function stubFetch(answer: Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal('fetch', (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(answer);
  });
  return calls;
}

const ask = (body: unknown, have = true) => transcribe(new Request('http://localhost/api/transcribe', { method: 'POST', body: JSON.stringify(body) }), { keys: keys(have), fetch: out });

afterEach(() => vi.unstubAllGlobals());

describe('transcribe', () => {
  it('refuses without a key, without audio, or with audio that is not base64', async () => {
    await expect(ask({ audio: WAV }, false)).rejects.toMatchObject({ status: 503, message: /no OpenAI key/ });
    await expect(ask({})).rejects.toMatchObject({ status: 400 });
    await expect(ask({ audio: 'not base64 !' })).rejects.toMatchObject({ status: 400 });
    await expect(ask({ audio: 'A'.repeat(8 * 1024 * 1024 + 4) })).rejects.toMatchObject({ status: 413 });
  });

  it('sends the chunk to Whisper and answers its words in the shape of the server', async () => {
    const calls = stubFetch(Response.json({ text: 'hello there', language: 'english', duration: 1.2, words: [{ word: ' hello', start: 0.1, end: 0.5 }, { word: 'there', start: 0.6, end: 1 }, { word: ' ', start: 1, end: 1 }] }));
    const res = await ask({ audio: WAV, language: 'en' });
    expect(calls[0].url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(new Headers(calls[0].init?.headers).get('authorization')).toBe('Bearer sk-test');
    const form = calls[0].init?.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.get('timestamp_granularities[]')).toBe('word');
    expect(form.get('language')).toBe('en');
    expect((form.get('file') as Blob).size).toBe(16);
    expect(await res.json()).toEqual({ words: [{ w: 'hello', s: 0.1, e: 0.5 }, { w: 'there', s: 0.6, e: 1 }], text: 'hello there', language: 'english', duration: 1.2 });
  });

  it('the language Whisper named is not sent back: it takes only codes', async () => {
    const calls = stubFetch(Response.json({ words: [] }));
    await ask({ audio: WAV, language: 'english' });
    expect((calls[0].init?.body as FormData).has('language')).toBe(false);
  });

  it('a refusal is read and named', async () => {
    stubFetch(new Response(JSON.stringify({ error: { message: 'invalid file format' } }), { status: 400, headers: { 'content-type': 'application/json' } }));
    await expect(ask({ audio: WAV })).rejects.toMatchObject({ status: 400, message: 'openai: invalid file format' });
  });
});
