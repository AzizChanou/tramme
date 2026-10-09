// Documents (PDF) read in the browser with pdf.js, loaded on first use: the
// text of a page, and the page drawn as a picture. pdf.js parses in a worker
// of its own, served beside the editor (/pdf.worker.mjs, copied by the build).

import type { PDFDocumentProxy } from 'pdfjs-dist';

export type { PDFDocumentProxy };

let lib: Promise<typeof import('pdfjs-dist')> | null = null;
const pdfjs = () => (lib ??= import('pdfjs-dist').then((m) => { m.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs'; return m; }));

/** the documents opened, by address: the few last ones stay parsed */
const opened = new Map<string, Promise<{ doc: PDFDocumentProxy; close: () => Promise<void> }>>();
const KEEP = 4;

export async function openPdf(url: string): Promise<PDFDocumentProxy> {
  let entry = opened.get(url);
  if (entry) opened.delete(url);
  else {
    entry = pdfjs().then(async (m) => { const task = m.getDocument({ url }); return { doc: await task.promise, close: () => task.destroy() }; });
    entry.catch(() => opened.delete(url));
  }
  opened.set(url, entry);
  for (const [old, e] of opened) {
    if (opened.size <= KEEP) break;
    opened.delete(old);
    e.then((x) => x.close()).catch(() => {});
  }
  return (await entry).doc;
}

/** the title the document gives itself, if any */
export async function pdfTitle(doc: PDFDocumentProxy): Promise<string> {
  try {
    const { info } = await doc.getMetadata();
    return String((info as { Title?: unknown }).Title ?? '').trim();
  } catch { return ''; }
}

/** the text of a page (from 1), its lines kept */
export async function pageText(doc: PDFDocumentProxy, n: number): Promise<string> {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  let out = '';
  for (const it of content.items) if ('str' in it) out += it.str + (it.hasEOL ? '\n' : '');
  return out.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** a page (from 1) drawn on white, its longest side `size` pixels */
export async function pageImage(doc: PDFDocumentProxy, n: number, size: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: size / Math.max(base.width, base.height) });
  const c = Object.assign(document.createElement('canvas'), { width: Math.ceil(viewport.width), height: Math.ceil(viewport.height) });
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, viewport }).promise;
  return c;
}

/**
 * The pages asked, from 1, within the document: "3", "1-4", "2,5,7", "6-"
 * (to the end). Nothing given or nothing readable: the first `count` pages.
 */
export function pageRange(spec: string | undefined, total: number, count: number): number[] {
  const out: number[] = [];
  for (const part of (spec ?? '').split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d*)\s*)?$/.exec(part);
    if (!m) continue;
    const from = Math.max(1, +m[1]), to = Math.min(total, m[2] === undefined ? from : m[2] === '' ? total : +m[2]);
    for (let n = from; n <= to; n++) if (!out.includes(n)) out.push(n);
  }
  if (!out.length) for (let n = 1; n <= Math.min(total, count); n++) out.push(n);
  return out;
}
