import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearTeamEdit, saveTeamEdit, teamEditFor } from '../src/lib/teamEdits.js';

function memoryStorage() {
  const data = {};
  return { getItem: k => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
}

test("a Team ID's edits are kept per gameweek and can be cleared", () => {
  const storage = memoryStorage();
  const squad = { playerIds: [1, 2, 3], captainId: 1, gwId: 8 };
  assert.equal(teamEditFor(123, 8, storage), null);
  saveTeamEdit(123, 8, squad, storage);
  assert.deepEqual(teamEditFor(123, 8, storage), squad);
  assert.deepEqual(teamEditFor('123', 8, storage), squad, 'the Team ID can be a string or a number');
  assert.equal(teamEditFor(123, 9, storage), null, 'edits for another gameweek are ignored');
  assert.equal(teamEditFor(456, 8, storage), null);
  clearTeamEdit(123, storage);
  assert.equal(teamEditFor(123, 8, storage), null);
});

test('broken storage never throws', () => {
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(teamEditFor(1, 1, broken), null);
  assert.doesNotThrow(() => saveTeamEdit(1, 1, {}, broken));
  assert.equal(teamEditFor(1, 1, null), null);
});
