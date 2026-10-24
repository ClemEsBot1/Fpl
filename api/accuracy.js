import { get, put } from '@vercel/blob';
import { predictionsPathnameFor, summariseAccuracy, latestFinishedEvent } from '../src/lib/accuracy.js';
import { buildStaticDataFromRaw, seasonIdFor, snapshotFromModel, snapshotIsForSeason } from '../src/lib/predictions.js';
import { aggregateLiveStats, applyAsOfStats, recentMinutesFromAsOf } from '../src/lib/asOf.js';

const FPL_BASE = 'https://fantasy.premierleague.com/api/';

async function fplJson(path) {
  const r = await fetch(FPL_BASE + path, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`FPL ${path}: ${r.status}`);
  return r.json();
}

// "Nothing to show yet" answers are cached for a while too: the home screen
// asks on every visit, and each uncached answer costs a bootstrap download.
// Every player's formula prediction for gameweek `gwId` from what was known
// before its deadline (as the app's past-gameweek view works it out, see
// loadStaticDataAsOf in src/lib/fplClient.js), for a saved file that came
// from the model instead.
async function formulaPredictionsAsOf(bootstrap, gwId) {
  const gws = Array.from({ length: gwId - 1 }, (_, i) => i + 1);
  const [lives, fixtures, history] = await Promise.all([
    Promise.all(gws.map(async gw => [gw, (await fplJson(`event/${gw}/live/`)).elements || []])),
    fplJson('fixtures/'),
    get('player-history.json', { access: 'public', useCache: false })
      .then(r => (r ? new Response(r.stream).text().then(JSON.parse) : null)).catch(() => null),
  ]);
  const asOf = aggregateLiveStats(Object.fromEntries(lives), gwId);
  const staticData = buildStaticDataFromRaw(applyAsOfStats(bootstrap, asOf), fixtures, {
    forceGwId: gwId, playerHistoryData: history, oddsData: null, recentMinutesById: recentMinutesFromAsOf(asOf),
  });
  return Object.fromEntries(Object.entries(staticData.predictionsById).map(([id, p]) => [id, p.nextMatchPredicted]));
}

// The predictions saved before gameweek `gwId`'s deadline, or null when
// there's no file for it this season. Predictions the model made are
// replaced by the formula's, worked out as of that deadline, and saved back
// so this happens once.
async function savedPredictions(bootstrap, gwId) {
  const saved = await get(predictionsPathnameFor(gwId), { access: 'public', useCache: false });
  if (!saved) return null;
  let savedJson = JSON.parse(await new Response(saved.stream).text());
  // The file for this gameweek number may be from last season.
  if (!snapshotIsForSeason(savedJson, seasonIdFor(bootstrap.events), bootstrap.events)) return null;
  if (snapshotFromModel(savedJson)) {
    savedJson = { ...savedJson, predictedById: await formulaPredictionsAsOf(bootstrap, gwId), source: 'formula' };
    try {
      await put(predictionsPathnameFor(gwId), JSON.stringify(savedJson), { access: 'public', contentType: 'application/json', allowOverwrite: true });
    } catch { /* worked out again next time */ }
  }
  return savedJson;
}

// For a gameweek with no saved predictions (before saving began, or a
// missed run): the formula's, worked out afterwards from what was known
// before its deadline. Kept in a file of its own, so the accuracy figures
// stay those of predictions made at the time.
const workedOutPathFor = gwId => `predictions-asof-gw${gwId}.json`;
async function workedOutPredictions(bootstrap, gwId) {
  const season = seasonIdFor(bootstrap.events);
  const kept = await get(workedOutPathFor(gwId), { access: 'public', useCache: false });
  if (kept) {
    const json = JSON.parse(await new Response(kept.stream).text());
    if (json.season === season) return json.predictedById;
  }
  const predictedById = await formulaPredictionsAsOf(bootstrap, gwId);
  try {
    await put(workedOutPathFor(gwId), JSON.stringify({ gwId, season, predictedById, source: 'formula-asof' }), { access: 'public', contentType: 'application/json', allowOverwrite: true });
  } catch { /* worked out again next time */ }
  return predictedById;
}

// GET /api/accuracy?all=1 — every player's prediction for each gameweek
// this season whose deadline has passed, for the player profile
// (src/lib/playerProfile.js): { season, gws: { [gw]: { [id]: points } },
// workedOut: [gw] } — workedOut lists those worked out afterwards.
async function allSaved(res, bootstrap) {
  const now = Date.now();
  const closed = (bootstrap.events || []).filter(e => Date.parse(e.deadline_time) <= now).map(e => e.id);
  const files = await Promise.all(closed.map(gw => savedPredictions(bootstrap, gw).catch(() => null)));
  const gws = {};
  const workedOut = [];
  await Promise.all(closed.map(async (gw, i) => {
    if (files[i] && files[i].predictedById) { gws[gw] = files[i].predictedById; return; }
    const byId = await workedOutPredictions(bootstrap, gw).catch(() => null);
    if (byId) { gws[gw] = byId; workedOut.push(gw); }
  }));
  res
    .status(200)
    .setHeader('Cache-Control', 'public, max-age=1800, s-maxage=1800, stale-while-revalidate=86400')
    .json({ season: seasonIdFor(bootstrap.events), gws, workedOut: workedOut.sort((a, b) => a - b) });
}

function notAvailable(res, body) {
  res.status(404).setHeader('Cache-Control', 'public, max-age=600, s-maxage=600').json(body);
}

// GET /api/accuracy[?gw=N] — how last gameweek's (or gameweek N's)
// predictions compared with what players actually scored. 404 when there
// are no saved predictions for it (e.g. gameweeks before this existed).
// ?all=1 gives every gameweek's saved predictions instead (allSaved).
export default async function handler(req, res) {
  try {
    const bootstrap = await fplJson('bootstrap-static/');
    if (req.query && req.query.all) { await allSaved(res, bootstrap); return; }
    let gwId = Number(req.query && req.query.gw);
    let gwName = null;
    if (!Number.isInteger(gwId) || gwId < 1) {
      const event = latestFinishedEvent(bootstrap.events);
      if (!event) { notAvailable(res, { error: 'no_finished_gameweek' }); return; }
      gwId = event.id;
      gwName = event.name;
    }

    // null means there's no file; a storage failure throws, and is answered
    // below without being cached.
    const savedJson = await savedPredictions(bootstrap, gwId);
    if (!savedJson) { notAvailable(res, { error: 'no_saved_predictions', gwId }); return; }

    const live = await fplJson(`event/${gwId}/live/`);
    const positionById = Object.fromEntries((bootstrap.elements || []).map(e => [e.id, e.element_type]));
    const summary = summariseAccuracy(savedJson.predictedById || {}, live.elements || [], positionById);
    if (!summary) { notAvailable(res, { error: 'not_enough_data', gwId }); return; }

    res
      .status(200)
      .setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400')
      .json({ gwId, gwName: gwName || `Gameweek ${gwId}`, ...summary });
  } catch (e) {
    const detail = String((e && e.message) || e);
    console.error('accuracy failed:', detail);
    res.status(502).setHeader('Cache-Control', 'no-store').json({ error: 'accuracy_failed', detail });
  }
}
