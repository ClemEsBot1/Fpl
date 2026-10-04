import { getRedis, getJSON, createJSON, updateJSON } from '../src/lib/redis.js';
import { clientIp, bump, release, reset } from '../src/lib/rateLimit.js';
import {
  validateUsername, validatePassword, normalizeEmail,
  hashPassword, verifyPassword, signSessionToken,
  buildSessionCookie, buildClearedSessionCookie, getSessionFromRequest,
  sessionMatchesRecord, isJsonRequest,
  userKeyFor, normalizeUsername, emailKeyFor,
  createResetToken, resetKeyFor, RESET_TOKEN_TTL_SECONDS,
} from '../src/lib/auth.js';
import { mailerConfigured, sendMail } from '../src/lib/mailer.js';
import { resetPasswordEmail } from '../src/lib/emails.js';

// Without a cap, anyone could keep guessing a user's password forever.
// Failed logins are counted per username (protects one account from a
// distributed attack) and per IP (stops one client trying many accounts);
// a successful login clears that username's counter. Every attempt is
// counted before the password is checked, so a burst of parallel guesses
// can't all get in under the limit.
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
const RESET_INVALID = 'This reset link is invalid or has expired. Ask for a new one.';
const TOO_MANY = 'Too many attempts. Please wait 15 minutes and try again.';
const BAD_LOGIN = 'Incorrect username or password.';
const LOG_IN_AGAIN = 'Please log in again.';

// "clem@example.com" -> "c***@example.com": enough for someone to recognise
// their own address without showing the whole thing to whoever typed the
// username.
export function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

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

// What every signed-in response carries: the account and its saved teams,
// so the app doesn't need a second request for the teams.
function account(record) {
  return { ok: true, username: record.username, email: record.email || '', teams: Array.isArray(record.teams) ? record.teams : [] };
}

function signIn(res, record, secret) {
  res.setHeader('Set-Cookie', buildSessionCookie(signSessionToken(record.username, secret, record.sessionVersion || 0)));
  res.status(200).json(account(record));
}

function storageFailed(res, e) {
  res.status(502).json({ error: 'storage_failed', detail: String((e && e.message) || e) });
}

// `redisOverride` and `mailOverride` are never passed in production
// (Vercel always calls `handler(req, res)`) — they exist purely so tests
// can inject an in-memory Redis and capture emails instead of sending them.
export default async function handler(req, res, redisOverride, mailOverride) {
  let secret;
  try {
    secret = requireSecret();
  } catch {
    res.status(500).json({ error: 'server_misconfigured', detail: 'JWT_SECRET is not set' });
    return;
  }

  if (req.method === 'GET') {
    const session = getSessionFromRequest(req, secret);
    if (!session) { res.status(401).json({ error: 'not_logged_in' }); return; }
    let record;
    try {
      record = await getJSON(redisOverride || getRedis(), userKeyFor(session.username));
    } catch {
      // Storage is down: still report the session (without the extras).
      res.status(200).json({ ok: true, username: session.username, email: '' });
      return;
    }
    if (!sessionMatchesRecord(session, record)) {
      // The account is gone, or its password was reset since this session
      // started.
      res.setHeader('Set-Cookie', buildClearedSessionCookie());
      res.status(401).json({ error: 'not_logged_in' });
      return;
    }
    res.status(200).json(account(record));
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (!isJsonRequest(req)) {
    res.status(415).json({ error: 'Send this request as JSON.' });
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
  } catch {
    res.status(500).json({ error: 'server_misconfigured', detail: 'REDIS_URL is not set' });
    return;
  }

  if (action === 'register') {
    const { password } = body;
    // A stray space (a phone keyboard, a paste) isn't part of the name.
    const username = typeof body.username === 'string' ? body.username.trim() : body.username;
    const usernameCheck = validateUsername(username);
    if (!usernameCheck.ok) { res.status(400).json({ error: usernameCheck.error }); return; }
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) { res.status(400).json({ error: passwordCheck.error }); return; }
    const emailCheck = normalizeEmail(body.email);
    if (!emailCheck.ok) { res.status(400).json({ error: emailCheck.error }); return; }

    // Only accounts actually created count towards the per-network limit:
    // an attempt that fails below hands its place back.
    const registerKey = `ratelimit:register:ip:${clientIp(req)}`;
    let counted = false;
    try {
      counted = true;
      if (await bump(redis, registerKey, REGISTER_WINDOW_SECONDS) > MAX_REGISTRATIONS_PER_IP) {
        res.status(429).json({ error: 'Too many new accounts from this network. Please try again later.' });
        return;
      }
    } catch { counted = false; /* limiter unavailable — don't block sign-ups */ }
    const giveBack = () => (counted ? release(redis, registerKey, REGISTER_WINDOW_SECONDS).catch(() => {}) : null);

    const key = userKeyFor(username);
    try {
      if (await redis.get(key)) {
        await giveBack();
        res.status(409).json({ error: 'That username is already taken.' });
        return;
      }
      if (emailCheck.email && !(await emailAvailable(redis, emailCheck.email, username))) {
        await giveBack();
        res.status(409).json({ error: EMAIL_TAKEN });
        return;
      }
      const record = { username, passwordHash: await hashPassword(password), teams: [], sessionVersion: 0 };
      if (emailCheck.email) record.email = emailCheck.email;
      // Created only if the username is still free: two sign-ups racing
      // for the same name can't overwrite one another.
      if (!(await createJSON(redis, key, record))) {
        await giveBack();
        res.status(409).json({ error: 'That username is already taken.' });
        return;
      }
      if (emailCheck.email) await redis.set(emailKeyFor(emailCheck.email), normalizeUsername(username));
      signIn(res, record, secret);
    } catch (e) {
      await giveBack();
      storageFailed(res, e);
    }
    return;
  }

  if (action === 'login') {
    const { password } = body;
    if (typeof body.username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }
    const username = body.username.trim();
    const ipLimitKey = `ratelimit:login:ip:${clientIp(req)}`;
    try {
      // The network is checked first: once it's blocked, its guesses don't
      // count against (and so can't lock out) the accounts it targets.
      if (await bump(redis, ipLimitKey, LOGIN_WINDOW_SECONDS) > MAX_FAILED_LOGINS_PER_IP) {
        res.status(429).json({ error: TOO_MANY });
        return;
      }
      // A name no account could have can't match; it only counts against
      // the network, which also stops huge made-up "usernames" becoming
      // Redis keys.
      if (!validateUsername(username).ok) {
        res.status(401).json({ error: BAD_LOGIN });
        return;
      }
      const userLimitKey = `ratelimit:login:user:${normalizeUsername(username)}`;
      if (await bump(redis, userLimitKey, LOGIN_WINDOW_SECONDS) > MAX_FAILED_LOGINS_PER_USER) {
        res.status(429).json({ error: TOO_MANY });
        return;
      }

      const record = await getJSON(redis, userKeyFor(username));
      const match = record ? await verifyPassword(password, record.passwordHash) : false;
      if (!match) {
        res.status(401).json({ error: BAD_LOGIN });
        return;
      }
      // A successful login wipes the account's failures and doesn't count
      // against the network.
      await Promise.all([reset(redis, userLimitKey), release(redis, ipLimitKey, LOGIN_WINDOW_SECONDS)]);
      // Accounts that added an email before resets existed have no lookup
      // entry yet; add it so "forgot password" works by email too.
      if (record.email) {
        try { await redis.set(emailKeyFor(record.email), normalizeUsername(record.username), 'NX'); } catch { /* best-effort */ }
      }
      signIn(res, record, secret);
    } catch (e) {
      storageFailed(res, e);
    }
    return;
  }

  // Add, change or (with an empty email) remove the logged-in user's email.
  if (action === 'set_email') {
    const session = getSessionFromRequest(req, secret);
    if (!session) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
    const emailCheck = normalizeEmail(body.email);
    if (!emailCheck.ok) { res.status(400).json({ error: emailCheck.error }); return; }
    const key = userKeyFor(session.username);
    try {
      if (emailCheck.email && !(await emailAvailable(redis, emailCheck.email, session.username))) {
        res.status(409).json({ error: EMAIL_TAKEN });
        return;
      }
      let signedOut = false;
      let oldEmail;
      const updated = await updateJSON(redis, key, record => {
        if (!sessionMatchesRecord(session, record)) { signedOut = true; return null; }
        oldEmail = record.email;
        const next = { ...record };
        if (emailCheck.email) next.email = emailCheck.email;
        else delete next.email;
        return next;
      });
      if (updated === undefined || signedOut) { res.status(401).json({ error: LOG_IN_AGAIN }); return; }
      if (oldEmail && oldEmail !== emailCheck.email && (await emailAvailable(redis, oldEmail, updated.username))) {
        await redis.del(emailKeyFor(oldEmail));
      }
      if (emailCheck.email) await redis.set(emailKeyFor(emailCheck.email), normalizeUsername(updated.username));
      res.status(200).json(account(updated));
    } catch (e) {
      storageFailed(res, e);
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
    try {
      if (await bump(redis, `ratelimit:reset:ip:${clientIp(req)}`, RESET_WINDOW_SECONDS) > MAX_RESET_REQUESTS_PER_IP) {
        res.status(429).json({ error: 'Too many reset requests. Please try again in an hour.' });
        return;
      }

      let record = null;
      if (identifier.includes('@')) {
        const email = normalizeEmail(identifier);
        const owner = email.ok && email.email ? await redis.get(emailKeyFor(email.email)) : null;
        if (owner) record = await getJSON(redis, userKeyFor(owner));
        if (record && record.email !== email.email) record = null;
      } else if (validateUsername(identifier).ok) {
        record = await getJSON(redis, userKeyFor(identifier));
      }

      if (!record) { res.status(404).json({ error: NO_ACCOUNT }); return; }
      if (!record.email) { res.status(400).json({ error: NO_EMAIL }); return; }

      if (await bump(redis, `ratelimit:reset:user:${normalizeUsername(record.username)}`, RESET_WINDOW_SECONDS) > MAX_RESET_EMAILS_PER_USER) {
        res.status(429).json({ error: "We've already sent several reset emails to this account. Check your inbox and spam folder, or try again in an hour." });
        return;
      }
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

  // Step 2: the link's token plus a new password. The token works once, and
  // every session from before the reset is signed out.
  if (action === 'reset_password') {
    const { token, password } = body;
    if (typeof token !== 'string' || !token || token.length > 200) { res.status(400).json({ error: RESET_INVALID }); return; }
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) { res.status(400).json({ error: passwordCheck.error }); return; }
    try {
      // Read and delete in one step, so the same link can't be used twice
      // even by two requests at once.
      const resetKey = resetKeyFor(token);
      const [[, raw]] = await redis.multi().get(resetKey).del(resetKey).exec();
      let entry = null;
      try { entry = raw ? JSON.parse(raw) : null; } catch { entry = null; }
      if (!entry || !(entry.expiresAt > Date.now())) { res.status(400).json({ error: RESET_INVALID }); return; }

      // Hash before touching the record, so the read-modify-write below is
      // quick.
      const passwordHash = await hashPassword(password);
      const updated = await updateJSON(redis, userKeyFor(entry.username), record => ({
        ...record, passwordHash, sessionVersion: (record.sessionVersion || 0) + 1,
      }));
      if (updated === undefined) { res.status(400).json({ error: RESET_INVALID }); return; }
      // A forgotten password often comes after failed guesses; don't leave
      // the account locked now that it has a new one.
      await reset(redis, `ratelimit:login:user:${entry.username}`);
      signIn(res, updated, secret);
    } catch (e) {
      storageFailed(res, e);
    }
    return;
  }

  res.status(400).json({ error: 'unknown_action' });
}
