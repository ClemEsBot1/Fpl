import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStaticDataFromRaw } from '../src/lib/predictions.js';
import { compareGameweek } from '../src/lib/headToHead.js';
import { league } from './helpers/league.js';

const { bootstrap, fixtures } = league();
const staticData = buildStaticDataFromRaw(bootstrap, fixtures);
const ids = staticData.allPlayers.map(p => p.id);
const positionById = Object.fromEntries(staticData.allPlayers.map(p => [p.id, p.positionId]));
// What everyone scored: player id mod 7, and all of them played.
const scored = id => id % 7;
const live = ids.map(id => ({ id, stats: { total_points: scored(id), minutes: 90 } }));

test('the model that predicted the points better wins on every measure', () => {
  const exact = Object.fromEntries(ids.map(id => [id, scored(id) + 0.2]));
  const noise = Object.fromEntries(ids.map(id => [id, ((id * 37) % 11) / 2]));
  const r = compareGameweek({ formula: noise, ml: exact, live, positionById, staticData });
  assert.ok(r.ml.meanAbsError < r.formula.meanAbsError);
  assert.ok(r.ml.correlation > r.formula.correlation);
  assert.ok(r.ml.topTenAverageActual > r.formula.topTenAverageActual);
  assert.ok(r.ml.xiPoints > r.formula.xiPoints, `best XI: ML ${r.ml.xiPoints} v formula ${r.formula.xiPoints}`);
  assert.equal(r.ml.xiPlayerIds.length, 11);
});

test("a player the formula had ruled out at the deadline can't be picked by the model either", () => {
  const formula = Object.fromEntries(ids.map(id => [id, 1]));
  const out = ids[0];
  formula[out] = 0;
  const ml = Object.fromEntries(ids.map(id => [id, id === out ? 99 : 1]));
  const r = compareGameweek({ formula, ml, live, positionById, staticData });
  assert.ok(!r.ml.xiPlayerIds.includes(out));
});

test('the captain counts double in the best XI', () => {
  const pred = Object.fromEntries(ids.map(id => [id, scored(id)]));
  const r = compareGameweek({ formula: pred, ml: pred, live, positionById, staticData });
  const xiSum = r.formula.xiPlayerIds.reduce((s, id) => s + scored(id), 0);
  assert.equal(r.formula.xiPoints, xiSum + scored(r.formula.captainId));
  assert.ok(r.formula.xiPlayerIds.includes(r.formula.captainId));
});

test('the admin head-to-head scores each finished gameweek that has both files, and keeps it', async () => {
  const { modelHeadToHead } = await import('../src/lib/adminServer.js');
  const { fakeRedis } = await import('./helpers/fakeRedis.js');
  const { seasonIdFor } = await import('../src/lib/predictions.js');
  const season = seasonIdFor(bootstrap.events);
  const finished = bootstrap.events.filter(e => e.finished).map(e => e.id);
  const last = finished[finished.length - 1];
  const preds = Object.fromEntries(ids.map(id => [id, scored(id)]));
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    const body = url.endsWith('bootstrap-static/') ? bootstrap
      : url.endsWith('fixtures/') ? fixtures
      : url.endsWith(`event/${last}/live/`) || url.includes('/live/') ? { elements: live }
      : url.endsWith(`/ml/predictions-gw${last}.json`) ? { season, gwId: last, builtAt: 'x', byId: Object.fromEntries(ids.map(id => [id, [scored(id), 1, 1, 1, 1]])) }
      : null;
    return { ok: !!body, json: async () => body };
  };
  const blob = { get: async pathname => (pathname === `predictions-gw${last}.json`
    ? { stream: new Response(JSON.stringify({ gwId: last, season, source: 'formula', predictedById: preds })).body } : null) };
  const redis = fakeRedis();
  const out = await modelHeadToHead(redis, { host: 'localhost:3000', fetchImpl, blob });
  assert.equal(out.season, season);
  const week = out.weeks.find(w => w.gwId === last);
  assert.ok(week.formula && week.ml, 'both scored');
  assert.equal(week.ml.meanAbsError, week.formula.meanAbsError);
  assert.deepEqual(out.weeks.find(w => w.gwId === finished[0]).missing, ['formula', 'ml']);
  // Scored once: the second look reads it back without fetching it again.
  urls.length = 0;
  const again = await modelHeadToHead(redis, { host: 'localhost:3000', fetchImpl, blob });
  assert.deepEqual(again.weeks.find(w => w.gwId === last), week);
  assert.ok(!urls.some(u => u.includes(`event/${last}/live/`) || u.includes(`predictions-gw${last}.json`)), 'the scored week is not fetched again');
});
