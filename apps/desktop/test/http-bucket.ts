// The desktop storage over HTTP: a Bucket that forwards every operation to
// the little server (src-tauri/examples/tramme-storage-server.rs) backed by
// the same folders the app writes to. The conditions and the ranges follow
// the exact helpers the other buckets use (conditions.ts).

import type { Bucket, Listing, PutOptions, StoredBody, StoredObject } from '@tramme/api';
import { conditionsHold, rangeOf } from '@tramme/api';

interface RawMeta {
  key: string;
  size: number;
  etag: string;
  uploaded: string;
  custom?: Record<string, string>;
  error?: string;
}

const metaHeader = (res: Response): RawMeta => JSON.parse(decodeURIComponent(res.headers.get('x-tramme-meta')!)) as RawMeta;

const meta = (m: RawMeta): StoredObject => ({
  key: m.key,
  size: m.size,
  httpEtag: m.etag,
  uploaded: new Date(m.uploaded),
  customMetadata: m.custom,
});

function withBody(m: RawMeta, data: ArrayBuffer, range?: { offset: number; length: number }): StoredBody {
  const blob = range ? new Blob([data]).slice(range.offset, range.offset + range.length) : new Blob([data]);
  return { ...meta(m), body: blob.stream(), range, arrayBuffer: () => blob.arrayBuffer(), json: async <T>() => JSON.parse(await blob.text()) as T };
}

const qs = (params: Record<string, string | number | undefined>) => {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');
  return q ? `?${q}` : '';
};

/**
 * A bucket of folders, as the contract suite sees it. Each bucket gets a
 * fresh root on the server, the way each browser gets its own IndexedDB.
 */
export function httpBucket(base: string, root: string): Bucket {
  // the reset happens before the first operation of this bucket
  let ready: Promise<unknown> = fetch(`${base}/reset`, { method: 'POST', body: JSON.stringify({ home: root }) });
  const gate = <T>(op: () => Promise<T>): Promise<T> => {
    const awaited = ready.then(op);
    ready = Promise.resolve();
    return awaited;
  };

  const bucket = {
    async head(key: string): Promise<StoredObject | null> {
      const res = await fetch(`${base}/head${qs({ key })}`, { method: 'POST' });
      if (res.status === 404) return null;
      return meta(metaHeader(res));
    },
    get: (async (key: string, options?: { range?: Headers; onlyIf?: Headers }): Promise<StoredBody | StoredObject | null> => {
      const res = await fetch(`${base}/get${qs({ key })}`, { method: 'POST' });
      if (res.status === 404) return null;
      const m = metaHeader(res);
      if (!conditionsHold(options?.onlyIf, m.etag)) return meta(m);
      return withBody(m, await res.arrayBuffer(), rangeOf(options?.range, m.size));
    }) as Bucket['get'],
    async put(key: string, value: ArrayBuffer | Uint8Array | string, options?: PutOptions): Promise<StoredObject | null> {
      // the condition holds against the object there now, as R2 reads it
      if (options?.onlyIf) {
        const head = await fetch(`${base}/head${qs({ key })}`, { method: 'POST' });
        const current = head.status === 404 ? null : metaHeader(head).etag;
        if (!conditionsHold(options.onlyIf, current)) return null;
      }
      const body: BodyInit = typeof value === 'string' ? value : new Uint8Array(value instanceof ArrayBuffer ? value : value.slice());
      const custom = options?.customMetadata ? JSON.stringify(options.customMetadata) : undefined;
      const res = await fetch(`${base}/put${qs({ key, custom })}`, { method: 'POST', body });
      if (res.status !== 200) return null;
      return meta(metaHeader(res));
    },
    async delete(keys: string | string[]): Promise<void> {
      await fetch(`${base}/delete`, { method: 'POST', body: JSON.stringify({ keys: [keys].flat() }) });
    },
    async list(options: { prefix?: string; delimiter?: string }): Promise<Listing> {
      const res = await fetch(`${base}/list`, { method: 'POST', body: JSON.stringify({ prefix: options.prefix ?? '', delimiter: options.delimiter }) });
      const out = (await res.json()) as { objects: RawMeta[]; delimitedPrefixes: string[]; truncated: boolean };
      return { objects: out.objects.map(meta), delimitedPrefixes: out.delimitedPrefixes, truncated: out.truncated };
    },
    async createMultipartUpload(key: string): Promise<{ uploadId: string }> {
      const res = await fetch(`${base}/multipart/create${qs({ key })}`, { method: 'POST' });
      return (await res.json()) as { uploadId: string };
    },
    resumeMultipartUpload(key: string, uploadId: string) {
      return {
        async uploadPart(partNumber: number, value: ArrayBuffer): Promise<{ partNumber: number; etag: string }> {
          const res = await fetch(`${base}/multipart/part${qs({ key, uploadId, partNumber })}`, { method: 'POST', body: new Uint8Array(value) });
          if (res.status !== 200) throw new Error(`part ${partNumber} of upload ${uploadId} refused`);
          return (await res.json()) as { partNumber: number; etag: string };
        },
        async complete(parts: { partNumber: number; etag: string }[]): Promise<StoredObject> {
          const res = await fetch(`${base}/multipart/complete${qs({ key, uploadId })}`, { method: 'POST', body: JSON.stringify({ parts: parts.map((p) => [p.partNumber, p.etag]) }) });
          if (res.status !== 200) throw new Error(`upload ${uploadId} incomplete: ${metaHeader(res).error ?? res.status}`);
          return meta(metaHeader(res));
        },
        async abort(): Promise<void> {
          await fetch(`${base}/multipart/abort${qs({ key, uploadId })}`, { method: 'POST' });
        },
      };
    },
  };
  // every operation waits for its root, then runs on its own
  return {
    head: (key) => gate(() => bucket.head(key)),
    get: ((key: string, options?: { range?: Headers; onlyIf?: Headers }) => gate(() => bucket.get(key, options))) as Bucket['get'],
    put: (key, value, options) => gate(() => bucket.put(key, value, options)),
    delete: (keys) => gate(() => bucket.delete(keys)),
    list: (options) => gate(() => bucket.list(options)),
    createMultipartUpload: (key, options) => gate(() => bucket.createMultipartUpload(key, options)),
    resumeMultipartUpload: (key, uploadId) => bucket.resumeMultipartUpload(key, uploadId),
  };
}
