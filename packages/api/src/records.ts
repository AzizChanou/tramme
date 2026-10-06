// A bucket that answers as R2 does (etags, conditions, ranges, listings,
// uploads in parts) on top of a plain store of records: IndexedDB in the
// browser (apps/editor/src/local/idb.ts), a map in the tests.

import type { Bucket, Listing, StoredBody, StoredObject, UploadedPart } from './bucket.ts';
import { conditionsHold, rangeOf } from './conditions.ts';

export interface StoredRecord {
  key: string;
  data: Blob;
  /** unquoted */
  etag: string;
  uploaded: Date;
  contentType?: string;
  custom?: Record<string, string>;
}

export interface RecordStore {
  get(key: string): Promise<StoredRecord | undefined>;
  /** writes the record, unless `check` refuses the one there now (read and written in one step); false when refused */
  put(record: StoredRecord, check?: (current: StoredRecord | undefined) => boolean): Promise<boolean>;
  delete(keys: string[]): Promise<void>;
  /** the records whose key starts with prefix, in key order */
  list(prefix: string): Promise<StoredRecord[]>;
}

/** the parts of an upload under way, kept apart from everything listed */
const UPLOADS = '.uploads/';

const newEtag = () => crypto.randomUUID().replace(/-/g, '');

function meta(r: StoredRecord): StoredObject {
  return { key: r.key, size: r.data.size, httpEtag: `"${r.etag}"`, uploaded: r.uploaded, httpMetadata: { contentType: r.contentType }, customMetadata: r.custom };
}

function withBody(r: StoredRecord, range?: { offset: number; length: number }): StoredBody {
  const data = range ? r.data.slice(range.offset, range.offset + range.length) : r.data;
  return { ...meta(r), body: data.stream(), range, arrayBuffer: () => data.arrayBuffer(), json: async <T>() => JSON.parse(await data.text()) as T };
}

const record = (key: string, data: Blob, contentType?: string, custom?: Record<string, string>): StoredRecord =>
  ({ key, data, etag: newEtag(), uploaded: new Date(), ...(contentType ? { contentType } : {}), ...(custom ? { custom } : {}) });

export function recordBucket(store: RecordStore): Bucket {
  const bucket: Bucket = {
    async head(key) {
      const r = await store.get(key);
      return r ? meta(r) : null;
    },
    // without a condition, always the body (Bucket's two signatures)
    get: (async (key: string, options?: { range?: Headers; onlyIf?: Headers }) => {
      const r = await store.get(key);
      if (!r) return null;
      if (!conditionsHold(options?.onlyIf, `"${r.etag}"`)) return meta(r);
      return withBody(r, rangeOf(options?.range, r.data.size));
    }) as Bucket['get'],
    async put(key, value, options) {
      const r = record(key, new Blob([typeof value === 'string' || value instanceof ArrayBuffer ? value : value.slice()]), options?.httpMetadata?.contentType, options?.customMetadata);
      const onlyIf = options?.onlyIf;
      const ok = await store.put(r, onlyIf ? (current) => conditionsHold(onlyIf, current ? `"${current.etag}"` : null) : undefined);
      return ok ? meta(r) : null;
    },
    async delete(keys) { await store.delete([keys].flat()); },
    async list({ prefix = '', delimiter }) {
      const all = (await store.list(prefix)).filter((r) => !r.key.startsWith(UPLOADS));
      const out: Listing = { objects: [], delimitedPrefixes: [], truncated: false };
      const prefixes = new Set<string>();
      for (const r of all) {
        const rest = r.key.slice(prefix.length);
        if (delimiter && rest.includes(delimiter)) prefixes.add(prefix + rest.slice(0, rest.indexOf(delimiter) + delimiter.length));
        else out.objects.push(meta(r));
      }
      out.delimitedPrefixes = [...prefixes];
      return out;
    },
    async createMultipartUpload(key, options) {
      const uploadId = newEtag();
      await store.put(record(`${UPLOADS}${uploadId}`, new Blob(), options?.httpMetadata?.contentType, { key }));
      return { uploadId };
    },
    resumeMultipartUpload(key, uploadId) {
      const at = `${UPLOADS}${uploadId}`;
      const started = async () => {
        const r = await store.get(at);
        if (!r || r.custom?.key !== key) throw new Error(`no upload ${uploadId} for ${key}`);
        return r;
      };
      return {
        async uploadPart(partNumber, value): Promise<UploadedPart> {
          await started();
          const part = record(`${at}/${partNumber}`, new Blob([value]));
          await store.put(part);
          return { partNumber, etag: part.etag };
        },
        async complete(parts) {
          const start = await started();
          const chunks = await Promise.all(parts.map(async (p) => {
            const r = await store.get(`${at}/${p.partNumber}`);
            if (!r || r.etag !== p.etag) throw new Error(`part ${p.partNumber} of upload ${uploadId} is missing`);
            return r.data;
          }));
          const done = record(key, new Blob(chunks), start.contentType);
          await store.put(done);
          await store.delete((await store.list(`${at}/`)).map((r) => r.key).concat(at));
          return meta(done);
        },
        async abort() { await store.delete((await store.list(`${at}/`)).map((r) => r.key).concat(at)); },
      };
    },
  };
  return bucket;
}

/** records in memory: the tests, and a browser that keeps nothing */
export function memoryRecords(): RecordStore {
  const map = new Map<string, StoredRecord>();
  return {
    async get(key) { return map.get(key); },
    async put(r, check) {
      if (check && !check(map.get(r.key))) return false;
      map.set(r.key, r);
      return true;
    },
    async delete(keys) { for (const k of keys) map.delete(k); },
    async list(prefix) { return [...map.values()].filter((r) => r.key.startsWith(prefix)).sort((a, b) => (a.key < b.key ? -1 : 1)); },
  };
}
