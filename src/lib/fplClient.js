// Browser-side data loading: FPL data through the /api/fpl proxy, plus the
// cached player-history and odds blobs.
import { buildStaticDataFromRaw } from './predictions.js';
import { applyAsOfStats } from './asOf.js';

export async function fetchFplJson(path) {
  // Calls our own /api/fpl serverless function (added via Vercel), which
  // fetches FPL server-side — no CORS issue, no dependence on third-party
  // proxy services, and no dynamic-route filename to trip over.
  const r = await fetch(`/api/fpl?path=${encodeURIComponent(path)}`);
  if (!r.ok) throw new Error('status ' + r.status);
  return r.json();
}

export async function fetchPlayerHistory() {
  // Unlike fetchFplJson above, a failure here is NOT an error worth
  // surfacing — the player-history blob only exists once
  // scripts/import-player-history.mjs has been run at least once, and
  // predictions work fine without it (falls back to the pre-existing
  // position-average ep_next shrinkage baseline). So this always resolves,
  // never throws.
  // 5s timeout: this is best-effort by design (see above) — if the server
  // is slow to answer, don't let it hold up the whole page. A skipped
  // history fetch just means the same fallback as a failed one.
  try {
    const r = await fetch('/api/player-history', { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function fetchOdds() {
  // Same reasoning as fetchPlayerHistory above: this reads whatever the
  // daily cron last cached (see api/odds.js) — never a live call to the
  // odds provider, and a miss here just means oddsAdjustment is 0 for
  // everyone (see buildStaticDataFromRaw), exactly as before this feature
  // existed. Always resolves, never throws. Same 5s timeout, same reason.
  try {
    const r = await fetch('/api/odds', { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function loadStaticData() {
  const [bootstrap, fixturesRaw, playerHistoryData, oddsData] = await Promise.all([
    fetchFplJson('bootstrap-static/'),
    fetchFplJson('fixtures/'),
    fetchPlayerHistory(),
    fetchOdds(),
  ]);
  const staticData = buildStaticDataFromRaw(bootstrap, fixturesRaw, { playerHistoryData, oddsData });
  // Kept so a past gameweek can be rebuilt "as of" its deadline.
  return { ...staticData, raw: { bootstrap, fixturesRaw, playerHistoryData } };
}

// Static data for a past gameweek, using only what was known before its
// deadline: player stats from earlier gameweeks (/api/as-of, see
// src/lib/asOf.js), with that gameweek as the target. Bookmaker odds are
// left out — the cached odds are for upcoming matches only.
export async function loadStaticDataAsOf(base, gwId) {
  const r = await fetch(`/api/as-of?gw=${gwId}`);
  if (!r.ok) throw new Error('status ' + r.status);
  const asOf = await r.json();
  const bootstrap = applyAsOfStats(base.raw.bootstrap, asOf);
  const staticData = buildStaticDataFromRaw(bootstrap, base.raw.fixturesRaw, {
    forceGwId: gwId, playerHistoryData: base.raw.playerHistoryData, oddsData: null,
  });
  return { ...staticData, raw: base.raw, asOfGwId: gwId };
}
