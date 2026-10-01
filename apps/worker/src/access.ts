// Cloudflare Access in front of the app: every API request carries a JWT
// signed by the team's keys. Checking it here also covers routes Access does
// not sit in front of (workers.dev, preview URLs).

import { cookie, json, type Env } from './http.ts';

interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }
let jwks: { team: string; at: number; keys: Jwk[] } | null = null;

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));

async function keysOf(team: string, kid: string): Promise<Jwk | undefined> {
  const fresh = jwks && jwks.team === team && Date.now() - jwks.at < 3600_000;
  if (!fresh || !jwks!.keys.some((k) => k.kid === kid)) {
    const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
    if (!r.ok) throw new Error(`Access keys unavailable (${r.status})`);
    jwks = { team, at: Date.now(), keys: ((await r.json()) as { keys: Jwk[] }).keys };
  }
  return jwks!.keys.find((k) => k.kid === kid);
}

/** the token's claims when it is valid for this application; throws otherwise */
export async function verifyAccess(token: string, teamDomain: string, aud: string): Promise<Record<string, unknown>> {
  const team = teamDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw new Error('malformed token');
  const header = JSON.parse(new TextDecoder().decode(b64url(h))) as { kid: string; alg: string };
  if (header.alg !== 'RS256') throw new Error('algorithm refused');
  const jwk = await keysOf(team, header.kid);
  if (!jwk) throw new Error('unknown key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('invalid signature');
  const claims = JSON.parse(new TextDecoder().decode(b64url(p))) as { aud?: string | string[]; exp?: number; nbf?: number; iss?: string };
  const now = Date.now() / 1000;
  if (!claims.exp || claims.exp < now) throw new Error('token expired');
  if (claims.nbf && claims.nbf > now + 60) throw new Error('token not valid yet');
  if (claims.iss !== `https://${team}`) throw new Error('unexpected issuer');
  if (!(Array.isArray(claims.aud) ? claims.aud : [claims.aud]).includes(aud)) throw new Error('token meant for another application');
  return claims;
}

const local = (url: URL) => url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';

/** a response refusing the request, or null when it may go on */
export async function guard(req: Request, env: Env): Promise<Response | null> {
  const url = new URL(req.url);
  // a page of another site must not drive the API with the user's cookies
  const origin = req.headers.get('origin');
  if (req.method !== 'GET' && req.method !== 'HEAD' && origin && origin !== url.origin) return json({ error: 'origin refused' }, 403);
  if (env.DEV_OPEN === '1' && local(url)) return null;
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return json({ error: 'access not configured: set ACCESS_TEAM_DOMAIN and ACCESS_AUD (Cloudflare Access)' }, 503);
  }
  const token = req.headers.get('cf-access-jwt-assertion') ?? cookie(req, 'CF_Authorization');
  if (!token) return json({ error: 'authentication required' }, 401);
  try { await verifyAccess(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD); } catch (e) {
    return json({ error: `access denied: ${(e as Error).message}` }, 403);
  }
  return null;
}
