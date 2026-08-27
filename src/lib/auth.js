import { getRedis, getJSON, setJSON } from '../src/lib/redis.js';
import {
  validateUsername, validatePassword,
  hashPassword, verifyPassword, signSessionToken,
  buildSessionCookie, buildClearedSessionCookie, getSessionFromRequest,
  userKeyFor,
} from '../src/lib/auth.js';

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
    res.status(200).json({ ok: true, username: session.username });
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
    const usernameCheck = validateUsername(username);
    if (!usernameCheck.ok) { res.status(400).json({ error: usernameCheck.error }); return; }
    const passwordCheck = validatePassword(password);
    if (!passwordCheck.ok) { res.status(400).json({ error: passwordCheck.error }); return; }

    const key = userKeyFor(username);
    try {
      const existing = await getJSON(redis, key);
      if (existing) { res.status(409).json({ error: 'That username is already taken.' }); return; }

      const passwordHash = await hashPassword(password);
      const record = { username, passwordHash, teams: [] };
      await setJSON(redis, key, record);

      const token = signSessionToken(username, secret);
      res.setHeader('Set-Cookie', buildSessionCookie(token));
      res.status(200).json({ ok: true, username });
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
    try {
      const record = await getJSON(redis, userKeyFor(username));
      const match = record ? await verifyPassword(password, record.passwordHash) : false;
      if (!match) { res.status(401).json({ error: 'Incorrect username or password.' }); return; }

      const token = signSessionToken(record.username, secret);
      res.setHeader('Set-Cookie', buildSessionCookie(token));
      res.status(200).json({ ok: true, username: record.username });
    } catch (e) {
      res.status(502).json({ error: 'storage_failed', detail: String((e && e.message) || e) });
    }
    return;
  }

  res.status(400).json({ error: 'unknown_action' });
}