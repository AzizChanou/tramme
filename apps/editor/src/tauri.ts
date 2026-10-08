// The desktop app (Tauri): its global, injected in the native window only (the
// web deployments have none of it), and its way to the providers. The page
// answers the provider routes itself (@tramme/api providersAnswer, as the key
// vault does) with a stand-in for each key; the app sends the requests and
// puts the keys of the system keychain back on the way out, toward each key's
// own provider only (apps/desktop/src-tauri/src/fetch.rs). The keys never
// reach the page, its plugins included.

import { failure, loadKeys, providersAnswer, type KeyStatus, type StoredKeys } from '@tramme/api';
import { fromBase64, toBase64 } from '@tramme/interop';

interface Channel<T> { onmessage: (message: T) => void }

interface Tauri {
  core: {
    invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
    Channel: new <T>() => Channel<T>;
  };
  event: { listen: (name: string, handler: () => void) => Promise<unknown> };
  window: { getCurrentWindow: () => NativeWindow };
}

export interface NativeWindow {
  startDragging: () => Promise<void>;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onResized: (handler: () => void) => Promise<() => void>;
}

export const tauri: Tauri | undefined = typeof window !== 'undefined' ? (window as unknown as { __TAURI__?: Tauri }).__TAURI__ : undefined;

/** the window without the system's title bar (Windows, Linux): the editor's own bar
 *  moves it and carries its buttons (ui/WindowControls.tsx); macOS keeps its own */
export const ownFrame = !!tauri && !/Mac/.test(navigator.userAgent);

/** what the app tells of a request, in this order: head, chunks, then end or error */
type Heard =
  | { type: 'head'; status: number; headers: [string, string][] }
  | { type: 'chunk'; data: string }
  | { type: 'end' }
  | { type: 'error'; message: string };

const NO_BODY = [101, 204, 205, 304];
let last = 0;

/** fetch, from the app instead of the page: no CORS, and the stand-ins of the headers become keys */
function outbound(input: string, init?: RequestInit): Promise<Response> {
  const t = tauri!, id = ++last, req = new Request(input, init);
  const giveUp = () => { t.core.invoke('desktop_fetch_abort', { id }).catch(() => {}); };
  return new Promise<Response>((resolve, reject) => {
    let body: ReadableStreamDefaultController<Uint8Array> | null = null, answered = false;
    const fail = (e: unknown) => {
      req.signal.removeEventListener('abort', aborted);
      if (!answered) { answered = true; reject(e); } else try { body?.error(e); } catch { /* closed already */ }
    };
    const aborted = () => { giveUp(); fail(req.signal.reason ?? new DOMException('The request was aborted', 'AbortError')); };
    if (req.signal.aborted) return aborted();
    req.signal.addEventListener('abort', aborted, { once: true });
    const events = new t.core.Channel<Heard>();
    events.onmessage = (m) => {
      if (m.type === 'head') {
        answered = true;
        const stream = new ReadableStream<Uint8Array>({ start: (c) => { body = c; }, cancel: giveUp });
        resolve(new Response(NO_BODY.includes(m.status) ? null : stream, { status: m.status, headers: m.headers }));
      } else if (m.type === 'chunk') {
        body?.enqueue(fromBase64(m.data));
      } else if (m.type === 'end') {
        req.signal.removeEventListener('abort', aborted);
        try { body?.close(); } catch { /* cancelled */ }
      } else {
        fail(new TypeError(m.message));
      }
    };
    const send = req.method === 'GET' || req.method === 'HEAD' ? Promise.resolve(null) : req.arrayBuffer().then((b) => toBase64(new Uint8Array(b)));
    send
      .then((b) => t.core.invoke('desktop_fetch', { id, request: { url: req.url, method: req.method, headers: [...req.headers], body: b }, events }))
      .catch((e) => fail(new TypeError(String((e as Error)?.message ?? e))));
  });
}

/** the keys as the provider routes take them: a stand-in for each one the app keeps */
const standIns = (s: KeyStatus): StoredKeys => ({
  keys: Object.fromEntries(Object.entries(s.providers).filter(([, source]) => source).map(([p]) => [p, `tramme-key:${p}`])),
  custom: s.custom.map(({ id, label, base, key }) => ({ id, label, base, ...(key ? { key: `tramme-key:custom:${id}` } : {}) })),
});

/** a provider route (or /api/config), answered here, as fetch would answer it */
export async function desktopFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    const req = new Request(new URL(path, location.href), init);
    const config = await fetch('/api/config', { cache: 'no-store' });
    if (!config.ok) return config;
    const { keys } = await config.json() as { keys: KeyStatus };
    const stored = standIns(keys);
    return await providersAnswer(req, { keys: await loadKeys({ load: async () => stored, save: async () => {} }), fetch: outbound });
  } catch (e) { return failure(e); }
}
