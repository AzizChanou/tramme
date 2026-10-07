// Starlight's `docs` collection, loaded from the repository's own Markdown
// (the pages listed in lib/docs.ts): each file's title comes from its first
// heading, the README is cut at its ## sections, and the links are rewritten
// for the site (to the docs page that holds the file, or to GitHub for the
// rest). In dev, a change to one of these files reloads the docs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Loader, LoaderContext } from 'astro/loaders';
import { PAGES, docHref, docId, type DocPage } from './docs';
import { REPO } from './links';

const FENCE = /^\s*(```|~~~)/;
const LINK = /\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g;

/** each line of a Markdown file, and whether it sits in a fenced code block */
function lines(md: string) {
  let fenced = false;
  return md.split(/\r?\n/).map((text) => {
    const fence = FENCE.test(text);
    const code = fenced || fence;
    if (fence) fenced = !fenced;
    return { text, code };
  });
}

/** a heading's anchor, as GitHub and Starlight write it */
const anchor = (title: string) => title.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');

const plain = (md: string) => md.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_]/g, '').trim();

/** the README's parts: the text above the first ## heading (''), then each section by its title */
function readmeSections(md: string) {
  const parts = new Map<string, string[]>([['', []]]);
  let current = parts.get('')!;
  for (const { text, code } of lines(md)) {
    if (!code && /^# /.test(text)) continue;
    const h2 = !code && /^## (.+)$/.exec(text);
    if (h2) parts.set(h2[1].trim(), (current = [text]));
    else current.push(text);
  }
  return parts;
}

/** a page's title and body, from its file */
function extract(source: string, page: DocPage) {
  if (!page.sections) {
    const all = lines(source);
    const h1 = all.findIndex(({ text, code }) => !code && /^# /.test(text));
    const title = page.title ?? plain(all[h1]?.text.slice(2) ?? page.label);
    return { title, body: all.filter((_, i) => i !== h1).map((l) => l.text).join('\n') };
  }
  const parts = readmeSections(source);
  const chunks = page.sections.map((name) => {
    const chunk = parts.get(name);
    if (!chunk) throw new Error(`docs: no section "${name}" in ${page.file} (page /${docId(page.slug)}/)`);
    return chunk;
  });
  // a page made of one section takes its heading as its title
  if (page.sections.length === 1 && page.sections[0]) {
    return { title: page.title ?? page.sections[0], body: chunks[0].slice(1).join('\n') };
  }
  return { title: page.title ?? page.label, body: chunks.map((c) => c.join('\n')).join('\n') };
}

/** where a README anchor (#the-assistant) now lives: the page made of that section */
function readmeAnchor(hash: string, from: DocPage): { href: string; doc?: DocPage } {
  for (const doc of PAGES) {
    const named = doc.file === 'README.md' && doc.sections?.find((s) => s && anchor(s) === hash);
    if (!named) continue;
    // a section kept as a heading inside the same page stays an anchor
    if (doc === from && doc.sections!.length > 1) break;
    return { href: docHref(doc.slug), doc };
  }
  return { href: `#${hash}` };
}

/** a link of `page`'s file, for the site, and the docs page it now leads to */
function resolve(href: string, page: DocPage, root: URL): { href: string; doc?: DocPage } {
  if (/^[a-z][a-z\d+.-]*:|^\/\//i.test(href)) return { href };
  const [target, hash] = href.split('#');
  if (!target) return page.file === 'README.md' && hash ? readmeAnchor(hash, page) : { href };
  const file = path.posix.normalize(path.posix.join(path.posix.dirname(page.file), target));
  const suffix = hash ? `#${hash}` : '';
  const doc = PAGES.find((p) => p.file === file && (file !== 'README.md' || p.slug === ''));
  if (doc) return { href: docHref(doc.slug) + suffix, doc };
  let dir = false;
  try { dir = fs.statSync(new URL(file, root)).isDirectory(); } catch { /* a link to a missing file stays a file link */ }
  return { href: `${REPO}/${dir ? 'tree' : 'blob'}/main/${file}${suffix}` };
}

/** the page's links, outside code blocks, rewritten for the site; a link
 *  named by its own path (`[docs/document.md](docs/document.md)`) takes the page's name */
function rewriteLinks(body: string, page: DocPage, root: URL) {
  return lines(body)
    .map(({ text, code }) => (code ? text : text.replace(LINK, (_, label: string, href: string, title: string) => {
      const to = resolve(href, page, root);
      const name = to.doc && label.replace(/`/g, '') === href ? to.doc.label : label;
      return `[${name}](${to.href}${title})`;
    })))
    .join('\n');
}

/** the first paragraph, as plain text, for the page's description; the first items of its first list when it opens on one */
function describe(body: string) {
  const para: string[] = [], items: string[] = [];
  for (const { text, code } of lines(body)) {
    const item = !code && /^\s*(?:[-*+]|\d+\.) (.+)$/.exec(text);
    if (item && !para.length && items.length < 3) items.push(item[1].trim());
    if (code || /^\s*([#>|]|[-*+] |\d+\. )/.test(text)) { if (para.length) break; continue; }
    if (!text.trim()) { if (para.length) break; continue; }
    para.push(text.trim());
  }
  const text = plain((para.length ? para : items).join(' '));
  return text.length <= 160 ? text : `${text.slice(0, 157).replace(/\s+\S*$/, '')}...`;
}

export function repoDocs(): Loader {
  return {
    name: 'tramme-docs',
    load: async (context: LoaderContext) => {
      const { config, store, parseData, renderMarkdown, generateDigest, watcher, logger } = context;
      const root = new URL('../../', config.root);
      const files = [...new Set(PAGES.map((p) => fileURLToPath(new URL(p.file, root))))];

      async function loadAll() {
        store.clear();
        for (const page of PAGES) {
          const url = new URL(page.file, root);
          const { title, body: raw } = extract(fs.readFileSync(url, 'utf8'), page);
          const body = rewriteLinks(raw, page, root);
          const id = docId(page.slug);
          const data = await parseData({ id, data: { title, description: describe(body), editUrl: `${REPO}/edit/main/${page.file}` } });
          store.set({ id, data, body, rendered: await renderMarkdown(body, { fileURL: url }), digest: generateDigest(body) });
        }
      }

      await loadAll();
      watcher?.add(files);
      watcher?.on('change', async (changed) => {
        if (!files.includes(path.resolve(changed))) return;
        logger.info(`docs: ${path.basename(changed)} changed, reloading`);
        await loadAll();
      });
    },
  };
}
