// The editor's side of the key vault (personal mode): a hidden frame of the
// vault's origin, opened once, which takes the provider routes (/api/claude,
// /api/llm, /api/models, /api/generate…, /api/config) and answers them with
// the keys only it can read. The editor gets the answers, never the keys.

import { t } from '../i18n/index.ts';
import { vaultOrigin } from '../mode.ts';
import { askOver } from './channel.ts';

/** the messages the vault's frames send to the editor */
export type VaultMessage =
  | { type: 'tramme-vault-ready' }
  | { type: 'tramme-vault-changed' }
  | { type: 'tramme-vault-height'; height: number }
  | { type: 'tramme-vault-toast'; text: string; kind?: 'info' | 'error' };

/** a message of one of the vault's frames, or null for anything else */
export function fromVault(e: MessageEvent, frame: Window | null | undefined): VaultMessage | null {
  if (!vaultOrigin || e.origin !== vaultOrigin || !frame || e.source !== frame) return null;
  const type = (e.data as { type?: unknown } | null)?.type;
  return typeof type === 'string' && type.startsWith('tramme-vault-') ? e.data as VaultMessage : null;
}

let ready: Promise<Window> | null = null;

function vault(): Promise<Window> {
  ready ??= new Promise<Window>((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.hidden = true;
    frame.title = 'tramme vault';
    frame.src = `${vaultOrigin}/`;
    const timer = setTimeout(() => { removeEventListener('message', heard); reject(new Error(t('personal.vaultUnreachable'))); }, 15_000);
    const heard = (e: MessageEvent) => {
      if (fromVault(e, frame.contentWindow)?.type !== 'tramme-vault-ready') return;
      clearTimeout(timer);
      removeEventListener('message', heard);
      resolve(frame.contentWindow!);
    };
    addEventListener('message', heard);
    document.body.append(frame);
  }).catch((e) => { ready = null; throw e; });
  return ready;
}

/** a provider route answered by the vault, as fetch would answer it */
export async function vaultFetch(path: string, init?: RequestInit): Promise<Response> {
  const w = await vault();
  return askOver((asked, transfer) => w.postMessage(asked, vaultOrigin!, transfer), path, init);
}
