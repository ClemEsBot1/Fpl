import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const SESSION_COOKIE_NAME = 'fpl_session';
// Long-lived on purpose: there's no email/password-reset flow (usernames
// only), so forcing frequent re-logins would just be friction with no real
// security upside for this app.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function validateUsername(username) {
  if (typeof username !== 'string') return { ok: false, error: 'Username is required.' };
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: 'Username must be 3-20 characters: letters, numbers, underscores only.' };
  }
  return { ok: true };
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters.' };
  }
  if (password.length > 200) {
    return { ok: false, error: 'Password is too long.' };
  }
  return { ok: true };
}

// Usernames are stored case-insensitively (so "Clem" and "clem" collide),
// but we keep the original casing for display by storing it in the user
// record itself; this function is only for the lookup key.
export function normalizeUsername(username) {
  return String(username).trim().toLowerCase();
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

export function signSessionToken(username, secret) {
  return jwt.sign({ username }, secret, { expiresIn: SESSION_MAX_AGE_SECONDS });
}

// Returns { username } on a valid, unexpired token, or null otherwise —
// never throws, since an invalid/expired session should just look
// "logged out" to the caller rather than surfacing as a server error.
export function verifySessionToken(token, secret) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret);
    if (!payload || typeof payload.username !== 'string') return null;
    return { username: payload.username };
  } catch (e) {
    return null;
  }
}

export function buildSessionCookie(token) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  return parts.join('; ');
}

export function buildClearedSessionCookie() {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    'Path=/',
    'Max-Age=0',
  ];
  return parts.join('; ');
}

// Minimal `Cookie` request-header parser — only needs to split on ';' and
// '=' pairs (request-header cookies never carry the attribute flags that
// appear in a Set-Cookie response header, so nothing fancier is needed).
function parseCookieHeader(header) {
  const out = {};
  String(header).split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!key) return;
    try { out[key] = decodeURIComponent(value); } catch (e) { out[key] = value; }
  });
  return out;
}

// Convenience: given a raw `Cookie` request header and the JWT secret,
// returns { username } for a valid session or null. Used by every
// endpoint that requires auth so they don't each reimplement this.
export function getSessionFromRequest(req, secret) {
  const raw = req.headers && req.headers.cookie;
  if (!raw) return null;
  const parsed = parseCookieHeader(raw);
  return verifySessionToken(parsed[SESSION_COOKIE_NAME], secret);
}

export function userKeyFor(username) {
  return `user:${normalizeUsername(username)}`;
}

// A short, sufficiently-unique id for a saved-team entry — no external
// uuid dependency needed for this volume (a handful of entries per user).
export function generateEntryId() {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}