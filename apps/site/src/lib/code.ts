// Code shown on the page, laid out and colored at build time: the page gets
// spans, never a highlighter.

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** a value on one line: `{ "t": 0, "v": [540, 1700] }` */
function inline(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  if (v && typeof v === 'object') {
    const entries = Object.entries(v);
    return entries.length ? `{ ${entries.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}';
  }
  return JSON.stringify(v);
}

/** JSON as a person writes it: an object or a list stays on one line while
 *  its line fits in `width` (`lead`: what comes before it on that line, its key) */
export function formatJson(v: unknown, width = 76, indent = '', lead = 0): string {
  const one = inline(v);
  if (v === null || typeof v !== 'object' || indent.length + lead + one.length <= width) return one;
  const inner = indent + '  ';
  if (Array.isArray(v)) return `[\n${v.map((x) => inner + formatJson(x, width, inner)).join(',\n')}\n${indent}]`;
  const items = Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${formatJson(x, width, inner, k.length + 4)}`);
  return `{\n${items.join(',\n')}\n${indent}}`;
}

const JSON_TOKEN = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b)/g;

/** JSON as spans. The keys that make a value move ($k, $expr, $mod, $link)
 *  and the token references ("@name") carry data-key, for the page to point at them. */
export function highlightJson(src: string): string {
  let out = '';
  let last = 0;
  for (const m of src.matchAll(JSON_TOKEN)) {
    const [all, str, colon] = m;
    out += escape(src.slice(last, m.index));
    if (str && colon) {
      const key = str.startsWith('"$') ? str.slice(1, -1) : null;
      out += key ? `<span class="c-key c-move" data-key="${key}">${escape(str)}</span>` : `<span class="c-key">${escape(str)}</span>`;
      out += escape(colon);
    } else if (str) {
      out += str.startsWith('"@') ? `<span class="c-str c-move" data-key="@">${escape(str)}</span>` : `<span class="c-str">${escape(str)}</span>`;
    } else {
      out += `<span class="c-num">${escape(all)}</span>`;
    }
    last = m.index! + all.length;
  }
  return out + escape(src.slice(last));
}

/** shell lines as spans: `#` comments, the `$` prompt, the command and its --flags */
export function highlightShell(src: string): string {
  return src.split('\n').map((line) => {
    if (line.startsWith('#')) return `<span class="c-cmt">${escape(line)}</span>`;
    const command = /^\$ (.*)$/.exec(line)?.[1];
    if (command === undefined) return escape(line);
    return `<span class="c-prompt">$</span> <span class="c-cmd">${escape(command).replace(/(--[\w-]+)/g, '<span class="c-flag">$1</span>')}</span>`;
  }).join('\n');
}
