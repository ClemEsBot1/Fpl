// Server-only: the formula's, the ML model's and the blend's predictions
// for finished gameweeks, made before each deadline, with what players
// scored. For the admin head-to-head (modelHeadToHead in adminServer.js)
// and for learning the blend's weights (refreshBlendWeights, run by
// api/refresh-optimal.js).
import { predictionsPathnameFor } from './accuracy.js';
import { modelGatedBy } from './headToHead.js';
import { seasonIdFor, snapshotFromModel, snapshotIsForSeason } from './predictions.js';
import { BLEND_PRIOR, blendPredictions, fitBlendWeights } from './blend.js';

// Gameweeks looked back over.
export const MODEL_WEEKS = 8;
// Where the learned weights are kept (Vercel Blob), for the refresh job
// and, through /api/optimal-squad?blend=1, the app.
export const BLEND_WEIGHTS_PATHNAME = 'blend-weights.json';

async function jsonFrom(fetchImpl, url) {
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export async function blobJson(blob, pathname) {
  const r = await blob.get(pathname, { access: 'public', useCache: false });
  return r ? JSON.parse(await new Response(r.stream).text()) : null;
}

// The site's address (where public/ml/ is served), from the request's host.
export function siteBase(host) {
  return host ? `${host.startsWith('localhost') ? 'http' : 'https'}://${host}` : null;
}

// The finished gameweeks to look at: the last MODEL_WEEKS whose points FPL
// has confirmed.
export function finishedEvents(events) {
  return (events || []).filter(e => e.finished && e.data_checked !== false).slice(-MODEL_WEEKS);
}

// One finished gameweek: { gwId, formula, ml, blend, blendLearned, live,
// mlBuiltAt }, formula, ml and blend each { [playerId]: points predicted }
// and live FPL's event/{gw}/live/ elements; or { gwId, missing } naming what
// isn't there. The formula's and model's figures come from the predictions
// file the refresh job saved before the deadline (formulaById, mlById);
// one saved before the blend has the formula's as its predictedById, and
// the model's are then read from its own file for that gameweek. A file
// saved before the blend has no blend: it's worked out with the prior
// weights, which no finished week has had a say in.
export async function loadModelWeek({ event, season, events, base, fetchImpl = fetch, blob, positionById }) {
  const [saved, live] = await Promise.all([
    blobJson(blob, predictionsPathnameFor(event.id)).catch(() => null),
    jsonFrom(fetchImpl, `https://fantasy.premierleague.com/api/event/${event.id}/live/`),
  ]);
  // A saved file the model picked (see snapshotFromModel) has no formula figures.
  const fresh = saved && saved.predictedById && snapshotIsForSeason(saved, season, events) && !snapshotFromModel(saved) ? saved : null;
  const formula = fresh ? fresh.formulaById || (fresh.source !== 'blend' ? fresh.predictedById : null) : null;
  let ml = fresh && fresh.mlById ? fresh.mlById : null;
  let mlBuiltAt = fresh && fresh.mlBuiltAt ? fresh.mlBuiltAt : null;
  if (!ml && base) {
    const mlFile = await jsonFrom(fetchImpl, `${base}/ml/predictions-gw${event.id}.json`);
    if (mlFile && mlFile.byId && mlFile.season === season && mlFile.gwId === event.id) {
      ml = Object.fromEntries(Object.entries(mlFile.byId).map(([id, v]) => [id, Array.isArray(v) ? v[0] : v]));
      mlBuiltAt = mlFile.builtAt || null;
    }
  }
  if (!formula || !ml || !live) {
    return { gwId: event.id, missing: [!formula && 'formula', !ml && 'ml', !live && 'points'].filter(Boolean) };
  }
  const gated = modelGatedBy(formula, ml);
  const blendLearned = fresh.source === 'blend';
  return {
    gwId: event.id, formula, ml: gated, live: live.elements || [], mlBuiltAt, blendLearned,
    blend: blendLearned ? fresh.predictedById : blendPredictions(formula, gated, positionById, BLEND_PRIOR),
  };
}

// The blend's weights for the season, learned from the finished gameweeks
// (fitBlendWeights) and kept in Blob. Learned again once another gameweek
// has finished; otherwise the kept ones. Never throws for a failed write:
// the weights are still returned.
export async function refreshBlendWeights({ bootstrap, base, fetchImpl = fetch, blob, now = () => new Date() }) {
  const season = seasonIdFor(bootstrap.events);
  const finished = finishedEvents(bootstrap.events);
  const throughGw = finished.length ? finished[finished.length - 1].id : 0;
  const kept = await blobJson(blob, BLEND_WEIGHTS_PATHNAME).catch(() => null);
  if (kept && kept.season === season && kept.throughGw === throughGw && kept.weights) return kept;
  const positionById = Object.fromEntries((bootstrap.elements || []).map(e => [e.id, e.element_type]));
  const weeks = (await Promise.all(finished.map(event => loadModelWeek({ event, season, events: bootstrap.events, base, fetchImpl, blob, positionById }))))
    .filter(w => w.formula);
  const fit = fitBlendWeights(weeks.map(w => ({ formula: w.formula, ml: w.ml, live: w.live, positionById })));
  const data = { season, throughGw, weights: fit.weights, weeks: fit.weeks, gws: weeks.map(w => w.gwId), fittedAt: now().toISOString() };
  try {
    await blob.put(BLEND_WEIGHTS_PATHNAME, JSON.stringify(data), { access: 'public', contentType: 'application/json', allowOverwrite: true });
  } catch { /* learned again on the next run */ }
  return data;
}
