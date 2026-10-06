// A fetch carried by messages between two windows of different origins: the
// editor asks (askOver), the key vault answers (answerOver) with its own
// routes. The answer streams back in chunks, as a response from the network
// would; aborting the request stops it on the other side.

/** what the editor sends, with a port for the answer */
export interface Asked { type: 'tramme-fetch'; method: string; path: string; headers: [string, string][]; body: ArrayBuffer | null }

type Told =
  | { type: 'head'; status: number; headers: [string, string][] }
  | { type: 'chunk'; data: Uint8Array }
  | { type: 'end' }
  | { type: 'error'; message: string };

const aborted = () => new DOMException('The operation was aborted.', 'AbortError');
/** the requests carry only a path: the routes read nothing else of their address */
const BASE = 'https://vault.invalid';

/** the response of `path`, asked through `post` (which sends the message and its transferables to the other side) */
export async function askOver(post: (asked: Asked, transfer: Transferable[]) => void, path: string, init: RequestInit = {}): Promise<Response> {
  const req = new Request(new URL(path, BASE), { method: init.method, headers: init.headers, body: init.body });
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.arrayBuffer();
  const signal = init.signal;
  if (signal?.aborted) throw aborted();
  const { port1, port2 } = new MessageChannel();
  post({ type: 'tramme-fetch', method: req.method, path, headers: [...req.headers], body }, [port2, ...(body ? [body] : [])]);
  return new Promise<Response>((resolve, reject) => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    let settled = false, closed = false;
    const finish = () => { closed = true; port1.close(); };
    const fail = (e: Error) => {
      if (closed) return;
      if (!settled) reject(e);
      else try { stream.error(e); } catch { /* already closed */ }
      finish();
    };
    const answer = new ReadableStream<Uint8Array>({
      start(c) { stream = c; },
      cancel() { if (!closed) { port1.postMessage({ type: 'abort' }); finish(); } },
    });
    signal?.addEventListener('abort', () => { if (!closed) { port1.postMessage({ type: 'abort' }); fail(aborted()); } }, { once: true });
    port1.onmessage = (e: MessageEvent<Told>) => {
      const m = e.data;
      if (m.type === 'head') {
        settled = true;
        resolve(new Response(m.status === 204 || m.status === 304 ? null : answer, { status: m.status, headers: m.headers }));
      } else if (m.type === 'chunk') stream.enqueue(m.data);
      else if (m.type === 'end') { stream.close(); finish(); }
      else fail(new Error(m.message));
    };
  });
}

/** answers one request with `handle`, through the port it came with */
export async function answerOver(port: MessagePort, asked: Asked, handle: (req: Request) => Promise<Response>): Promise<void> {
  const abort = new AbortController();
  port.onmessage = (e) => { if (e.data?.type === 'abort') abort.abort(); };
  const tell = (m: Told) => { if (!abort.signal.aborted) port.postMessage(m); };
  try {
    const req = new Request(new URL(asked.path, BASE), { method: asked.method, headers: asked.headers, body: asked.body, signal: abort.signal });
    const res = await handle(req);
    tell({ type: 'head', status: res.status, headers: [...res.headers] });
    if (res.body) {
      const reader = res.body.getReader();
      abort.signal.addEventListener('abort', () => { reader.cancel().catch(() => {}); }, { once: true });
      for (let r = await reader.read(); !r.done; r = await reader.read()) tell({ type: 'chunk', data: r.value });
    }
    tell({ type: 'end' });
  } catch (e) {
    tell({ type: 'error', message: (e as Error).message });
  } finally {
    port.close();
  }
}
