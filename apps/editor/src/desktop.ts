// The desktop app (Tauri): the system can hand a .tramme to the window — at
// startup or while it runs, from a double-click in the file explorer. It
// lands here and goes through the same import as a dropped file. The web
// deployments have none of Tauri, so everything here is a no-op there.

import { importFile } from './importer.ts';

interface Tauri {
  core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  event: { listen: (name: string, handler: () => void) => Promise<unknown> };
}

const tauri = (window as unknown as { __TAURI__?: Tauri }).__TAURI__;

export function initDesktop(): void {
  if (!tauri) return;
  const pending = async () => {
    const name = (await tauri.core.invoke('desktop_pending_name')) as string | null;
    if (!name) return;
    const raw = (await tauri.core.invoke('desktop_pending_bytes')) as ArrayBuffer | number[];
    const data = raw instanceof ArrayBuffer ? new Uint8Array(raw) : Uint8Array.from(raw ?? []);
    if (!data.length) return;
    // the import makes a new project: it opens, like a file dropped on the home
    importFile(new File([data], name))
      .then((m) => { location.assign(`/p/${m.id}`); })
      .catch((e) => console.warn('[tramme] desktop open:', (e as Error).message));
  };
  // the listener first, so an open arriving during the read is not lost
  tauri.event.listen('desktop-open', () => pending());
  pending();
}
