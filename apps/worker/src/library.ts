// The libraries kept outside any project, shared by them: plugins and sounds.
// An item is copied into a project when used (the project stays
// self-contained: its archive carries it), and a project's item can be kept
// in its library. Files live in R2 at library/<shelf>/<name>; a sound keeps
// its description (kind, tags, length, the moment it lands on) in the
// object's metadata.

import { LIMITS } from '@tramme/project';
import { HttpError, json } from './http.ts';

interface Shelf {
  prefix: string;
  /** a file name of the shelf: lower case letters, digits, - and _, then its extension */
  name: RegExp;
  what: string;
  type(name: string): string;
  /** the description sent with a file (header x-tramme-entry), kept beside it */
  described?: boolean;
}

const AUDIO: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', webm: 'audio/webm', opus: 'audio/ogg' };
/** R2 metadata holds 2 KB: a description is short (no code, a prompt cut) */
const ENTRY_MAX = 1800;

export const SHELVES = {
  plugins: { prefix: 'library/plugins/', name: /^[a-z0-9][a-z0-9_-]{0,62}\.(js|mjs)$/, what: 'plugin', type: () => 'text/javascript; charset=utf-8' },
  sounds: { prefix: 'library/sounds/', name: /^[a-z0-9][a-z0-9_-]{0,62}\.(wav|mp3|ogg|m4a|flac|webm|opus)$/, what: 'sound', type: (n: string) => AUDIO[n.split('.').pop()!] ?? 'application/octet-stream', described: true },
} satisfies Record<string, Shelf>;

function nameOf(shelf: Shelf, raw: string): string {
  const name = decodeURIComponent(raw);
  if (!shelf.name.test(name)) throw new HttpError(400, `invalid ${shelf.what} name "${name}": lower case letters, digits, - and _, then its extension`);
  return name;
}

export async function listShelf(bucket: R2Bucket, shelf: Shelf) {
  const out: { name: string; size: number; modified: string; entry?: unknown }[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: shelf.prefix, cursor, ...(shelf.described ? { include: ['customMetadata'] as const } : {}) });
    for (const o of page.objects) {
      let entry: unknown;
      try { entry = o.customMetadata?.entry ? JSON.parse(o.customMetadata.entry) : undefined; } catch { /* unreadable: listed without it */ }
      out.push({ name: o.key.slice(shelf.prefix.length), size: o.size, modified: o.uploaded.toISOString(), ...(entry ? { entry } : {}) });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return json(out.sort((a, b) => a.name.localeCompare(b.name)));
}

export async function getFromShelf(bucket: R2Bucket, shelf: Shelf, raw: string) {
  const obj = await bucket.get(shelf.prefix + nameOf(shelf, raw));
  if (!obj) throw new HttpError(404, `no ${shelf.what} "${decodeURIComponent(raw)}" in the library`);
  return new Response(obj.body, { headers: { 'content-type': shelf.type(raw), 'cache-control': 'no-store' } });
}

export async function putOnShelf(bucket: R2Bucket, shelf: Shelf, raw: string, req: Request) {
  const name = nameOf(shelf, raw);
  const data = await req.arrayBuffer();
  if (data.byteLength > LIMITS.file) throw new HttpError(413, `${shelf.what} too large (${data.byteLength} bytes)`);
  const entry = shelf.described ? req.headers.get('x-tramme-entry') : null;
  if (entry !== null) {
    if (entry.length > ENTRY_MAX) throw new HttpError(413, `description too long (${entry.length} characters, ${ENTRY_MAX} at most)`);
    try { JSON.parse(entry); } catch { throw new HttpError(400, 'x-tramme-entry: JSON expected'); }
  }
  await bucket.put(shelf.prefix + name, data, { httpMetadata: { contentType: shelf.type(name) }, ...(entry !== null ? { customMetadata: { entry } } : {}) });
  return json({ name, size: data.byteLength });
}

export async function deleteFromShelf(bucket: R2Bucket, shelf: Shelf, raw: string) {
  await bucket.delete(shelf.prefix + nameOf(shelf, raw));
  return json({ deleted: decodeURIComponent(raw) });
}
