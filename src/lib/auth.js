import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const SESSION_COOKIE_NAME = 'fpl_session';
// Long-lived on purpose: this is a low-stakes app (saved team IDs and
// squads), so frequent re-logins would just be friction.
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days

// The shape any account name has; logins and lookups check only this, so
// accounts made before the 6-character minimum keep working.
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function validateUsername(username) {
  if (typeof username !== 'string') return { ok: false, error: 'Username is required.' };
  if (!USERNAME_RE.test(username)) {
    return { ok: false, error: 'Username must be 3-20 characters: letters, numbers, underscores only.' };
  }
  return { ok: true };
}

// Usernames the rules for new accounts and passwords don't apply to.
const EXEMPT_USERNAMES = ['clem'];

function isExempt(username) {
  return typeof username === 'string' && EXEMPT_USERNAMES.includes(normalizeUsername(username));
}

export const MIN_USERNAME_LENGTH = 6;

// A name for a new account: at least 6 characters (apart from the exempt
// usernames).
export function validateNewUsername(username) {
  const shape = validateUsername(username);
  if (!shape.ok || isExempt(username)) return shape;
  if (username.length < MIN_USERNAME_LENGTH) {
    return { ok: false, error: `Username must be ${MIN_USERNAME_LENGTH}-20 characters: letters, numbers, underscores only.` };
  }
  return { ok: true };
}

// Applies to new passwords only (sign-up and resets) — login never
// re-validates, so older passwords keep working. `username` is the account
// the password is for: the exempt usernames skip the rules.
export const MIN_PASSWORD_LENGTH = 6;

export function validatePassword(password, username) {
  if (typeof password !== 'string' || !password) return { ok: false, error: 'Password is required.' };
  if (password.length > 200) return { ok: false, error: 'Password is too long.' };
  if (isExempt(username)) return { ok: true };
  if (password.length < MIN_PASSWORD_LENGTH || !/[0-9]/.test(password)) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters and include a number.` };
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

// A random id minted once per account at sign-up and stored on the record.
// It ties a session token to that specific account, so a token issued for
// one account can never be valid for a different account that later happens
// to have the same username (e.g. after the first was deleted and the name
// re-registered). Accounts created before this existed have no authId; such
// tokens fall back to the sessionVersion check alone (see below).
export function generateAuthId() {
  return randomBytes(16).toString('base64url');
}

// `sessionVersion` is copied from the user record. Resetting the password
// bumps the record's version, which signs out every session made before
// it (sessions are otherwise stateless tokens that nothing can revoke).
// `authId`, when the record has one, is embedded so the token is bound to
// that account and not just its name.
export function signSessionToken(username, secret, sessionVersion = 0, authId) {
  const payload = { username, sv: sessionVersion };
  if (authId) payload.aid = authId;
  return jwt.sign(payload, secret, { expiresIn: SESSION_MAX_AGE_SECONDS });
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
    return {
      username: payload.username,
      sv: Number.isInteger(payload.sv) ? payload.sv : 0,
      aid: typeof payload.aid === 'string' ? payload.aid : null,
    };
  } catch {
    return null;
  }
}

// Whether a session token is still valid for the user's stored record
// (false once the password has been reset since the token was issued, or if
// the token was issued for a different account that merely shared this
// name). The authId must match when the record carries one; records from
// before authIds existed accept a token with no authId, so existing
// sessions aren't logged out — but any account created or re-registered
// since gets a fresh authId that an older token can't match.
export function sessionMatchesRecord(session, record) {
  if (!session || !record) return false;
  if ((record.sessionVersion || 0) !== (session.sv || 0)) return false;
  return (record.authId || null) === (session.aid || null);
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