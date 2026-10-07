import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forEachLimited, parseStandings, predictedXiTotal, privateLeagues } from '../src/lib/leagues.js';

test("a team's mini-leagues leave out FPL's own leagues", () => {
  const entry = { leagues: { classic: [
    { id: 314, name: 'Overall', league_type: 's', entry_rank: 900000 },
    { id: 1234, name: 'Work league', league_type: 'x', entry_rank: 3 },
  ] } };
  assert.deepEqual(privateLeagues(entry), [{ id: 1234, name: 'Work league', rank: 3 }]);
  assert.deepEqual(privateLeagues(null), []);
});

test('standings are read from FPL\'s league page', () => {
  const json = {
    league: { id: 1234, name: 'Work league' },
    standings: { has_next: false, results: [{ entry: 7, entry_name: 'Sam XI', player_name: 'Sam Lee', rank: 1, last_rank: 2, total: 400, event_total: 61 }] },
  };
  assert.deepEqual(parseStandings(json), {
    league: { id: 1234, name: 'Work league' }, hasMore: false,
    members: [{ entry: 7, teamName: 'Sam XI', managerName: 'Sam Lee', rank: 1, lastRank: 2, total: 400, eventTotal: 61 }],
  });
  assert.equal(parseStandings({ detail: 'Not found.' }), null);
});

test('predicted points count the XI with the captain doubled', () => {
  const squad = [
    { isStarting: true, predicted: 5, multiplier: 2 },
    { isStarting: true, predicted: 3, multiplier: 1 },
    { isStarting: false, predicted: 9, multiplier: 0 },
  ];
  assert.equal(predictedXiTotal(squad), 13);
});

test('team loads run a few at a time and report every result', async () => {
  let running = 0, peak = 0;
  const seen = [];
  await forEachLimited([1, 2, 3, 4, 5], 2, async n => {
    running++; peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, 5));
    running--;
    if (n === 3) throw new Error('nope');
    return n * 10;
  }, (n, value, error) => seen.push([n, value, error ? error.message : null]));
  assert.equal(peak, 2);
  assert.deepEqual(seen.sort((a, b) => a[0] - b[0]), [[1, 10, null], [2, 20, null], [3, null, 'nope'], [4, 40, null], [5, 50, null]]);
});
