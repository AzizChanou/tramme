// Editor entry. Two pages: / lists the projects (home), /p/<id> edits one.
// Opening a project loads its manifest, document and conversation from
// storage, starts the preview and mounts the editor.

import { render } from 'preact';
import { DOCUMENT } from '@tramme/project';
import { upgradeDoc, type TrammeDoc } from '@tramme/core';
import { api } from './api.ts';
import { preview } from './preview.ts';
import { commit, hooks, load, S, select, setTime, undo } from './state.ts';
import { loadChats, runTool } from './ai/index.ts';
import { App } from './ui/App.tsx';
import { Home } from './ui/Home.tsx';
import './styles.css';
import { offerTours } from './tours/index.ts';
import { startFromVideo } from './start.ts';
import { t } from './i18n/index.ts';

const root = document.getElementById('app')!;

function fail(title: string, message: string) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  root.innerHTML = `<div class="empty" style="height:100vh"><b>${esc(title)}</b><div class="mono">${esc(message)}</div><a class="btn" href="/">${esc(t('app.backToProjects'))}</a></div>`;
}

/** the home screen's picture of the project, refreshed at most every 20 s after a save */
let lastThumb = 0;
async function thumbnail(force = false) {
  if (!force && performance.now() - lastThumb < 20_000) return;
  lastThumb = performance.now();
  try {
    // where the user stands, or the middle of the main composition (the first frames are often empty)
    const c = S.doc.peek().compositions[S.doc.peek().root];
    const blob = await preview.thumbnail(S.time.peek() > 0 && S.compId.peek() === S.doc.peek().root ? S.time.peek() : c.duration / 2);
    if (!blob) return;
    const id = S.project.peek().id;
    await api.write(id, 'thumbnail.webp', blob, { type: 'image/webp' });
    if (S.project.peek().thumbnail !== 'thumbnail.webp') S.project.value = await api.update(id, { thumbnail: 'thumbnail.webp' });
  } catch (e) { console.warn('[tramme] thumbnail:', (e as Error).message); }
}

async function openProject(id: string) {
  const info = await api.info(id);
  const doc = await api.readText(id, DOCUMENT);
  if (!doc) throw new Error(t('app.projectIdHasNo', { id }));
  load(upgradeDoc(JSON.parse(doc.text)) as TrammeDoc, info.manifest, api.fileUrl(id, DOCUMENT), doc.etag);
  document.title = `${info.manifest.name} · tramme`;
  render(<App />, root);
  loadChats(info.files).catch((e) => console.warn('[tramme] conversations :', (e as Error).message)).finally(startFromVideo);
  await preview.start();
  // the editor's tour, the first time a project opens
  setTimeout(() => offerTours('editor'), 700);
  hooks.afterSave = () => { thumbnail(); };
  if (!info.manifest.thumbnail) setTimeout(() => thumbnail(true), 1500);
  // a handle for measurements and automated checks (tramme bench); runTool runs a tool of the / menu, its events returned
  (window as any).__tramme = { S, preview, select, setTime, undo, commit, runTool };
}

const m = location.pathname.match(/^\/p\/([a-z0-9][a-z0-9-]{2,63})\/?$/);
if (m) {
  openProject(m[1]).catch((e) => {
    S.loadError.value = (e as Error).message;
    fail(t('app.couldNotOpenThe'), (e as Error).message);
  });
} else {
  if (location.pathname !== '/') history.replaceState(null, '', '/');
  render(<Home />, root);
}
