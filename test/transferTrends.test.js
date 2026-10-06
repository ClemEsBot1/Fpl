import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTransferTrends, predictPriceChange } from '../src/lib/transferTrends.js';

const TOTAL = 10_000_000;
const p = (id, selectedBy, inn, out) => ({ id, webName: `P${id}`, selectedBy, transfersInEvent: inn, transfersOutEvent: out });

test('price change follows net transfers against the number of owners', () => {
  // 1% owned = 100,000 owners.
  assert.deepEqual(predictPriceChange(p(1, 1, 15000, 1000), TOTAL), { dir: 'rise', confidence: 'likely' });
  assert.deepEqual(predictPriceChange(p(2, 1, 7000, 0), TOTAL), { dir: 'rise', confidence: 'possible' });
  assert.deepEqual(predictPriceChange(p(3, 1, 0, 6000), TOTAL), { dir: 'fall', confidence: 'likely' });
  assert.deepEqual(predictPriceChange(p(4, 1, 0, 3000), TOTAL), null, 'under the minimum net');
  assert.deepEqual(predictPriceChange(p(5, 50, 100000, 0), TOTAL), null, 'small next to 5m owners');
});

test('panels rank the biggest moves first and skip players nobody moved', () => {
  const players = [p(1, 1, 15000, 1000), p(2, 1, 7000, 0), p(3, 1, 0, 6000), p(4, 1, 0, 0), p(5, 1, 20000, 0)];
  const [inn, out, rise, fall] = buildTransferTrends(players, TOTAL);
  assert.deepEqual(inn.rows.map(r => r.player.id), [5, 1, 2]);
  assert.deepEqual(out.rows.map(r => r.player.id), [3, 1]);
  assert.deepEqual(rise.rows.map(r => r.player.id), [5, 1, 2], 'likely before possible');
  assert.deepEqual(fall.rows.map(r => r.player.id), [3]);
  assert.equal(inn.rows[0].net, 20000);
});
