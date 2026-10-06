import { describe, expect, it } from 'vitest';
import { BROWSER_DIRECT, bucketKeyStore, keysRoute, loadKeys, memoryRecords, PROVIDER_ORIGINS, recordBucket, relayed } from '../src/index.ts';

const store = () => bucketKeyStore(recordBucket(memoryRecords()));
const put = (body: unknown) => new Request('http://vault/api/keys', { method: 'PUT', body: JSON.stringify(body) });

describe('keys kept without a server (the key vault)', () => {
  it('connects, says what is connected without the keys, and forgets everything at once', async () => {
    const keys = store();
    await keysRoute(put({ key: 'sk-ant-1' }), keys, ['anthropic']);
    await keysRoute(put({ label: 'DeepSeek', base: 'https://api.deepseek.com/v1', key: 'ds-1' }), keys, ['custom', 'deepseek']);
    const k = await loadKeys(keys);
    expect(k.get('anthropic')).toBe('sk-ant-1');
    expect(JSON.stringify(k.status())).not.toContain('sk-ant-1');
    expect(k.status()).toMatchObject({ providers: { anthropic: 'settings', openai: null }, custom: [{ id: 'deepseek', key: true }] });
    await keysRoute(new Request('http://vault/api/keys', { method: 'DELETE' }), keys, []);
    const after = await loadKeys(keys);
    expect(after.get('anthropic')).toBeUndefined();
    expect(after.status().custom).toEqual([]);
  });

  it('names no server secret when there is no server', async () => {
    expect((await loadKeys(store())).how(['openai'])).toBe('connect it in Settings, Providers');
    const withSecrets = await loadKeys(store(), { read: () => undefined, name: (p) => `${p.toUpperCase()}_API_KEY` });
    expect(withSecrets.how(['openai', 'gemini'], 'one')).toBe('connect one in Settings, Providers (or npx wrangler secret put OPENAI_API_KEY or GEMINI_API_KEY)');
  });
});

describe('which providers a browser reaches directly', () => {
  it('all but those refusing calls from a page; custom providers through the relay', () => {
    expect(BROWSER_DIRECT).toContain(PROVIDER_ORIGINS.anthropic);
    expect(BROWSER_DIRECT).not.toContain(PROVIDER_ORIGINS.zai);
    expect(relayed('zai')).toBe(true);
    expect(relayed('custom')).toBe(true);
    expect(relayed('openai')).toBe(false);
  });
});
