// Small helpers shared by the routes.

export interface Env {
  /** project files, under projects/<id>/<path> */
  FILES: R2Bucket;
  /** the editor's static build */
  ASSETS: Fetcher;
  /** secret: the Anthropic key for the server-side assistant (optional) */
  ANTHROPIC_API_KEY?: string;
  /** secrets: keys of the other model providers (optional) */
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  /** Workers AI: speech to text (Whisper) */
  AI?: Ai;
  /** Cloudflare Access: team domain (equipe.cloudflareaccess.com) and application audience tag */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** '1' only from `wrangler dev` on this machine: no Access check */
  DEV_OPEN?: string;
}

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

export function cookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
