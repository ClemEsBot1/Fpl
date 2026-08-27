import { getRedis, getJSON, setJSON } from '../src/lib/redis.js';
import { getSessionFromRequest, userKeyFor, generateEntryId } from '../src/lib/auth.js';
import { buildEntryFromBody, mergeEntry } from '../src/lib/teams.js';

function requireSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
}

// `redisOverride` is never passed in production — tests inject an
// in-memory fake instead of a real Redis connection.
export default async function handler(req, res, redisOverride) {
  let secret;
  try {
    secret = requireSecret();
  } catch (e) {
    res.status(500).json({ error: 'server_misconfigured', detail: 'JWT_SECRET is not set' });
    return;
  }

  const session = getSessionFromRequest(req, secret);
  if (!session) { res.status(401).json({ error: 'not_logged_in' }); return; }

  let redis;
  try {
    redis = redisOverride || getRedis();
  } catch (e) {
    res.status(500).json({ error: 'server_misconfigured', detail: 'REDIS_URL is not set' });
    return;
  }

  const key = userKeyFor(session.username);

  if (req.method === 'GET') {
    try {
      const record = await getJSON(redis, key);
      res.status(200).json({ ok: true, teams: (record && record.teams) || [] });
    } catch (e) {
      res.status(502).json({ error: 'storage_failed', detail: String((e && e.message) || e) });
    }
    return;
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const built = buildEntryFromBody(body);
    if (!built.ok) { res.status(400).json({ error: built.error }); return; }

    try {
      const record = await getJSON(redis, key);
      if (!record) { res.status(404).json({ error: 'user_not_found' }); return; }

      const merged = mergeEntry(record.teams, built.entry, { makeId: generateEntryId });
      if (!merged.ok) { res.status(400).json({ error: merged.error }); return; }

      await setJSON(redis, key, { ...record, teams: merged.teams });
      res.status(200).json({ ok: true, teams: merged.teams });
    } catch (e) {
      res.status(502).json({ error: 'storage_failed', detail: String((e && e.message) || e) });
    }
    return;
  }

  if (req.method === 'DELETE') {
    const body = req.body || {};
    const entryId = body.entryId;
    if (!entryId) { res.status(400).json({ error: 'entryId is required' }); return; }

    try {
      const record = await getJSON(redis, key);
      if (!record) { res.status(404).json({ error: 'user_not_found' }); return; }
      const teams = (Array.isArray(record.teams) ? record.teams : []).filter(t => t.id !== entryId);
      await setJSON(redis, key, { ...record, teams });
      res.status(200).json({ ok: true, teams });
    } catch (e) {
      res.status(502).json({ error: 'storage_failed', detail: String((e && e.message) || e) });
    }
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
}