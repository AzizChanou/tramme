// Bringing files into storage as new projects: a .tramme archive (checked
// for structure, then for meaning with its plugins loaded), a Lottie
// animation, an example. Nothing reaches storage before the checks pass.

import { stringifyDoc, validate, type TrammeDoc, type Registry } from '@tramme/core';
import { fromLottie } from '@tramme/interop';
import { builtinRegistry } from '@tramme/nodes';
import { checkProject, DOCUMENT, MANIFEST, newProject, srcPath, unpackProject, type Issue, type Manifest } from '@tramme/project';
import { probeVideo } from '@tramme/render';
import { api } from './api.ts';
import { safeName } from './files.ts';
import { t } from './i18n/index.ts';

export class ImportError extends Error {
  issues: Issue[];
  constructor(message: string, issues: Issue[] = []) { super(message); this.issues = issues; }
}

export type Progress = (done: number, total: number, label: string) => void;

/** the document's plugins, imported from the archive's own files */
async function registryOf(doc: TrammeDoc, files: Map<string, Uint8Array>): Promise<Registry> {
  const reg = builtinRegistry().clone();
  for (const id of doc.plugins || []) {
    const path = srcPath(doc.assets[id]?.src ?? '');
    const data = path ? files.get(path) : undefined;
    if (!data) throw new ImportError(t('importer.pluginIdNotFound', { id }));
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'text/javascript' }));
    try { reg.use(await import(/* @vite-ignore */ url), id); }
    catch (e) { throw new ImportError(t('importer.unreadablePluginIdError', { id, error: (e as Error).message })); }
    finally { URL.revokeObjectURL(url); }
  }
  return reg;
}

/** the files of an archive, checked: structure, then the document's meaning */
export async function readArchive(data: Uint8Array): Promise<{ files: Map<string, Uint8Array>; manifest: Manifest; doc: TrammeDoc }> {
  let files: Map<string, Uint8Array>;
  try { files = unpackProject(data); } catch (e) { throw new ImportError((e as Error).message); }
  for (const k of [...files.keys()]) if (k.startsWith('renders/')) files.delete(k);
  const { issues, manifest, doc } = checkProject(files);
  if (issues.length || !manifest || !doc) throw new ImportError(t('importer.thisFileIsNot'), issues);
  const meaning = validate(doc, await registryOf(doc, files)).map((i) => ({ path: `${DOCUMENT}${i.path}`, message: i.message }));
  if (meaning.length) throw new ImportError(t('importer.theProjectSDocument'), meaning);
  return { files, manifest, doc };
}

/** write files into a new project, the document last; the project is removed if anything fails */
async function fill(project: Manifest, files: Map<string, Uint8Array | string>, progress?: Progress): Promise<Manifest> {
  const rest = [...files.keys()].filter((p) => p !== MANIFEST && p !== DOCUMENT);
  const total = rest.length + 1;
  let done = 0;
  try {
    const queue = [...rest];
    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        const body = files.get(p)!;
        await api.writeAny(project.id, p, typeof body === 'string' ? new Blob([body]) : new Blob([body as BlobPart]));
        progress?.(++done, total, p);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const doc = files.get(DOCUMENT)!;
    await api.write(project.id, DOCUMENT, typeof doc === 'string' ? doc : new Blob([doc as BlobPart]), { type: 'application/json' });
    progress?.(total, total, DOCUMENT);
    const thumb = rest.find((p) => /^thumbnail\.(webp|png|jpg)$/.test(p));
    return thumb ? await api.update(project.id, { thumbnail: thumb }) : project;
  } catch (e) {
    await api.remove(project.id).catch(() => {});
    throw e;
  }
}

/** a .tramme archive as a new project (always a new id: nothing is overwritten) */
export async function importArchive(file: Blob, progress?: Progress): Promise<Manifest> {
  const { files, manifest, doc } = await readArchive(new Uint8Array(await file.arrayBuffer()));
  const root = doc.compositions[doc.root];
  const project = await api.create({ name: manifest.name, created: manifest.created, width: root?.width, height: root?.height, fps: root?.fps, duration: root?.duration, empty: true });
  return fill(project, files, progress);
}

/** a Lottie animation as a new project */
export async function importLottie(file: File, progress?: Progress): Promise<Manifest> {
  let json: unknown;
  try { json = JSON.parse(await file.text()); } catch { throw new ImportError('unreadable JSON'); }
  if (!json || typeof json !== 'object' || !('layers' in json) || !('fr' in json)) throw new ImportError(t('importer.thisJsonIsNeither'));
  const { doc, files, warnings } = fromLottie(json as never);
  const issues = validate(doc, builtinRegistry());
  if (issues.length) throw new ImportError(t('importer.invalidLottieConversion'), issues);
  const name = file.name.replace(/(\.lottie)?\.json$/i, '') || 'Lottie';
  doc.meta.title = name;
  const root = doc.compositions[doc.root];
  const project = await api.create({ name, width: root.width, height: root.height, fps: root.fps, duration: root.duration, empty: true });
  const all = new Map<string, Uint8Array | string>(files.map((f) => [f.path, f.data]));
  all.set(DOCUMENT, stringifyDoc(doc));
  const done = await fill(project, all, progress);
  if (warnings.length) console.info('[tramme] import Lottie :', warnings);
  return done;
}

/** where the editor finds, on first opening, the video a project was made from */
export const startKey = (id: string) => `tramme.start.${id}`;

/**
 * A video as a new project: the composition takes its size, cadence and
 * length, the video sits on a layer, ready to be dressed with the assistant.
 * Progress counts bytes sent.
 */
export async function importVideo(file: File, progress?: Progress): Promise<Manifest> {
  let info: Awaited<ReturnType<typeof probeVideo>>;
  try { info = await probeVideo(file); } catch (e) { throw new ImportError(`${file.name} : ${(e as Error).message}`); }
  if (!info.decodable) throw new ImportError(t('importer.nameVideoCodecNot', { name: file.name, codec: info.codec ?? t('common.unknown') }));
  if (!(info.duration > 0)) throw new ImportError(t('importer.nameUnreadableDuration', { name: file.name }));
  const even = (n: number) => Math.max(16, Math.min(8192, Math.round(n / 2) * 2));
  const width = even(info.width), height = even(info.height);
  const fps = Math.max(1, Math.min(120, Math.round(info.fps) || 30));
  const duration = Math.min(3600, Math.round(info.duration * 1000) / 1000);
  const name = file.name.replace(/\.[^.]+$/, '').trim() || t('importer.video');
  const project = await api.create({ name, width, height, fps, duration, empty: true });
  try {
    const path = `assets/video/${safeName(file.name)}`;
    await api.writeAny(project.id, path, file, (sent, total) => progress?.(sent, total, path));
    const { doc } = newProject({ name, width, height, fps, duration, id: project.id });
    const asset = safeName(name).replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'video';
    doc.assets[asset] = { type: 'video', src: path, name };
    const c = doc.compositions[doc.root];
    c.layers.video = { type: 'video', name, in: 0, out: duration, transform: { position: [width / 2, height / 2] }, props: { video: asset, size: [width, height], fit: 'cover' } } as never;
    c.order = ['video'];
    const issues = validate(doc, builtinRegistry());
    if (issues.length) throw new ImportError(t('importer.invalidVideoProject'), issues);
    await api.write(project.id, DOCUMENT, stringifyDoc(doc), { type: 'application/json' });
    try { sessionStorage.setItem(startKey(project.id), JSON.stringify({ asset, path, name: file.name, size: file.size })); } catch { /* the editor opens without the greeting */ }
    return project;
  } catch (e) {
    await api.remove(project.id).catch(() => {});
    throw e;
  }
}

export const isVideoFile = (f: File) => f.type.startsWith('video/') || /\.(mp4|m4v|webm|mov|mkv)$/i.test(f.name);

/** a file dropped or chosen on the home screen */
export function importFile(file: File, progress?: Progress): Promise<Manifest> {
  // .trame, .emotion: an archive saved under a former name of the tool, converted on import
  if (/\.(tramme|trame|emotion|zip)$/i.test(file.name)) return importArchive(file, progress);
  if (/\.json$/i.test(file.name)) return importLottie(file, progress);
  if (isVideoFile(file)) return importVideo(file, progress);
  return Promise.reject(new ImportError(t('importer.nameATrammeProject', { name: file.name })));
}

