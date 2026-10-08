import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTransfers, xiPointsForWeek } from '../src/lib/transferPlan.js';

// A 15 of 2 GKP, 5 DEF, 5 MID, 3 FWD at different clubs, plus a pool of
// players to buy. Everyone scores `base` a week unless set otherwise.
const POS = [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4];
function setup({ weeks = 5, squadPts = {}, poolPts = {}, bank = 0 } = {}) {
  const squadPlayers = POS.map((positionId, i) => ({ id: i + 1, positionId, team: i + 1, price: 5 }));
  const pool = [
    { id: 101, positionId: 3, team: 16, price: 5 },
    { id: 102, positionId: 4, team: 17, price: 5 },
    { id: 103, positionId: 2, team: 18, price: 9 },
  ];
  const allPlayers = [...squadPlayers, ...pool];
  const pointsById = {};
  allPlayers.forEach(p => { pointsById[p.id] = Array.from({ length: weeks }, (_, k) => (squadPts[p.id] || poolPts[p.id] || (() => 3))(k)); });
  return { squadPlayers, bankTenths: bank, allPlayers, pointsById, events: Array.from({ length: weeks }, (_, k) => 10 + k) };
}
const flat = v => () => v;

test('the XI picks a legal formation and doubles the captain', () => {
  const players = POS.map((positionId, i) => ({ id: i + 1, positionId }));
  // Everyone 1 point except one forward on 10: 11 + 9 extra + 10 for the armband.
  assert.equal(xiPointsForWeek(players, p => (p.id === 13 ? 10 : 1), 0), 30);
});

test('an injured midfielder is replaced straight away with the free transfer', () => {
  const plan = planTransfers({ ...setup({ squadPts: { 8: flat(0) }, poolPts: { 101: flat(6) } }), freeTransfers: 1 });
  assert.deepEqual(plan.weeks[0].moves.map(m => [m.out.id, m.in.id]), [[8, 101]]);
  assert.equal(plan.weeks[0].hits, 0);
  assert.ok(plan.gain > 20);
});

test('nothing worth buying: every transfer is rolled', () => {
  const plan = planTransfers({ ...setup(), freeTransfers: 1 });
  assert.ok(plan.weeks.every(w => w.moves.length === 0));
  assert.equal(plan.gain, 0);
  assert.equal(plan.freeAtEnd, 5);
});

test('a second injury is worth a hit only when the gain clears it', () => {
  const both = { 8: flat(0), 13: flat(0) };
  const big = planTransfers({ ...setup({ squadPts: both, poolPts: { 101: flat(7), 102: flat(7) } }), freeTransfers: 1 });
  assert.equal(big.weeks[0].moves.length, 2);
  assert.equal(big.weeks[0].hits, 1);
  // A forward only half a point better each week: wait a week for the free one.
  const small = planTransfers({ ...setup({ squadPts: { 8: flat(0), 13: flat(2.5) }, poolPts: { 101: flat(7), 102: flat(3) } }), freeTransfers: 1 });
  assert.equal(small.weeks[0].hits, 0);
  assert.ok(small.weeks.every(w => w.hits === 0));
});

test('with one free transfer a week, the urgent move goes first and the later one waits', () => {
  // Midfielder 8 is out now, forward 13 from week 2; the bench scores nothing.
  const squadPts = { 7: flat(0), 12: flat(0), 15: flat(0), 8: flat(0), 13: k => (k < 2 ? 3 : 0) };
  const plan = planTransfers({ ...setup({ squadPts, poolPts: { 101: flat(6), 102: flat(6) } }), freeTransfers: 1 });
  assert.deepEqual(plan.weeks[0].moves.map(m => m.in.id), [101]);
  const forward = plan.weeks.findIndex(w => w.moves.some(m => m.in.id === 102));
  assert.ok(forward >= 1 && forward <= 2, `forward bought in week ${forward}`);
  assert.ok(plan.weeks.every(w => w.hits === 0));
});

test('the bank and the club limit are respected', () => {
  // 103 costs 9.0 against a 5.0 defender and nothing in the bank.
  const poor = planTransfers({ ...setup({ poolPts: { 103: flat(9) } }), freeTransfers: 1 });
  assert.ok(poor.weeks.every(w => w.moves.every(m => m.in.id !== 103)));
  const rich = planTransfers({ ...setup({ poolPts: { 103: flat(9) }, bank: 40 }), freeTransfers: 1 });
  assert.equal(rich.weeks[0].moves[0].in.id, 103);
});
