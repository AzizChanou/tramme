// Stable, readable JSON for documents: a value stays on one line when it fits
// in `width` columns (a keyframe, a vector, a short layer), otherwise it opens
// one entry per line. Same input, same text: diffs stay small.

export function stringifyDoc(value: unknown, width = 100): string {
  /** v printed at a line position where `used` columns are taken already */
  const rec = (v: unknown, indent: string, used: number): string => {
    const one = JSON.stringify(v);
    if (v === null || typeof v !== 'object' || used + one.length <= width) return one;
    const inner = indent + '  ';
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return `[\n${v.map((x) => inner + rec(x, inner, inner.length)).join(',\n')}\n${indent}]`;
    }
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
    if (!entries.length) return '{}';
    const lines = entries.map(([k, x]) => {
      const head = `${inner}${JSON.stringify(k)}: `;
      return head + rec(x, inner, head.length);
    });
    return `{\n${lines.join(',\n')}\n${indent}}`;
  };
  return rec(value, '', 0) + '\n';
}
