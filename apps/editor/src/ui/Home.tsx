// Home screen: the projects in storage, most recent first; a new project; a
// .tramme archive or a Lottie animation opened from the computer (button or
// drop); the examples. Each card opens its project, its menu renames,
// duplicates, saves the archive on the computer or deletes.

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Manifest } from '@tramme/project';
import { api, ApiError } from '../api.ts';
import { saveBlob } from '../download.ts';
import { safeName } from '../files.ts';
import { ago } from '../model.ts';
import { importArchive, ImportError, importFile, isVideoFile, type Progress } from '../importer.ts';
import { toast } from '../state.ts';
import { MenuHost, Modal, openMenu } from './controls.tsx';
import { Icon } from './icons.tsx';
import { LogoMark } from './Logo.tsx';
import { Toasts } from './App.tsx';
import { SettingsDialog } from './Settings.tsx';
import { HelpButton } from './Help.tsx';
import { personal } from '../mode.ts';
import { offerTours } from '../tours/index.ts';
import { settingsOpen } from '../settings.ts';
import { t } from '../i18n/index.ts';

interface Example { file: string; name: string; description: string; width: number; height: number; duration: number; thumbnail?: string }

const PRESETS: [string, string, number, number][] = [
  ['16x9', t('home.landscape'), 1920, 1080],
  ['9x16', t('home.vertical'), 1080, 1920],
  ['1x1', t('common.square'), 1080, 1080],
  ['4x5', t('home.portrait'), 1080, 1350],
  ['4k', '4K', 3840, 2160],
];

const open = (id: string) => location.assign(`/p/${encodeURIComponent(id)}`);

const dims = (m: { width?: number; height?: number; duration?: number }) =>
  [m.width && m.height ? `${m.width}×${m.height}` : null, m.duration ? `${+m.duration.toFixed(2)} s` : null].filter(Boolean).join(' · ');

function NewProject({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState(t('home.untitled'));
  const [preset, setPreset] = useState('16x9');
  const [size, setSize] = useState<[number, number]>([1920, 1080]);
  const [fps, setFps] = useState(30);
  const [duration, setDuration] = useState(5);
  const [busy, setBusy] = useState(false);
  const pick = (id: string) => {
    setPreset(id);
    const p = PRESETS.find((x) => x[0] === id);
    if (p) setSize([p[2], p[3]]);
  };
  const valid = name.trim() && size.every((v) => Number.isInteger(v) && v >= 16 && v <= 8192) && duration > 0 && duration <= 3600;
  const create = async (e: Event) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const m = await api.create({ name: name.trim(), width: size[0], height: size[1], fps, duration });
      open(m.id);
    } catch (x) { toast(t('home.couldNotCreateError', { error: (x as Error).message }), 'error'); setBusy(false); }
  };
  return (
    <Modal title={t('common.newProject')} onClose={onClose} wide>
      <form class="modal-body" onSubmit={create}>
        <label class="lbl">{t('common.name')}</label>
        <div class="field"><input value={name} autoFocus onFocus={(e) => (e.target as HTMLInputElement).select()} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></div>
        <label class="lbl">{t('common.format')}</label>
        <div class="presets">
          {PRESETS.map(([id, label, w, h]) => (
            <button type="button" key={id} class={preset === id ? 'on' : ''} onClick={() => pick(id)}>
              <span class="shape"><i style={{ aspectRatio: `${w} / ${h}`, [w >= h ? 'width' : 'height']: '100%' }} /></span>
              <span>{label}</span><span class="faint mono">{w}×{h}</span>
            </button>
          ))}
          <button type="button" class={preset === 'custom' ? 'on' : ''} onClick={() => setPreset('custom')}>
            <span class="shape"><Icon name="edit" /></span><span>{t('home.custom')}</span><span class="faint mono">{preset === 'custom' ? `${size[0]}×${size[1]}` : t('home.anySize')}</span>
          </button>
        </div>
        {preset === 'custom' && (
          <div class="inline-fields">
            <div class="field num"><span class="axis">L</span><input type="number" min={16} max={8192} value={size[0]} onInput={(e) => setSize([Math.round(Number((e.target as HTMLInputElement).value)), size[1]])} /><span class="unit">px</span></div>
            <div class="field num"><span class="axis">H</span><input type="number" min={16} max={8192} value={size[1]} onInput={(e) => setSize([size[0], Math.round(Number((e.target as HTMLInputElement).value))])} /><span class="unit">px</span></div>
          </div>
        )}
        <div class="inline-fields">
          <div>
            <label class="lbl">{t('common.frameRate')}</label>
            <div class="seg">{[24, 25, 30, 50, 60].map((f) => <button type="button" key={f} class={fps === f ? 'on' : ''} onClick={() => setFps(f)}>{f}</button>)}</div>
          </div>
          <div>
            <label class="lbl">{t('common.duration')}</label>
            <div class="field num"><input type="number" min={0.1} max={3600} step={0.1} value={duration} onInput={(e) => setDuration(Number((e.target as HTMLInputElement).value))} /><span class="unit">s</span></div>
          </div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" class="btn primary" disabled={!valid || busy}><Icon name={busy ? 'spinner' : 'plus'} />{t('home.createProject')}</button>
        </div>
      </form>
    </Modal>
  );
}

function Rename({ project, onClose, onDone }: { project: Manifest; onClose: () => void; onDone: (m: Manifest) => void }) {
  const [name, setName] = useState(project.name);
  const save = async (e: Event) => {
    e.preventDefault();
    if (!name.trim()) return;
    try { onDone(await api.update(project.id, { name: name.trim() })); onClose(); }
    catch (x) { toast(t('common.couldNotRenameError', { error: (x as Error).message }), 'error'); }
  };
  return (
    <Modal title={t('common.rename')} onClose={onClose}>
      <form class="modal-body" onSubmit={save}>
        <div class="field"><input value={name} autoFocus onFocus={(e) => (e.target as HTMLInputElement).select()} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></div>
        <div class="modal-foot">
          <button type="button" class="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" class="btn primary" disabled={!name.trim()}>{t('common.rename')}</button>
        </div>
      </form>
    </Modal>
  );
}

function Remove({ project, onClose, onDone }: { project: Manifest; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try { await api.remove(project.id); onDone(); onClose(); }
    catch (x) { toast(t('home.couldNotDeleteError', { error: (x as Error).message }), 'error'); setBusy(false); }
  };
  return (
    <Modal title={t('home.deleteProject')} onClose={onClose}>
      <div class="modal-body">
        <p>{t('home.nameAndAllIts', { name: project.name })}</p>
        <div class="modal-foot">
          <button class="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button class="btn danger-solid" disabled={busy} onClick={remove}><Icon name="trash" />{t('common.delete')}</button>
        </div>
      </div>
    </Modal>
  );
}

function Failure({ error, onClose }: { error: ImportError | Error; onClose: () => void }) {
  const issues = error instanceof ImportError ? error.issues : error instanceof ApiError ? error.issues ?? [] : [];
  return (
    <Modal title={t('home.importFailed')} onClose={onClose} wide>
      <div class="modal-body">
        <p>{error.message}</p>
        {issues.length > 0 && <ul class="issues mono">{issues.slice(0, 30).map((i, n) => <li key={n}><b>{i.path || '/'}</b> {i.message}</li>)}</ul>}
        {issues.length > 30 && <p class="faint">{t('home.andNMore', { n: issues.length - 30 })}</p>}
        <div class="modal-foot"><button class="btn primary" onClick={onClose}>{t('common.close')}</button></div>
      </div>
    </Modal>
  );
}

function Card({ m, onMenu }: { m: Manifest; onMenu: (e: MouseEvent) => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <div class="card" role="button" tabIndex={0} onClick={() => open(m.id)} onKeyDown={(e) => e.key === 'Enter' && open(m.id)} onContextMenu={(e) => { e.preventDefault(); onMenu(e); }}>
      <div class="card-thumb">
        {m.thumbnail && !broken
          ? <img src={`${api.fileUrl(m.id, m.thumbnail)}?v=${encodeURIComponent(m.modified)}`} alt="" loading="lazy" onError={() => setBroken(true)} />
          : <span class="frame" style={{ aspectRatio: `${m.width ?? 16} / ${m.height ?? 9}` }}><Icon name="film" /></span>}
      </div>
      <div class="card-meta">
        <div class="card-name" title={m.name}>{m.name}</div>
        <div class="card-sub">{[dims(m), ago(m.modified)].filter(Boolean).join(' · ')}</div>
      </div>
      <button class="icon-btn sm card-more" title={t('home.actions')} onClick={(e) => { e.stopPropagation(); onMenu(e); }}><Icon name="more" /></button>
    </div>
  );
}

export function Home() {
  const [projects, setProjects] = useState<Manifest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [examples, setExamples] = useState<Example[]>([]);
  const [dialog, setDialog] = useState<null | { kind: 'new' } | { kind: 'rename' | 'remove'; m: Manifest } | { kind: 'failure'; error: Error }>(null);
  const [busy, setBusy] = useState<{ label: string; done: number; total: number; bytes?: boolean } | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLInputElement>(null);

  const refresh = () => api.list().then(setProjects).catch((e) => setLoadError((e as Error).message));
  // the home tour, the first time, once the page has its content
  useEffect(() => { if (projects !== null) { const timer = setTimeout(() => offerTours('home'), 500); return () => clearTimeout(timer); } }, [projects !== null]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); settingsOpen.value = !settingsOpen.value; } };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    document.title = `${t('home.projects')} · tramme`;
    refresh();
    fetch('/examples/index.json').then((r) => (r.ok ? r.json() : [])).then(setExamples).catch(() => {});
  }, []);

  const run = async (label: string, job: (progress: Progress) => Promise<Manifest>, bytes = false) => {
    if (busy) return;
    setBusy({ label, done: 0, total: 1, bytes });
    try {
      const m = await job((done, total) => setBusy({ label, done, total, bytes }));
      open(m.id);
    } catch (e) {
      setBusy(null);
      setDialog({ kind: 'failure', error: e as Error });
    }
  };
  const openFiles = (files: FileList | File[] | null) => {
    const f = files?.[0];
    if (f) run(isVideoFile(f) ? t('home.uploadingTheVideoName', { name: f.name }) : t('home.importingName', { name: f.name }), (p) => importFile(f, p), isVideoFile(f));
  };
  const useExample = (x: Example) => run(t('home.copyingTheExampleName', { name: t(x.name) }), async (p) => {
    const r = await fetch(`/examples/${x.file}`);
    if (!r.ok) throw new Error(t('home.exampleNotFoundHttp', { status: r.status }));
    return importArchive(await r.blob(), p);
  });
  const menu = (e: MouseEvent, m: Manifest) => openMenu(e, [
    { label: t('common.open'), icon: 'folder', onClick: () => open(m.id) },
    { label: t('common.rename'), icon: 'edit', onClick: () => setDialog({ kind: 'rename', m }) },
    { label: t('common.duplicate'), icon: 'copy', onClick: async () => { try { await api.duplicate(m.id); refresh(); } catch (x) { toast(t('home.couldNotDuplicateError', { error: (x as Error).message }), 'error'); } } },
    { label: t('home.saveToComputerTramme'), icon: 'download', onClick: async () => {
      try {
        const r = await fetch(api.exportUrl(m.id));
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await saveBlob(await r.blob(), `${safeName(m.name)}.tramme`);
      } catch (x) { toast(t('home.couldNotExportError', { error: (x as Error).message }), 'error'); }
    } },
    'sep',
    { label: t('common.delete'), icon: 'trash', onClick: () => setDialog({ kind: 'remove', m }) },
  ]);

  return (
    <div class={`home${drag ? ' dragging' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (e.target === e.currentTarget) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); openFiles(e.dataTransfer?.files ?? null); }}>
      <header class="home-top">
        <div class="brand"><LogoMark /><span>tramme</span></div>
        <span class="grow" />
        <HelpButton page="home" />
        <button class="icon-btn" data-tour="settings" title={t('common.settingsCtrl')} onClick={() => { settingsOpen.value = true; }}><Icon name="gear" /></button>
        <button class="btn" data-tour="home-open" onClick={() => input.current?.click()}><Icon name="upload" /><span class="label">{t('common.openAFile')}</span></button>
        <button class="btn" data-tour="home-video" title={t('home.aProjectAtThe')} onClick={() => video.current?.click()}><Icon name="film" /><span class="label">{t('home.fromAVideo')}</span></button>
        <button class="btn primary" data-tour="home-new" onClick={() => setDialog({ kind: 'new' })}><Icon name="plus" /><span class="label">{t('common.newProject')}</span></button>
        <input ref={input} type="file" accept=".tramme,.trame,.emotion,.zip,.json,application/json" hidden onChange={(e) => { openFiles((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />
        <input ref={video} type="file" accept="video/*,.mp4,.mov,.webm,.mkv" hidden onChange={(e) => { openFiles((e.target as HTMLInputElement).files); (e.target as HTMLInputElement).value = ''; }} />
      </header>
      <main class="home-main">
        <section data-tour="home-projects">
          <div class="home-h"><h2>{t('home.projects')}</h2>{projects && projects.length > 0 && <span class="faint">{projects.length}</span>}</div>
          {/* personal mode: nothing is kept on the server, the user should know where the projects are */}
          {personal && <div class="home-note"><Icon name="info" /><span>{t('personal.storedHere')}</span></div>}
          {loadError && <div class="home-note err"><Icon name="alert" /><span>{t('home.projectsCannotBeRead', { error: loadError })}</span></div>}
          {!projects && !loadError && <div class="cards">{[0, 1, 2].map((i) => <div key={i} class="card ghost-card"><div class="card-thumb" /><div class="card-meta"><i /><i /></div></div>)}</div>}
          {projects && projects.length === 0 && (
            <div class="home-empty">
              <Icon name="film" />
              <div><b>{t('home.noProjectsYet')}</b></div>
              <div class="faint">{t('home.createAProjectStart')}</div>
              <button class="btn primary" onClick={() => setDialog({ kind: 'new' })}><Icon name="plus" />{t('common.newProject')}</button>
            </div>
          )}
          {projects && projects.length > 0 && <div class="cards">{projects.map((m) => <Card key={m.id} m={m} onMenu={(e) => menu(e, m)} />)}</div>}
        </section>
        {examples.length > 0 && (
          <section data-tour="home-examples">
            <div class="home-h"><h2>{t('home.examples')}</h2><span class="faint">{t('home.aCopyBecomesYour')}</span></div>
            <div class="examples">
              {examples.map((x) => (
                <button key={x.file} class="example" onClick={() => useExample(x)}>
                  <span class="example-thumb">{x.thumbnail ? <img src={`/examples/${x.thumbnail}`} alt="" loading="lazy" /> : <span class="frame" style={{ aspectRatio: `${x.width} / ${x.height}` }}><Icon name="film" /></span>}</span>
                  <span class="example-text" title={t(x.description)}><b>{t(x.name)}</b><span class="faint example-about">{t(x.description)}</span><span class="faint mono">{dims(x)}</span></span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
      {drag && <div class="drop-hint"><Icon name="upload" /><span>{t('home.dropATrammeProject')}</span></div>}
      {busy && (
        <div class="modal-back"><div class="modal">
          <div class="modal-body">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Icon name="spinner" /><span>{busy.label}</span></div>
            <div class="progress"><i style={{ width: `${(100 * busy.done) / Math.max(1, busy.total)}%` }} /></div>
            <div class="faint mono" style={{ fontSize: 11 }}>{busy.bytes ? t('home.doneTotalMb', { done: (busy.done / 1e6).toFixed(1), total: (busy.total / 1e6).toFixed(1) }) : t('home.doneTotalFileS', { done: busy.done, total: busy.total })}</div>
          </div>
        </div></div>
      )}
      {dialog?.kind === 'new' && <NewProject onClose={() => setDialog(null)} />}
      {dialog?.kind === 'rename' && <Rename project={dialog.m} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'remove' && <Remove project={dialog.m} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'failure' && <Failure error={dialog.error} onClose={() => setDialog(null)} />}
      <SettingsDialog />
      <MenuHost />
      <Toasts />
    </div>
  );
}
