// The assistant's tools, run here in the editor whichever way Claude is
// reached: the document (with the assistant's pending proposal applied), the
// node vocabulary, the engine's values, stills from the same renderer, the
// project's text files, and the tools its plugins bring. The document itself
// only changes through proposals the user applies.

import { applyOps, Evaluator, getAt, isTranscript, pointer, remapTranscript, silences, toolInputIssues, toolOutput, validate, type TrammeDoc, type Op, type Registry, type ToolContext, type Transcript } from '@tramme/core';
import { editorRegistry } from '../vocabulary.ts';
import { DOCUMENT, isChatPath, MANIFEST, pathIssue, srcPath } from '@tramme/project';
import { Renderer, VideoFrames } from '@tramme/render';
import type { ToolResult } from '@tramme/assistant';
import { inputIssues, vocabularyDetail, vocabularyIndex } from './answers.ts';
import { uid } from './calls.ts';
import { api, type AiEvent } from '../api.ts';
import { describeOp, freshId } from '../model.ts';
import { safeName } from '../files.ts';
import { transcribeAsset, transcriptIdOf } from '../speech.ts';
import { TEMPLATES } from '../templates.ts';
import { S } from '../state.ts';
import { t } from '../i18n/index.ts';

const text =(s: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: s }], isError });
const STILL_WIDTH = 768;
const TEXT_FILE = /\.(js|mjs|json|svg)$/i;
/** a file read in parts of this many characters (about 15k tokens) */
const READ_PART = 50_000;

interface Pending { id: string; label: string; ops: Op[]; steps: string[] }

export class ToolRunner {
  pending: Pending | null = null;
  /** the turn's signal, handed to the plugins' tools */
  private signal: AbortSignal = new AbortController().signal;
  /** the last plugin tool's message for the user */
  notice = '';
  private renderer: Renderer | null = null;
  private canvas = document.createElement('canvas');
  /** events for the conversation (images, proposals, reloads), read after each tool */
  events: AiEvent[] = [];
  /** where a running tool reports how far it is (set by the call that runs it) */
  onProgress: ((done: number, total: number, step?: string) => void) | null = null;

  /** the document the tools see: the user's, plus the pending proposal */
  liveDoc(): TrammeDoc {
    const doc = S.doc.peek();
    if (!this.pending) return doc;
    try { return applyOps(doc, this.pending.ops).doc; } catch { return doc; }
  }

  /** a renderer of its own (never the preview's), on the given document */
  private async rendererFor(doc: TrammeDoc, compId?: string): Promise<Renderer> {
    const base = new URL(S.docUrl.peek(), location.href).href;
    if (!this.renderer) this.renderer = await Renderer.open(doc, editorRegistry(), base, this.canvas, { compId, raster: 'gpu' });
    else await this.renderer.setDoc(doc, { compId: compId ?? doc.root, trusted: true });
    return this.renderer;
  }

  /** the vocabulary of a document: the editor's when its plugins are the same */
  private async registry(doc: TrammeDoc): Promise<Registry> {
    const cur = S.doc.peek();
    const same = JSON.stringify(doc.plugins ?? []) === JSON.stringify(cur.plugins ?? []) && (doc.plugins ?? []).every((id) => doc.assets[id]?.src === cur.assets[id]?.src);
    return same ? S.registry.peek() : (await this.rendererFor(doc)).registry;
  }

  /** the user applied or refused the proposal, or wrote a new message without deciding */
  clear() { this.pending = null; }

  dispose() { this.renderer?.dispose(); this.renderer = null; for (const v of this.videos.values()) v.then((x) => x.dispose()).catch(() => {}); this.videos.clear(); }

  // ── video dressing ───────────────────────────────────────────
  private videos = new Map<string, Promise<VideoFrames>>();
  private urlOf(src: string) { return new URL(src, new URL(S.docUrl.peek(), location.href)).href; }

  /** a transcript: of the asset itself (json), or of a sound or video (made now if missing) */
  private async readTranscript(assetId: string): Promise<{ t: Transcript; id: string }> {
    const doc = this.liveDoc(), a = doc.assets[assetId];
    if (!a) throw new Error(`unknown asset: ${assetId}`);
    let id = assetId;
    if (a.type === 'audio' || a.type === 'video') {
      id = transcriptIdOf(assetId);
      if (!S.doc.peek().assets[id]) id = await transcribeAsset(assetId);
    } else if (a.type !== 'json') throw new Error(`${assetId}: a sound, a video or a transcript is expected`);
    const entry = S.doc.peek().assets[id] ?? doc.assets[id];
    const r = await fetch(this.urlOf(entry.src), { cache: 'no-store' });
    const t = await r.json();
    if (!isTranscript(t)) throw new Error(`${id} is not a transcript`);
    return { t, id };
  }

  private async transcript(assetId: string, from?: number, to?: number, words = false): Promise<ToolResult> {
    const { t, id } = await this.readTranscript(assetId);
    const lo = typeof from === 'number' ? from : 0, hi = typeof to === 'number' ? to : Infinity;
    const ws = t.words.filter((w) => w.e > lo && w.s < hi);
    // sentences: a pause or a sentence end closes one
    const lines: string[] = [];
    let cur: typeof ws = [];
    const flush = () => {
      if (!cur.length) return;
      const body = words ? cur.map((w) => `${w.w}@${w.s.toFixed(2)}`).join(' ') : cur.map((w) => w.w).join(' ');
      lines.push(`[${cur[0].s.toFixed(2)}-${cur[cur.length - 1].e.toFixed(2)}] ${body}`);
      cur = [];
    };
    ws.forEach((w, i) => { if (cur.length && w.s - ws[i - 1].e > 0.6) flush(); cur.push(w); if (/[.!?…]$/.test(w.w)) flush(); });
    flush();
    const pauses = silences(t, 0.7).filter((p) => p.to > lo && p.from < hi).map((p) => `${p.from.toFixed(2)}-${p.to.toFixed(2)}`);
    const fillers = ws.filter((w) => /^(euh+|heu+|hum+|bah|ben|uh+|um+|erm)[,.]?$/i.test(w.w)).map((w) => `${w.w}@${w.s.toFixed(2)}`);
    const head = `Transcript "${id}": ${t.language ?? 'language?'}, ${t.duration.toFixed(2)} s, ${t.words.length} words, ${t.keeps ? 'composition time (edit)' : 'file time'}.`;
    return text([head, pauses.length ? `Pauses longer than 0.7 s: ${pauses.join(', ')}` : 'No pause longer than 0.7 s.', fillers.length ? `Hesitations: ${fillers.join(', ')}` : '', '', ...lines].filter((l, i) => l || i === 3).join('\n'));
  }

  private async mediaFrame(assetId: string, t: number): Promise<ToolResult> {
    const a = this.liveDoc().assets[assetId];
    if (!a) return text(`unknown asset: ${assetId}`, true);
    let source: CanvasImageSource, w: number, h: number;
    if (a.type === 'image') {
      const img = new Image();
      img.src = this.urlOf(a.src);
      await img.decode();
      source = img; w = img.naturalWidth; h = img.naturalHeight;
    } else if (a.type === 'video') {
      let v = this.videos.get(assetId);
      if (!v) { v = VideoFrames.open(this.urlOf(a.src)); this.videos.set(assetId, v); }
      const frames = await v;
      await frames.request(t);
      const f = frames.frameAt(t);
      if (!f.image) return text(`no frame at ${t} s`, true);
      source = f.image; w = frames.width; h = frames.height;
    } else return text(`${assetId}: a video or an image is expected`, true);
    const k = Math.min(1, STILL_WIDTH / w), c = document.createElement('canvas');
    c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.86);
    this.events.push({ type: 'item', item: { id: uid(), role: 'assistant', image: { url, caption: `${a.name ?? assetId}${a.type === 'video' ? ` · ${t.toFixed(2)} s` : ''}` } } });
    return { content: [{ type: 'image', data: url.slice(url.indexOf(',') + 1), mimeType: 'image/jpeg' }] };
  }

  /** an edit of a media: the parts kept laid end to end, the transcript remapped, the captions rewired */
  private async cut(input: any): Promise<ToolResult> {
    const doc = this.liveDoc(), assetId = String(input.asset ?? ''), a = doc.assets[assetId];
    if (!a || (a.type !== 'video' && a.type !== 'audio')) return text('a sound or video asset is expected', true);
    const keeps = (input.keeps as { from: number; to: number }[]).map((k) => ({ from: Math.max(0, Number(k.from)), to: Number(k.to) })).filter((k) => k.to > k.from + 0.04);
    if (!keeps.length) return text('no passage to keep', true);
    const compId = input.compId && doc.compositions[input.compId] ? input.compId : S.compId.peek() in doc.compositions ? S.compId.peek() : doc.root;
    const c = doc.compositions[compId], at = Number(input.at ?? 0);
    const prop = a.type === 'video' ? 'video' : 'audio';
    const olds = c.order.filter((id) => c.layers[id]?.type === a.type && (c.layers[id].props?.[prop] as unknown) === assetId);
    const model = olds.length ? c.layers[olds[0]] : null;
    const ops: Op[] = [];
    const layers = { ...c.layers };
    for (const id of olds) { ops.push({ op: 'remove', path: pointer('compositions', compId, 'layers', id) }); delete layers[id]; }
    const order = c.order.filter((id) => !olds.includes(id));
    const ids: string[] = [];
    let cursor = at;
    keeps.forEach((k, i) => {
      const id = freshId(layers, `${a.type === 'video' ? 'take' : 'sound'}-${i + 1}`);
      layers[id] = {} as never;
      const len = k.to - k.from;
      const layer = model
        ? { ...model, name: `${a.name ?? assetId} · ${i + 1}`, in: +cursor.toFixed(4), out: +(cursor + len).toFixed(4), props: { ...model.props, [prop]: assetId, start: +k.from.toFixed(4) } }
        : { type: a.type, name: `${a.name ?? assetId} · ${i + 1}`, in: +cursor.toFixed(4), out: +(cursor + len).toFixed(4), ...(a.type === 'video' ? { transform: { position: [c.width / 2, c.height / 2] } } : {}), props: { [prop]: assetId, start: +k.from.toFixed(4), ...(a.type === 'video' ? { size: [c.width, c.height], fit: 'cover' } : {}) } };
      ops.push({ op: 'add', path: pointer('compositions', compId, 'layers', id), value: layer });
      ids.push(id);
      cursor += len;
    });
    // the edit at the bottom, where the media was
    const first = model ? c.order.indexOf(olds[0]) : 0;
    order.splice(Math.max(0, Math.min(order.length, first)), 0, ...ids);
    ops.push({ op: 'replace', path: pointer('compositions', compId, 'order'), value: order });
    if (input.fitDuration !== false) ops.push({ op: 'replace', path: pointer('compositions', compId, 'duration'), value: +cursor.toFixed(3) });
    // the transcript of the edit, the captions on it
    let note = '';
    try {
      const { t, id: srcId } = await this.readTranscript(assetId);
      const remapped = remapTranscript(t, keeps, at);
      const editId = `${transcriptIdOf(assetId)}-edit`.slice(0, 64);
      const path = `assets/transcripts/${safeName(`${assetId}-edit.json`)}`;
      await api.write(S.project.peek().id, path, new Blob([JSON.stringify(remapped)], { type: 'application/json' }));
      ops.push({ op: doc.assets[editId] ? 'replace' : 'add', path: pointer('assets', editId), value: { type: 'json', src: path, name: `Transcript · ${a.name ?? assetId} · edit` } });
      for (const [id, l] of Object.entries(c.layers)) {
        if (l.type === 'captions' && (l.props?.transcript === srcId || l.props?.transcript === editId)) {
          ops.push({ op: 'replace', path: pointer('compositions', compId, 'layers', id, 'props', 'transcript'), value: editId });
          ops.push({ op: 'add', path: pointer('compositions', compId, 'layers', id, 'props', 'start'), value: 0 });
        }
      }
      // an edit made again: same file, new content
      if (S.doc.peek().assets[editId]) this.events.push({ type: 'reload', assets: [editId] });
      note = ` Transcript of the edit: asset "${editId}" (${remapped.words.length} words, composition time); place the captions, keywords and titles with it.`;
    } catch (e) { note = ` (transcript of the edit not made: ${(e as Error).message})`; }
    const total = cursor - at;
    const r = await this.propose(t('ai.editOfName', { name: a.name ?? assetId }), ops);
    if (r.isError) return r;
    return text(`Edit: ${keeps.length} passage(s), ${total.toFixed(2)} s kept, layers ${ids.join(', ')} from ${at.toFixed(2)} to ${cursor.toFixed(2)} s.${note}
${r.content[0].type === 'text' ? r.content[0].text : ''}`);
  }

  async run(name: string, input: any, signal?: AbortSignal): Promise<ToolResult> {
    this.signal = signal ?? new AbortController().signal;
    // the model reads the error and calls again rather than the tool guessing
    const issues = inputIssues(name, input);
    if (issues.length) return text(`input refused by ${name}:\n${issues.join('\n')}`, true);
    try {
      switch (name) {
        case 'get_document': {
          const doc = this.liveDoc();
          if (!input.path) return text(JSON.stringify(doc));
          const part = getAt(doc, String(input.path));
          return part === undefined ? text(`nothing at ${input.path} in the document`, true) : text(JSON.stringify(part));
        }
        case 'list_nodes': {
          const reg = await this.registry(this.liveDoc());
          return text(Array.isArray(input.types) && input.types.length ? vocabularyDetail(reg, input.types.map(String)) : vocabularyIndex(reg));
        }
        case 'evaluate': {
          const doc = this.liveDoc();
          return text(JSON.stringify(new Evaluator(doc, await this.registry(doc)).value(String(input.address), Number(input.t), input.compId)));
        }
        case 'render_still': return await this.still(Number(input.t), input.compId, input.caption);
        case 'propose_changes': return await this.propose(String(input.label ?? 'Change'), input.ops as Op[]);
        case 'discard_proposal': {
          if (this.pending) this.events.push({ type: 'proposal-clear', id: this.pending.id });
          this.pending = null;
          return text('Proposal dropped.');
        }
        case 'list_files': {
          const { files } = await api.info(S.project.peek().id);
          return text(files.map((f) => `${f.path}\t${f.size} bytes`).join('\n') || '(no files)');
        }
        case 'read_file': return await this.read(String(input.path ?? ''), Number(input.offset ?? 0));
        case 'write_file': return await this.write(String(input.path ?? ''), String(input.content ?? ''));
        case 'get_transcript': return await this.transcript(String(input.asset ?? ''), input.from, input.to, !!input.words);
        case 'media_frame': return await this.mediaFrame(String(input.asset ?? ''), Number(input.t ?? 0));
        case 'cut_media': return await this.cut(input);
        case 'use_tool': return await this.useTool(String(input.name ?? ''), input.input ?? {});
        case 'apply_template': {
          const tpl = TEMPLATES[String(input.template)];
          if (!tpl) return text(`unknown template: ${input.template} (${Object.keys(TEMPLATES).join(', ')})`, true);
          const doc = this.liveDoc(), compId = input.compId && doc.compositions[input.compId] ? input.compId : S.compId.peek() in doc.compositions ? S.compId.peek() : doc.root;
          const { label, ops } = tpl.build(doc, compId, { at: Number(input.at ?? 0), duration: input.duration, text: input.text, subtitle: input.subtitle, transcript: input.transcript, place: input.place });
          return await this.propose(label, ops);
        }
        default: return text(`unknown tool: ${name}`, true);
      }
    } catch (e) {
      return text((e as Error).message, true);
    }
  }

  /** a still of the live document, as a JPEG data URL */
  private async stillUrl(t: number, compId?: string): Promise<string> {
    const doc = this.liveDoc();
    const id = compId && doc.compositions[compId] ? compId : doc.root;
    const r = await this.rendererFor(doc, id);
    r.setScale(Math.min(1, STILL_WIDTH / doc.compositions[id].width));
    await r.renderComplete(t);
    r.render(t);
    // copied right after drawing, before the WebGL canvas is presented
    const copy = document.createElement('canvas');
    copy.width = this.canvas.width; copy.height = this.canvas.height;
    copy.getContext('2d')!.drawImage(this.canvas, 0, 0);
    return copy.toDataURL('image/jpeg', 0.86);
  }

  private async still(t: number, compId: string | undefined, caption?: string): Promise<ToolResult> {
    const url = await this.stillUrl(t, compId);
    this.events.push({ type: 'item', item: { id: uid(), role: 'assistant', image: { url, caption: `${t.toFixed(2)} s${caption ? ` · ${caption}` : ''}` } } });
    return { content: [{ type: 'image', data: url.slice(url.indexOf(',') + 1), mimeType: 'image/jpeg' }] };
  }

  // ── tools brought by the project's plugins ───────────────────
  private toolContext(doc: TrammeDoc, registry: Registry): ToolContext {
    const compId = doc.compositions[S.compId.peek()] ? S.compId.peek() : doc.root;
    return {
      doc, compId, registry,
      time: S.time.peek(),
      selection: S.selection.peek().filter((id) => doc.compositions[compId].layers[id]),
      assetUrl: (id) => { const a = doc.assets[id]; if (!a) throw new Error(`unknown asset: ${id}`); return this.urlOf(a.src); },
      readText: async (path) => (await api.readText(S.project.peek().id, path))?.text ?? null,
      writeFile: async (path, data) => {
        const bad = pathIssue(path);
        const plugin = /^plugins\/.+\.(js|mjs)$/i.test(path);
        if (bad || (!path.startsWith('assets/') && !plugin)) throw new Error(`${path}: ${bad ?? 'a tool writes under assets/, or a plugin under plugins/'}`);
        const id = S.project.peek().id;
        // a computed video (a cut-out mask) may pass the single request limit: sent in parts
        if (typeof data === 'string') await api.write(id, path, new Blob([data], { type: plugin ? 'text/javascript' : /\.json$/i.test(path) ? 'application/json' : 'text/plain' }));
        else await api.writeAny(id, path, data);
        return path;
      },
      renderStill: (t, id) => this.stillUrl(t, id),
      transcript: async (id) => (await this.readTranscript(id)).t,
      signal: this.signal,
      progress: (done, total, step) => this.onProgress?.(done, total, step),
    };
  }

  /** a tool of the project's plugins: its text and images for the assistant, its operations added to the proposal */
  private async useTool(name: string, input: unknown): Promise<ToolResult> {
    this.notice = '';
    const doc = this.liveDoc(), reg = await this.registry(doc);
    if (!reg.hasTool(name)) {
      const names = reg.listTools().map((e) => e.tool.name);
      return text(`unknown tool: ${name}. ${names.length ? `Tools of this project: ${names.join(', ')}.` : 'This project has no tools (list_nodes).'}`, true);
    }
    const { tool, from } = reg.tool(name);
    const issues = toolInputIssues(tool.input, input);
    if (issues.length) return text(`input refused by ${name}:\n${issues.join('\n')}`, true);
    let out;
    try { out = toolOutput(await tool.run(input, this.toolContext(doc, reg))); }
    catch (e) { if (this.signal.aborted) return text(`${name}: stopped by the user`, true); return text(`${name} (plugin ${from}) failed: ${(e as Error).message}`, true); }
    const content: ToolResult['content'] = [];
    for (const img of out.images ?? []) {
      const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,/.exec(img.url);
      if (!m) continue;
      this.events.push({ type: 'item', item: { id: uid(), role: 'assistant', image: { url: img.url, caption: img.caption ?? tool.title ?? name } } });
      content.push({ type: 'image', data: img.url.slice(m[0].length), mimeType: m[1] });
    }
    if (out.reload?.length) this.events.push({ type: 'reload', assets: out.reload });
    // what the user reads after running it from the / menu: its notice, or its text when no proposal card shows the result
    this.notice = out.notice ?? (out.ops?.length ? '' : out.text ?? '');
    const lines = out.text ? [out.text] : [];
    if (out.ops?.length) {
      const r = await this.propose(out.label ?? tool.title ?? name, out.ops);
      const said = r.content[0]?.type === 'text' ? r.content[0].text : '';
      if (r.isError) return text([...lines, said].join('\n'), true);
      lines.push(said);
    }
    content.unshift({ type: 'text', text: lines.join('\n') || `${name}: done.` });
    return { content };
  }

  private async propose(label: string, ops: Op[]): Promise<ToolResult> {
    if (!Array.isArray(ops) || !ops.length) return text('no operations', true);
    const merged = [...(this.pending?.ops ?? []), ...ops];
    let next: TrammeDoc;
    try { next = applyOps(S.doc.peek(), merged).doc; } catch (e) { return text(`operations refused: ${(e as Error).message}`, true); }
    const issues = validate(next, await this.registry(next));
    if (issues.length) return text(`invalid document after these operations, nothing is proposed:\n${issues.slice(0, 30).map((i) => `${i.path}: ${i.message}`).join('\n')}`, true);
    // several steps in one proposal: each one named
    const steps = [...new Set([...(this.pending?.steps ?? []), label])];
    const all = steps.join(' · ');
    this.pending = { id: this.pending?.id ?? uid(), label: all.length > 90 ? `${steps[0]} and ${steps.length - 1} more step(s)` : all, ops: merged, steps };
    this.events.push({ type: 'proposal', id: this.pending.id, label: this.pending.label, ops: merged });
    return text(`Proposal "${this.pending.label}" ready (${merged.length} operations in all). The user sees it as a preview.`);
  }

  private async read(path: string, offset = 0): Promise<ToolResult> {
    if (path === DOCUMENT) return text('read the document with get_document', true);
    const bad = pathIssue(path);
    if (bad) return text(`${path}: ${bad}`, true);
    if (!TEXT_FILE.test(path) || path === MANIFEST || isChatPath(path)) return text('only .js, .mjs, .json and .svg text files can be read', true);
    const f = await api.readText(S.project.peek().id, path);
    if (!f) return text(`file not found: ${path}`, true);
    if (offset === 0 && f.text.length <= READ_PART) return text(f.text);
    if (offset >= f.text.length) return text(`${path} has ${f.text.length} characters: nothing from ${offset}`, true);
    const end = Math.min(f.text.length, offset + READ_PART);
    const more = end < f.text.length ? `; the rest from offset ${end}` : '; end of the file';
    return text(`[${path}: characters ${offset} to ${end} of ${f.text.length}${more}]\n${f.text.slice(offset, end)}`);
  }

  private async write(path: string, content: string): Promise<ToolResult> {
    const bad = pathIssue(path);
    if (bad) return text(`${path}: ${bad}`, true);
    const ok = (/^plugins\/.+\.(js|mjs)$/i.test(path)) || (/^assets\/.+\.(json|svg)$/i.test(path));
    if (!ok) return text('allowed writes: plugins/*.js|mjs and assets/*.json|svg. The document changes through propose_changes.', true);
    await api.write(S.project.peek().id, path, content, { type: /\.(js|mjs)$/i.test(path) ? 'text/javascript' : undefined });
    // a plugin in use is loaded again in the preview
    const assets = Object.entries(S.doc.peek().assets).filter(([, a]) => srcPath(a.src) === path).map(([id]) => id);
    if (assets.length) this.events.push({ type: 'reload', assets });
    return text(`${path} written (${content.length} characters).`);
  }
}

/** a one-line summary of an op, for the proposal card */
export const opLine = (o: Op) => `${o.op}\t${describeOp(S.doc.peek(), o)}`;
