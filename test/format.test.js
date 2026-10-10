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
});
