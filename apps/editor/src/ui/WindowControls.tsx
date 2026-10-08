// The desktop app's window, framed by the editor (tauri.ts, frame): its top
// bars (the home's, a project's) move it and a double-click maximizes it, as
// Tauri's drag regions do on each system (what can be pressed in them stays
// pressable); on Windows and Linux its three buttons sit at their right end,
// in the theme's colours. On the web, none of it.

import { useEffect, useState } from 'preact/hooks';
import { frame, tauri } from '../tauri.ts';
import { t } from '../i18n/index.ts';

const win = () => tauri!.window.getCurrentWindow();

/** the attributes of a bar that moves the window */
export const windowBar = frame ? { 'data-tauri-drag-region': 'deep' } : {};

// the system's own caption glyphs (10 px, a 1 px line), drawn rather than taken from the icon set
const GLYPHS = {
  minimize: 'M0 5.5h10',
  maximize: 'M.5.5h9v9h-9z',
  restore: 'M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z',
  close: 'M.5.5l9 9M9.5.5l-9 9',
};

function Glyph({ d }: { d: string }) {
  return <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" stroke-width="1" /></svg>;
}

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (frame !== 'own') return;
    const check = () => { win().isMaximized().then(setMaximized, () => {}); };
    check();
    const off = win().onResized(check);
    return () => { off.then((f) => f(), () => {}); };
  }, []);
  if (frame !== 'own') return null;
  return (
    <div class="window-controls">
      <button title={t('window.minimize')} aria-label={t('window.minimize')} onClick={() => win().minimize()}><Glyph d={GLYPHS.minimize} /></button>
      <button title={maximized ? t('window.restore') : t('window.maximize')} aria-label={maximized ? t('window.restore') : t('window.maximize')} onClick={() => win().toggleMaximize()}>
        <Glyph d={maximized ? GLYPHS.restore : GLYPHS.maximize} />
      </button>
      <button class="close" title={t('window.close')} aria-label={t('window.close')} onClick={() => win().close()}><Glyph d={GLYPHS.close} /></button>
    </div>
  );
}
