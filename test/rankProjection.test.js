import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normCdf, normInv, rankProjection, roundRank } from '../src/lib/rankProjection.js';

const averages = { 1: 50, 2: 50, 3: 50, 4: 50, 5: 50, 6: 50 };
const N = 10000000;
// A manager `above` points a week over the average, at the rank that puts them.
function season(above, ranks) {
  let total = 0;
  return ranks.map((rank, i) => { total += 50 + above; return { event: i + 1, points: 50 + above, total_points: total, overall_rank: rank, event_transfers_cost: 0 }; });
}

test('normal helpers round-trip and ranks round to 2 significant figures', () => {
  for (const p of [0.001, 0.2, 0.5, 0.9, 0.999]) assert.ok(Math.abs(normCdf(normInv(p)) - p) < 1e-4);
  assert.equal(roundRank(253481), 250000);
  assert.equal(roundRank(1834), 1800);
  assert.equal(roundRank(42), 42);
});

test('a manager beating the average climbs, one below it falls, with a range around it', () => {
  const up = rankProjection(season(8, [3e6, 2e6, 1.5e6, 1.2e6, 1e6, 900000]), averages, N);
  assert.ok(up.rank < 900000, `climbs: ${up.rank}`);
  assert.ok(up.best < up.rank && up.rank < up.worst);
  assert.equal(up.gw, 6);
  assert.equal(up.weeksLeft, 32);
  assert.equal(up.pace, 8);
  const down = rankProjection(season(-8, [6e6, 7e6, 7.5e6, 7.8e6, 8e6, 8.2e6]), averages, N);
  assert.ok(down.rank > 8.2e6, `falls: ${down.rank}`);
  assert.ok(down.worst <= N);
});

test('no projection with too few gameweeks, no averages or a finished season', () => {
  assert.equal(rankProjection(season(5, [1e6, 1e6, 1e6]), averages, N), null);
  assert.equal(rankProjection(season(5, [1e6, 1e6, 1e6, 1e6]), {}, N), null);
  assert.equal(rankProjection(season(5, [1e6, 1e6, 1e6, 1e6, 1e6, 1e6]), averages, N, 6), null);
  assert.equal(rankProjection(null, averages, N), null);
});
