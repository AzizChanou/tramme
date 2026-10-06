// The keys of the private Worker: those connected in the settings, kept in R2
// (behind Cloudflare Access like everything else), then the Worker's secrets.

import { bucketKeyStore, loadKeys, type KeyedProvider, type Keys, type KeyStore, type Secrets } from '@tramme/api';
import { HttpError, type Env } from './http.ts';

/** the Worker secret of each provider, used when the settings hold no key */
const SECRET: Record<KeyedProvider, { name: string; read(env: Env): string | undefined }> = {
  anthropic: { name: 'ANTHROPIC_API_KEY', read: (e) => e.ANTHROPIC_API_KEY },
  openai: { name: 'OPENAI_API_KEY', read: (e) => e.OPENAI_API_KEY },
  gemini: { name: 'GEMINI_API_KEY', read: (e) => e.GEMINI_API_KEY },
  openrouter: { name: 'OPENROUTER_API_KEY', read: (e) => e.OPENROUTER_API_KEY },
  zai: { name: 'ZAI_API_KEY', read: (e) => e.ZAI_API_KEY ?? e.GLM_API_KEY },
  elevenlabs: { name: 'ELEVENLABS_API_KEY', read: (e) => e.ELEVENLABS_API_KEY },
};

const secrets = (env: Env): Secrets => ({ read: (p) => SECRET[p].read(env), name: (p) => SECRET[p].name });

/** the R2 bucket of the private mode */
export function bucket(env: Env): R2Bucket {
  if (!env.FILES) throw new HttpError(503, 'no storage: bind an R2 bucket as FILES (apps/worker/wrangler.jsonc)');
  return env.FILES;
}

export const keyStore = (env: Env): KeyStore => bucketKeyStore(bucket(env));
export const workerKeys = (env: Env): Promise<Keys> => loadKeys(keyStore(env), secrets(env));
