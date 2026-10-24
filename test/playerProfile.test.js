import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pastSeasons, photoUrls, predictionError, profileRows, savedFor, signed } from '../src/lib/playerProfile.js';

const teamsById = { 1: { short_name: 'ARS' }, 7: { short_name: 'EVE' }, 9: { short_name: 'LIV' }, 12: { short_name: 'NFO' } };
const played = (round, opponent, home, h, a, pts, mins = 90) => ({ round, opponent_team: opponent, was_home: home, team_h_score: h, team_a_score: a, total_points: pts, minutes: mins, starts: mins ? 1 : 0, goals_scored: 0, assists: pts > 6 ? 1 : 0 });

test('a row per gameweek with the prediction saved before it and how far off it was', () => {
  const summary = {
    history: [{ ...played(8, 1, false, 0, 0, 1, 20), fixture: 80 }, played(5, 12, false, 0, 1, 9), played(6, 7, true, 2, 2, 2), played(6, 9, false, 3, 0, 1), played(7, 9, true, 0, 0, 0, 0)],
    fixtures: [{ id: 80, event: 8, is_home: false, team_h: 1, team_a: 9 }, { event: 9, is_home: true, team_h: 1, team_a: 7, difficulty: 2 }, { event: null, is_home: false, team_h: 9, team_a: 1 }],
  };
  const rows = profileRows(summary, { teamsById, predictedByGw: { 5: 4.5, 6: 5, 7: 3.1 }, upcomingByGw: { 9: 6.2 }, finishedGws: new Set([5, 6, 7]) });
  assert.deepEqual(rows.map(r => r.gw), [9, 8, 7, 6, 5], 'newest first; an unscheduled fixture left out');
  const [gw9, gw8, gw7, gw6, gw5] = rows;
  assert.equal(gw8.matches.length, 1, 'a match under way is listed once');
  assert.equal(gw8.diff, null, 'and not judged until the gameweek is over');
  assert.deepEqual(gw5.matches[0], { opponent: 'NFO', opponentId: 12, home: false, score: [1, 0], result: 'W', difficulty: null }, 'score from his side');
  assert.equal(gw5.diff, 4.5);
  assert.equal(gw6.matches.length, 2, 'a double gameweek is one row');
  assert.equal(gw6.points, 3);
  assert.equal(gw6.diff, -2);
  assert.deepEqual(gw6.matches.map(m => m.result), ['D', 'L']);
  assert.equal(gw7.diff, -3.1, 'judged even when he didn’t play…');
  assert.equal(gw9.predicted, 6.2, 'upcoming: the prediction made now');
  assert.equal(gw9.diff, null);
  assert.equal(gw9.matches[0].difficulty, 2);
  // …but the average only counts the gameweeks he played.
  assert.deepEqual(predictionError(rows), { n: 2, meanMiss: 3.3, bias: 1.3 });
});

test('a gameweek still being played has no difference yet; nothing to judge gives null', () => {
  const rows = profileRows({ history: [played(8, 7, true, 1, 0, 6)], fixtures: [] }, { teamsById, predictedByGw: { 8: 4 }, finishedGws: new Set([7]) });
  assert.equal(rows[0].diff, null);
  assert.equal(predictionError(rows), null);
  assert.deepEqual(profileRows(null), []);
});

test('saved predictions for one player, past seasons newest first, signs and photo', () => {
  assert.deepEqual(savedFor({ gws: { 1: { 5: 3.2, 6: 1 }, 2: { 6: 2 }, 3: null } }, 5), { 1: 3.2 });
  assert.deepEqual(savedFor(null, 5), {});
  const seasons = pastSeasons({ history_past: [
    { season_name: '2024/25', total_points: 103, starts: 33, minutes: 2936, goals_scored: 2, assists: 0, expected_goal_involvements: '1.90' },
    { season_name: '2025/26', total_points: 100, starts: 34, minutes: 3035, goals_scored: 0, assists: 1, expected_goal_involvements: '1.86' },
  ] });
  assert.deepEqual(seasons.map(s => s.season), ['2025/26', '2024/25']);
  assert.equal(seasons[1].xgi, 1.9);
  assert.equal(signed(2.14), '+2.1');
  assert.equal(signed(-0.4), '−0.4');
  assert.equal(signed(0), '0.0');
  assert.deepEqual(photoUrls(223094).map(u => u.split('/').pop()), ['223094.png', 'p223094.png']);
});

test('a prediction worked out afterwards is marked as such', () => {
  const rows = profileRows({ history: [played(1, 7, true, 1, 0, 6), played(2, 9, false, 0, 0, 2)] }, { teamsById, predictedByGw: { 1: 3, 2: 4 }, finishedGws: new Set([1, 2]), workedOutGws: new Set([1]) });
  assert.deepEqual(rows.map(r => [r.gw, r.workedOut]), [[2, false], [1, true]]);
});

test('price through the season and cheaper players predicted nearly as well', async () => {
  const { priceSeries, cheaperAlternatives } = await import('../src/lib/playerProfile.js');
  assert.deepEqual(priceSeries({ history: [{ round: 2, value: 61 }, { round: 1, value: 60 }, { round: 2, value: 61 }] }), [{ gw: 1, price: 6 }, { gw: 2, price: 6.1 }]);
  assert.deepEqual(priceSeries(null), []);
  const pl = (id, price, o = {}) => ({ id, price, positionId: 3, status: 'a', chanceNext: null, ...o });
  const weeks = total => ({ byGw: Array.from({ length: 5 }, (_, i) => ({ event: 9 + i, points: total / 5 })) });
  const me = pl(1, 8);
  const all = [me, pl(2, 7.5), pl(3, 6), pl(4, 6, { status: 'd', chanceNext: 50 }), pl(5, 5), pl(6, 7.8), pl(7, 6, { positionId: 4 })];
  const preds = { 1: weeks(25), 2: weeks(24), 3: weeks(21), 4: weeks(30), 5: weeks(15), 6: weeks(26), 7: weeks(30) };
  const alts = cheaperAlternatives(me, all, preds);
  assert.deepEqual(alts.map(a => a.player.id), [2, 3], 'cheaper by £0.5m+, fit, same position, at least 80% of his points');
  assert.equal(alts[0].saving, 0.5);
  assert.equal(alts[1].next, 21);
  assert.deepEqual(cheaperAlternatives(me, all, { 1: weeks(0) }), []);
});
