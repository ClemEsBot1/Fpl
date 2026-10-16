// Six-digit one-time codes sent by email: one to check an account's email
// address ('verify'), one to set a new password ('reset').
//
// Only an HMAC of the code is stored (keyed with JWT_SECRET), so someone
// who can read the database can't recover a pending code by trying all
// million. Each code allows MAX_CODE_ATTEMPTS guesses, counted atomically
// before checking, then it's thrown away; a correct code works once.
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { bump } from './rateLimit.js';

export const CODE_TTL_SECONDS = 15 * 60;
export const MAX_CODE_ATTEMPTS = 5;

const codeKey = (purpose, username) => `code:${purpose}:${String(username).toLowerCase()}`;
const triesKey = (purpose, username) => `${codeKey(purpose, username)}:tries`;
const digest = (secret, purpose, username, code) => createHmac('sha256', secret).update(`${purpose}:${String(username).toLowerCase()}:${code}`).digest('hex');

// "123456"; leading zeros kept.
export function createCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

// A fresh code for `username`, replacing any earlier one. `extra` is kept
// with it (the address a verify code was sent to). Returns the code.
export async function issueCode(redis, secret, purpose, username, extra = {}, now = Date.now()) {
  const code = createCode();
  const entry = { hash: digest(secret, purpose, username, code), expiresAt: now + CODE_TTL_SECONDS * 1000, ...extra };
  await redis.multi()
    .set(codeKey(purpose, username), JSON.stringify(entry), 'EX', CODE_TTL_SECONDS)
    .del(triesKey(purpose, username))
    .exec();
  return code;
}

// Checks a code and, when right, uses it up. Returns the stored entry, or
// null (wrong, expired, used, or too many guesses).
export async function redeemCode(redis, secret, purpose, username, code, now = Date.now()) {
  const clean = String(code ?? '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const key = codeKey(purpose, username);
  const raw = await redis.get(key);
  let entry = null;
  try { entry = raw ? JSON.parse(raw) : null; } catch { entry = null; }
  if (!entry || !(entry.expiresAt > now)) return null;
  if (await bump(redis, triesKey(purpose, username), CODE_TTL_SECONDS) > MAX_CODE_ATTEMPTS) {
    await redis.del(key);
    return null;
  }
  const expected = Buffer.from(entry.hash, 'hex');
  const given = Buffer.from(digest(secret, purpose, username, clean), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  // Whoever deletes it first gets it: two requests with the same code
  // can't both succeed.
  if (await redis.del(key) !== 1) return null;
  await redis.del(triesKey(purpose, username));
  return entry;
}
