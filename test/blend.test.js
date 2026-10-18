import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLEND_MAX, BLEND_MIN, BLEND_PRIOR, blendPredictions, blendWeightsFrom, fitBlendWeights } from '../src/lib/blend.js';

// 40 players a position, all of whom played. The model is spot on for
// midfielders and the formula for defenders; for keepers and forwards
// both miss by the same.
function week() {
  const formula = {}, ml = {}, positionById = {}, live = [];
  let id = 1;
  for (const pos of [1, 2, 3, 4]) {
    for (let k = 0; k < 40; k++, id++) {
      const actual = k % 9;
      positionById[id] = pos;
      formula[id] = pos === 2 ? actual : actual + (k % 2 ? 3 : -3);
      ml[id] = pos === 3 ? actual : actual + (k % 2 ? -3 : 3);
      live.push({ id, stats: { total_points: actual, minutes: 90 } });
    }
  }
  return { formula, ml, live, positionById };
}

test('the weights lean toward whichever model was nearer, by position', () => {
  const { weights } = fitBlendWeights(Array.from({ length: 8 }, week));
  assert.ok(weights[3] > 0.7, `MID ${weights[3]}: the model was spot on`);
  assert.ok(weights[2] < 0.3, `DEF ${weights[2]}: the formula was`);
  // Misses in opposite directions: half each cancels them out.
  assert.equal(weights[1], 0.5);
  assert.equal(weights[4], 0.5);
});

test('with few gameweeks the weights stay near the prior, and never reach all of one model', () => {
  const one = fitBlendWeights([week()]).weights;
  const eight = fitBlendWeights(Array.from({ length: 8 }, week)).weights;
  assert.ok(one[3] < eight[3], 'one week moves it less than eight');
  assert.equal(one[3], 0.6); // (1 × 1 + 4 × 0.5) / 5
  const many = fitBlendWeights(Array.from({ length: 200 }, week)).weights;
  assert.equal(many[3], BLEND_MAX);
  assert.equal(many[2], BLEND_MIN);
  assert.deepEqual(fitBlendWeights([]), { weights: BLEND_PRIOR, weeks: 0 }, 'no weeks: the prior');
});

test("only players who played count, and only ones both models had a figure for", () => {
  const w = week();
  // A midfielder who didn't play, with the model's figure way off.
  w.live.find(el => w.positionById[el.id] === 3).stats.minutes = 0;
  const first = w.live.find(el => w.positionById[el.id] === 3).id;
  w.ml[first] = 50;
  // One the model has nothing for.
  delete w.ml[first + 1];
  assert.equal(fitBlendWeights([w]).weights[3], 0.6);
});

test('blended figures, keeping the formula where the model has none', () => {
  const out = blendPredictions({ 1: 4, 2: 6, 3: 2 }, { 1: 2, 2: 2 }, { 1: 3, 2: 2, 3: 3 }, { 2: 0.25, 3: 0.5 });
  assert.deepEqual(out, { 1: 3, 2: 5, 3: 2 });
});

test('weights read from a saved file are checked, falling back to the prior', () => {
  assert.deepEqual(blendWeightsFrom(null), BLEND_PRIOR);
  assert.deepEqual(blendWeightsFrom({ weights: { 1: 0.3, 2: 'x', 3: 2, 4: 0.7 } }), { 1: 0.3, 2: 0.5, 3: 0.5, 4: 0.7 });
});
