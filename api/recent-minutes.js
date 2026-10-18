import { getTargetEvent, recentMinutesFromLive, RECENT_MINUTES_GWS } from '../src/lib/predictions.js';
import { getRedis } from '../src/lib/redis.js';
import { readLastGood, saveLastGood } from '../src/lib/lastGood.js';
import { STALE_CACHE_CONTROL } from '../src/lib/fplProxy.js';

const redisOrNull = () => { try { return getRedis(); } catch { return null; } };

const FPL_BASE = 'https://fantasy.premierleague.com/api/';

async function fplJson(path) {
  const r = await fetch(FPL_BASE + path, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

// GET /api/recent-minutes — minutes each player played in the
// RECENT_MINUTES_GWS gameweeks before the one being planned for:
// { gwId, minutes: { [playerId]: minutes } }. Cached for half an hour,
// since the last of those gameweeks can still be being played.
export default async function handler(req, res) {
  try {
    const bootstrap = await fplJson('bootstrap-static/');
    const target = getTargetEvent(bootstrap.events);
    if (!target) throw new Error('no target gameweek');
    const gws = [];
    for (let gw = Math.max(1, target.id - RECENT_MINUTES_GWS); gw < target.id; gw++) gws.push(gw);
    const lives = await Promise.all(gws.map(async gw => [gw, (await fplJson(`event/${gw}/live/`)).elements || []]));
    const body = JSON.stringify({ gwId: target.id, minutes: recentMinutesFromLive(Object.fromEntries(lives), target.id) });
    const redis = redisOrNull();
    if (redis) await saveLastGood(redis, 'recent-minutes', body);
    res
      .status(200)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Cache-Control', 'public, max-age=1800, s-maxage=1800, stale-while-revalidate=86400')
      .send(body);
  } catch (e) {
    const detail = String((e && e.message) || e);
    // FPL down or mid-update: the last good answer, if there is one.
    const redis = redisOrNull();
    const saved = redis ? await readLastGood(redis, 'recent-minutes') : null;
    if (saved) {
      res.status(200).setHeader('Content-Type', 'application/json').setHeader('Cache-Control', STALE_CACHE_CONTROL).setHeader('X-Fpl-Stale-At', new Date(saved.at).toISOString()).send(saved.text);
      return;
    }
    console.error('recent-minutes failed:', detail);
    res.status(502).setHeader('Cache-Control', 'no-store').json({ error: 'recent_minutes_failed', detail });
  }
}
