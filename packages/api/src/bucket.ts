// What the projects and the libraries need of a storage: the part of an R2
// bucket they use. R2 provides it on the Worker; IndexedDB in the browser
// (apps/editor/src/local/bucket.ts) and an in-memory map in the tests.

export interface StoredObject {
  key: string;
  size: number;
  /** quoted, as sent in an ETag header */
  httpEtag: string;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

/** the part read of a ranged request */
export type StoredRange = { offset?: number; length?: number } | { suffix: number };

export interface StoredBody extends StoredObject {
  body: ReadableStream;
  range?: StoredRange;
  arrayBuffer(): Promise<ArrayBuffer>;
  json<T>(): Promise<T>;
}

export interface PutOptions {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  /** If-Match / If-None-Match: the write is refused (null) when they do not hold */
  onlyIf?: Headers;
}

export interface Listing { objects: StoredObject[]; delimitedPrefixes: string[]; truncated: boolean; cursor?: string }

export interface UploadedPart { partNumber: number; etag: string }

export interface MultipartUpload {
  uploadPart(partNumber: number, value: ArrayBuffer): Promise<UploadedPart>;
  complete(parts: UploadedPart[]): Promise<StoredObject>;
  abort(): Promise<void>;
}

export interface Bucket {
  head(key: string): Promise<StoredObject | null>;
  /** with onlyIf: the object without its body when the condition fails */
  get(key: string, options: { range?: Headers; onlyIf: Headers }): Promise<StoredBody | StoredObject | null>;
  get(key: string, options?: { range?: Headers }): Promise<StoredBody | null>;
  put(key: string, value: ArrayBuffer | Uint8Array | string, options?: PutOptions): Promise<StoredObject | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options: { prefix?: string; delimiter?: string; cursor?: string; include?: ('httpMetadata' | 'customMetadata')[] }): Promise<Listing>;
  createMultipartUpload(key: string, options?: { httpMetadata?: { contentType?: string } }): Promise<{ uploadId: string }>;
  resumeMultipartUpload(key: string, uploadId: string): MultipartUpload;
}
