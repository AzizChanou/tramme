// The deployed app, in one of two modes (MODE in wrangler.jsonc):
//
// - private (default): one user behind Cloudflare Access. The editor's static
//   build, and under /api the projects (R2), the keys of the settings (R2) and
//   the providers reached with them, speech to text (Workers AI).
// - personal: anyone, without an account; the server keeps nothing. See
//   personal.ts.
//
// Private routes, besides those of @tramme/api (storage.ts, providers.ts, keys.ts):
//   GET    /api/config                          what this server offers, the providers connected
//   PUT    /api/keys/:provider, /custom/:id     connect a provider from the settings (DELETE: disconnect)
//   POST   /api/transcribe                      {audio: WAV base64, language?} -> words with their timing (Whisper)

import { failure, HttpError, json, keysRoute, PROVIDER_ROUTES, providerRoute, providersConfig, storageRoute } from '@tramme/api';
import { LIMITS, PROJECT_FORMAT } from '@tramme/project';
import { guard } from './access.ts';
import type { Env } from './http.ts';
import { bucket, keyStore, workerKeys } from './keys.ts';
import { personal } from './personal.ts';
import { transcribe } from './speech.ts';

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.slice('/api/'.length).split('/');
  const m = req.method;
  if (parts[0] === 'config' && m === 'GET') {
    return json({ mode: 'private', format: PROJECT_FORMAT, limits: LIMITS, ...providersConfig(await workerKeys(env)), transcribe: !!env.AI });
  }
  if (parts[0] === 'keys') return keysRoute(req, keyStore(env), parts.slice(1).map(decodeURIComponent));
  if (PROVIDER_ROUTES.includes(parts[0])) {
    const res = await providerRoute(req, { keys: await workerKeys(env), fetch: (input, init) => fetch(input, init) }, parts);
    if (res) return res;
  }
  if (parts[0] === 'transcribe' && m === 'POST') return transcribe(req, env);
  const res = await storageRoute(req, bucket(env), url);
  if (res) return res;
  throw new HttpError(404, `unknown route: ${m} ${url.pathname}`);
}

export default {
  async fetch(req, env) {
    if (env.MODE === 'personal') return personal(req, env);
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return (await guard(req, env)) ?? (await route(req, env, url));
    } catch (e) { return failure(e); }
  },
} satisfies ExportedHandler<Env>;
