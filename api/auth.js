import { getRedis, getJSON, setJSON } from '../src/lib/redis.js';
import { clientIp, getCount, bump, reset } from '../src/lib/rateLimit.js';
import {
  validateUsername, validatePassword, normalizeEmail,
  hashPassword, verifyPassword, signSessionToken,
  buildSessionCookie, buildClearedSessionCookie, getSessionFromRequest,
  userKeyFor, normalizeUsername, emailKeyFor,
  createResetToken, resetKeyFor, RESET_TOKEN_TTL_SECONDS,
} from '../src/lib/auth.js';
import { mailerConfigured, sendMail } from '../src/lib/mailer.js';
import { resetPasswordEmail } from '../src/lib/emails.js';

// Without a cap, anyone could keep guessing a user's password forever.
// Failed logins are counted per username (protects one account from a
// distributed attack) and per IP (stops one client trying many accounts);
// a successful login clears that username's counter.
export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const MAX_FAILED_LOGINS_PER_USER = 10;
export const MAX_FAILED_LOGINS_PER_IP = 30;
export const REGISTER_WINDOW_SECONDS = 60 * 60;
export const MAX_REGISTRATIONS_PER_IP = 5;
// Reset emails: capped per IP (stops someone spamming many inboxes) and
// per account (stops someone flooding one inbox).
export const RESET_WINDOW_SECONDS = 60 * 60;
export const MAX_RESET_REQUESTS_PER_IP = 10;
export const MAX_RESET_EMAILS_PER_USER = 3;

// Where reset links point. Fixed rather than taken from the request's Host
// header, which a client controls.
const APP_URL = (process.env.APP_URL || 'https://fplchecker.vercel.app').replace(/\/+$/, '');

const EMAIL_TAKEN = 'That email is already used by another account.';
const NO_ACCOUNT = 'No account found with that username or email.';
const NO_EMAIL = "That account doesn't have an email address, so its password can't be reset by email.";

// "clem@example.com" -> "c***@example.com": enough for someone to recognise
// their own address without showing the whole thing to whoever typed the
// username.
export function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}
const RESET_INVALID = 'This reset link is invalid or has expired. Ask for a new one.';

const TOO_MANY = 'Too many attempts. Please wait 15 minutes and try again.';

function requireSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
}

// Whether `email` is free for `username` to use (unclaimed, or already theirs).
async function emailAvailable(redis, email, username) {
  const owner = await redis.get(emailKeyFor(email));
  return !owner || owner === normalizeUsername(username);
}

// `redisOverride` and `mailOverride` are never passed in production
// (Vercel always calls `handler(req, res)`) — they exist purely so tests
// can inject an in-memory Redis and capture emails instead of sending them.
export default async function handler(req, res, redisOverride, mailOverride) {
  let secret;
  try {
    secret = requireSecret();
  } catch (e) {
    res.status(500).json({ error: 'server_misconfigured', detail: 'JWT_SECRET is not set' });
    return;
  }

  if (req.method === 'GET') {
    const session = getSessionFromRequest(req, secret);
    if (!session) { res.status(401).json({ error: 'not_logged_in' }); return; }
    // The email lives in the user record, not the token; if storage is
    // down, still report the session (just without the email).
    let email = '';
    try {
      const record = await getJSON(redisOverride || getRedis(), userKeyFor(session.username));
      email = (record && record.email) || '';
    } catch { /* best-effort */ }
    res.status(200).json({ ok: true, username: session.username, email });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const body = req.body || {};
  const action = body.action;

  if (action === 'logout') {
    res.setHeader('Set-Cookie', buildClearedSessionCookie());
    res.status(200).json({ ok: true });
    return;
  }

  let redis;
  try {
    redis = redisOverride || getRedis();
  } catch (e) {
    res.status(500).json({ error: 'server_misconfigured', detail: 'REDIS_URL is not set' });
    return;
  }

  if (action === 'register') {
    const { username, password } = body;
    const registerKey = `ratelimit:register:ip:${clientIp(req)}`;
    try {
      if (await getCount(redis, registerKey) >= MAX_REGISTRATIONS_PER_IP) {
        res.status(429).json({ error: 'Too many new accounts from this network. Please try again later.' });
        return;
      }
    } catch { /* limiter unavailable — don't block sign-ups */ }
    const usernameCheck = validateUsername(username);
    if (!usernameCheck.ok) { res.status(400).json({ error: usernameCheck.error }); return; }
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) { res.status(400).json({ error: passwordCheck.error }); return; }
    const emailCheck = normalizeEmail(body.email);
    if (!emailCheck.ok) { res.status(400).json({ error: emailCheck.error }); return; }

    const key = userKeyFor(username);
    try {
      const existing = await getJSON(redis, key);
      if (existing) { res.status(409).json({ error: 'That username is already taken.' }); return; }
      if (emailCheck.email && !(await emailAvailable(redis, emailCheck.email, username))) {
        res.status(409).json({ error: EMAIL_TAKEN });
        return;
      }

      const passwordHash = await hashPassword(password);
      const record = { username, passwordHash, teams: [] };
      if (emailCheck.email) record.email = emailCheck.email;
      await setJSON(redis, key, record);
      if (emailCheck.email) await redis.set(emailKeyFor(emailCheck.email), normalizeUsername(username));
      try { await bump(redis, registerKey, REGISTER_WINDOW_SECONDS); } catch { /* best-effort */ }

      const token = signSessionToken(username, secret);
      res.setHeader('Set-Cookie', buildSessionCookie(token));
      res.status(200).json({ ok: true, username, email: emailCheck.email });
    } catch (e) {
      res.status(502).json({ error: 'storage_failed', detail: String((e && e.message) || e) });
    }
    return;
  }

  if (action === 'login') {
    const { username, password } = body;
    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }
    const userLimitKey = `ratelimit:login:user:${normalizeUsername(username)}`;
    const ipLimitKey = `ratelimit:login:ip:${clientIp(req)}`;
    try {
      const [userFails, ipFails] = await Promise.all([getCount(redis, userLimitKey), getCount(redis, ipLimitKey)]);
      if (userFails >= MAX_FAILED_LOGINS_PER_USER || ipFails >= MAX_FAILED_LOGINS_PER_IP) {
        res.status(429).json({ error: TOO_MANY });
        return;
      }

      const record = await getJSON(redis, userKeyFor(username));
      const match = record ? await verifyPassword(password, record.passwordHash) : false;
      if (!match) {
        await Promise.all([
          bump(redis, userLimitKey, LOGIN_WINDOW_SECONDS),
          bump(redis, ipLimitKey, LOGIN_WINDOW_SECONDS),
        ]);
        res.status(401).json({ error: 'Incorrect username or password.' });
        return;
      }
      await reset(redis, userLimitKey);
      // Accounts that added an email before resets existed have no lookup
      // entry yet; add it so "forgot password" works by email too.
      if (record.email) {
        try {
          if (!(await redis.get(emailKeyFor(record.email)))) await redis.set(emailKeyFor(record.email), normalizeUsername(record.username));
        } catch { /* best-effort */ }
      }

      const token = signSessionToken(record.username, secret);
      res.setHeader('Set-Cookie', buildSessionCookie(token));
      res.status(200).json({ ok: true, username: record.username, email: record.email || '' });
    } catch (e) {
      res.status(502).json({ error: 'storage_failed', detail: String((e && e.message) || e) });
    }
    return;
  }

  // Add, change or (with an empty email) remove the logged-in user's email.
  if (action === 'set_email') {
    const session = getSessionFromRequest(req, secret);
    if (!session) { res.status(401).json({ error: 'Please log in again.' }); return; }
    const emailCheck = normalizeEmail(body.email);
    if (!emailCheck.ok) { res.status(400).json({ error: emailCheck.error }); return; }
    try {
      const key = userKeyFor(session.username);
      const record = await getJSON(redis, key);
      if (!record) { res.status(401).json({ error: 'Please log in again.' }); return; }
      if (emailCheck.email && !(await emailAvailable(redis, emailCheck.email, record.username))) {
        res.status(409).json({ error: EMAIL_TAKEN });
        return;
      }
      const oldEmail = record.email;
      if (emailCheck.email) record.email = emailCheck.email;
      else delete record.email;
      await setJSON(redis, key, record);
      if (oldEmail && oldEmail !== emailCheck.email && (await emailAvailable(redis, oldEmail, record.username))) {
        await redis.del(emailKeyFor(oldEmail));
      }
      if (emailCheck.email) await redis.set(emailKeyFor(emailCheck.email), normalizeUsername(record.username));
      res.status(200).json({ ok: true, username: record.username, email: emailCheck.email });
    } catch (e) {
      res.status(502).json({ error: 'storage_failed', detail: String((e && e.message) || e) });
    }
    return;
  }

  // Step 1 of a reset: email a one-time link to the account's address.
  // Says plainly when no account matches or it has no email, so people
  // aren't left waiting for an email that will never come. (That does let
  // someone check whether a username or email has an account; the per-IP
  // limit keeps that slow.)
  if (action === 'forgot_password') {
    const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
    if (!identifier) { res.status(400).json({ error: 'Enter your username or email.' }); return; }
    const send = mailOverride || (mailerConfigured() ? sendMail : null);
    if (!send) {
      res.status(503).json({ error: "Password reset by email isn't set up on this site yet." });
      return;
    }
    const ipKey = `ratelimit:reset:ip:${clientIp(req)}`;
    try {
      if (await getCount(redis, ipKey) >= MAX_RESET_REQUESTS_PER_IP) {
        res.status(429).json({ error: 'Too many reset requests. Please try again in an hour.' });
        return;
      }
      await bump(redis, ipKey, RESET_WINDOW_SECONDS);

      let record = null;
      if (identifier.includes('@')) {
        const owner = await redis.get(emailKeyFor(identifier));
        if (owner) record = await getJSON(redis, userKeyFor(owner));
        if (record && record.email !== identifier.toLowerCase()) record = null;
      } else {
        record = await getJSON(redis, userKeyFor(identifier));
      }

      if (!record) { res.status(404).json({ error: NO_ACCOUNT }); return; }
      if (!record.email) { res.status(400).json({ error: NO_EMAIL }); return; }

      const userKey = `ratelimit:reset:user:${normalizeUsername(record.username)}`;
      if (await getCount(redis, userKey) >= MAX_RESET_EMAILS_PER_USER) {
        res.status(429).json({ error: "We've already sent several reset emails to this account. Check your inbox and spam folder, or try again in an hour." });
        return;
      }
      await bump(redis, userKey, RESET_WINDOW_SECONDS);
      const token = createResetToken();
      const entry = { username: normalizeUsername(record.username), expiresAt: Date.now() + RESET_TOKEN_TTL_SECONDS * 1000 };
      await redis.set(resetKeyFor(token), JSON.stringify(entry), 'EX', RESET_TOKEN_TTL_SECONDS);
      const link = `${APP_URL}/?reset=${encodeURIComponent(token)}`;
      await send({ to: record.email, ...resetPasswordEmail({ username: record.username, link, appUrl: APP_URL, expiresMinutes: RESET_TOKEN_TTL_SECONDS / 60 }) });
      res.status(200).json({ ok: true, message: `We've sent a reset link to ${maskEmail(record.email)}. It expires in 30 minutes; check your spam folder if it doesn't arrive.` });
    } catch (e) {
      console.error('forgot_password failed:', e && e.message);
      res.status(502).json({ error: "Couldn't send the reset email right now. Please try again later." });
    }
    return;
  }

  // Step 2: the link's token plus a new password. The token works once.
  if (action === 'reset_password') {
    const { token, password } = body;
    if (typeof token !== 'string' || !token) { res.status(400).json({ error: RESET_INVALID }); return; }
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) { res.status(400).json({ error: passwordCheck.error }); return; }
    try {
      const resetKey = resetKeyFor(token);
      const entry = await getJSON(redis, resetKey);
      if (!entry || !(entry.expiresAt > Date.now())) { res.status(400).json({ error: RESET_INVALID }); return; }
      await redis.del(resetKey);
      const key = userKeyFor(entry.username);
      const record = await getJSON(redis, key);
      if (!record) { res.status(400).json({ error: RESET_INVALID }); return; }
      record.passwordHash = await hashPassword(password);
      await setJSON(redis, key, record);
      // A forgotten password often comes after failed guesses; don't leave
      // the account locked now that it has a new one.
      await reset(redis, `ratelimit:login:user:${entry.username}`);

      const sessionToken = signSessionToken(record.username, secret);
      res.setHeader('Set-Cookie', buildSessionCookie(sessionToken));
      res.status(200).json({ ok: true, username: record.username, email: record.email || '' });
    } catch (e) {
      res.status(502).json({ error: 'storage_failed', detail: String((e && e.message) || e) });
    }
    return;
  }

  res.status(400).json({ error: 'unknown_action' });
}