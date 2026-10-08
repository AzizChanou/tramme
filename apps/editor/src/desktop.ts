// The desktop app (Tauri): the system can hand a .tramme to the window — at
// startup or while it runs, from a double-click in the file explorer. It
// lands here and goes through the same import as a dropped file. The web
// deployments have none of Tauri, so everything here is a no-op there.

import { importFile } from './importer.ts';
import { frame, tauri } from './tauri.ts';

export function initDesktop(): void {
  const app = tauri;
  if (!app) return;
  // the window's frame, for the top bars' room (styles.css); in full screen
  // the traffic lights of macOS leave
  const root = document.documentElement;
  root.dataset.frame = frame;
  if (frame === 'mac') {
    const win = app.window.getCurrentWindow();
    const check = () => { win.isFullscreen().then((f) => { root.toggleAttribute('data-fullscreen', f); }, () => {}); };
    check();
    win.onResized(check);
  }
  const pending = async () => {
    const name = (await app.core.invoke('desktop_pending_name')) as string | null;
    if (!name) return;
    const raw = (await app.core.invoke('desktop_pending_bytes')) as ArrayBuffer | number[];
    const data = raw instanceof ArrayBuffer ? new Uint8Array(raw) : Uint8Array.from(raw ?? []);
    if (!data.length) return;
    // the import makes a new project: it opens, like a file dropped on the home
    importFile(new File([data], name))
      .then((m) => { location.assign(`/p/${m.id}`); })
      .catch((e) => console.warn('[tramme] desktop open:', (e as Error).message));
  };
  // the listener first, so an open arriving during the read is not lost
  app.event.listen('desktop-open', () => pending());
  pending();
}
