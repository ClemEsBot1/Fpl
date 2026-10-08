import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benchLabels, nextFixtureLabel, shirtUrl } from '../src/lib/pitch.js';

test("shirts come from FPL by club code, the keeper's kit for goalkeepers", () => {
  assert.equal(shirtUrl({ code: 3 }, false), 'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_3-110.webp');
  assert.equal(shirtUrl({ code: 3 }, true), 'https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_3_1-110.webp');
  assert.equal(shirtUrl(null, false), null);
});

test('the bench is labelled as on the FPL site', () => {
  const slot = positionId => ({ player: { positionId } });
  assert.deepEqual(benchLabels([slot(1), slot(4), slot(2), slot(2)]), ['GKP', '1. FWD', '2. DEF', '3. DEF']);
});

test('the next fixture reads like "MCI (H)"', () => {
  const teamsById = { 2: { short_name: 'MCI' } };
  assert.equal(nextFixtureLabel({ team: 1 }, { 1: [{ opponent: 2, isHome: true }] }, teamsById), 'MCI (H)');
  assert.equal(nextFixtureLabel({ team: 1 }, { 1: [] }, teamsById), '');
});
