import { getRedis, getJSON, updateJSON } from '../src/lib/redis.js';
import { getSessionFromRequest, sessionMatchesRecord, isJsonRequest, userKeyFor, generateEntryId } from '../src/lib/auth.js';
import { buildEntryFromBody, mergeEntry } from '../src/lib/teams.js';
import { recordError } from '../src/lib/errorLog.js';

function requireSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
}

function storageFailed(res, e, redis) {
  // Log the real cause server-side, but don't return it: error messages can
  // carry internal hostnames, connection strings or other infrastructure
  // details that a client has no business seeing. Also record it to the
  // admin error log (best-effort).
  console.error('storage_failed:', (e && e.stack) || e);
  recordError(redis, 'teams', e);
  res.status(502).json({ error: 'storage_failed' });
}

// `redisOverride` is never passed in production — tests inject an
// in-memory fake instead of a real Redis connection.
export default async function handler(req, res, redisOverride) {
  let secret;
  try {
    secret = requireSecret();
  } catch {
    res.status(500).json({ error: 'server_misconfigured', detail: 'JWT_SECRET is not set' });
    return;
  }

  const session = getSessionFromRequest(req, secret);
  if (!session) { res.status(401).json({ error: 'not_logged_in' }); return; }

  let redis;
  try {
    redis = redisOverride || getRedis();
  } catch {
    res.status(500).json({ error: 'server_misconfigured', detail: 'REDIS_URL is not set' });
    return;
  }

  const key = userKeyFor(session.username);

  if (req.method === 'GET') {
    try {
      const record = await getJSON(redis, key);
      if (!sessionMatchesRecord(session, record)) { res.status(401).json({ error: 'not_logged_in' }); return; }
      res.status(200).json({ ok: true, teams: record.teams || [] });
    } catch (e) {
      storageFailed(res, e, redis);
    }
    return;
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    res.setHeader('Allow', 'GET, POST, DELETE');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (!isJsonRequest(req)) {
    res.status(415).json({ error: 'Send this request as JSON.' });
    return;
  }
  const body = req.body || {};

  // Both writes are a read-modify-write of the user record, done with
  // updateJSON so a save on one device can't wipe out a change made at the
  // same moment somewhere else (another save, a new password).
  if (req.method === 'POST') {
    const built = buildEntryFromBody(body);
    if (!built.ok) { res.status(400).json({ error: built.error }); return; }
    try {
      let outcome = null;
      let signedOut = false;
      const updated = await updateJSON(redis, key, record => {
        if (!sessionMatchesRecord(session, record)) { signedOut = true; return null; }
        outcome = mergeEntry(record.teams, built.entry, { makeId: generateEntryId });
        return outcome.ok ? { ...record, teams: outcome.teams } : null;
      });
      if (updated === undefined || signedOut) { res.status(401).json({ error: 'not_logged_in' }); return; }
      if (!outcome.ok) { res.status(400).json({ error: outcome.error }); return; }
      res.status(200).json({ ok: true, teams: outcome.teams });
    } catch (e) {
      storageFailed(res, e, redis);
    }
    return;
  }

  const entryId = body.entryId;
  if (!entryId) { res.status(400).json({ error: 'entryId is required' }); return; }
  try {
    let signedOut = false;
    const updated = await updateJSON(redis, key, record => {
      if (!sessionMatchesRecord(session, record)) { signedOut = true; return null; }
      const teams = Array.isArray(record.teams) ? record.teams : [];
      return teams.some(t => t.id === entryId) ? { ...record, teams: teams.filter(t => t.id !== entryId) } : null;
    });
    if (updated === undefined || signedOut) { res.status(401).json({ error: 'not_logged_in' }); return; }
    res.status(200).json({ ok: true, teams: Array.isArray(updated.teams) ? updated.teams : [] });
  } catch (e) {
    storageFailed(res, e, redis);
  }
}
