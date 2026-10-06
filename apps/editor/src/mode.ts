// Where this editor keeps its projects and reaches the providers.
//
// - private (the Worker behind Cloudflare Access, or `wrangler dev`): the
//   server keeps the projects and the keys.
// - personal (anyone, no account): the projects stay in this browser, served
//   by the service worker (sw.ts) from IndexedDB; the keys stay in the key
//   vault, a page of another origin the editor and its plugins cannot read
//   (vault/). The Worker says so with <meta name="tramme-vault">.

import { t } from './i18n/index.ts';

/** the key vault's address in personal mode; undefined in private mode */
export const vaultOrigin: string | undefined = typeof document !== 'undefined'
  ? document.querySelector<HTMLMetaElement>('meta[name="tramme-vault"]')?.content || undefined
  : undefined;

export const personal = !!vaultOrigin;

/** the service worker serving the projects from this browser, in control of this page */
async function startLocalStore() {
  if (!('serviceWorker' in navigator)) throw new Error(t('personal.noServiceWorker'));
  const sw = navigator.serviceWorker;
  await sw.register('/sw.js', { scope: '/' });
  // the browser may otherwise clear the projects when space runs low
  navigator.storage?.persist?.().catch(() => {});
  if (sw.controller) return;
  // the first visit, or a forced reload: the worker takes this page over
  const ready = await sw.ready;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(t('personal.noServiceWorker'))), 10_000);
    sw.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(); }, { once: true });
    ready.active?.postMessage('claim');
  });
}

/** a service worker left from the personal mode on this address would keep answering for the server: removed */
async function leaveLocalStore() {
  if (!navigator.serviceWorker?.controller) return;
  for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  location.reload();
  await new Promise(() => {});
}

/** before anything reads a project */
export const boot = () => (personal ? startLocalStore() : leaveLocalStore());
