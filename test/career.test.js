import { test } from 'node:test';
import assert from 'node:assert/strict';
import { careerStats } from '../src/lib/career.js';

const history = {
  current: [
    { event: 1, points: 70, total_points: 70, overall_rank: 900000, event_transfers: 0, event_transfers_cost: 0, points_on_bench: 4, value: 1000, bank: 5 },
    { event: 2, points: 45, total_points: 111, overall_rank: 1200000, event_transfers: 2, event_transfers_cost: 4, points_on_bench: 11, value: 1003, bank: 2 },
    { event: 3, points: 88, total_points: 199, overall_rank: 400000, event_transfers: 1, event_transfers_cost: 0, points_on_bench: 0, value: 1007, bank: 0 },
  ],
  past: [
    { season_name: '2023/24', total_points: 2310, rank: 250000 },
    { season_name: '2024/25', total_points: 2502, rank: 8400 },
    { season_name: '2022/23', total_points: 2105, rank: 1500000 },
  ],
  chips: [{ name: 'bboost', event: 3 }, { name: 'wildcard', event: 2 }],
};
const entry = { name: 'Klopp Dreams', player_first_name: 'Sam', player_last_name: 'Smith' };

test('career totals: seasons, best finish and best season', () => {
  const c = careerStats(history, entry);
  assert.equal(c.teamName, 'Klopp Dreams');
  assert.equal(c.managerName, 'Sam Smith');
  assert.equal(c.seasons, 4, 'three past and this one');
  assert.equal(c.bestRank, 8400);
  assert.deepEqual(c.bestSeason, { season: '2024/25', points: 2502, rank: 8400 });
  assert.equal(c.averageSeasonPoints, 2306);
  assert.equal(c.top10kFinishes, 1);
  assert.deepEqual(c.past.map(s => s.season), ['2024/25', '2023/24', '2022/23'], 'newest first');
});

test('this season so far, and chips in gameweek order', () => {
  const t = careerStats(history, entry).thisSeason;
  assert.equal(t.points, 199);
  assert.equal(t.overallRank, 400000);
  assert.equal(t.gameweeks, 3);
  assert.equal(t.averageGw, 67.7);
  assert.deepEqual(t.bestGw, { gw: 3, points: 88 });
  assert.deepEqual(t.worstGw, { gw: 2, points: 45 });
  assert.equal(t.transfers, 3);
  assert.equal(t.hitPoints, 4);
  assert.equal(t.benchPoints, 15);
  assert.equal(t.value, 100.7);
  assert.equal(t.bank, 0);
  assert.deepEqual(careerStats(history, entry).chips, [{ name: 'Wildcard', gw: 2 }, { name: 'Bench Boost', gw: 3 }]);
});

test('a brand new manager: nothing past, nothing played', () => {
  const c = careerStats({ current: [], past: [], chips: [] }, {});
  assert.equal(c.seasons, 0);
  assert.equal(c.bestRank, null);
  assert.equal(c.bestSeason, null);
  assert.equal(c.thisSeason, null);
  assert.equal(careerStats(null).seasons, 0);
});
