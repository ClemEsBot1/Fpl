import { getRedis, getJSON, setJSON } from '../src/lib/redis.js';
import { clientIp, getCount, bump, reset } from '../src/lib/rateLimit.js';
import {
  validateUsername, validatePassword, normalizeEmail,
  hashPassword, verifyPassword, signSessionToken,
  buildSessionCookie, buildClearedSessionCookie, getSessionFromRequest,
  userKeyFor, normalizeUsername,
} from '../src/lib/auth.js';

// Without a cap, anyone could keep guessing a user's password forever.
// Failed logins are counted per username (protects one account from a
// distributed attack) and per IP (stops one client trying many accounts);
// a successful login clears that username's counter.
export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const MAX_FAILED_LOGINS_PER_USER = 10;
export const MAX_FAILED_LOGINS_PER_IP = 30;
export const REGISTER_WINDOW_SECONDS = 60 * 60;
export const MAX_REGISTRATIONS_PER_IP = 5;

const TOO_MANY = 'Too many attempts. Please wait 15 minutes and try again.';

function requireSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
}

// `redisOverride` is never passed in production (Vercel always calls
// `handler(req, res)`) — it exists purely so tests can inject an in-memory
// fake instead of a real Redis connection.
export default async function handler(req, res, redisOverride) {
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

      const passwordHash = await hashPassword(password);
      const record = { username, passwordHash, teams: [] };
      if (emailCheck.email) record.email = emailCheck.email;
      await setJSON(redis, key, record);
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
      if (emailCheck.email) record.email = emailCheck.email;
      else delete record.email;
      await setJSON(redis, key, record);
      res.status(200).json({ ok: true, username: record.username, email: emailCheck.email });
    } catch (e) {
      res.status(502).json({ error: 'storage_failed', detail: String((e && e.message) || e) });
    }
    return;
  }

  res.status(400).json({ error: 'unknown_action' });
}