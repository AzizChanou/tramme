// The personal mode's storage: this service worker answers the editor's
// storage routes (/api/projects, /api/library, /api/sounds) from IndexedDB, in
// this browser, with the same code the Worker runs on R2 (@tramme/api). The
// editor does not know the difference; nothing reaches the server. Registered
// by mode.ts only in personal mode.

import { failure, json, recordBucket, STORAGE, storageRoute } from '@tramme/api';
import { idbRecords } from './local/idb.ts';

// what this file needs of the service worker's scope (the DOM's types are the editor's)
interface ExtendableEvent extends Event { waitUntil(p: Promise<unknown>): void }
interface FetchEvent extends ExtendableEvent { request: Request; respondWith(r: Promise<Response>): void }
interface MessageEvent extends ExtendableEvent { data: unknown }
const scope = self as unknown as {
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', fn: (e: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', fn: (e: FetchEvent) => void): void;
  addEventListener(type: 'message', fn: (e: MessageEvent) => void): void;
};

const bucket = recordBucket(idbRecords());

scope.addEventListener('install', (e) => e.waitUntil(scope.skipWaiting()));
scope.addEventListener('activate', (e) => e.waitUntil(scope.clients.claim()));
// a page opened without the worker (first visit, forced reload) asks to be taken over
scope.addEventListener('message', (e) => { if (e.data === 'claim') e.waitUntil(scope.clients.claim()); });

scope.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/') || !STORAGE.includes(url.pathname.split('/')[2])) return;
  e.respondWith(storageRoute(e.request, bucket, url).then((r) => r ?? json({ error: `unknown route: ${e.request.method} ${url.pathname}` }, 404)).catch(failure));
});
