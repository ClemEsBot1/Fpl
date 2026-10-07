import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPriceWatch, buildTransferTrends, nextPriceChangeAt, predictPriceChange, topByPoints } from '../src/lib/transferTrends.js';

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

test('transfer panels rank the biggest moves first and skip players nobody moved', () => {
  const players = [p(1, 1, 15000, 1000), p(2, 1, 7000, 0), p(3, 1, 0, 6000), p(4, 1, 0, 0), p(5, 1, 20000, 0)];
  const [inn, out] = buildTransferTrends(players, TOTAL);
  assert.deepEqual(inn.rows.map(r => r.player.id), [5, 1, 2]);
  assert.deepEqual(out.rows.map(r => r.player.id), [3, 1]);
  assert.equal(inn.rows[0].net, 20000);
  assert.deepEqual(inn.rows[0].change, { dir: 'rise', confidence: 'likely' });
});

test('points panels list the highest first and leave out zeros', () => {
  const rows = topByPoints([{ player: { id: 1 }, points: 4 }, { player: { id: 2 }, points: 9 }, { player: { id: 3 }, points: 0 }, { player: null, points: 12 }], 2);
  assert.deepEqual(rows.map(r => r.player.id), [2, 1]);
});

test("FPL's own price progress sets the status when it's published", () => {
  const withPct = pct => ({ ...p(1, 1, 0, 0), priceChangePercent: pct });
  assert.deepEqual(predictPriceChange(withPct(104), TOTAL), { dir: 'rise', confidence: 'very likely', percent: 104 });
  assert.deepEqual(predictPriceChange(withPct(75), TOTAL), { dir: 'rise', confidence: 'likely', percent: 75 });
  assert.deepEqual(predictPriceChange(withPct(-120), TOTAL), { dir: 'fall', confidence: 'very likely', percent: -120 });
  assert.equal(predictPriceChange(withPct(40), TOTAL), null);
  // Big net transfers don't override FPL's own figure.
  assert.equal(predictPriceChange({ ...p(2, 1, 50000, 0), priceChangePercent: 10 }, TOTAL), null);
});

test('price watch lists the players closest to a rise and a drop, only with FPL data', () => {
  const players = [5, 90, -30, 130, -101, 0].map((pct, i) => ({ ...p(i + 1, 1, 0, 0), priceChangePercent: pct }));
  const [rises, drops] = buildPriceWatch(players, TOTAL);
  assert.deepEqual(rises.rows.map(r => r.player.id), [4, 2, 1]);
  assert.deepEqual(drops.rows.map(r => r.player.id), [5, 3]);
  assert.deepEqual(buildPriceWatch([p(1, 1, 9000, 0)], TOTAL), []);
});

test('price changes are at the next 00:00 UK time, BST or GMT', () => {
  const next = iso => nextPriceChangeAt(new Date(iso)).toISOString();
  assert.equal(next('2026-10-07T17:00:00Z'), '2026-10-07T23:00:00.000Z'); // BST
  assert.equal(next('2026-10-07T23:30:00Z'), '2026-10-08T23:00:00.000Z'); // just after midnight UK
  assert.equal(next('2026-12-10T12:00:00Z'), '2026-12-11T00:00:00.000Z'); // GMT
  assert.equal(next('2026-10-24T23:10:00Z'), '2026-10-26T00:00:00.000Z'); // clocks go back that night
});
