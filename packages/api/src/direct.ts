// Which providers a browser may call itself. The key vault calls them
// directly; its page may reach nothing else (its Content-Security-Policy, set
// by the Worker). Every other address (Z.AI, custom providers, a picture Z.AI
// names) goes through the Worker's relay, which keeps nothing.

import { PROVIDERS, type KeyedProvider } from './keys.ts';

/** where each provider answers */
export const PROVIDER_ORIGINS: Record<KeyedProvider, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
  openrouter: 'https://openrouter.ai',
  zai: 'https://api.z.ai',
  elevenlabs: 'https://api.elevenlabs.io',
};

/** the providers that refuse cross-origin requests (no CORS answer to a preflight, checked on 2026-10-06) */
const NO_CORS = new Set<KeyedProvider>(['zai']);

export const BROWSER_DIRECT = PROVIDERS.filter((p) => !NO_CORS.has(p)).map((p) => PROVIDER_ORIGINS[p]);

/** whether a browser reaches this address without the relay */
export const reachedDirectly = (url: string) => BROWSER_DIRECT.includes(new URL(url).origin);

/** whether the vault reaches this provider through the relay (custom providers always do) */
export const relayed = (p: KeyedProvider | 'custom') => p === 'custom' || NO_CORS.has(p);
