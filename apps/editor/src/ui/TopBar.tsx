// Top bar: project, history, format, frame rate, export.

import { useRef, useState } from 'preact/hooks';
import { pointer } from '@tramme/core';
import { api } from '../api.ts';
import { saveBlob } from '../download.ts';
import { safeName, takenPaths, upload } from '../files.ts';
import { canRedo, canUndo, comp, commit, redo, redoLabel, S, saveNow, toast, undo, undoLabel } from '../state.ts';
import { fmtSeconds } from '../model.ts';
import { openMenu, Popover, Select, type MenuItem } from './controls.tsx';
import { VIDEO, WEB_FORMATS, type WebFormat } from '../formats.ts';
import { Icon } from './icons.tsx';
import { LogoMark } from './Logo.tsx';
import { settingsOpen, setPrefs, prefs, DISPLAYS } from '../settings.ts';
import { HelpButton, helpMenu } from './Help.tsx';
import { t } from '../i18n/index.ts';

const FORMATS: [string, string, number, number][] = [
  ['9x16', '9:16 · 1080×1920', 1080, 1920],
  ['4x5', '4:5 · 1080×1350', 1080, 1350],
  ['1x1', '1:1 · 1080×1080', 1080, 1080],
  ['16x9', '16:9 · 1920×1080', 1920, 1080],
  ['4k', '16:9 · 3840×2160', 3840, 2160],
];

interface Done { blob: Blob; name: string; seconds: number; warnings: string[]; saved?: string }

function ExportPop({ anchor, onClose }: { anchor: HTMLElement; onClose: () => void }) {
  const c = comp.value;
  const [format, setFormat] = useState<WebFormat>('mp4');
  const [samples, setSamples] = useState('doc');
  const [state, setState] = useState<{ done: number; total: number } | Done | { error: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const running = state !== null && 'total' in state;
  const video = VIDEO.has(format);
  const run = async () => {
    const t0 = performance.now(), at = S.time.peek();
    abort.current = new AbortController();
    setState({ done: 0, total: video ? Math.round(c.duration * c.fps) : 1 });
    try {
      const { exportInBrowser } = await import('../webexport.ts');
      const r = await exportInBrowser(S.doc.peek(), new URL(S.docUrl.peek(), location.href).href, format, {
        compId: S.compId.peek(), registry: S.registry.peek(), t: at, signal: abort.current.signal,
        samples: samples === 'doc' ? undefined : Number(samples),
        onProgress: (done, total) => { if (done % 3 === 0 || done === total) setState({ done, total }); },
      });
      const stem = safeName(S.project.peek().name);
      const name = format === 'svg' ? `${stem}_${at.toFixed(2)}.svg` : `${stem}.${r.ext}`;
      setState({ blob: r.blob, name, seconds: (performance.now() - t0) / 1000, warnings: r.warnings });
    } catch (e) {
      setState((e as Error).name === 'AbortError' ? null : { error: (e as Error).message });
    } finally { abort.current = null; }
  };
  // a copy in the project's renders/ folder (kept out of .tramme archives)
  const keep = async (done: Done) => {
    try {
      const path = await upload(await takenPaths(), `renders/${done.name.replace(/\.png\.zip$/, '.zip').replace(/\.lottie\.json$/, '.json')}`, done.blob);
      setState({ ...done, saved: path });
    } catch (e) { toast(t('topbar.couldNotSaveTo', { error: (e as Error).message }), 'error'); }
  };
  return (
    <Popover anchor={anchor} onClose={running ? () => {} : onClose} class="export-pop" align="right">
      <div style={{ fontWeight: 600 }}>{t('common.export')}</div>
      <div class="export-formats">
        {WEB_FORMATS.map(([id, label, hint]) => (
          <button key={id} class={format === id ? 'on' : ''} disabled={running} onClick={() => { setFormat(id); setState(null); }}>
            <span>{t(label)}</span><span class="faint">{t(hint)}</span>
          </button>
        ))}
      </div>
      <div class="row"><span class="muted">{t('common.image')}</span><span class="mono">{c.width}×{c.height} · {t('common.nFps', { n: c.fps })} · {fmtSeconds(c.duration)}</span></div>
      {video && <div class="row"><span class="muted">{t('topbar.blur')}</span>
        <Select value={samples} options={[['doc', t('topbar.documentSetting')], ['1', t('topbar.noBlurFast')], ['8', t('topbar.nSubFrames', { n: 8 })], ['16', t('topbar.nSubFrames', { n: 16 })]]} onChange={setSamples} />
      </div>}
      {state && 'total' in state && video && <>
        <div class="progress"><i style={{ width: `${(100 * state.done) / Math.max(1, state.total)}%` }} /></div>
        <div class="faint mono" style={{ fontSize: 11 }}>{t('common.frameDoneTotal', { done: state.done, total: state.total })}</div>
      </>}
      {state && 'blob' in state && <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ color: 'var(--ok)' }}>{t('topbar.doneInSS', { s: state.seconds.toFixed(1) })}</div>
        <div class="mono faint" style={{ fontSize: 11, userSelect: 'text', wordBreak: 'break-all' }}>{state.name} · {t('topbar.nMb', { n: (state.blob.size / 1e6).toFixed(2) })}</div>
        {state.warnings.length > 0 && <ul class="export-warn">{state.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <button class="btn sm" onClick={() => saveBlob(state.blob, state.name)}><Icon name="download" />{t('topbar.saveToComputer')}</button>
          {state.saved
            ? <span class="faint" style={{ fontSize: 11 }}>{t('topbar.keptInPath', { path: state.saved })}</span>
            : <button class="btn sm" onClick={() => keep(state)}><Icon name="folder" />{t('topbar.keepInTheProject')}</button>}
        </div>
      </div>}
      {state && 'error' in state && <div class="prop-note err">{state.error}</div>}
      {running
        ? <button class="btn" onClick={() => abort.current?.abort()}><Icon name="stop" />{t('topbar.cancelExport')}</button>
        : <button class="btn primary" onClick={run}><Icon name="download" />{t('common.export')}</button>}
    </Popover>
  );
}

/** back to the projects, once the last changes are saved */
async function leave(e: MouseEvent) {
  e.preventDefault();
  try { await saveNow(); location.assign('/'); } catch (x) { toast(t('common.couldNotSaveError', { error: (x as Error).message }), 'error'); }
}

async function rename(value: string) {
  const name = value.trim();
  if (!name || name === S.project.peek().name) return;
  try {
    S.project.value = await api.update(S.project.peek().id, { name });
    document.title = `${name} · tramme`;
    if (S.doc.peek().meta.title !== name) commit(t('topbar.projectName'), [{ op: 'replace', path: '/meta/title', value: name }]);
  } catch (e) { toast(t('common.couldNotRenameError', { error: (e as Error).message }), 'error'); }
}

const FPS = [24, 25, 30, 50, 60];

/** format, frame rate, compositions, help and settings, for the narrow bar */
const DISPLAY_LABEL: Record<string, string> = { editor: t('app.displayEditor'), cinema: t('app.displayCinema'), conversation: t('app.displayConversation') };

function moreMenu(e: MouseEvent, o: { fmt: string; fps: number; setFormat: (id: string) => void; setFps: (n: number) => void; comps: [string, string][] }) {
  const btn = e.currentTarget as HTMLElement, r = btn.getBoundingClientRect();
  const items: MenuItem[] = [];
  if (o.comps.length) items.push({ section: t('common.composition') }, ...o.comps.map(([id, name]): MenuItem => ({ label: name, icon: id === S.compId.peek() ? 'check' : undefined, onClick: () => { S.compId.value = id; S.selection.value = []; } })), 'sep');
  items.push({ section: t('common.format') }, ...FORMATS.map(([id, label]): MenuItem => ({ label, icon: id === o.fmt ? 'check' : undefined, onClick: () => o.setFormat(id) })));
  items.push('sep', { section: t('common.frameRate') }, ...FPS.map((n): MenuItem => ({ label: t('common.nFps', { n }), icon: n === o.fps ? 'check' : undefined, onClick: () => o.setFps(n) })));
  items.push('sep',
    { section: t('app.display') },
    ...DISPLAYS.map((id): MenuItem => ({ label: DISPLAY_LABEL[id], icon: prefs.value.display === id ? 'check' : undefined, onClick: () => setPrefs({ display: id }) })),
    'sep',
    { label: t('common.helpAndGuidedTours'), icon: 'help', onClick: () => helpMenu({ currentTarget: btn } as unknown as MouseEvent, 'editor') },
    { label: t('common.settings'), icon: 'gear', onClick: () => { settingsOpen.value = true; } });
  openMenu({ clientX: r.right, clientY: r.bottom + 4 }, items);
}

export function TopBar() {
  const doc = S.doc.value, c = comp.value, save = S.save.value, project = S.project.value;
  const [exp, setExp] = useState<HTMLElement | null>(null);
  const cp = pointer('compositions', S.compId.value);
  const fmt = FORMATS.find((f) => f[2] === c.width && f[3] === c.height)?.[0] ?? 'custom';
  const setFormat = (id: string) => {
    const f = FORMATS.find((x) => x[0] === id);
    if (!f) return;
    commit(t('topbar.formatName', { name: f[1] }), [{ op: 'replace', path: `${cp}/width`, value: f[2] }, { op: 'replace', path: `${cp}/height`, value: f[3] }]);
  };
  const comps = Object.entries(doc.compositions);
  return (
    <header class="topbar">
      <a class="brand" href="/" title={t('topbar.allProjects')} onClick={leave}><LogoMark /><span>tramme</span></a>
      <span class="sep" />
      <div class="project" data-tour="project">
        <input class="title" value={project.name} spellcheck={false} aria-label={t('topbar.projectName')}
          style={{ width: `${Math.max(6, project.name.length + 1)}ch` }}
          onChange={(e) => rename((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <span class={`save-state ${save === 'saved' ? '' : save === 'error' ? 'error' : 'dirty'}`} title={t('topbar.projectId', { id: project.id })}>
          <i class="dot" /><span>{save === 'saved' ? t('topbar.saved') : save === 'saving' ? t('topbar.saving') : save === 'error' ? t('topbar.notSaved') : t('topbar.modified')}</span>
        </span>
      </div>
      {comps.length > 1 && <div style={{ width: 170 }}><Select value={S.compId.value} options={comps.map(([id, x]) => [id, x.name])} onChange={(v) => { S.compId.value = v; S.selection.value = []; }} /></div>}
      <span class="grow" />
      <div class="group" data-tour="history">
        <button class="icon-btn" title={undoLabel.value ? t('topbar.undoActionCtrlZ', { action: undoLabel.value }) : t('topbar.undoCtrlZ')} disabled={!canUndo.value} onClick={undo}><Icon name="undo" /></button>
        <button class="icon-btn" title={redoLabel.value ? t('topbar.redoActionCtrlShift', { action: redoLabel.value }) : t('topbar.redoCtrlShiftZ')} disabled={!canRedo.value} onClick={redo}><Icon name="redo" /></button>
      </div>
      <span class="sep" />
      <div class="settings" data-tour="format">
        <div style={{ width: 168 }} class="hide-sm">
          <Select value={fmt} options={[...FORMATS.map(([id, label]) => [id, label] as [string, string]), ...(fmt === 'custom' ? [['custom', `${c.width}×${c.height}`] as [string, string]] : [])]} onChange={setFormat} />
        </div>
        <div style={{ width: 84 }}>
          <Select value={String(c.fps)} options={['24', '25', '30', '50', '60'].map((f) => [f, t('common.nFps', { n: f })])} onChange={(v) => commit(t('common.frameRate'), [{ op: 'replace', path: `${cp}/fps`, value: Number(v) }])} />
        </div>
      </div>
      <HelpButton page="editor" />
      <button class="icon-btn" title={t('app.display')} onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        openMenu({ clientX: r.right, clientY: r.bottom + 4 }, DISPLAYS.map((id): MenuItem => ({ label: DISPLAY_LABEL[id], icon: prefs.value.display === id ? 'check' : undefined, onClick: () => setPrefs({ display: id }) })));
      }}><Icon name="expand" /></button>
      <button class="icon-btn" data-tour="settings" title={t('common.settingsCtrl')} onClick={() => { settingsOpen.value = true; }}><Icon name="gear" /></button>
      <button class="btn primary" data-tour="export" onClick={(e) => setExp(exp ? null : (e.currentTarget as HTMLElement))}><Icon name="download" /><span class="label">{t('common.export')}</span></button>
      {/* narrow screens: what no longer fits in the bar moves here */}
      <button class="icon-btn more-btn" title={t('topbar.moreOptions')} aria-label={t('topbar.moreOptions')} onClick={(e) => moreMenu(e as unknown as MouseEvent, { fmt, fps: c.fps, setFormat, setFps: (n) => commit(t('common.frameRate'), [{ op: 'replace', path: `${cp}/fps`, value: n }]), comps: comps.length > 1 ? comps.map(([id, x]) => [id, x.name] as [string, string]) : [] })}><Icon name="more" /></button>
      {exp && <ExportPop anchor={exp} onClose={() => setExp(null)} />}
    </header>
  );
}

export const notify = toast;
