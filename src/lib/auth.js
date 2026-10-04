import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const SESSION_COOKIE_NAME = 'fpl_session';
// Long-lived on purpose: this is a low-stakes app (saved team IDs and
// squads), so frequent re-logins would just be friction.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function validateUsername(username) {
  if (typeof username !== 'string') return { ok: false, error: 'Username is required.' };
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: 'Username must be 3-20 characters: letters, numbers, underscores only.' };
  }
  return { ok: true };
}

// Applies to new accounts only — login never re-validates, so anyone who
// signed up under the old 6-character minimum can still log in.
export const MIN_PASSWORD_LENGTH = 8;

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (password.length > 200) {
    return { ok: false, error: 'Password is too long.' };
  }
  return { ok: true };
}

// Email is optional (sign-up and later from the account menu). It's used
// for password resets; logins are still by username. A loose shape check
// is enough; anything stricter rejects real addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Returns { ok, email } with the address trimmed and lower-cased, or '' for
// "no email". Missing/blank input is fine: email is optional.
export function normalizeEmail(email) {
  if (email == null) return { ok: true, email: '' };
  if (typeof email !== 'string') return { ok: false, error: 'Enter a valid email address.' };
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return { ok: true, email: '' };
  if (trimmed.length > 254 || !EMAIL_RE.test(trimmed)) return { ok: false, error: 'Enter a valid email address.' };
  return { ok: true, email: trimmed };
}

// Lookup key from an email address to the username that owns it, so a
// password reset can start from either. Kept in step by register,
// set_email and (for accounts that added an email before this existed)
// login.
export function emailKeyFor(email) {
  return `email:${String(email).trim().toLowerCase()}`;
}

// Password-reset links carry a random token; only its SHA-256 is stored,
// so someone who can read the database can't use a pending reset.
export const RESET_TOKEN_TTL_SECONDS = 30 * 60;

export function createResetToken() {
  return randomBytes(32).toString('base64url');
}

export function resetKeyFor(token) {
  return `pwreset:${createHash('sha256').update(String(token)).digest('hex')}`;
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

// `sessionVersion` is copied from the user record. Resetting the password
// bumps the record's version, which signs out every session made before
// it (sessions are otherwise stateless tokens that nothing can revoke).
export function signSessionToken(username, secret, sessionVersion = 0) {
  return jwt.sign({ username, sv: sessionVersion }, secret, { expiresIn: SESSION_MAX_AGE_SECONDS });
}

// Returns { username, sv } on a valid, unexpired token, or null otherwise —
// never throws, since an invalid/expired session should just look
// "logged out" to the caller rather than surfacing as a server error.
// Tokens from before session versions existed count as version 0.
export function verifySessionToken(token, secret) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, secret);
    if (!payload || typeof payload.username !== 'string') return null;
    return { username: payload.username, sv: Number.isInteger(payload.sv) ? payload.sv : 0 };
  } catch {
    return null;
  }
}

// Whether a session token is still valid for the user's stored record
// (false once the password has been reset since the token was issued).
export function sessionMatchesRecord(session, record) {
  return !!session && !!record && (record.sessionVersion || 0) === (session.sv || 0);
}

// State-changing requests must be JSON. Browsers only send JSON across
// sites after a CORS preflight this API never approves, so this stops
// another site's hidden form from logging someone in or out (form posts
// arrive as application/x-www-form-urlencoded).
export function isJsonRequest(req) {
  const type = (req.headers && req.headers['content-type']) || '';
  return String(type).toLowerCase().startsWith('application/json');
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
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
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