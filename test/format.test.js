import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noPointsLabel, officialGwPoints } from '../src/lib/format.js';

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

test('a prediction counts the captain picked, never the vice-captain', async () => {
  const { predictedMultiplier } = await import('../src/lib/format.js');
  const slot = (o) => ({ isStarting: true, isCaptain: false, isViceCaptain: false, multiplier: 1, ...o });
  // FPL passed the armband: the captain didn't play, the vice has 2.
  assert.equal(predictedMultiplier(slot({ isCaptain: true, multiplier: 0 })), 2);
  assert.equal(predictedMultiplier(slot({ isViceCaptain: true, multiplier: 2 })), 1);
  assert.equal(predictedMultiplier(slot({ isCaptain: true, multiplier: 3 })), 3, 'Triple Captain');
  assert.equal(predictedMultiplier(slot({ isCaptain: true, multiplier: 0 }), '3xc'), 3);
  assert.equal(predictedMultiplier(slot({ isStarting: false, multiplier: 0 })), 0);
  assert.equal(predictedMultiplier(slot({ isStarting: false, multiplier: 0 }), 'bboost'), 1);
});

test('the build knows its pull request from Vercel or the squash merge', async () => {
  const { prNumberFrom } = await import('../src/lib/buildInfo.js');
  assert.equal(prNumberFrom({ prId: '120' }), 120);
  assert.equal(prNumberFrom({ message: 'Colour injured and doubtful players as the FPL app does (#119)' }), 119);
  assert.equal(prNumberFrom({ message: 'Fix (#12) thing\n\nbody (#5)' }), null, 'only a number closing the title');
  assert.equal(prNumberFrom({ prId: '', message: 'Local change' }), null);
  assert.equal(prNumberFrom(), null);
});

test('a player with no points to show reads DNP once his matches are over, else a dash', () => {
  assert.equal(noPointsLabel({ played: false, dnp: true }), 'DNP');
  assert.equal(noPointsLabel({ played: false }), '–');
});
