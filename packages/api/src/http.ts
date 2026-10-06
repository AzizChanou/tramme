// Small helpers shared by the routes, wherever they run (the Worker, the
// browser's service worker, the key vault).

export class HttpError extends Error {
  status: number;
  issues?: { path: string; message: string }[];
  constructor(status: number, message: string, issues?: { path: string; message: string }[]) { super(message); this.status = status; this.issues = issues; }
}

export const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

export async function readJson<T>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { throw new HttpError(400, 'unreadable JSON body'); }
}

/** an error as the API answers it: its status and message, 500 for anything unexpected */
export function failure(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message, issues: e.issues }, e.status);
  console.error(e);
  return json({ error: 'internal server error' }, 500);
}
