import { fplPathRule, fplCacheControl, STALE_CACHE_CONTROL } from '../src/lib/fplProxy.js';
import { readLastGood, saveLastGood } from '../src/lib/lastGood.js';
import { getRedis } from '../src/lib/redis.js';

function redisOrNull(override) {
  if (override !== undefined) return override;
  try { return getRedis(); } catch { return null; }
}

// GET /api/fpl?path=<FPL API path> — FPL's API, fetched here (no CORS) and
// cached at the edge. For data that's the same for everyone (bootstrap,
// fixtures, live points) the last good answer is kept, and served with an
// X-Fpl-Stale-At header when FPL fails or is mid-update.
// `fetchImpl` and `redisOverride` are for tests.
export default async function handler(req, res, fetchImpl = fetch, redisOverride) {
  const path = (req.query && req.query.path) || '';
  const rule = fplPathRule(path);
  if (!rule) {
    res.status(400).json({ error: 'path_not_allowed' });
    return;
  }
  const redis = rule.shared ? redisOrNull(redisOverride) : null;
  let status = 502;
  let detail = '';
  try {
    const r = await fetchImpl('https://fantasy.premierleague.com/api/' + path, { signal: AbortSignal.timeout(10_000) });
    const text = await r.text();
    status = r.status;
    // FPL answers its "game is being updated" page with a non-JSON 503.
    if (r.ok) {
      if (redis) await saveLastGood(redis, `fpl:${path}`, text);
      res.status(200).setHeader('Content-Type', 'application/json').setHeader('Cache-Control', fplCacheControl(rule, 200)).send(text);
      return;
    }
    if (r.status < 500 && r.status !== 403 && r.status !== 429) {
      res.status(r.status).setHeader('Content-Type', 'application/json').setHeader('Cache-Control', 'no-store').send(text);
      return;
    }
    detail = `FPL ${r.status}`;
  } catch (e) {
    detail = String((e && e.message) || e);
  }
  const saved = redis ? await readLastGood(redis, `fpl:${path}`) : null;
  if (saved) {
    res.status(200)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Cache-Control', STALE_CACHE_CONTROL)
      .setHeader('X-Fpl-Stale-At', new Date(saved.at).toISOString())
      .send(saved.text);
    return;
  }
  console.error(`fpl proxy ${path}: ${detail}`);
  res.status(status >= 500 ? status : 502).setHeader('Cache-Control', 'no-store').json({ error: 'FPL fetch failed', detail });
}
