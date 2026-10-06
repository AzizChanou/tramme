// The key vault (personal mode): a page of its own origin, framed by the
// editor, that keeps the visitor's keys in its own storage and calls the
// providers with them. The editor, its plugins and the server never read a
// key: the editor asks for a route (/api/claude, /api/llm…, the same routes
// the private Worker answers, @tramme/api) and gets the answer.
//
//   /           hidden: answers the editor's requests (channel.ts)
//   /settings   the providers and their keys, shown in the editor's settings;
//               the keys are typed here, never in the editor
//
// The Worker serves this page with a strict Content-Security-Policy: framed by
// the editor's address only, reaching the providers of direct.ts and the relay.

import './params.ts';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { bucketKeyStore, failure, json, keysRoute, loadKeys, PROVIDER_ROUTES, providerRoute, providersConfig, recordBucket, relayed, type KeyStatus } from '@tramme/api';
import { idbRecords } from '../local/idb.ts';
import { Providers, type ProviderActions } from '../ui/Providers.tsx';
import { t } from '../i18n/index.ts';
import '../settings.ts';
import '../styles.css';
import { answerOver, type Asked } from './channel.ts';
import type { VaultMessage } from './link.ts';
import { upstream } from './upstream.ts';

/** the only page the vault answers (set by the Worker) */
const APP = document.querySelector<HTMLMetaElement>('meta[name="tramme-app"]')?.content ?? '';
const keys = bucketKeyStore(recordBucket(idbRecords('tramme-vault')));

const tell = (m: VaultMessage) => { if (APP && parent !== window) parent.postMessage(m, APP); };

/** a provider route, answered with the keys kept here */
async function serve(req: Request): Promise<Response> {
  const parts = new URL(req.url).pathname.slice('/api/'.length).split('/');
  try {
    const reach = { keys: await loadKeys(keys), fetch: upstream };
    if (parts[0] === 'config' && req.method === 'GET') return json(providersConfig(reach.keys));
    // the keys are managed on /settings only: a page of the editor cannot change them
    const res = PROVIDER_ROUTES.includes(parts[0]) ? await providerRoute(req, reach, parts) : null;
    return res ?? json({ error: `not a route of the key vault: ${req.method} ${new URL(req.url).pathname}` }, 404);
  } catch (e) { return failure(e); }
}

/** a change of the keys, typed on this page */
async function manage(method: 'PUT' | 'DELETE', path: string, body?: unknown) {
  const req = new Request(new URL(`/api/keys/${path}`, location.origin), { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const res = await keysRoute(req, keys, path.split('/').filter(Boolean)).catch(failure);
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
  tell({ type: 'tramme-vault-changed' });
}

function Settings() {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const refresh = () => loadKeys(keys).then((k) => setStatus(k.status()));
  useEffect(() => {
    refresh();
    // the editor sizes its frame to this page
    const sized = new ResizeObserver(() => tell({ type: 'tramme-vault-height', height: Math.ceil(document.documentElement.scrollHeight) }));
    sized.observe(document.body);
    return () => sized.disconnect();
  }, []);
  const after = (p: Promise<void>) => p.then(refresh);
  const actions: ProviderActions = {
    connect: (p, key) => after(manage('PUT', p, { key })),
    disconnect: (p) => after(manage('DELETE', p)),
    saveCustom: (id, c) => after(manage('PUT', `custom/${encodeURIComponent(id)}`, c)),
    removeCustom: (id) => after(manage('DELETE', `custom/${encodeURIComponent(id)}`)),
    notify: (text, kind) => tell({ type: 'tramme-vault-toast', text, kind }),
  };
  return (
    <div class="vault-page">
      <Providers keys={status} actions={actions} intro={t('personal.keysIntro')} relayed={relayed} forget={() => after(manage('DELETE', ''))} />
    </div>
  );
}

const root = document.getElementById('app')!;
document.documentElement.classList.add('vault');
if (location.origin === APP || !APP) {
  // never on the editor's own address: its plugins would read what is kept here
  root.textContent = 'tramme: the key vault is not configured.';
} else if (location.pathname === '/settings') {
  render(<Settings />, root);
} else {
  addEventListener('message', (e: MessageEvent<Asked>) => {
    if (e.origin !== APP || e.source !== parent || e.data?.type !== 'tramme-fetch' || !e.ports[0]) return;
    answerOver(e.ports[0], e.data, serve);
  });
  tell({ type: 'tramme-vault-ready' });
  if (parent === window) root.textContent = t('personal.vaultAlone');
}
