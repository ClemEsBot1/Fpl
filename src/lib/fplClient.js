// Browser-side data loading: FPL data through the /api/fpl proxy, plus the
// cached player-history and odds blobs.
import { buildStaticDataFromRaw, getTargetEvent } from './predictions.js';
import { applyAsOfStats, recentMinutesFromAsOf } from './asOf.js';
import { t } from './i18n.js';

// FPL turns some requests away when many arrive at once (a mini-league
// loads several calls per team), and the proxy can time out. Those are
// worth another go; a 404 or 400 is an answer, not a hiccup.
const RETRY_DELAYS_MS = [700, 2000];
const retryable = status => status === 429 || status >= 500;

// When FPL is down the proxy answers with its last good copy and an
// X-Fpl-Stale-At header; the app shows a note saying how old it is.
const staleListeners = new Set();
let staleAt = null;
export function onFplStale(fn) {
  staleListeners.add(fn);
  if (staleAt) fn(staleAt);
  return () => staleListeners.delete(fn);
}
function noteStale(at) {
  if (!at || at === staleAt) return;
  staleAt = at;
  staleListeners.forEach(fn => fn(at));
}

export async function fetchFplJson(path, { retryDelays = RETRY_DELAYS_MS } = {}) {
  // Calls our own /api/fpl serverless function (added via Vercel), which
  // fetches FPL server-side — no CORS issue, no dependence on third-party
  // proxy services, and no dynamic-route filename to trip over.
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(`/api/fpl?path=${encodeURIComponent(path)}`);
    } catch (e) {
      // Offline or the connection dropped.
      if (attempt >= retryDelays.length) throw e;
    }
    if (r && r.ok) {
      noteStale(r.headers && r.headers.get && r.headers.get('X-Fpl-Stale-At'));
      return r.json();
    }
    if (r && (!retryable(r.status) || attempt >= retryDelays.length)) throw new Error('status ' + r.status);
    // A little jitter so a burst of retries doesn't arrive together.
    await new Promise(resolve => setTimeout(resolve, retryDelays[attempt] * (0.75 + Math.random() / 2)));
  }
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

// Minutes each player played in the last few gameweeks (api/recent-minutes),
// for marking down players who have lost their place. Best-effort like the
// two above: without it predictions just skip that step.
export async function fetchRecentMinutes() {
  try {
    const r = await fetch('/api/recent-minutes', { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// The machine-learning model's predictions (public/ml/, rebuilt daily by
// .github/workflows/ml-retrain.yml): the gameweek being planned, or one
// gameweek's as saved before its deadline. Best-effort: without them the
// formula predicts, as before.
export async function fetchMlPredictions(gwId = null) {
  try {
    const r = await fetch(gwId ? `/ml/predictions-gw${gwId}.json` : '/ml/predictions.json', { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const data = await r.json();
    return data && data.byId ? data : null;
  } catch {
    return null;
  }
}

// How much the model counts in the blend, per position, as the refresh job
// last learned it (src/lib/modelWeeks.js). Best-effort: without it the
// blend is half each.
export async function fetchBlendWeights() {
  try {
    const r = await fetch('/api/optimal-squad?blend=1', { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// FPL names every gameweek "Gameweek N"; this puts them in the app's
// language, so every screen that shows event.name does too.
export function localEventNames(bootstrap) {
  if (!bootstrap || !Array.isArray(bootstrap.events)) return bootstrap;
  return { ...bootstrap, events: bootstrap.events.map(e => ({ ...e, name: t('Gameweek {n}', { n: e.id }) })) };
}

export async function loadStaticData() {
  const [rawBootstrap, fixturesRaw, playerHistoryData, oddsData, recent, mlData, blendData] = await Promise.all([
    fetchFplJson('bootstrap-static/'),
    fetchFplJson('fixtures/'),
    fetchPlayerHistory(),
    fetchOdds(),
    fetchRecentMinutes(),
    fetchMlPredictions(),
    fetchBlendWeights(),
  ]);
  const bootstrap = localEventNames(rawBootstrap);
  const target = getTargetEvent(bootstrap.events);
  const recentMinutesById = recent && target && recent.gwId === target.id ? recent.minutes : null;
  const staticData = buildStaticDataFromRaw(bootstrap, fixturesRaw, { playerHistoryData, oddsData, recentMinutesById, mlData, blendData });
  // Kept so a past gameweek can be rebuilt "as of" its deadline.
  return { ...staticData, raw: { bootstrap, fixturesRaw, playerHistoryData, blendData } };
}

// Static data for a past gameweek, using only what was known before its
// deadline: player stats from earlier gameweeks (/api/as-of, see
// src/lib/asOf.js), with that gameweek as the target. Bookmaker odds are
// left out — the cached odds are for upcoming matches only. The blend uses
// today's weights.
export async function loadStaticDataAsOf(base, gwId) {
  const [r, mlData] = await Promise.all([fetch(`/api/as-of?gw=${gwId}`), fetchMlPredictions(gwId)]);
  if (!r.ok) throw new Error('status ' + r.status);
  const asOf = await r.json();
  const bootstrap = applyAsOfStats(base.raw.bootstrap, asOf);
  const staticData = buildStaticDataFromRaw(bootstrap, base.raw.fixturesRaw, {
    forceGwId: gwId, playerHistoryData: base.raw.playerHistoryData, oddsData: null, recentMinutesById: recentMinutesFromAsOf(asOf), mlData, blendData: base.raw.blendData,
  });
  return { ...staticData, raw: base.raw, asOfGwId: gwId };
}
