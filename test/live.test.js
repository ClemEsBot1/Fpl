import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bonusFromBps, liveTeamScore, projectedBonus, teamStates } from '../src/lib/live.js';

test('bonus follows FPL tie rules', () => {
  const b = list => bonusFromBps(list.map((value, i) => ({ element: i + 1, value })));
  assert.deepEqual(b([40, 30, 20, 10]), { 1: 3, 2: 2, 3: 1 });
  assert.deepEqual(b([40, 40, 20, 10]), { 1: 3, 2: 3, 3: 1 });
  assert.deepEqual(b([40, 30, 30, 10]), { 1: 3, 2: 2, 3: 2 });
  assert.deepEqual(b([40, 30, 20, 20]), { 1: 3, 2: 2, 3: 1, 4: 1 });
});

test('bonus is projected only until FPL confirms it', () => {
  const bps = { identifier: 'bps', h: [{ element: 1, value: 30 }], a: [{ element: 2, value: 20 }, { element: 3, value: 10 }] };
  const live = { started: true, stats: [bps, { identifier: 'bonus', h: [], a: [] }] };
  const confirmed = { started: true, stats: [bps, { identifier: 'bonus', h: [{ element: 1, value: 3 }], a: [] }] };
  assert.deepEqual(projectedBonus([live]), { 1: 3, 2: 2, 3: 1 });
  assert.deepEqual(projectedBonus([confirmed]), {});
  assert.deepEqual(projectedBonus([{ started: false, stats: [bps] }]), {});
});

test('a club is done only when all its matches are', () => {
  const s = teamStates([
    { team_h: 1, team_a: 2, started: true, finished: true },
    { team_h: 1, team_a: 3, started: false, finished: false },
    { team_h: 4, team_a: 5, started: true, finished: false, finished_provisional: false },
  ]);
  assert.deepEqual(s, { 1: 'waiting', 2: 'done', 3: 'waiting', 4: 'playing', 5: 'playing' });
});

// 4-4-2: GKP 1, DEF 2-5, MID 6-9, FWD 10-11; bench GKP 12, DEF 13, MID 14, FWD 15.
const POS = [1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 1, 2, 3, 4];
const playersById = Object.fromEntries(POS.map((positionId, i) => [i + 1, { id: i + 1, positionId, team: i + 1 }]));
const picksWith = (extra = {}) => ({
  active_chip: null, entry_history: { event_transfers_cost: 4 },
  picks: POS.map((_, i) => ({ element: i + 1, position: i + 1, multiplier: i === 9 ? 2 : i < 11 ? 1 : 0, is_captain: i === 9, is_vice_captain: i === 5 })),
  ...extra,
});
const allDone = Object.fromEntries(POS.map((_, i) => [i + 1, 'done']));
const played = (overrides = {}) => Object.fromEntries(POS.map((_, i) => [i + 1, { totalPoints: 2, minutes: 90, bonus: 0, ...(overrides[i + 1] || {}) }]));

test('live total: captain doubled, projected bonus added, hit taken off', () => {
  const r = liveTeamScore({ picks: picksWith(), liveById: played({ 10: { totalPoints: 8 } }), bonus: { 10: 3 }, states: allDone, playersById });
  // 10 starters × 2 + captain (8 + 3) × 2 − 4.
  assert.equal(r.total, 20 + 22 - 4);
});

test('a starter who did not play is replaced by the first sub who keeps a legal formation', () => {
  // A defender misses out with four at the back: the first outfield sub
  // (DEF 13) comes on.
  const r = liveTeamScore({ picks: picksWith(), liveById: played({ 2: { minutes: 0, totalPoints: 0 }, 13: { totalPoints: 6 } }), bonus: {}, states: allDone, playersById });
  assert.ok(r.rows.find(x => x.id === 13).subIn);
  assert.ok(r.rows.find(x => x.id === 2).subOut);
  assert.equal(r.total, 9 * 2 + 4 + 6 - 4);
});

test('the keeper is only covered by the bench keeper, and nobody comes on for a match not yet over', () => {
  const states = { ...allDone, 6: 'waiting' };
  const r = liveTeamScore({ picks: picksWith(), liveById: played({ 1: { minutes: 0, totalPoints: 0 }, 6: { minutes: 0, totalPoints: 0 } }), bonus: {}, states, playersById });
  assert.ok(r.rows.find(x => x.id === 12).subIn, 'bench keeper on');
  assert.ok(!r.rows.find(x => x.id === 6).subOut, 'still to play');
});

test('a back three can only lose a defender to a defender', () => {
  // 3-5-2: one of the three defenders misses out; the bench MID (14) is
  // first after a bench DEF that also did not play, so nobody can come on.
  const pos = [1, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 1, 2, 3, 4];
  const byId = Object.fromEntries(pos.map((positionId, i) => [i + 1, { id: i + 1, positionId, team: i + 1 }]));
  const r = liveTeamScore({ picks: picksWith(), liveById: played({ 2: { minutes: 0, totalPoints: 0 }, 13: { minutes: 0, totalPoints: 0 } }), bonus: {}, states: allDone, playersById: byId });
  assert.ok(!r.rows.some(x => x.subIn));
});

test('the vice-captain takes the armband when the captain does not play', () => {
  const r = liveTeamScore({ picks: picksWith(), liveById: played({ 10: { minutes: 0, totalPoints: 0 }, 6: { totalPoints: 5 } }), bonus: {}, states: allDone, playersById });
  assert.equal(r.rows.find(x => x.id === 6).multiplier, 2);
  assert.equal(r.rows.find(x => x.id === 6).points, 10);
});

test('bench boost counts all fifteen and makes no substitutions', () => {
  const r = liveTeamScore({ picks: picksWith({ active_chip: 'bboost' }), liveById: played({ 2: { minutes: 0, totalPoints: 0 } }), bonus: {}, states: allDone, playersById });
  assert.ok(!r.rows.some(x => x.subIn));
  assert.equal(r.total, 13 * 2 + 4 - 4);
});
