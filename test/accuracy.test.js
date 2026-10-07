import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseAccuracy, latestFinishedEvent } from '../src/lib/accuracy.js';

const live = (rows) => rows.map(([id, points, minutes = 90]) => ({ id, stats: { total_points: points, minutes } }));

test('scores only players who played', () => {
  const predicted = {};
  const rows = [];
  for (let id = 1; id <= 30; id++) { predicted[id] = id / 5; rows.push([id, Math.round(id / 5)]); }
  rows.push([31, 0, 0]); predicted[31] = 9; // didn't play — ignored
  const s = summariseAccuracy(predicted, live(rows));
  assert.equal(s.playersCompared, 30);
  assert.ok(s.meanAbsError < 0.5);
  assert.ok(s.correlation > 0.95);
  assert.equal(s.topPick.id, 30);
  assert.ok(s.topTenAverageActual > s.averageActual);
});

test('the usual size of a miss comes from the spread of every miss', () => {
  // Misses of 0, 1, 2 … 9, each for 3 players.
  const predicted = {};
  const rows = [];
  for (let id = 1; id <= 30; id++) { predicted[id] = 2; rows.push([id, 2 + ((id - 1) % 10)]); }
  const s = summariseAccuracy(predicted, live(rows));
  assert.equal(s.missP50, 4);
  assert.equal(s.missP80, 7);
  assert.equal(s.missP90, 8);
});

test('too few players to judge returns null', () => {
  assert.equal(summariseAccuracy({ 1: 2 }, live([[1, 2]])), null);
});

test('latest finished gameweek', () => {
  const events = [{ id: 1, finished: true, data_checked: true }, { id: 2, finished: true, data_checked: true }, { id: 3, finished: true, data_checked: false }, { id: 4, finished: false }];
  assert.equal(latestFinishedEvent(events).id, 2);
  assert.equal(latestFinishedEvent([]), null);
});
