import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeHitPlan, wildcardPlan } from '../src/lib/transferChips.js';

const POSITIONS = [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4];
const player = (id, positionId, team, price = 5) => ({ id, webName: `P${id}`, positionId, team, price, status: 'a' });
const slot = (p, isStarting = true) => ({ player: p, isStarting, isCaptain: false, multiplier: 1, predicted: 2 });
const weeks = points => points.map((v, k) => ({ event: 10 + k, points: v }));

// Your 15 score 2 a week. On the market: 15 steady players (4 a week) and
// 15 who score 12 in GW12 only (a double), at the same £5m each.
function setup() {
  const mine = POSITIONS.map((pos, i) => player(i + 1, pos, i + 1));
  const steady = POSITIONS.map((pos, i) => player(100 + i, pos, i + 1));
  const spike = POSITIONS.map((pos, i) => player(200 + i, pos, i + 1));
  const predictionsById = {};
  const add = (list, byGw) => list.forEach(p => {
    const avg = byGw.reduce((s, w) => s + w.points, 0) / byGw.length;
    predictionsById[p.id] = { predicted: avg, nextMatchPredicted: byGw[0].points, byGw };
  });
  add(mine, weeks([2, 2, 2, 2, 2]));
  add(steady, weeks([4, 4, 4, 4, 4]));
  add(spike, weeks([0, 0, 12, 0, 0]));
  const squad = mine.map((p, i) => slot(p, i !== 1 && i !== 6 && i !== 11 && i !== 14));
  return { squad, allPlayers: [...mine, ...steady, ...spike], predictionsById };
}

test('a wildcard is built for the weeks ahead and shows what it adds each week', () => {
  const { squad, allPlayers, predictionsById } = setup();
  const wc = wildcardPlan(squad, 0, allPlayers, predictionsById);
  assert.deepEqual(wc.weeks.map(w => w.event), [10, 11, 12, 13, 14]);
  assert.ok(wc.squad.every(s => s.player.id >= 100 && s.player.id < 200), 'the steady players, not the one-week spike');
  assert.equal(wc.ins.length, 15);
  // Best XI with the captain doubled: 12 x 2 = 24 for yours, 12 x 4 = 48 for the wildcard's.
  assert.deepEqual(wc.weeks[0], { event: 10, now: 24, chip: 48, gain: 24 });
  assert.equal(wc.gain, 120);
});

test('a free hit only looks at its own gameweek, and finds the week it adds most', () => {
  const { squad, allPlayers, predictionsById } = setup();
  const fh = freeHitPlan(squad, 0, allPlayers, predictionsById);
  assert.equal(fh.budgetTenths, 15 * 50);
  const gw12 = fh.weeks.find(w => w.event === 12);
  assert.ok(gw12.squad.every(s => s.player.id >= 200), 'GW12: the double-gameweek players');
  assert.ok(fh.weeks.find(w => w.event === 10).squad.every(s => s.player.id >= 100 && s.player.id < 200), 'other weeks: the steady ones');
  assert.equal(fh.best.event, 12);
  assert.equal(gw12.chip, 12 * 12);
  assert.equal(gw12.gain, 144 - 24);
  assert.equal(gw12.ins.length, gw12.outs.length);
});

test('a squad that is already the best needs no changes', () => {
  const { squad, predictionsById } = setup();
  const mineOnly = squad.map(s => s.player);
  const fh = freeHitPlan(squad, 0, mineOnly, predictionsById);
  assert.ok(fh.weeks.every(w => w.ins.length === 0 && w.gain === 0));
  assert.equal(wildcardPlan(squad, 0, mineOnly, predictionsById).ins.length, 0);
});
