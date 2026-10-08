import { getTargetEvent, recentMinutesFromLive, RECENT_MINUTES_GWS } from '../src/lib/predictions.js';

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
    res
      .status(200)
      .setHeader('Cache-Control', 'public, max-age=1800, s-maxage=1800, stale-while-revalidate=86400')
      .json({ gwId: target.id, minutes: recentMinutesFromLive(Object.fromEntries(lives), target.id) });
  } catch (e) {
    res.status(502).setHeader('Cache-Control', 'no-store').json({ error: 'recent_minutes_failed', detail: String((e && e.message) || e) });
  }
}
