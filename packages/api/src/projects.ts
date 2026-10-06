// Projects in a bucket (R2 on the Worker, IndexedDB in the browser): every
// file of project <id> lives at projects/<id>/<path>. The manifest is kept by
// the server (dates, size of the main composition); the editor writes the
// document and the other files.

import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { isMedia, upgradeFile, currentPath, LEGACIES, DOCUMENT, isChatPath, LIMITS, MANIFEST, ManifestSchema, mimeOf, newId, newProject, parseDocument, pathIssue, type Manifest } from '@tramme/project';
import type { Bucket, StoredBody, StoredObject } from './bucket.ts';
import { HttpError, json, readJson } from './http.ts';

const ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const key = (id: string, path = '') => `projects/${id}/${path}`;

function checkId(id: string) {
  if (!ID.test(id)) throw new HttpError(400, 'invalid project id');
}

async function allKeys(bucket: Bucket, prefix: string): Promise<StoredObject[]> {
  const out: StoredObject[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/**
 * A project stored under a former name of the tool (trame.json, document.trame.json,
 * .trame/; or emotion): its files take today's names, its manifest and document today's versions.
 * Done once, the first time it is read. False when there is nothing to convert.
 */
async function migrateStored(bucket: Bucket, id: string): Promise<boolean> {
  let found = false;
  for (const l of LEGACIES) if (await bucket.head(key(id, l.manifest))) { found = true; break; }
  if (!found) return false;
  for (const o of await allKeys(bucket, key(id))) {
    const path = o.key.slice(key(id).length), next = currentPath(path);
    if (next === path) continue;
    const obj = await bucket.get(o.key);
    if (!obj) continue;
    const data = upgradeFile(path, new Uint8Array(await obj.arrayBuffer()));
    await bucket.put(key(id, next), data, { httpMetadata: { contentType: mimeOf(next) } });
    await bucket.delete(o.key);
  }
  return true;
}

export async function readManifest(bucket: Bucket, id: string): Promise<Manifest> {
  checkId(id);
  let obj = await bucket.get(key(id, MANIFEST));
  if (!obj && (await migrateStored(bucket, id))) obj = await bucket.get(key(id, MANIFEST));
  if (!obj) throw new HttpError(404, 'project not found');
  const r = ManifestSchema.safeParse(await obj.json());
  if (!r.success) throw new HttpError(500, 'unreadable project manifest');
  return r.data;
}

async function writeManifest(bucket: Bucket, m: Manifest) {
  await bucket.put(key(m.id, MANIFEST), JSON.stringify(m, null, 2) + '\n', { httpMetadata: { contentType: mimeOf(MANIFEST) } });
  return m;
}

async function freeId(bucket: Bucket, name: string): Promise<string> {
  for (;;) {
    const id = newId(name);
    if (!(await bucket.head(key(id, MANIFEST)))) return id;
  }
}

// ── projects ─────────────────────────────────────────────────

export async function listProjects(bucket: Bucket) {
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: 'projects/', delimiter: '/', cursor });
    ids.push(...page.delimitedPrefixes.map((p) => p.slice('projects/'.length, -1)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  const all = await Promise.all(ids.filter((id) => ID.test(id)).map((id) => readManifest(bucket, id).catch(() => null)));
  return all.filter((m): m is Manifest => !!m).sort((a, b) => b.modified.localeCompare(a.modified));
}

interface CreateBody { name?: string; width?: number; height?: number; fps?: number; duration?: number; created?: string; empty?: boolean }

/**
 * A new project. With `empty`, only the manifest is written: the editor then
 * sends the files of an imported archive, the document last.
 */
export async function createProject(bucket: Bucket, req: Request) {
  const b = await readJson<CreateBody>(req);
  const name = (b.name ?? '').trim();
  if (!name || name.length > 200) throw new HttpError(400, 'project name required (200 characters at most)');
  const int = (v: unknown, d: number, max: number) => (Number.isInteger(v) && (v as number) > 0 && (v as number) <= max ? (v as number) : d);
  const width = int(b.width, 1920, 8192), height = int(b.height, 1080, 8192), fps = int(b.fps, 30, 240);
  const duration = typeof b.duration === 'number' && b.duration > 0 && b.duration <= 3600 ? b.duration : 5;
  const { manifest, doc } = newProject({ name, width, height, fps, duration, id: await freeId(bucket, name), app: 'tramme' });
  if (b.created && !Number.isNaN(Date.parse(b.created))) manifest.created = b.created;
  if (!b.empty) await bucket.put(key(manifest.id, DOCUMENT), JSON.stringify(doc, null, 2) + '\n', { httpMetadata: { contentType: mimeOf(DOCUMENT) } });
  await writeManifest(bucket, manifest);
  return json(manifest, 201);
}

export async function projectInfo(bucket: Bucket, id: string) {
  const manifest = await readManifest(bucket, id);
  const files = (await allKeys(bucket, key(id))).map((o) => ({ path: o.key.slice(key(id).length), size: o.size, etag: o.httpEtag, modified: o.uploaded.toISOString() }));
  return json({ manifest, files });
}

export async function updateProject(bucket: Bucket, id: string, req: Request) {
  const m = await readManifest(bucket, id);
  const b = await readJson<{ name?: string; thumbnail?: string | null }>(req);
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name || name.length > 200) throw new HttpError(400, 'invalid name');
    m.name = name;
  }
  if (b.thumbnail === null) delete m.thumbnail;
  else if (b.thumbnail !== undefined) {
    if (!/^thumbnail\.(webp|png|jpg)$/.test(b.thumbnail)) throw new HttpError(400, 'thumbnail: thumbnail.webp, .png or .jpg');
    m.thumbnail = b.thumbnail;
  }
  m.modified = new Date().toISOString();
  return json(await writeManifest(bucket, m));
}

export async function deleteProject(bucket: Bucket, id: string) {
  await readManifest(bucket, id);
  const keys = (await allKeys(bucket, key(id))).map((o) => o.key);
  for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
  return json({ deleted: id, files: keys.length });
}

export async function duplicateProject(bucket: Bucket, id: string, req: Request) {
  const src = await readManifest(bucket, id);
  const b = await readJson<{ name?: string }>(req).catch(() => ({}) as { name?: string });
  const name = (b.name ?? `${src.name} (copy)`).trim().slice(0, 200);
  const now = new Date().toISOString();
  const m: Manifest = { ...src, id: await freeId(bucket, name), name, created: now, modified: now };
  for (const o of await allKeys(bucket, key(id))) {
    const path = o.key.slice(key(id).length);
    if (path === MANIFEST || path.startsWith('renders/') || isChatPath(path)) continue;
    const obj = await bucket.get(o.key);
    if (obj) await bucket.put(key(m.id, path), await obj.arrayBuffer(), { httpMetadata: obj.httpMetadata });
  }
  return json(await writeManifest(bucket, m), 201);
}

/** the project as a .tramme archive, zipped while it streams out */
export async function exportProject(bucket: Bucket, id: string) {
  const m = await readManifest(bucket, id);
  const objects = (await allKeys(bucket, key(id))).filter((o) => !o.key.slice(key(id).length).startsWith('renders/'));
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  (async () => {
    let queue: Uint8Array[] = [];
    let failed: unknown = null;
    const zip = new Zip((err, chunk) => { if (err) failed = err; else queue.push(chunk); });
    const flush = async () => { const q = queue; queue = []; for (const c of q) await writer.write(c); };
    try {
      for (const o of objects) {
        const path = o.key.slice(key(id).length);
        const obj = await bucket.get(o.key);
        if (!obj) continue;
        // media are already compressed: store them as they are
        const file = /\.(png|jpe?g|webp|gif|avif|mp3|ogg|m4a|mp4|webm|mov|woff2?)$/i.test(path) ? new ZipPassThrough(path) : new ZipDeflate(path, { level: 6 });
        zip.add(file);
        file.push(new Uint8Array(await obj.arrayBuffer()), true);
        if (failed) throw failed;
        await flush();
      }
      zip.end();
      await flush();
      await writer.close();
    } catch (e) {
      await writer.abort(e);
    }
  })();
  const file = `${m.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')}.tramme`;
  return new Response(readable, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${file.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file)}`,
      'cache-control': 'no-store',
    },
  });
}

// ── files ────────────────────────────────────────────────────

function checkPath(path: string) {
  const bad = pathIssue(path);
  if (bad) throw new HttpError(400, `${path} : ${bad}`);
}

export async function getFile(bucket: Bucket, id: string, path: string, req: Request) {
  checkId(id);
  checkPath(path);
  const obj = await bucket.get(key(id, path), { range: req.headers, onlyIf: req.headers });
  if (!obj) throw new HttpError(404, `file not found: ${path}`);
  const headers = new Headers({
    'content-type': mimeOf(path),
    etag: obj.httpEtag,
    'cache-control': 'no-cache',
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
    // a file opened on its own (an SVG, a page) runs nothing
    'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self' data:; sandbox",
  });
  if (!('body' in obj)) return new Response(null, { status: req.headers.has('if-none-match') ? 304 : 412, headers });
  const body = obj as StoredBody;
  if (req.headers.has('range') && body.range) {
    const r = body.range as { offset?: number; length?: number; suffix?: number };
    const start = r.suffix !== undefined ? body.size - r.suffix : r.offset ?? 0;
    const length = r.suffix !== undefined ? r.suffix : r.length ?? body.size - start;
    headers.set('content-range', `bytes ${start}-${start + length - 1}/${body.size}`);
    headers.set('content-length', String(length));
    return new Response(body.body, { status: 206, headers });
  }
  headers.set('content-length', String(body.size));
  return new Response(body.body, { headers });
}

export async function putFile(bucket: Bucket, id: string, path: string, req: Request) {
  const m = await readManifest(bucket, id);
  checkPath(path);
  if (path === MANIFEST) throw new HttpError(403, 'the manifest is kept by the server');
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > LIMITS.file) throw new HttpError(413, 'file too large');
  const data = await req.arrayBuffer();
  if (data.byteLength > LIMITS.file) throw new HttpError(413, 'file too large');
  if (path === DOCUMENT || isChatPath(path)) {
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(data); } catch { throw new HttpError(422, 'UTF-8 text expected'); }
    if (path === DOCUMENT) {
      try {
        const doc = parseDocument(text);
        const root = doc.compositions[doc.root];
        if (root) Object.assign(m, { width: root.width, height: root.height, duration: root.duration });
      } catch (e) { throw new HttpError(422, (e as Error).message); }
    } else {
      try { JSON.parse(text); } catch { throw new HttpError(422, 'unreadable JSON'); }
    }
  }
  // If-Match: refuse to overwrite a version this client has not seen (another tab)
  const obj = await bucket.put(key(id, path), data, {
    httpMetadata: { contentType: mimeOf(path) },
    onlyIf: req.headers.has('if-match') ? req.headers : undefined,
  });
  if (!obj) throw new HttpError(412, 'the file changed elsewhere since it was opened');
  if (!path.startsWith('renders/')) {
    m.modified = new Date().toISOString();
    await writeManifest(bucket, m);
  }
  return json({ path, size: obj.size, etag: obj.httpEtag, modified: m.modified }, 200, { etag: obj.httpEtag });
}

export async function deleteFile(bucket: Bucket, id: string, path: string) {
  const m = await readManifest(bucket, id);
  checkPath(path);
  if (path === MANIFEST || path === DOCUMENT) throw new HttpError(403, 'the manifest and the document cannot be deleted');
  await bucket.delete(key(id, path));
  if (m.thumbnail === path) delete m.thumbnail;
  m.modified = new Date().toISOString();
  await writeManifest(bucket, m);
  return json({ deleted: path });
}

// ── large files, in parts ────────────────────────────────────
// A sound or a video can exceed one request: the editor starts an upload,
// sends parts of LIMITS.part (several at once), then completes it.

/** starts an upload: { uploadId, partSize } */
export async function startUpload(bucket: Bucket, id: string, req: Request) {
  await readManifest(bucket, id);
  const b = await readJson<{ path?: string; size?: number }>(req);
  const path = String(b.path ?? '');
  checkPath(path);
  if (!isMedia(path)) throw new HttpError(400, 'multipart upload: sounds and videos only');
  if (!(Number(b.size) > 0) || Number(b.size) > LIMITS.media) throw new HttpError(413, 'file too large');
  const up = await bucket.createMultipartUpload(key(id, path), { httpMetadata: { contentType: mimeOf(path) } });
  return json({ uploadId: up.uploadId, partSize: LIMITS.part }, 201);
}

/** one part (numbered from 1) */
export async function uploadPart(bucket: Bucket, id: string, uploadId: string, req: Request, url: URL) {
  checkId(id);
  const path = url.searchParams.get('path') ?? '';
  checkPath(path);
  const n = Number(url.searchParams.get('part'));
  if (!Number.isInteger(n) || n < 1 || n > 10000) throw new HttpError(400, 'invalid part number');
  const data = await req.arrayBuffer();
  if (data.byteLength > LIMITS.part) throw new HttpError(413, 'part too large');
  const part = await bucket.resumeMultipartUpload(key(id, path), uploadId).uploadPart(n, data);
  return json({ partNumber: part.partNumber, etag: part.etag });
}

/** the parts put together: the file exists from now on */
export async function completeUpload(bucket: Bucket, id: string, uploadId: string, req: Request) {
  const m = await readManifest(bucket, id);
  const b = await readJson<{ path?: string; parts?: { partNumber: number; etag: string }[] }>(req);
  const path = String(b.path ?? '');
  checkPath(path);
  if (!Array.isArray(b.parts) || !b.parts.length) throw new HttpError(400, 'missing parts');
  const obj = await bucket.resumeMultipartUpload(key(id, path), uploadId).complete(b.parts.sort((x, y) => x.partNumber - y.partNumber));
  if (!path.startsWith('renders/')) { m.modified = new Date().toISOString(); await writeManifest(bucket, m); }
  return json({ path, size: obj.size, etag: obj.httpEtag, modified: m.modified });
}

export async function abortUpload(bucket: Bucket, id: string, uploadId: string, url: URL) {
  checkId(id);
  const path = url.searchParams.get('path') ?? '';
  checkPath(path);
  await bucket.resumeMultipartUpload(key(id, path), uploadId).abort();
  return json({ aborted: uploadId });
}
