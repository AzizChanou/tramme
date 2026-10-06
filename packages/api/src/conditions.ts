// What R2 reads from a request's headers for a ranged or conditional access,
// for the buckets that are not R2 (IndexedDB in the browser, memory in the
// tests): they must answer as R2 does.

/** the part of an object of `size` bytes a Range header asks for (a single range), or undefined for the whole */
export function rangeOf(headers: Headers | undefined, size: number): { offset: number; length: number } | undefined {
  const m = /^bytes=(\d*)-(\d*)$/.exec(headers?.get('range')?.trim() ?? '');
  if (!m || (!m[1] && !m[2])) return undefined;
  if (!m[1]) {
    const n = Math.min(size, Number(m[2]));
    return { offset: size - n, length: n };
  }
  const start = Number(m[1]);
  if (start >= size) return undefined;
  const end = m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
  return end < start ? undefined : { offset: start, length: end - start + 1 };
}

const tags = (v: string) => v.split(',').map((s) => s.trim().replace(/^W\//, ''));

/** whether If-Match and If-None-Match hold for an object of this (quoted) etag, null when it does not exist */
export function conditionsHold(onlyIf: Headers | undefined, httpEtag: string | null): boolean {
  if (!onlyIf) return true;
  const match = onlyIf.get('if-match'), none = onlyIf.get('if-none-match');
  if (match !== null && !(httpEtag && (match.trim() === '*' || tags(match).includes(httpEtag)))) return false;
  if (none !== null && httpEtag && (none.trim() === '*' || tags(none).includes(httpEtag))) return false;
  return true;
}
