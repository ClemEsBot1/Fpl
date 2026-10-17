// "Continue with Google": the OAuth authorization-code flow, done on the
// server so no Google script runs on the site and it works the same in a
// browser and inside the Android app.
//
//   GET /auth/google            -> /api/auth?google=start   (to Google)
//   GET /auth/google/callback   -> /api/auth?google=callback (back here)
//
// Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (a "Web application"
// OAuth client whose redirect URI is <site>/auth/google/callback).
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const GOOGLE_STATE_COOKIE = 'fpl_gstate';
const STATE_MAX_AGE_SECONDS = 10 * 60;
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

export function googleConfig(env = process.env) {
  const clientId = env.GOOGLE_CLIENT_ID || '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET || '';
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export const redirectUriFor = appUrl => `${appUrl}/auth/google/callback`;

// What the round trip has to remember: a random value (checked against the
// cookie, so another site can't finish a sign-in for you), whether this is
// linking Google to the signed-in account, and whether the Terms were
// agreed to first (needed to create an account).
export function newState({ link = false, terms = false } = {}) {
  return [randomBytes(18).toString('base64url'), link ? 'l' : '', terms ? 't' : ''].join('.');
}

export function parseState(state) {
  const [nonce, link, terms] = String(state || '').split('.');
  return nonce ? { nonce, link: link === 'l', terms: terms === 't' } : null;
}

export function stateMatches(fromQuery, fromCookie) {
  if (typeof fromQuery !== 'string' || typeof fromCookie !== 'string' || !fromQuery) return false;
  const a = Buffer.from(fromQuery);
  const b = Buffer.from(fromCookie);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function stateCookie(state) {
  return `${GOOGLE_STATE_COOKIE}=${encodeURIComponent(state)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${STATE_MAX_AGE_SECONDS}`;
}

export const clearedStateCookie = () => `${GOOGLE_STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

export function authorizationUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
    scope: 'openid email profile', state, prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

// The ID token's claims, once checked. It comes straight from Google's
// token endpoint over TLS, which is enough to trust who issued it (OpenID
// Connect Core 3.1.3.7), so its signature isn't re-checked here.
export function claimsFromIdToken(idToken, clientId, now = Date.now()) {
  const part = String(idToken || '').split('.')[1];
  if (!part) return null;
  let claims;
  try { claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); } catch { return null; }
  if (!claims || !ISSUERS.includes(claims.iss)) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) return null;
  if (!(Number(claims.exp) * 1000 > now)) return null;
  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  return {
    sub: claims.sub,
    email,
    emailVerified: !!email && (claims.email_verified === true || claims.email_verified === 'true'),
    name: typeof claims.name === 'string' ? claims.name : '',
  };
}

// Swaps the code Google sent back for the person's verified claims, or null.
export async function exchangeCode({ code, clientId, clientSecret, redirectUri, fetchImpl = fetch }) {
  if (typeof code !== 'string' || !code || code.length > 2048) return null;
  const r = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return null;
  const data = await r.json().catch(() => null);
  return data && data.id_token ? claimsFromIdToken(data.id_token, clientId) : null;
}

export const googleKeyFor = sub => `google:${sub}`;

// A free username for a new Google account, from the person's name or
// email: "Jamie O'Neil" -> "jamieoneil", padded to 6 and with digits added
// until it's free. `taken(name)` says whether a name is in use.
export async function suggestUsername({ name, email }, taken, random = Math.random) {
  const fromName = String(name || '').normalize('NFKD').replace(/[^a-zA-Z0-9_]/g, '');
  const fromEmail = String(email || '').split('@')[0].replace(/[^a-zA-Z0-9_]/g, '');
  let base = (fromName.length >= 3 ? fromName : fromEmail).toLowerCase().slice(0, 14) || 'player';
  if (base.length < 6) base += '_fpl';
  while (base.length < 6) base += '1';
  if (!(await taken(base))) return base;
  for (let i = 0; i < 8; i++) {
    const candidate = `${base}${Math.floor(random() * 9000) + 1000}`.slice(0, 20);
    if (!(await taken(candidate))) return candidate;
  }
  return `player${Date.now().toString(36)}`.slice(0, 20);
}
