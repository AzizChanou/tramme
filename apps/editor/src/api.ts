// Calls to the server (the Worker in production, `wrangler dev` locally):
// projects and their files in storage, and the server side of the assistant.

import type { TrammeDoc, Op } from '@tramme/core';
import { isMedia, LIMITS, type Manifest } from '@tramme/project';

export interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  /** text (user message, or assistant text) */
  text?: string;
  /** user: what the message was about */
  context?: string;
  /** user: files joined to the message (files of the project) */
  attachments?: { path: string; name: string; kind: 'image' | 'audio' | 'video' | 'file'; asset?: string }[];
  /** assistant activity: tool name and short description */
  tool?: { name: string; summary: string; done?: boolean; error?: boolean };
  /** a still the assistant rendered (data URL) */
  image?: { url: string; caption: string };
  /** what the assistant thinks before answering (summary streamed by the API); start and duration in ms */
  thinking?: { text: string; done?: boolean; start?: number; ms?: number };
  /** a proposal of changes (its ops live in the state while pending) */
  proposal?: { id: string; label: string; count: number; status: 'pending' | 'accepted' | 'rejected'; lines: string[] };
}

export type AiEvent =
  | { type: 'item'; item: ChatItem }
  | { type: 'text'; id: string; delta: string }
  | { type: 'tool-done'; id: string; error?: boolean }
  | { type: 'thinking'; id: string; delta: string }
  | { type: 'thinking-done'; id: string }
  | { type: 'proposal'; id: string; label: string; ops: Op[] }
  | { type: 'proposal-clear'; id: string }
  | { type: 'reload'; assets: string[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface ServerConfig {
  format: string;
  limits: { file: number; archive: number; files: number };
  claude: { server: boolean };
  /** other model providers with a key on the server */
  llm?: Record<string, boolean>;
}

export interface ProjectFile { path: string; size: number; etag: string; modified: string }

export class ApiError extends Error {
  status: number;
  issues?: { path: string; message: string }[];
  constructor(status: number, message: string, issues?: { path: string; message: string }[]) { super(message); this.status = status; this.issues = issues; }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) {
    let body: { error?: string; issues?: { path: string; message: string }[] } = {};
    try { body = await r.json(); } catch { /* not JSON */ }
    throw new ApiError(r.status, body.error ?? `HTTP ${r.status}`, body.issues);
  }
  return r.json() as Promise<T>;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const P = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
const filePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export const api = {
  config: () => call<ServerConfig>('/api/config'),
  /** models of the providers with a key on the server */
  models: () => call<Record<string, { id: string; label: string; effort?: true }[] | { error: string }>>('/api/models'),

  // ── projects ───────────────────────────────────────────────
  list: () => call<Manifest[]>('/api/projects'),
  create: (opts: { name: string; width?: number; height?: number; fps?: number; duration?: number; created?: string; empty?: boolean }) => call<Manifest>('/api/projects', jsonInit('POST', opts)),
  info: (id: string) => call<{ manifest: Manifest; files: ProjectFile[] }>(P(id)),
  update: (id: string, patch: { name?: string; thumbnail?: string | null }) => call<Manifest>(P(id), jsonInit('PATCH', patch)),

  // ── the plugin library, shared by the projects ─────────────────
  library: () => call<{ name: string; size: number; modified: string }[]>('/api/library'),
  async libraryGet(name: string): Promise<string> {
    const r = await fetch(`/api/library/${encodeURIComponent(name)}`, { cache: 'no-store' });
    if (!r.ok) throw new ApiError(r.status, `no plugin "${name}" in the library (HTTP ${r.status})`);
    return r.text();
  },
  libraryPut: (name: string, code: string) => call<{ name: string; size: number }>(`/api/library/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'content-type': 'text/javascript' }, body: code }),
  remove: (id: string) => call<{ deleted: string }>(P(id), { method: 'DELETE' }),
  duplicate: (id: string, name?: string) => call<Manifest>(`${P(id)}/duplicate`, jsonInit('POST', { name })),
  exportUrl: (id: string) => `${P(id)}/export`,

  // ── files ──────────────────────────────────────────────────
  /** URL of a project file; relative srcs of the document resolve against the document's URL */
  fileUrl: (id: string, path: string) => `${P(id)}/files/${filePath(path)}`,

  /** a text file and its version, or null when it does not exist */
  async readText(id: string, path: string): Promise<{ text: string; etag: string } | null> {
    const r = await fetch(api.fileUrl(id, path), { cache: 'no-store' });
    if (r.status === 404) return null;
    if (!r.ok) throw new ApiError(r.status, `could not read ${path} (HTTP ${r.status})`);
    return { text: await r.text(), etag: r.headers.get('etag') ?? '' };
  },

  /** write a file; with ifMatch, refused (412) when it changed since that version */
  write: (id: string, path: string, body: BodyInit, opts: { ifMatch?: string; type?: string } = {}) => call<{ path: string; size: number; etag: string; modified: string }>(api.fileUrl(id, path), {
    method: 'PUT', body,
    headers: { ...(opts.ifMatch ? { 'if-match': opts.ifMatch } : {}), ...(opts.type ? { 'content-type': opts.type } : {}) },
  }),

  /**
   * Writes a file of any size: one request, or for a large sound or video
   * parts sent three at a time (R2 multipart). Progress in bytes.
   */
  async writeAny(id: string, path: string, blob: Blob, onProgress?: (sent: number, total: number) => void): Promise<{ path: string; size: number; etag: string; modified: string }> {
    if (blob.size <= LIMITS.file || !isMedia(path)) {
      const r = await api.write(id, path, blob);
      onProgress?.(blob.size, blob.size);
      return r;
    }
    const { uploadId, partSize } = await call<{ uploadId: string; partSize: number }>(`${P(id)}/uploads`, jsonInit('POST', { path, size: blob.size }));
    const count = Math.ceil(blob.size / partSize), parts: { partNumber: number; etag: string }[] = [];
    const queue = Array.from({ length: count }, (_, i) => i + 1);
    let sent = 0;
    const q = `path=${encodeURIComponent(path)}`;
    try {
      const worker = async () => {
        for (let n = queue.shift(); n; n = queue.shift()) {
          const body = blob.slice((n - 1) * partSize, Math.min(blob.size, n * partSize));
          parts.push(await call<{ partNumber: number; etag: string }>(`${P(id)}/uploads/${uploadId}?${q}&part=${n}`, { method: 'PUT', body }));
          sent += body.size;
          onProgress?.(sent, blob.size);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      return await call(`${P(id)}/uploads/${uploadId}/complete`, jsonInit('POST', { path, parts }));
    } catch (e) {
      fetch(`${P(id)}/uploads/${uploadId}?${q}`, { method: 'DELETE' }).catch(() => {});
      throw e;
    }
  },

  removeFile: (id: string, path: string) => call<{ deleted: string }>(api.fileUrl(id, path), { method: 'DELETE' }),
};

export type { TrammeDoc, Manifest };
