import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLeagueId, parseTeamId } from '../src/lib/teamIdInput.js';

test('a Team ID from the number or a pasted FPL link', () => {
  assert.equal(parseTeamId('1234567'), '1234567');
  assert.equal(parseTeamId(' 123 4567 '), '1234567');
  assert.equal(parseTeamId('https://fantasy.premierleague.com/entry/1234567/event/8'), '1234567', 'not 12345678');
  assert.equal(parseTeamId('fantasy.premierleague.com/entry/987/history'), '987');
  assert.equal(parseTeamId('https://fantasy.premierleague.com/entry/55/'), '55');
  assert.equal(parseTeamId(''), '');
  assert.equal(parseTeamId(null), '');
});

test('a league ID from the number or its standings link', () => {
  assert.equal(parseLeagueId('314'), '314');
  assert.equal(parseLeagueId('https://fantasy.premierleague.com/leagues/314/standings/c'), '314');
});
