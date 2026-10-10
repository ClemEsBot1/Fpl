import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startProbability, predictionRange, pickReasons } from '../src/lib/playerInsight.js';

test('start probability reads FPL availability, then featuring', () => {
  assert.equal(startProbability({ status: 'a' }), 1);
  assert.equal(startProbability({ status: 'a', chanceNext: 75 }), 0.75);
  assert.equal(startProbability({ status: 'i' }), 0, 'injured with no % is ruled out');
  assert.equal(startProbability({ status: 'd' }), 0.5, 'doubtful with no % is a coin flip');
  assert.equal(startProbability({ status: 'd', chanceNext: 25 }), 0.25);
  assert.equal(startProbability({ status: 'a', appearanceShare: 0.8 }), 0.8);
});

test('the range brackets the prediction and widens the right way', () => {
  const pred = { nextMatchPredicted: 5 };
  const steady = predictionRange(pred, { positionId: 3, status: 'a', appearanceShare: 1 });
  assert.ok(steady.floor <= steady.expected && steady.expected <= steady.ceiling);
  assert.equal(steady.expected, 5);

  // A fitness doubt drops the floor without touching the expectation.
  const doubt = predictionRange(pred, { positionId: 3, status: 'd', chanceNext: 25 });
  assert.ok(doubt.floor < steady.floor);

  // A higher prediction lifts the ceiling for the same player.
  const hi = predictionRange({ nextMatchPredicted: 7 }, { positionId: 4, status: 'a', appearanceShare: 1 });
  const lo = predictionRange({ nextMatchPredicted: 4 }, { positionId: 4, status: 'a', appearanceShare: 1 });
  assert.ok(hi.ceiling > lo.ceiling);
  assert.ok(hi.floor > lo.floor);
});

test('pick reasons surface the strongest positive signals, doubles first', () => {
  const pred = {
    isDoubleThisEvent: true,
    nextMatchPredicted: 6,
    breakdown: { fixtureMult: 1.1, form: 6.5, formEligible: true, oddsAdjustment: 0.5, xgAdjustment: 0.1 },
  };
  const player = { positionId: 4, status: 'a', appearanceShare: 0.95, penaltiesOrder: 1, selectedBy: 30 };
  const reasons = pickReasons(pred, player, { max: 3 });
  assert.equal(reasons[0], 'Double gameweek');
  assert.equal(reasons.length, 3);
  assert.ok(reasons.includes('Great fixtures'));

  // Nothing notable → no reasons (not fabricated).
  const flat = pickReasons({ nextMatchPredicted: 2, breakdown: { fixtureMult: 1, form: 1, formEligible: true, oddsAdjustment: 0, xgAdjustment: 0 } }, { positionId: 3, status: 'a', appearanceShare: 0.5, selectedBy: 25 });
  assert.deepEqual(flat, []);
});

test('a low-owned player in good form reads as a differential', () => {
  const reasons = pickReasons(
    { nextMatchPredicted: 5, breakdown: { fixtureMult: 1, form: 5, formEligible: true, oddsAdjustment: 0, xgAdjustment: 0 } },
    { positionId: 3, status: 'a', appearanceShare: 0.8, selectedBy: 2 },
  );
  assert.ok(reasons.includes('Low-owned differential'));
  assert.ok(reasons.includes('In form'));
});

test("the range uses the model's own low and high when it has them", () => {
  const r = predictionRange({ nextMatchPredicted: 5, range: { floor: 1, ceiling: 11 } }, { positionId: 3, status: 'a' });
  assert.deepEqual(r, { floor: 1, expected: 5, ceiling: 11, source: 'model' });
  // Never a band that excludes the prediction itself.
  const tight = predictionRange({ nextMatchPredicted: 5, range: { floor: 6, ceiling: 7 } }, { positionId: 3, status: 'a' });
  assert.equal(tight.floor, 5);
});
