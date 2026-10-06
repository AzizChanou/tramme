// How the key vault reaches a provider: straight from the browser when the
// provider takes calls from a page (@tramme/api direct.ts), through the
// Worker's relay otherwise (same origin as the vault: /relay).

import { reachedDirectly } from '@tramme/api';

const ANTHROPIC = 'https://api.anthropic.com';

export function upstream(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (reachedDirectly(input)) {
    // Anthropic answers a page only when it says it holds the key on purpose
    if (new URL(input).origin === ANTHROPIC) headers.set('anthropic-dangerous-direct-browser-access', 'true');
    return fetch(input, { ...init, headers });
  }
  headers.set('x-tramme-target', input);
  return fetch('/relay', { ...init, headers });
}
