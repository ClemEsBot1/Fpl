import { test } from 'node:test';
import assert from 'node:assert/strict';
import { careerStats, chipsLeft, rankChartPoints, valueChartPoints } from '../src/lib/career.js';

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

test('the season gameweek by gameweek, for the rank chart', () => {
  const history = {
    current: [
      { event: 1, points: 60, total_points: 60, overall_rank: 2_000_000, rank: 3_000_000, event_transfers_cost: 0, value: 1000, bank: 5 },
      { event: 2, points: 80, total_points: 136, overall_rank: 500_000, rank: 100_000, event_transfers_cost: 4, value: 1003, bank: 0 },
      { event: 3, points: null },
    ],
    chips: [{ name: 'bboost', event: 2 }],
  };
  assert.deepEqual(careerStats(history).gwHistory, [
    { gw: 1, points: 60, total: 60, overallRank: 2_000_000, gwRank: 3_000_000, hit: 0, chip: null, rankChange: null, value: 100, bank: 0.5 },
    { gw: 2, points: 80, total: 136, overallRank: 500_000, gwRank: 100_000, hit: 4, chip: 'Bench Boost', rankChange: 1_500_000, value: 100.3, bank: 0 },
  ]);
});

test('rank chart: rank 1 at the top, on a log scale, gameweeks spread across', () => {
  const pts = rankChartPoints([{ gw: 1, overallRank: 1_000_000 }, { gw: 2, overallRank: 1000 }, { gw: 3, overallRank: 10_000_000 }], { width: 200, height: 100, pad: 0 });
  assert.deepEqual(pts.map(p => p.x), [0, 100, 200]);
  assert.ok(pts[1].y < pts[0].y && pts[0].y < pts[2].y, 'a better rank sits higher');
  assert.equal(pts[1].y, 0);
  assert.equal(pts[2].y, 100);
  assert.deepEqual(rankChartPoints([], { width: 10, height: 10 }), []);
  assert.equal(rankChartPoints([{ gw: 1, overallRank: 5 }], { width: 200, height: 100, pad: 0 })[0].x, 100, 'one point is centred');
});

test('value chart: highest value at the top, on a linear scale', () => {
  const pts = valueChartPoints([{ gw: 1, value: 100 }, { gw: 2, value: 102 }, { gw: 3, value: null }, { gw: 4, value: 101 }], { width: 200, height: 100, pad: 0 });
  assert.deepEqual(pts.map(p => p.gw), [1, 2, 4], 'gameweeks without a value are left out');
  assert.deepEqual(pts.map(p => p.y), [100, 0, 50]);
  assert.deepEqual(valueChartPoints([], { width: 10, height: 10 }), []);
  assert.equal(valueChartPoints([{ gw: 1, value: 100 }, { gw: 2, value: 100 }], { width: 200, height: 100, pad: 0 })[0].y, 50, 'a flat value sits in the middle');
});

test('chipsLeft: one of each chip per half, played ones taken off', () => {
  const history = { chips: [{ name: 'wildcard', event: 4 }, { name: '3xc', event: 9 }, { name: 'freehit', event: 21 }, { name: 'manager', event: 5 }] };
  assert.deepEqual(chipsLeft(history, 10).map(c => c.name), ['freehit', 'bboost']);
  // The second half starts with all four back, less the Free Hit played in it.
  assert.deepEqual(chipsLeft(history, 20).map(c => c.name), ['wildcard', 'bboost', '3xc']);
  assert.deepEqual(chipsLeft({ chips: [] }, 1).map(c => c.short), ['WC', 'FH', 'BB', 'TC']);
  assert.deepEqual(chipsLeft(null, 39), []);
});
