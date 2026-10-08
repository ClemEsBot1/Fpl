import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateLiveStats, applyAsOfStats, recentMinutesFromAsOf } from '../src/lib/asOf.js';

const live = (rows) => rows.map(([id, points, minutes, goals = 0, xg = '0.00']) => ({ id, stats: { total_points: points, minutes, goals_scored: goals, assists: 0, expected_goals: xg, expected_assists: '0.00' } }));

test('only gameweeks before the target count', () => {
  const liveByEvent = {
    1: live([[1, 2, 90]]),
    2: live([[1, 12, 90, 2, '1.40']]),
    3: live([[1, 0, 0]]),
    4: live([[1, 20, 90, 3]]), // gameweek 4 itself must not leak into "before gameweek 4"
  };
  const asOf = aggregateLiveStats(liveByEvent, 4);
  assert.deepEqual(asOf.players[1], [14, 180, 2, 2, 0, 1.4, 0, 14, 180]);
});

test('form covers only the last four gameweeks', () => {
  const liveByEvent = {};
  for (let gw = 1; gw <= 9; gw++) liveByEvent[gw] = live([[7, gw <= 5 ? 10 : 2, 90]]);
  const asOf = aggregateLiveStats(liveByEvent, 10);
  const [points, , apps, , , , , formPoints] = asOf.players[7];
  assert.equal(points, 5 * 10 + 4 * 2);
  assert.equal(apps, 9);
  assert.equal(formPoints, 4 * 2);
  assert.deepEqual(recentMinutesFromAsOf(asOf), { 7: 4 * 90 });
  assert.equal(recentMinutesFromAsOf({ fields: ['points'], players: {} }), null, 'a table cached before recent minutes');
});

test('bootstrap players get their pre-deadline numbers, nothing from today', () => {
  const bootstrap = { events: [], teams: [], elements: [
    { id: 1, total_points: 99, minutes: 2000, form: '9.0', points_per_game: '8.0', ep_next: '9.5', status: 'i', chance_of_playing_next_round: 0, news: 'Hamstring', now_cost: 105, goals_scored: 15, assists: 4, expected_goals: '12.0', expected_assists: '3.0' },
    { id: 2, total_points: 50, minutes: 900, form: '3.0', points_per_game: '4.0', ep_next: '3.0', status: 'a', chance_of_playing_next_round: null, news: '', now_cost: 60, goals_scored: 1, assists: 1, expected_goals: '1.0', expected_assists: '1.0' },
  ] };
  const asOf = { gwId: 6, players: { 1: [30, 450, 5, 3, 1, 2.5, 0.8, 20] } };
  const [p1, p2] = applyAsOfStats(bootstrap, asOf).elements;
  assert.equal(p1.total_points, 30);
  assert.equal(p1.points_per_game, '6.0');
  assert.equal(p1.form, '5.0');
  assert.equal(p1.ep_next, '5.0', 'from gameweek 5 on, FPL-style expected points follow form');
  assert.equal(p1.status, 'a', "today's injury must not apply to an old gameweek");
  assert.equal(p1.news, '');
  assert.equal(p1.now_cost, 105, 'prices are not available historically');
  assert.equal(p2.total_points, 0, 'a player with no earlier games starts from zero');
  assert.equal(p2.minutes, 0);
});

test('a double gameweek counts each match a player appeared in', () => {
  const minutesIn = (...perMatch) => perMatch.map((value, i) => ({ fixture: i + 1, stats: [{ identifier: 'minutes', points: value ? 1 : 0, value }] }));
  const liveByEvent = {
    1: [{ id: 9, stats: { total_points: 10, minutes: 180 }, explain: minutesIn(90, 90) }],
    2: [{ id: 9, stats: { total_points: 2, minutes: 90 }, explain: minutesIn(90, 0) }],
    3: [{ id: 9, stats: { total_points: 2, minutes: 70 } }], // no breakdown: one match
    4: [{ id: 9, stats: { total_points: 0, minutes: 0 }, explain: minutesIn(0) }],
  };
  const [points, minutes, appearances] = aggregateLiveStats(liveByEvent, 5).players[9];
  assert.equal(points, 14);
  assert.equal(minutes, 340);
  assert.equal(appearances, 4);
});
