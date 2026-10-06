// The routes that reach a model or media provider with the user's key. The
// same routes run on the private Worker (keys in R2 or secrets, the Worker's
// fetch) and in the browser's key vault (keys in the vault's storage, calls
// made from the browser), so the editor asks both the same way.
//
//   GET    /api/config                          the providers connected (never their keys)
//   POST   /api/claude/v1/messages              Messages API with the Anthropic key
//   POST   /api/llm/:provider/chat/completions  OpenAI, Gemini, OpenRouter, Z.AI, custom providers with their keys
//   GET    /api/models                          the models of those providers
//   POST   /api/generate                        {kind: sfx|music|voice, prompt, duration?, voice?, style?, provider?} -> audio
//   POST   /api/generate-image                  {prompt, ratio?, quality?, provider?} -> the picture file

import { claude, claudeConfig } from './claude.ts';
import { generate, soundConfig } from './generate.ts';
import { generateImage, imageConfig } from './images.ts';
import type { Keys } from './keys.ts';
import { llm, llmConfig, models } from './llm.ts';

/** what the routes reach a provider with: the keys of this request, and the way out to the provider */
export interface Reach {
  keys: Keys;
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

/** the routes of providers, under /api/ */
export const PROVIDER_ROUTES = ['claude', 'llm', 'models', 'generate', 'generate-image'];

/** what is connected, as /api/config tells it */
export const providersConfig = (keys: Keys) => ({ claude: claudeConfig(keys), llm: llmConfig(keys), keys: keys.status(), sound: soundConfig(keys), images: imageConfig(keys) });

/** the answer of a provider route (parts: the path after /api/), or null when the request is not one */
export async function providerRoute(req: Request, reach: Reach, parts: string[]): Promise<Response | null> {
  const m = req.method;
  if (parts[0] === 'claude') return claude(req, reach, parts.slice(1).join('/'));
  if (parts[0] === 'llm' && parts[1]) return llm(req, reach, decodeURIComponent(parts[1]), parts.slice(2).join('/'));
  if (parts[0] === 'models' && m === 'GET') return models(reach);
  if (parts[0] === 'generate' && m === 'POST') return generate(req, reach);
  if (parts[0] === 'generate-image' && m === 'POST') return generateImage(req, reach);
  return null;
}
