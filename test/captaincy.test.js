import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captainOptions, differentialCaptain, haulChance } from '../src/lib/captaincy.js';

const slot = (id, positionId, pts, owned) => ({ player: { id, webName: `P${id}`, positionId, selectedBy: owned }, nextMatchPredicted: pts });

test('the chance of a haul climbs with the prediction', () => {
  assert.equal(haulChance(3, 0), 0);
  assert.ok(Math.abs(haulChance(3, 5) - (0.138 + 0.187) / 2) < 1e-9);
  assert.ok(haulChance(4, 8) > haulChance(4, 5));
  assert.equal(haulChance(2, 30), 0.6);
});

test('the safe captain is the best prediction; a differential is close to it but rarely owned', () => {
  const opts = captainOptions([slot(1, 4, 7.5, 60), slot(2, 3, 6.4, 4.5), slot(3, 3, 6.8, 35), slot(4, 2, 3, 1)]);
  assert.equal(opts[0].slot.player.id, 1);
  assert.equal(differentialCaptain(opts).slot.player.id, 2);
});

test('no differential when the alternatives are too far behind or as widely owned', () => {
  assert.equal(differentialCaptain(captainOptions([slot(1, 4, 8, 60), slot(2, 3, 5, 3)])), null, 'too far behind');
  assert.equal(differentialCaptain(captainOptions([slot(1, 4, 8, 15), slot(2, 3, 7.5, 10)])), null, 'owned about as much');
});
