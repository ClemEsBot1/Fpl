import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weeklyPicks } from '../src/lib/weeklyPicks.js';

function staticFrom(players) {
  const predictionsById = {};
  players.forEach(p => { predictionsById[p.id] = { nextMatchPredicted: p.next }; });
  return { allPlayers: players.map(p => ({ id: p.id, webName: `P${p.id}`, team: 1, positionId: p.pos, status: p.status || 'a', selectedBy: p.owned, price: 7 })), predictionsById };
}

test('the captain is the highest predicted available player', () => {
  const sd = staticFrom([
    { id: 1, pos: 4, next: 6.5, owned: 40 },
    { id: 2, pos: 3, next: 7.8, owned: 55 },
    { id: 3, pos: 4, next: 9.1, owned: 2, status: 'i' }, // injured: ignored
  ]);
  const picks = weeklyPicks(sd);
  assert.equal(picks.captain.player.id, 2);
  assert.equal(picks.captain.predicted, 7.8);
});

test('the differential is lightly owned with real upside', () => {
  const sd = staticFrom([
    { id: 1, pos: 4, next: 8, owned: 60 }, // captain
    { id: 2, pos: 3, next: 6, owned: 3 }, // low-owned, decent → differential
    { id: 3, pos: 2, next: 2, owned: 1 }, // too far below the top prediction
  ]);
  const picks = weeklyPicks(sd);
  assert.equal(picks.captain.player.id, 1);
  assert.equal(picks.differential.player.id, 2);
  assert.equal(picks.differential.owned, 3);
});

test('no differential when every strong pick is widely owned', () => {
  const sd = staticFrom([
    { id: 1, pos: 4, next: 8, owned: 60 },
    { id: 2, pos: 3, next: 7, owned: 40 },
  ]);
  assert.equal(weeklyPicks(sd).differential, null);
});

test('missing or empty data returns null', () => {
  assert.equal(weeklyPicks(null), null);
  assert.equal(weeklyPicks(staticFrom([])), null);
});
