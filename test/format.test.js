import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officialGwPoints } from '../src/lib/format.js';

test("a past gameweek's points use FPL's own figure when there is one", () => {
  assert.equal(officialGwPoints({ entryHistory: { points: 64 }, actualXiTotal: 61 }), 64);
  assert.equal(officialGwPoints({ entryHistory: null, actualXiTotal: 61 }), 61, 'a borrowed squad falls back to live points');
  assert.equal(officialGwPoints(null), null);
});

test("a gameweek still being played uses the live points, not FPL's lagging figure", () => {
  const allEvents = [{ id: 6, finished: false }, { id: 5, finished: true }];
  assert.equal(officialGwPoints({ gwId: 6, allEvents, entryHistory: { points: 0, event_transfers_cost: 4 }, actualXiTotal: 40 }), 40);
  assert.equal(officialGwPoints({ gwId: 5, allEvents, entryHistory: { points: 64 }, actualXiTotal: 61 }), 64);
  assert.equal(officialGwPoints({ gwId: 6, allEvents, entryHistory: { points: 0 }, actualXiTotal: 40, liveTotal: 46 }), 46, 'the settled live score when there is one');
});

test('chance of playing is coloured as in the FPL app', async () => {
  const { availLevel, availClass } = await import('../src/lib/format.js');
  const p = (status, chanceNext = null) => ({ status, chanceNext });
  assert.equal(availLevel(p('a')), null);
  assert.equal(availLevel(p('a', 100)), null);
  assert.equal(availLevel(p('d', 75)), 'c75');
  assert.equal(availLevel(p('d', 50)), 'c50');
  assert.equal(availLevel(p('d', 25)), 'c25');
  assert.equal(availLevel(p('d')), 'c50', 'a doubt with no chance given');
  assert.equal(availLevel(p('i', 0)), 'out');
  assert.equal(availLevel(p('i')), 'out');
  assert.equal(availLevel(p('s')), 'out');
  assert.equal(availLevel(p('u')), 'out');
  assert.equal(availLevel(p('i', 75)), 'c75', 'back in training');
  assert.equal(availClass(p('d', 50)), ' is-c50');
  assert.equal(availClass(p('a')), '');
  assert.equal(availLevel(null), null);
});
