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
  assert.ok(week.formula && week.ml && week.blend, 'all three scored');
  assert.equal(week.ml.meanAbsError, week.formula.meanAbsError);
  assert.equal(week.blendLearned, false, 'saved before the blend: worked out at half each');
  assert.equal(week.blend.meanAbsError, week.formula.meanAbsError);
  assert.equal(out.blendWeights, null, 'no weights learned yet');
  assert.deepEqual(out.weeks.find(w => w.gwId === finished[0]).missing, ['formula', 'ml']);
  // Scored once: the second look reads it back without fetching it again.
  urls.length = 0;
  const again = await modelHeadToHead(redis, { host: 'localhost:3000', fetchImpl, blob });
  assert.deepEqual(again.weeks.find(w => w.gwId === last), week);
  assert.ok(!urls.some(u => u.includes(`event/${last}/live/`) || u.includes(`predictions-gw${last}.json`)), 'the scored week is not fetched again');
});

test("the blend that ran is scored as it was, from the file saved with each model's figures", async () => {
  const { modelHeadToHead } = await import('../src/lib/adminServer.js');
  const { fakeRedis } = await import('./helpers/fakeRedis.js');
  const { seasonIdFor } = await import('../src/lib/predictions.js');
  const season = seasonIdFor(bootstrap.events);
  const finished = bootstrap.events.filter(e => e.finished).map(e => e.id);
  const last = finished[finished.length - 1];
  const exact = Object.fromEntries(ids.map(id => [id, scored(id)]));
  const off = Object.fromEntries(ids.map(id => [id, scored(id) + 2]));
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    const body = url.endsWith('bootstrap-static/') ? bootstrap : url.endsWith('fixtures/') ? fixtures : url.includes('/live/') ? { elements: live } : null;
    return { ok: !!body, json: async () => body };
  };
  const files = {
    [`predictions-gw${last}.json`]: { gwId: last, season, source: 'blend', predictedById: exact, formulaById: off, mlById: off, mlBuiltAt: 'y' },
    'blend-weights.json': { season, throughGw: last, weights: { 1: 0.4, 2: 0.5, 3: 0.6, 4: 0.7 }, weeks: 3 },
  };
  const blob = { get: async pathname => (files[pathname] ? { stream: new Response(JSON.stringify(files[pathname])).body } : null) };
  const out = await modelHeadToHead(fakeRedis(), { host: 'localhost:3000', fetchImpl, blob });
  const week = out.weeks.find(w => w.gwId === last);
  assert.equal(week.blendLearned, true);
  assert.equal(week.blend.meanAbsError, 0, 'the blend as saved');
  assert.equal(week.formula.meanAbsError, 2);
  assert.equal(week.mlBuiltAt, 'y');
  assert.ok(!urls.some(u => u.includes(`/ml/predictions-gw${last}.json`)), "the model's figures came with the saved file");
  assert.deepEqual(out.blendWeights.weights, { 1: 0.4, 2: 0.5, 3: 0.6, 4: 0.7 });
  assert.equal(out.blendWeights.weeks, 3);
});

test('the refresh job learns the weights once a gameweek has finished, and keeps them until the next', async () => {
  const { refreshBlendWeights } = await import('../src/lib/modelWeeks.js');
  const { seasonIdFor } = await import('../src/lib/predictions.js');
  const season = seasonIdFor(bootstrap.events);
  const finished = bootstrap.events.filter(e => e.finished).map(e => e.id);
  const last = finished[finished.length - 1];
  // The model spot on, the formula 2 out, for every finished gameweek.
  const exact = Object.fromEntries(ids.map(id => [id, scored(id)]));
  const off = Object.fromEntries(ids.map(id => [id, scored(id) + 2]));
  const files = Object.fromEntries(finished.map(gw => [`predictions-gw${gw}.json`, { gwId: gw, season, source: 'blend', predictedById: off, formulaById: off, mlById: exact }]));
  const puts = [];
  const blob = {
    get: async pathname => (files[pathname] ? { stream: new Response(JSON.stringify(files[pathname])).body } : null),
    put: async (pathname, body) => { puts.push(pathname); files[pathname] = JSON.parse(body); },
  };
  const fetchImpl = async url => ({ ok: url.includes('/live/'), json: async () => ({ elements: live }) });
  const now = () => new Date('2026-10-18T06:00:00Z');
  const learned = await refreshBlendWeights({ bootstrap, base: null, fetchImpl, blob, now });
  assert.equal(learned.season, season);
  assert.equal(learned.throughGw, last);
  assert.deepEqual(learned.gws, finished.slice(-8));
  for (const pos of [1, 2, 3, 4]) assert.ok(learned.weights[pos] > 0.5, `the model counts for more: ${pos} ${learned.weights[pos]}`);
  assert.deepEqual(puts, ['blend-weights.json']);
  // Kept: nothing new has finished.
  const again = await refreshBlendWeights({ bootstrap, base: null, fetchImpl, blob, now });
  assert.deepEqual(again, learned);
  assert.equal(puts.length, 1, 'not learned again');
  // Last season's weights are learned again.
  files['blend-weights.json'] = { ...learned, season: '1999-00' };
  await refreshBlendWeights({ bootstrap, base: null, fetchImpl, blob, now });
  assert.equal(puts.length, 2);
});

test('a gameweek whose matches are over but not yet confirmed by FPL is in the head-to-head, provisional', async () => {
  const { headToHeadEvents, finishedEvents } = await import('../src/lib/modelWeeks.js');
  const events = [
    { id: 7, finished: true, data_checked: true },
    { id: 8, finished: false, data_checked: false },
    { id: 9, finished: false, data_checked: false },
  ];
  const fixtures = [
    { event: 7, finished: true }, { event: 8, finished: false, finished_provisional: true },
    { event: 9, finished: false, finished_provisional: false },
  ];
  assert.deepEqual(headToHeadEvents(events, fixtures).map(e => [e.id, !!e.provisional]), [[7, false], [8, true]]);
  // The blend's weights still only learn from confirmed weeks.
  assert.deepEqual(finishedEvents(events).map(e => e.id), [7]);
});

test('a provisional week is scored afresh each time, never kept', async () => {
  const { modelHeadToHead } = await import('../src/lib/adminServer.js');
  const { fakeRedis } = await import('./helpers/fakeRedis.js');
  const { seasonIdFor } = await import('../src/lib/predictions.js');
  const season = seasonIdFor(bootstrap.events);
  const finished = bootstrap.events.filter(e => e.finished).map(e => e.id);
  const last = finished[finished.length - 1];
  // FPL hasn't confirmed the last week yet: only its final whistles are in.
  const unconfirmed = { ...bootstrap, events: bootstrap.events.map(e => (e.id === last ? { ...e, finished: false, data_checked: false } : e)) };
  const provisionalFixtures = fixtures.map(f => (f.event === last ? { ...f, finished: false, finished_provisional: true } : f));
  const preds = Object.fromEntries(ids.map(id => [id, scored(id)]));
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    const body = url.endsWith('bootstrap-static/') ? unconfirmed
      : url.endsWith('fixtures/') ? provisionalFixtures
      : url.includes('/live/') ? { elements: live }
      : url.endsWith(`/ml/predictions-gw${last}.json`) ? { season, gwId: last, builtAt: 'x', byId: Object.fromEntries(ids.map(id => [id, [scored(id), 1, 1, 1, 1]])) }
      : null;
    return { ok: !!body, json: async () => body };
  };
  const blob = { get: async pathname => (pathname === `predictions-gw${last}.json`
    ? { stream: new Response(JSON.stringify({ gwId: last, season, source: 'formula', predictedById: preds })).body } : null) };
  const redis = fakeRedis();
  const out = await modelHeadToHead(redis, { host: 'localhost:3000', fetchImpl, blob });
  const week = out.weeks.find(w => w.gwId === last);
  assert.ok(week && week.formula && week.ml && week.blend, 'scored');
  assert.equal(week.provisional, true);
  urls.length = 0;
  await modelHeadToHead(redis, { host: 'localhost:3000', fetchImpl, blob });
  assert.ok(urls.some(u => u.includes(`event/${last}/live/`)), 'fetched again: not kept');
});

test('the refresh job reads the ML file from the public address in production, not the cron’s own host', async () => {
  const { refreshBase } = await import('../src/lib/modelWeeks.js');
  const prod = { VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'fplchecker.co.uk' };
  assert.equal(refreshBase('fpl-abc123-team.vercel.app', prod), 'https://fplchecker.co.uk');
  assert.equal(refreshBase('fpl-git-branch-team.vercel.app', { VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'fplchecker.co.uk' }), 'https://fpl-git-branch-team.vercel.app');
  assert.equal(refreshBase('localhost:3000', {}), 'http://localhost:3000');
});
