import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceForecast } from '../src/lib/priceForecast.js';

const p = (id, percent, net = 0, costChangeEvent = 0) => ({
  id, webName: `P${id}`, team: 1, positionId: 3, price: 7.5,
  priceChangePercent: percent,
  transfersInEvent: net > 0 ? net : 0,
  transfersOutEvent: net < 0 ? -net : 0,
  costChangeEvent,
});

test('splits risers from fallers and ignores players far from a change', () => {
  const { risers, fallers } = priceForecast([
    p(1, 95), p(2, 70), p(3, 10), p(4, -80), p(5, -62), p(6, -5), p(7, null),
  ]);
  assert.deepEqual(risers.map(r => r.id), [1, 2]);
  assert.deepEqual(fallers.map(r => r.id), [4, 5]);
});

test('closest to a change comes first; net transfers breaks ties', () => {
  const { risers } = priceForecast([p(1, 80, 100), p(2, 80, 5000), p(3, 99, 1)]);
  assert.deepEqual(risers.map(r => r.id), [3, 2, 1]);
});

test('a price that already moved this gameweek is flagged', () => {
  const { risers } = priceForecast([p(1, 90, 100, 1)]);
  assert.equal(risers[0].alreadyMoved, true);
  assert.equal(priceForecast([p(2, 90, 100, 0)]).risers[0].alreadyMoved, false);
});

test('each list is capped by the limit', () => {
  const many = Array.from({ length: 30 }, (_, i) => p(i + 1, 70 + (i % 20)));
  assert.equal(priceForecast(many, { limit: 5 }).risers.length, 5);
});
