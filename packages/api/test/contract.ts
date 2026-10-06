// What the editor relies on from storage, whatever answers it: R2 on the
// Worker, IndexedDB in the browser (personal mode). Each bucket runs this same
// suite (storage.test.ts, apps/editor/test/local-store.test.ts); a future one
// (the desktop app's folders) must pass it too.

import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { DOCUMENT, MANIFEST, type Manifest } from '@tramme/project';
import { failure, storageRoute, type Bucket } from '../src/index.ts';

export function storageContract(name: string, makeBucket: () => Bucket) {
  const setup = () => {
    const bucket = makeBucket();
    const call = async (path: string, init: RequestInit = {}) => {
      const url = new URL(`http://localhost${path}`);
      // errors answered as the Worker and the service worker answer them
      const res = await storageRoute(new Request(url, init), bucket, url).catch(failure);
      if (!res) throw new Error(`not a storage route: ${path}`);
      return res;
    };
    const create = async (body: Record<string, unknown> = { name: 'First' }) =>
      (await (await call('/api/projects', { method: 'POST', body: JSON.stringify(body) })).json()) as Manifest;
    return { bucket, call, create };
  };

  describe(`storage contract: ${name}`, () => {
    it('creates, lists and reads a project, its document and its manifest', async () => {
      const { call, create } = setup();
      const m = await create({ name: 'First', width: 1080, height: 1920 });
      expect(m).toMatchObject({ name: 'First', width: 1080, height: 1920 });
      const second = await create({ name: 'Second' });
      const list = (await (await call('/api/projects')).json()) as Manifest[];
      expect(list.map((x) => x.id).sort()).toEqual([m.id, second.id].sort());
      const info = (await (await call(`/api/projects/${m.id}`)).json()) as { manifest: Manifest; files: { path: string; etag: string }[] };
      expect(info.files.map((f) => f.path).sort()).toEqual([DOCUMENT, MANIFEST].sort());
      const doc = await call(`/api/projects/${m.id}/files/${DOCUMENT}`);
      expect(doc.status).toBe(200);
      expect(doc.headers.get('etag')).toBe(info.files.find((f) => f.path === DOCUMENT)!.etag);
      expect(await doc.json()).toHaveProperty('compositions');
      expect((await call('/api/projects/nope-1234')).status).toBe(404);
    });

    it('refuses to overwrite a file changed elsewhere (If-Match), and says when nothing changed (If-None-Match)', async () => {
      const { call, create } = setup();
      const m = await create();
      const path = `/api/projects/${m.id}/files/assets/notes.json`;
      const first = await call(path, { method: 'PUT', body: 'one' });
      const etag = first.headers.get('etag')!;
      expect(etag).toMatch(/^".+"$/);
      const second = await call(path, { method: 'PUT', body: 'two', headers: { 'if-match': etag } });
      expect(second.status).toBe(200);
      const stale = await call(path, { method: 'PUT', body: 'three', headers: { 'if-match': etag } });
      expect(stale.status).toBe(412);
      expect(await (await call(path)).text()).toBe('two');
      const now = second.headers.get('etag')!;
      expect((await call(path, { headers: { 'if-none-match': now } })).status).toBe(304);
    });

    it('reads a part of a file (Range), as the video layer seeks', async () => {
      const { call, create } = setup();
      const m = await create();
      const path = `/api/projects/${m.id}/files/assets/data.wav`;
      await call(path, { method: 'PUT', body: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) });
      const part = await call(path, { headers: { range: 'bytes=2-5' } });
      expect(part.status).toBe(206);
      expect(part.headers.get('content-range')).toBe('bytes 2-5/10');
      expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([2, 3, 4, 5]);
      const open = await call(path, { headers: { range: 'bytes=7-' } });
      expect([...new Uint8Array(await open.arrayBuffer())]).toEqual([7, 8, 9]);
      const tail = await call(path, { headers: { range: 'bytes=-3' } });
      expect(tail.headers.get('content-range')).toBe('bytes 7-9/10');
      expect([...new Uint8Array(await tail.arrayBuffer())]).toEqual([7, 8, 9]);
      const whole = await call(path);
      expect(whole.headers.get('content-length')).toBe('10');
    });

    it('renames, deletes a file, duplicates, exports and deletes a project', async () => {
      const { call, create } = setup();
      const m = await create({ name: 'Trip' });
      await call(`/api/projects/${m.id}/files/assets/a.json`, { method: 'PUT', body: 'a' });
      const renamed = (await (await call(`/api/projects/${m.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Road trip' }) })).json()) as Manifest;
      expect(renamed.name).toBe('Road trip');
      const copy = (await (await call(`/api/projects/${m.id}/duplicate`, { method: 'POST', body: '{}' })).json()) as Manifest;
      expect(copy.id).not.toBe(m.id);
      expect(await (await call(`/api/projects/${copy.id}/files/assets/a.json`)).text()).toBe('a');
      const zip = unzipSync(new Uint8Array(await (await call(`/api/projects/${m.id}/export`)).arrayBuffer()));
      expect(Object.keys(zip).sort()).toEqual(['assets/a.json', DOCUMENT, MANIFEST].sort());
      expect((await call(`/api/projects/${m.id}/files/assets/a.json`, { method: 'DELETE' })).status).toBe(200);
      expect((await call(`/api/projects/${m.id}/files/assets/a.json`)).status).toBe(404);
      expect((await call(`/api/projects/${m.id}`, { method: 'DELETE' })).status).toBe(200);
      const list = (await (await call('/api/projects')).json()) as Manifest[];
      expect(list.map((x) => x.id)).toEqual([copy.id]);
    });

    it('puts a large file together from its parts', async () => {
      const { call, create } = setup();
      const m = await create();
      const start = await call(`/api/projects/${m.id}/uploads`, { method: 'POST', body: JSON.stringify({ path: 'assets/clip.mp4', size: 6 }) });
      const { uploadId } = (await start.json()) as { uploadId: string };
      const q = `path=${encodeURIComponent('assets/clip.mp4')}`;
      const parts = [];
      for (const [n, bytes] of [[2, [4, 5, 6]], [1, [1, 2, 3]]] as const) {
        parts.push(await (await call(`/api/projects/${m.id}/uploads/${uploadId}?${q}&part=${n}`, { method: 'PUT', body: new Uint8Array(bytes) })).json());
      }
      const done = await call(`/api/projects/${m.id}/uploads/${uploadId}/complete`, { method: 'POST', body: JSON.stringify({ path: 'assets/clip.mp4', parts }) });
      expect(done.status).toBe(200);
      expect([...new Uint8Array(await (await call(`/api/projects/${m.id}/files/assets/clip.mp4`)).arrayBuffer())]).toEqual([1, 2, 3, 4, 5, 6]);
      // nothing of the upload left among the project's files
      const info = (await (await call(`/api/projects/${m.id}`)).json()) as { files: { path: string }[] };
      expect(info.files.map((f) => f.path)).toContain('assets/clip.mp4');
      expect(info.files.every((f) => !f.path.includes('upload'))).toBe(true);
    });

    it('keeps plugins and sounds in libraries, a sound with its description', async () => {
      const { call } = setup();
      await call('/api/library/stars.js', { method: 'PUT', body: 'export default {}' });
      await call('/api/sounds/whoosh.wav', { method: 'PUT', body: new Uint8Array([1, 2]), headers: { 'x-tramme-entry': JSON.stringify({ kind: 'whoosh' }) } });
      expect(((await (await call('/api/library')).json()) as { name: string }[]).map((x) => x.name)).toEqual(['stars.js']);
      expect(await (await call('/api/library/stars.js')).text()).toBe('export default {}');
      const sounds = (await (await call('/api/sounds')).json()) as { name: string; entry?: unknown }[];
      expect(sounds).toMatchObject([{ name: 'whoosh.wav', entry: { kind: 'whoosh' } }]);
      await call('/api/sounds/whoosh.wav', { method: 'DELETE' });
      expect(await (await call('/api/sounds')).json()).toEqual([]);
    });
  });
}
