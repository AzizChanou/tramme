// The pieces the settings are laid out with: a section, a row (label, hint,
// control), and the search that filters them. Shared by the settings dialog
// and the key vault's page, which shows the providers the same way.

import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import { t } from '../i18n/index.ts';

// ── the search: a row shows when its label or hint holds the words, a section entirely when its title does ──
export const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const Search = createContext<{ query: string; whole: boolean }>({ query: '', whole: true });

export function Section({ title, children }: { title: string; children: ComponentChildren }) {
  const { query } = useContext(Search);
  return (
    <Search.Provider value={{ query, whole: !query || norm(title).includes(query) }}>
      <section class="set-section"><h3>{title}</h3>{children}</section>
    </Search.Provider>
  );
}

/** a setting: its label (and a badge) and hint, its control; `below`, what goes under it (a list), found by the search with it */
export function Row({ label, badge, hint, children, below, stack }: { label: string; badge?: string; hint?: string; children: ComponentChildren; below?: ComponentChildren; stack?: boolean }) {
  const { query, whole } = useContext(Search);
  if (!whole && !norm(`${label} ${hint ?? ''}`).includes(query)) return null;
  return (
    <>
      <div class={`set-row${stack ? ' stack' : ''}`}>
        <div class="set-label"><span>{label}{badge && <span class="set-badge">{badge}</span>}</span>{hint && <span class="faint">{hint}</span>}</div>
        <div class="set-control">{children}</div>
      </div>
      {below}
    </>
  );
}

/** the question asked under a row before a setting takes effect; danger: something is removed */
export function Confirm({ label, question, action, danger, onCancel, onConfirm }: { label: string; question: string; action: string; danger?: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div class="set-confirm" role="alertdialog" aria-label={label}>
      <span>{question}</span>
      <div class="set-confirm-actions">
        <button class="btn sm" onClick={onCancel}>{t('common.cancel')}</button>
        <button class={`btn sm ${danger ? 'danger-solid' : 'primary'}`} onClick={onConfirm}>{action}</button>
      </div>
    </div>
  );
}
