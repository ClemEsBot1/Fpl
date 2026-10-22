import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templateReport } from '../src/lib/ownership.js';

const P = (id, selectedBy, positionId = 3) => ({ id, webName: `P${id}`, selectedBy, positionId, team: id });
const pred = pts => ({ predicted: pts, nextMatchPredicted: pts });

test('template players you own and miss, and your differentials', () => {
  const all = [P(1, 60), P(2, 45), P(3, 30), P(4, 5), P(5, 2), P(6, 25), P(7, 12)];
  const preds = { 1: pred(6), 2: pred(5), 3: pred(4), 4: pred(5), 5: pred(1), 6: pred(3), 7: pred(4) };
  const r = templateReport([all[0], all[3], all[4], all[6]], all, preds);
  assert.deepEqual(r.template.map(x => x.player.id), [1, 2, 3, 6]);
  assert.equal(r.templateOwned, 1);
  // Missing, most at stake first: 45% × 5 = 2.25, 30% × 4 = 1.2, 25% × 3 = 0.75.
  assert.deepEqual(r.missing.map(x => x.player.id), [2, 3, 6]);
  assert.equal(r.missing[0].atStake, 2.3);
  // Differentials (under 10%), best predicted first; 12% isn't one.
  assert.deepEqual(r.differentials.map(x => x.player.id), [4, 5]);
  // What owning each would gain on the field: pts × (1 − ownership).
  assert.equal(r.differentials[0].edge, 4.8);
  assert.equal(r.differentialPoints, 5.7);
  assert.equal(r.missingPoints, 4.2);
});

test('players without a prediction are left out', () => {
  const r = templateReport([P(1, 50)], [P(1, 50), P(2, 40)], { 1: pred(5) });
  assert.deepEqual(r.missing, []);
  assert.equal(r.templateOwned, 1);
});
