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

function notAvailable(res, body) {
  res.status(404).setHeader('Cache-Control', 'public, max-age=600, s-maxage=600').json(body);
}

// GET /api/accuracy[?gw=N] — how last gameweek's (or gameweek N's)
// predictions compared with what players actually scored. 404 when there
// are no saved predictions for it (e.g. gameweeks before this existed).
export default async function handler(req, res) {
  try {
    const bootstrap = await fplJson('bootstrap-static/');
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
    const saved = await get(predictionsPathnameFor(gwId), { access: 'public', useCache: false });
    if (!saved) { notAvailable(res, { error: 'no_saved_predictions', gwId }); return; }
    let savedJson = JSON.parse(await new Response(saved.stream).text());
    // The file for this gameweek number may be from last season.
    if (!snapshotIsForSeason(savedJson, seasonIdFor(bootstrap.events), bootstrap.events)) {
      notAvailable(res, { error: 'no_saved_predictions', gwId });
      return;
    }

    // Predictions the model made are replaced by the formula's, worked out
    // as of that deadline, and saved back so this happens once.
    if (snapshotFromModel(savedJson)) {
      savedJson = { ...savedJson, predictedById: await formulaPredictionsAsOf(bootstrap, gwId), source: 'formula' };
      try {
        await put(predictionsPathnameFor(gwId), JSON.stringify(savedJson), { access: 'public', contentType: 'application/json', allowOverwrite: true });
      } catch { /* worked out again next time */ }
    }

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
