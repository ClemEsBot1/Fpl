import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFixtureTicker } from '../src/lib/fixtureTicker.js';

const teamsById = {
  1: { id: 1, name: 'Arsenal', short_name: 'ARS' },
  2: { id: 2, name: 'Burnley', short_name: 'BUR' },
  3: { id: 3, name: 'Chelsea', short_name: 'CHE' },
};
const fx = (event, opponent, isHome, difficulty) => ({ event, opponent, isHome, difficulty });

test('easiest run first, with doubles counting twice and blanks counting nothing', () => {
  const fixturesByTeam = {
    1: [fx(8, 2, true, 2), fx(9, 3, false, 4)],
    2: [fx(8, 1, false, 5), fx(9, 3, true, 4), fx(9, 1, true, 4)], // double in GW9
    3: [fx(9, 1, true, 3)], // blank in GW8
  };
  const { gws, rows } = buildFixtureTicker(fixturesByTeam, teamsById, 8, 2);
  assert.deepEqual(gws, [8, 9]);
  assert.deepEqual(rows.map(r => r.team.short_name), ['ARS', 'BUR', 'CHE']);
  const bur = rows.find(r => r.team.id === 2);
  assert.equal(bur.weeks[1].fixtures.length, 2);
  assert.equal(bur.weeks[1].fixtures[0].opponent.short_name, 'CHE');
  assert.deepEqual(rows.find(r => r.team.id === 3).weeks[0].fixtures, []);
});

test('the window stops at gameweek 38', () => {
  assert.deepEqual(buildFixtureTicker({}, teamsById, 36, 5).gws, [36, 37, 38]);
});
