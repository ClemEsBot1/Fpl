import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_WATCHED, toggleId, watchRows } from '../src/lib/watchlist.js';

test('starring adds to the front, starring again takes off, a full list stays full', () => {
  assert.deepEqual(toggleId([], 4), [4]);
  assert.deepEqual(toggleId([4], 7), [7, 4]);
  assert.deepEqual(toggleId([7, 4], '4'), [7]);
  assert.deepEqual(toggleId(['x', 3, 3, -2], 5), [5, 3], 'bad ids dropped');
  const full = Array.from({ length: MAX_WATCHED }, (_, i) => i + 1);
  assert.deepEqual(toggleId(full, 99), full);
  assert.deepEqual(toggleId(full, 1), full.slice(1));
});

test('rows: each watched player with prediction and fixtures, gone players left out', () => {
  const staticData = {
    playersById: { 1: { id: 1, team: 10, webName: 'Saka' }, 2: { id: 2, team: 11, webName: 'Isak' } },
    predictionsById: { 1: { predicted: 5.2 } },
    fixturesByTeam: { 10: [{ opponent: 11, difficulty: 2, isHome: true }] },
  };
  const rows = watchRows(staticData, [2, 1, 3]);
  assert.deepEqual(rows.map(r => r.player.webName), ['Isak', 'Saka']);
  assert.equal(rows[0].prediction, null);
  assert.deepEqual(rows[0].fixtures, []);
  assert.equal(rows[1].prediction.predicted, 5.2);
  assert.equal(rows[1].fixtures.length, 1);
  assert.deepEqual(watchRows(null, [1]), []);
});
