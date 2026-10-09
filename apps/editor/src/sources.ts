// The sources of a project: the material a video is made from — pictures,
// footage, sounds and documents (PDF) — brought in at once from the home
// screen (assets/sources/), joined to a message (assets/chat/), or the video
// a project was made from (assets/video/). The sources tool lists them with a
// contact sheet, then reads each one for the assistant: a document page by
// page (its text, and its pages as pictures), a video as frames across its
// length with what is said, a sound by what is said, a picture as it is. What
// the assistant learns goes into the brief (about, sources), so every later
// conversation starts from it.

import type { ToolContext, ToolType, TrammeDoc } from '@tramme/core';
import { srcPath } from '@tramme/project';
import { VideoFrames } from '@tramme/render';
import { clip } from './model.ts';
import { openPdf, pageImage, pageRange, pageText, pdfTitle, type PDFDocumentProxy } from './pdf.ts';
import { canvas, jpegOf, loadImage } from './perception.ts';
import { sheetOf } from './review.ts';
import { KIT_PATH } from './kit.ts';
import { t } from './i18n/index.ts';

/** where the sources a project was made from are kept (pictures, videos, sounds, documents) */
export const SOURCES_DIR = 'assets/sources/';

export type FileKind = 'image' | 'audio' | 'video' | 'document' | 'file';

/** what a file holds, by its type or its extension: a picture, a sound, a video, a document (PDF) */
export function kindOf(f: { name: string; type?: string }): FileKind {
  const ext = f.name.toLowerCase().split('.').pop() ?? '', type = f.type ?? '';
  if (type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'].includes(ext)) return 'image';
  if (type.startsWith('audio/') || ['wav', 'mp3', 'ogg', 'm4a', 'flac'].includes(ext)) return 'audio';
  if (type.startsWith('video/') || ['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  if (type === 'application/pdf' || ext === 'pdf') return 'document';
  return 'file';
}

/** where the material the user brought lives */
const BROUGHT = /^assets\/(sources|chat|video)\//;

export type SourceKind = 'image' | 'video' | 'audio' | 'document';
export interface Source {
  /** how the tool names it: the asset id, or the file path of a document */
  ref: string;
  kind: SourceKind;
  name: string;
  path: string;
  size: number;
  asset?: string;
}

/** the material of the project: the pictures, videos and sounds brought in, and every document */
export function sourcesOf(doc: TrammeDoc, files: { path: string; size: number }[]): Source[] {
  const sizes = new Map(files.map((f) => [f.path, f.size]));
  const out: Source[] = [];
  for (const [id, a] of Object.entries(doc.assets)) {
    if (a.type !== 'image' && a.type !== 'video' && a.type !== 'audio') continue;
    const path = srcPath(a.src);
    if (!path || !BROUGHT.test(path)) continue;
    out.push({ ref: id, kind: a.type, name: a.name ?? id, path, size: sizes.get(path) ?? 0, asset: id });
  }
  for (const f of files) {
    if (/\.pdf$/i.test(f.path)) out.push({ ref: f.path, kind: 'document', name: f.path.split('/').pop()!.replace(/\.pdf$/i, ''), path: f.path, size: f.size });
  }
  return out;
}

const KIND_WORD: Record<SourceKind, string> = { image: 'picture', video: 'video', audio: 'sound', document: 'document' };
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
/** pictures shown to the model: the longest side at most this */
const LOOK = 1024;
/** a contact sheet cell */
const CELL_W = 240, CELL_H = 180;
/** text read from one page at most */
const PAGE_TEXT = 8000;

/** a picture shrunk to fit w × h, centred on dark bands (no stretching) */
function fitted(image: CanvasImageSource, iw: number, ih: number, w: number, h: number): HTMLCanvasElement {
  const { c, g } = canvas(w, h);
  g.fillStyle = '#16191f'; g.fillRect(0, 0, w, h);
  const k = Math.min(w / iw, h / ih), dw = iw * k, dh = ih * k;
  g.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return c;
}

/** a picture as the model sees it: at most `size` px on its longest side, on white, a JPEG data URL */
export const shrunk = (image: CanvasImageSource, iw: number, ih: number, size = LOOK) => jpegOf(image, iw, ih, Math.min(1, size / Math.max(iw, ih)), '#ffffff');

/** a video's frame at t, drawn on a canvas of its own size (the frame is not kept by the decoder) */
async function frameOf(v: VideoFrames, at: number): Promise<HTMLCanvasElement | null> {
  await v.request(at);
  const f = v.frameAt(at);
  if (!f.image) return null;
  const { c, g } = canvas(v.width, v.height);
  g.drawImage(f.image, 0, 0);
  return c;
}

/** what is said in a sound or video, in short (get_transcript gives it all, timed) */
async function speech(ctx: ToolContext, asset: string): Promise<string> {
  try {
    const tr = await ctx.transcript(asset);
    if (!tr.words.length) return 'Nothing is said in it.';
    const said = tr.words.map((w) => w.w).join(' ');
    return `What is said (${tr.language ?? 'language?'}, ${tr.words.length} words${said.length > 3000 ? ', the beginning' : ''}; get_transcript gives it all, timed):\n${clip(said, 3000)}`;
  } catch (e) { return `What is said: unknown (${(e as Error).message}).`; }
}

interface Look { line: string; cell?: CanvasImageSource }

/** one line of the list, and the cell of the contact sheet */
async function glance(s: Source, ctx: ToolContext): Promise<Look> {
  const where = `${s.asset ? `asset "${s.asset}", ` : ''}${s.path}, ${mb(s.size)}`;
  if (s.kind === 'image') {
    const img = await loadImage(ctx.assetUrl(s.asset!));
    return { line: `${img.naturalWidth}×${img.naturalHeight} (${where})`, cell: fitted(img, img.naturalWidth, img.naturalHeight, CELL_W, CELL_H) };
  }
  if (s.kind === 'video') {
    const v = await VideoFrames.open(ctx.assetUrl(s.asset!));
    try {
      const frame = await frameOf(v, Math.min(v.duration * 0.25, 2));
      return { line: `${v.width}×${v.height}, ${v.duration.toFixed(1)} s (${where})`, cell: frame ? fitted(frame, frame.width, frame.height, CELL_W, CELL_H) : undefined };
    } finally { v.dispose(); }
  }
  if (s.kind === 'audio') return { line: `(${where})` };
  const doc = await openPdf(ctx.fileUrl(s.path));
  const title = await pdfTitle(doc);
  const first = await pageImage(doc, 1, 2 * CELL_H);
  return { line: `${doc.numPages} page${doc.numPages > 1 ? 's' : ''}${title ? `, titled "${clip(title, 80)}"` : ''} (${where})`, cell: fitted(first, first.width, first.height, CELL_W, CELL_H) };
}

/** what the kit adds to the list, when the project has one */
const KIT_NOTE = `A kit written from the project's repository is at ${KIT_PATH}: read it first (read_file). It lists the features, the facts with their sources, the brand and ideas of videos; its about, sources, tone and rules are already the project's brief, its colours and fonts the document's. Check what it says against the sources, and ask about what it marks to confirm.`;

/** every source in one list, the visual ones on a contact sheet numbered like the list */
async function inventory(list: Source[], ctx: ToolContext, kit: boolean) {
  if (!list.length && kit) return { text: KIT_NOTE, notice: t('sources.listed', { n: 0 }) };
  if (!list.length) {
    return { text: 'The project has no sources yet: no picture, video, sound or document brought in. Ask the user for theirs (they can join files to a message), or work from what they say.', notice: t('sources.none') };
  }
  const count = (k: SourceKind) => list.filter((s) => s.kind === k).length;
  const lines: string[] = [], cells: { image: CanvasImageSource; label: string }[] = [];
  for (const [i, s] of list.entries()) {
    if (ctx.signal.aborted) throw new Error('stopped');
    ctx.progress?.(i, list.length, s.name);
    let look: Look;
    try { look = await glance(s, ctx); } catch (e) { look = { line: `(${s.path}: unreadable, ${(e as Error).message})` }; }
    lines.push(`${i + 1}. ${KIND_WORD[s.kind]} "${s.name}": ${look.line}; source "${s.ref}"`);
    if (look.cell && cells.length < 24) cells.push({ image: look.cell, label: `${i + 1}. ${clip(s.name, 22)}` });
  }
  const summary = (['document', 'image', 'video', 'audio'] as SourceKind[]).filter(count).map((k) => `${count(k)} ${KIND_WORD[k]}${count(k) > 1 ? 's' : ''}`).join(', ');
  return {
    text: [...(kit ? [KIT_NOTE, ''] : []), `${list.length} source${list.length > 1 ? 's' : ''} (${summary})${cells.length ? ', the visual ones on the contact sheet, numbered as below' : ''}:`, ...lines, '',
      'Read each one with source (its "source" above): documents page by page, videos and sounds with what is said. Then write what you learned in the brief (use_tool "brief" with about and sources).'].join('\n'),
    images: cells.length ? [{ url: sheetOf(cells, CELL_W, CELL_H, Math.min(4, cells.length)), caption: t('sources.sheet', { n: list.length }) }] : [],
    notice: t('sources.listed', { n: list.length }),
  };
}

/** a document's pages: their text, the pages with text on a sheet, the pages without (scans) each large enough to read */
async function readDocument(s: Source, pages: string | undefined, textOnly: boolean, ctx: ToolContext) {
  const doc: PDFDocumentProxy = await openPdf(ctx.fileUrl(s.path));
  const total = doc.numPages, wanted = pageRange(pages, total, textOnly ? 30 : 4).slice(0, textOnly ? 30 : 6);
  const parts: string[] = [], sheet: { image: CanvasImageSource; label: string }[] = [], scans: { url: string; caption: string }[] = [];
  for (const [i, n] of wanted.entries()) {
    if (ctx.signal.aborted) throw new Error('stopped');
    ctx.progress?.(i, wanted.length, `p. ${n}`);
    const words = await pageText(doc, n);
    parts.push(`--- page ${n} ---\n${words ? clip(words, PAGE_TEXT) : '(no text layer: a scan or a picture, read it from its image)'}`);
    if (textOnly) continue;
    if (words.length < 20) {
      const page = await pageImage(doc, n, 1400);
      scans.push({ url: shrunk(page, page.width, page.height, 1400), caption: `${s.name} · p. ${n}` });
    } else {
      const page = await pageImage(doc, n, 2 * 400);
      sheet.push({ image: fitted(page, page.width, page.height, 400, 520), label: `p. ${n}` });
    }
  }
  const last = wanted[wanted.length - 1];
  const next = last < total ? ` Next: pages "${last + 1}-${Math.min(total, last + (textOnly ? 30 : 4))}".` : ' That is the end of the document.';
  const images = [...(sheet.length ? [{ url: sheetOf(sheet, 400, 520, Math.min(3, sheet.length)), caption: `${s.name} · ${sheet.map((x) => x.label).join(', ')}` }] : []), ...scans];
  return {
    text: `Document "${s.name}" (${s.path}): ${total} page${total > 1 ? 's' : ''}; pages ${wanted.join(', ')} below${images.length ? ' (the text, and the pages as pictures for their layout, pictures and colours)' : ''}.${next}\n\n${parts.join('\n\n')}`,
    images,
    notice: t('sources.readDocument', { name: s.name, pages: wanted.join(', ') }),
  };
}

async function readImage(s: Source, ctx: ToolContext) {
  const img = await loadImage(ctx.assetUrl(s.asset!));
  return {
    text: `Picture "${s.name}" (asset "${s.asset}", ${img.naturalWidth}×${img.naturalHeight}). A logo or a brand picture: take its colours as tokens (use_tool "palette" with this asset).`,
    images: [{ url: shrunk(img, img.naturalWidth, img.naturalHeight), caption: s.name }],
    notice: t('sources.readOne', { name: s.name }),
  };
}

async function readVideo(s: Source, ctx: ToolContext) {
  const v = await VideoFrames.open(ctx.assetUrl(s.asset!));
  const cells: { image: CanvasImageSource; label: string }[] = [];
  try {
    const n = 8;
    for (let i = 0; i < n; i++) {
      if (ctx.signal.aborted) throw new Error('stopped');
      ctx.progress?.(i, n, s.name);
      const at = (v.duration * (i + 0.5)) / n, frame = await frameOf(v, at);
      if (frame) cells.push({ image: fitted(frame, frame.width, frame.height, 320, Math.round((320 * v.height) / v.width) || 180), label: `${at.toFixed(1)} s` });
    }
  } finally { v.dispose(); }
  const said = await speech(ctx, s.asset!);
  return {
    text: `Video "${s.name}" (asset "${s.asset}", ${v.width}×${v.height}, ${v.duration.toFixed(1)} s): ${cells.length} frames across its length on the sheet. Look closer with media_frame, find its cuts with use_tool "shots".\n${said}`,
    images: cells.length ? [{ url: sheetOf(cells, 320, Math.round((320 * v.height) / v.width) || 180, 4), caption: s.name }] : [],
    notice: t('sources.readOne', { name: s.name }),
  };
}

async function readSound(s: Source, ctx: ToolContext) {
  return { text: `Sound "${s.name}" (asset "${s.asset}"). Music: analyse it with use_tool "beats".\n${await speech(ctx, s.asset!)}`, notice: t('sources.readOne', { name: s.name }) };
}

const sources: ToolType<{ source?: string; pages?: string; text?: boolean }> = {
  name: 'sources', title: 'Read the sources',
  description: "the material of the project (pictures, videos, sounds and PDF documents brought in): without source, lists them with a contact sheet; with one, reads it: a document's pages as text and pictures, a video's frames across its length and what is said, a sound's words, a picture as it is",
  input: {
    type: 'object',
    properties: {
      source: { type: 'string', title: 'Source', description: 'the asset id or the file path the list gives; none: the list' },
      pages: { type: 'string', title: 'Pages', description: 'a document: the pages to read, as "1-4", "2,5,7" or "6-" (the first four by default, six at most with their pictures)' },
      text: { type: 'boolean', title: 'Text only', description: 'a document: the text of the pages without their pictures, thirty pages at a time' },
    },
  },
  ai: {
    when: 'the project was made from sources, or the user brought pictures, videos or documents: read every one before deciding what the video says and shows, then keep what you learned in the brief',
    avoid: 'deciding the story from the file names or the first page alone; reading the same pages twice',
  },
  async run({ source, pages, text: textOnly = false }, ctx) {
    const files = await ctx.files(), list = sourcesOf(ctx.doc, files);
    if (!source) return inventory(list, ctx, files.some((f) => f.path === KIT_PATH));
    const s = list.find((x) => x.ref === source || x.path === source || x.asset === source)
      ?? (ctx.doc.assets[source] && ['image', 'video', 'audio'].includes(ctx.doc.assets[source].type) ? { ref: source, kind: ctx.doc.assets[source].type as SourceKind, name: ctx.doc.assets[source].name ?? source, path: srcPath(ctx.doc.assets[source].src) ?? '', size: 0, asset: source } : null);
    if (!s) throw new Error(`unknown source "${source}"; the sources are: ${list.map((x) => x.ref).join(', ') || 'none'}`);
    if (s.kind === 'document') return readDocument(s, pages, textOnly, ctx);
    if (s.kind === 'image') return readImage(s, ctx);
    if (s.kind === 'video') return readVideo(s, ctx);
    return readSound(s, ctx);
  },
};

export const SOURCE_TOOLS: ToolType[] = [sources];
