import { put, get } from '@vercel/blob';
import { buildStaticDataFromRaw, buildOptimalTeam, getTargetEvent, isEventLocked, recentMinutesFromLive, RECENT_MINUTES_GWS, SQUAD_BUDGET } from '../src/lib/predictions.js';
import { matchOddsToFixtures } from '../src/lib/oddsAdjustment.js';
import { predictionsPathnameFor } from '../src/lib/accuracy.js';
import { indexNowEnabled, pingIndexNow } from '../src/lib/indexNow.js';
import { SITE } from '../src/lib/seoPage.js';
import { refreshBlendWeights, siteBase } from '../src/lib/modelWeeks.js';

const FPL_BASE = 'https://fantasy.premierleague.com/api/';
// The Odds API (the-odds-api.com) — free tier (500 requests/month) is
// plenty for one fetch/day here. Swap ODDS_API_URL and the parsing in
// fetchOddsServer if you use a different provider; nothing else in this
// file or in oddsAdjustment.js is tied to this specific one.
const ODDS_API_URL = 'https://api.the-odds-api.com/v4/sports/soccer_epl/odds/?regions=uk&markets=h2h&oddsFormat=decimal';

// One blob per gameweek, e.g. optimal-squad-gw3.json — never a single
// "latest" file. The refresh job always writes to whichever gameweek is
// currently the target, so once a gameweek's deadline passes and the target
// moves on, that gameweek's file simply stops being touched and is
// naturally frozen — no separate "close it" step needed.
export function snapshotPathnameFor(gwId) {
  return `optimal-squad-gw${gwId}.json`;
}

async function fetchFplJsonServer(path) {
  // Runs server-side — no browser involved, so no CORS restriction and no
  // need for the /api/fpl proxy the client uses. Straight to the source.
  const r = await fetch(FPL_BASE + path, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`FPL fetch failed for ${path}: status ${r.status}`);
  return r.json();
}

// Best-effort: the player-history blob only exists once
// scripts/import-player-history.mjs has been run at least once. A missing
// blob is not an error here — it just means predictions fall back to the
// pre-existing position-average ep_next shrinkage baseline, exactly as
// before this feature existed.
async function fetchPlayerHistoryServer() {
  try {
    const result = await get('player-history.json', { access: 'public', useCache: false });
    if (!result) return null;
    const text = await new Response(result.stream).text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Best-effort, same reasoning as fetchPlayerHistoryServer above: no
// ODDS_API_KEY set, or the request fails, just means oddsAdjustment is 0 for
// everyone this run — not a reason to fail the whole refresh.
async function fetchOddsServer() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return null;
  try {
    const r = await fetch(`${ODDS_API_URL}&apiKey=${apiKey}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Minutes in the gameweeks before `gwId` (see recentMinutesFromLive).
// Best-effort like the two above: on failure predictions skip that step.
async function fetchRecentMinutesServer(gwId) {
  try {
    const gws = [];
    for (let gw = Math.max(1, gwId - RECENT_MINUTES_GWS); gw < gwId; gw++) gws.push(gw);
    const lives = await Promise.all(gws.map(async gw => [gw, (await fetchFplJsonServer(`event/${gw}/live/`)).elements || []]));
    return recentMinutesFromLive(Object.fromEntries(lives), gwId);
  } catch {
    return null;
  }
}

// The ML model's predictions, deployed with the app as public/ml/
// predictions.json (rebuilt daily by .github/workflows/ml-retrain.yml).
// Best-effort like the others: without them the formula predicts.
async function fetchMlServer(base) {
  try {
    if (!base) return null;
    const r = await fetch(`${base}/ml/predictions.json`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const data = await r.json();
    return data && data.byId ? data : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  // Authenticate both trigger sources with one check:
  //  - Vercel's own daily cron (see vercel.json) auto-sends this header using
  //    the CRON_SECRET env var Vercel provisions for you once crons exist.
  //  - The hourly GitHub Actions workflow sends the same header, using a
  //    repo secret you copy from that same CRON_SECRET value (not required —
  //    the app works fine on the daily schedule alone).
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!expected || auth !== `Bearer ${expected}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  // Optional manual override: ?gw=1 (re)builds a specific gameweek's
  // snapshot on demand, e.g. to backfill one that closed before this feature
  // existed and so never got saved. IMPORTANT: this necessarily uses
  // TODAY's prices/ep_next, not what was actually available before that
  // gameweek was played — FPL's API only exposes current state, so an
  // authentic historical snapshot isn't recoverable once a gameweek has
  // passed. The snapshot is flagged `backfilled: true` so the app/you can
  // tell it apart from one saved in real time.
  const forceGwId = req.query && req.query.gw ? Number(req.query.gw) : null;
  if (forceGwId !== null && (!Number.isInteger(forceGwId) || forceGwId < 1 || forceGwId > 38)) {
    res.status(400).json({ error: 'invalid_gw' });
    return;
  }

  try {
    const base = siteBase(req.headers && req.headers.host);
    const [bootstrap, fixturesRaw, playerHistoryData, oddsApiEvents, mlData] = await Promise.all([
      fetchFplJsonServer('bootstrap-static/'),
      fetchFplJsonServer('fixtures/'),
      fetchPlayerHistoryServer(),
      fetchOddsServer(),
      fetchMlServer(base),
    ]);
    if (forceGwId !== null && !bootstrap.events.some(e => e.id === forceGwId)) {
      res.status(400).json({ error: 'unknown_gw' });
      return;
    }

    const teamsById = {};
    bootstrap.teams.forEach(t => { teamsById[t.id] = t; });
    // Matched once here (not inside buildStaticDataFromRaw) because matching
    // needs the raw provider event shape (team names, commence_time) that
    // buildStaticDataFromRaw has no business knowing about — it only ever
    // sees the already-resolved {event, homeTeamId, awayTeamId, ...} shape.
    const oddsData = oddsApiEvents ? matchOddsToFixtures(oddsApiEvents, fixturesRaw, teamsById) : null;
    if (oddsData && oddsData.length) {
      // Cached for the browser to read via /api/odds — see that file for why
      // it's not a live proxy. Best-effort: a failed write here shouldn't
      // fail the whole refresh, since the squad snapshot below is the part
      // that actually matters.
      try {
        await put('odds-latest.json', JSON.stringify(oddsData), {
          access: 'public', contentType: 'application/json', allowOverwrite: true,
        });
      } catch { /* non-fatal — see comment above */ }
    }

    const plannedGw = forceGwId || (getTargetEvent(bootstrap.events) || {}).id;
    const recentMinutesById = plannedGw ? await fetchRecentMinutesServer(plannedGw) : null;
    // How much the model counts in the blend, learned from the finished
    // gameweeks (src/lib/modelWeeks.js). Best-effort: without them it's
    // half each.
    const blendData = mlData ? await refreshBlendWeights({ bootstrap, base, blob: { get, put } }).catch(() => null) : null;
    const staticData = buildStaticDataFromRaw(bootstrap, fixturesRaw, { ...(forceGwId ? { forceGwId } : {}), playerHistoryData, oddsData, recentMinutesById, mlData, blendData });
    const gwId = staticData.targetEvent ? staticData.targetEvent.id : 1;

    // After the last deadline of the season there's no gameweek left to
    // plan for, and the target stays on the final one. Rewriting its files
    // now would replace what was predicted before its deadline with
    // hindsight.
    if (!forceGwId && staticData.targetEvent && isEventLocked(staticData.targetEvent)) {
      res.status(200).json({ ok: true, skipped: 'season_over', gwId });
      return;
    }

    const built = buildOptimalTeam(staticData, SQUAD_BUDGET);
    const snapshot = {
      playerIds: built.squad.map(s => s.player.id),
      startingIds: built.squad.filter(s => s.isStarting).map(s => s.player.id),
      captainId: built.captainId,
      viceCaptainId: built.viceCaptainId,
      predictedById: Object.fromEntries(built.squad.map(s => [s.player.id, s.nextMatchPredicted])),
      gwId,
      // FPL reuses gameweek numbers and player ids every season, so readers
      // check this before trusting a file from an earlier one.
      season: staticData.seasonId,
      builtAt: new Date().toISOString(),
      backfilled: !!forceGwId,
      // Picked with the blend, or the formula's alone without the model's
      // file for this gameweek (see snapshotFromModel).
      source: staticData.predictionSource,
    };

    await put(snapshotPathnameFor(gwId), JSON.stringify(snapshot), {
      access: 'public',
      contentType: 'application/json',
      allowOverwrite: true,
    });

    // Every player's prediction for this gameweek, for /api/accuracy to
    // score once it's been played. Like the squad snapshot, it's rewritten
    // on each run until the deadline passes and then left as it was —
    // never rewritten for a backfill, which would use today's data.
    if (!forceGwId) {
      try {
        const predictedById = Object.fromEntries(
          Object.entries(staticData.predictionsById).map(([id, pred]) => [id, pred.nextMatchPredicted]),
        );
        // This gameweek and the next four, for the player, club and
        // gameweek pages (src/lib/seoDynamic.js).
        const byGwById = Object.fromEntries(
          Object.entries(staticData.predictionsById).map(([id, pred]) => [id, (pred.byGw || []).map(w => w.points)]),
        );
        // With the blend, each model's own figures too, for the admin
        // head-to-head and for learning the blend's weights once the
        // gameweek has been played (src/lib/modelWeeks.js).
        const blended = staticData.predictionSource === 'blend';
        const figures = key => Object.fromEntries(Object.entries(staticData.predictionsById)
          .filter(([, pred]) => pred.breakdown && pred.breakdown[key])
          .map(([id, pred]) => [id, pred.breakdown[key].next]));
        const models = blended
          ? { formulaById: Object.fromEntries(Object.entries(staticData.predictionsById).map(([id, pred]) => [id, pred.breakdown.formula ? pred.breakdown.formula.next : pred.nextMatchPredicted])), mlById: figures('ml'), mlBuiltAt: staticData.mlBuiltAt, blendWeights: staticData.blendWeights }
          : {};
        await put(predictionsPathnameFor(gwId), JSON.stringify({ gwId, season: staticData.seasonId, savedAt: snapshot.builtAt, predictedById, byGwById, source: staticData.predictionSource, ...models }), {
          access: 'public', contentType: 'application/json', allowOverwrite: true,
        });
      } catch { /* non-fatal — accuracy tracking just skips this gameweek */ }
    }

    // The pages made from these predictions changed: tell the engines that
    // take IndexNow (src/lib/indexNow.js).
    const indexNow = !forceGwId && indexNowEnabled()
      ? await pingIndexNow(['/', '/fpl-predictions', '/fpl-tips', '/fpl-players', '/fpl-price-changes', '/fpl-deadline', '/fpl-differentials', '/fpl-double-gameweek', '/fpl-blank-gameweek', `/gw/${gwId}`].map(p => SITE + p))
      : null;

    res.status(200).json({ ok: true, gwId, indexNow, builtAt: snapshot.builtAt, backfilled: snapshot.backfilled, playerCount: snapshot.playerIds.length, usedPlayerHistory: !!playerHistoryData, usedOdds: !!(oddsData && oddsData.length), matchedFixtureCount: oddsData ? oddsData.length : 0, source: staticData.predictionSource, blendWeights: staticData.blendWeights });
  } catch (e) {
    res.status(502).json({ error: 'refresh_failed', detail: String((e && e.message) || e) });
  }
}