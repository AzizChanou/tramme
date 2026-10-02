// The plugin library: plugins kept outside any project, to be used in
// several. A plugin is copied into a project when used (the project stays
// self-contained: its archive carries it), and a project's plugin can be
// kept in the library. Files live in R2 at library/plugins/<name>.js.

import { LIMITS } from '@tramme/project';
import { HttpError, json } from './http.ts';

const PREFIX = 'library/plugins/';
/** a library plugin's file name: lower case letters, digits, - and _, then .js or .mjs */
export const LIBRARY_NAME = /^[a-z0-9][a-z0-9_-]{0,62}\.(js|mjs)$/;

function nameOf(raw: string): string {
  const name = decodeURIComponent(raw);
  if (!LIBRARY_NAME.test(name)) throw new HttpError(400, `invalid plugin name "${name}": lower case letters, digits, - and _, then .js`);
  return name;
}

export async function listLibrary(bucket: R2Bucket) {
  const out: { name: string; size: number; modified: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix: PREFIX, cursor });
    for (const o of page.objects) out.push({ name: o.key.slice(PREFIX.length), size: o.size, modified: o.uploaded.toISOString() });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return json(out.sort((a, b) => a.name.localeCompare(b.name)));
}

export async function getLibraryPlugin(bucket: R2Bucket, raw: string) {
  const obj = await bucket.get(PREFIX + nameOf(raw));
  if (!obj) throw new HttpError(404, `no plugin "${decodeURIComponent(raw)}" in the library`);
  return new Response(obj.body, { headers: { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function putLibraryPlugin(bucket: R2Bucket, raw: string, req: Request) {
  const name = nameOf(raw);
  const data = await req.arrayBuffer();
  if (data.byteLength > LIMITS.file) throw new HttpError(413, `plugin too large (${data.byteLength} bytes)`);
  await bucket.put(PREFIX + name, data, { httpMetadata: { contentType: 'text/javascript; charset=utf-8' } });
  return json({ name, size: data.byteLength });
}

export async function deleteLibraryPlugin(bucket: R2Bucket, raw: string) {
  await bucket.delete(PREFIX + nameOf(raw));
  return json({ deleted: decodeURIComponent(raw) });
}
