import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bonusFromBps, lineup, liveBonusRace, liveTeamScore, matchDetail, projectedBonus, teamStates } from '../src/lib/live.js';

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

test('live total: captain doubled, projected bonus added, hit kept apart', () => {
  const r = liveTeamScore({ picks: picksWith(), liveById: played({ 10: { totalPoints: 8 } }), bonus: { 10: 3 }, states: allDone, playersById });
  // 10 starters × 2 + captain (8 + 3) × 2; like FPL, the hit isn't taken
  // off the week's points.
  assert.equal(r.total, 20 + 22);
  assert.equal(r.hit, 4);
});

test('a starter who did not play is replaced by the first sub who keeps a legal formation', () => {
  // A defender misses out with four at the back: the first outfield sub
  // (DEF 13) comes on.
  const r = liveTeamScore({ picks: picksWith(), liveById: played({ 2: { minutes: 0, totalPoints: 0 }, 13: { totalPoints: 6 } }), bonus: {}, states: allDone, playersById });
  assert.ok(r.rows.find(x => x.id === 13).subIn);
  assert.ok(r.rows.find(x => x.id === 2).subOut);
  assert.equal(r.total, 9 * 2 + 4 + 6);
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
  assert.equal(r.total, 13 * 2 + 4);
});

test('the live bonus race ranks by BPS across live matches and flags owned players', () => {
  const stats = (bps) => ({ identifier: 'bps', h: bps.h, a: bps.a });
  const fixtures = [
    // live match, no confirmed bonus
    { id: 1, started: true, finished: false, finished_provisional: false, stats: [stats({ h: [{ element: 10, value: 40 }, { element: 11, value: 30 }], a: [{ element: 12, value: 20 }] })] },
    // confirmed bonus already → excluded
    { id: 2, started: true, finished: true, finished_provisional: true, stats: [{ identifier: 'bonus', h: [{ element: 99, value: 3 }], a: [] }, { identifier: 'bps', h: [{ element: 99, value: 99 }], a: [] }] },
    // not started → excluded
    { id: 3, started: false, stats: [] },
  ];
  const race = liveBonusRace(fixtures, { ownedIds: [11], limit: 5 });
  assert.deepEqual(race.map(r => r.element), [10, 11, 12]);
  assert.equal(race[0].bonus, 3);
  assert.equal(race[1].bonus, 2);
  assert.equal(race[1].owned, true);
  assert.equal(race.some(r => r.element === 99), false, 'confirmed and unstarted matches are left out');
});

test('a match in detail: each side’s players with this match’s points, BPS and bonus, and its events', () => {
  const ex = (fixture, stats) => ({ fixture, stats: Object.entries(stats).map(([identifier, [value, points]]) => ({ identifier, value, points })) });
  const playersById = { 1: { webName: 'Saka', team: 1 }, 2: { webName: 'Rice', team: 1 }, 3: { webName: 'Isak', team: 2 }, 4: { webName: 'Sub', team: 2 } };
  const fixture = {
    id: 10, team_h: 1, team_a: 2, started: true, finished: false,
    stats: [
      { identifier: 'goals_scored', h: [{ element: 1, value: 2 }], a: [{ element: 3, value: 1 }] },
      { identifier: 'assists', h: [{ element: 2, value: 1 }], a: [] },
      { identifier: 'bps', h: [{ element: 1, value: 40 }, { element: 2, value: 25 }], a: [{ element: 3, value: 30 }] },
    ],
  };
  const live = [
    { id: 1, explain: [ex(10, { minutes: [90, 2], goals_scored: [2, 8] })] },
    { id: 2, explain: [ex(10, { minutes: [80, 2], assists: [1, 3] })] },
    // A double gameweek: only this match's points count here.
    { id: 3, explain: [ex(10, { minutes: [90, 2], goals_scored: [1, 4] }), ex(11, { minutes: [90, 2] })] },
    { id: 4, explain: [ex(10, { minutes: [0, 0] })] },
  ];
  const d = matchDetail(fixture, live, playersById);
  assert.equal(d.bonusProjected, true);
  assert.deepEqual(d.home.map(r => [r.player.webName, r.points, r.bonus, r.bps]), [['Saka', 13, 3, 40], ['Rice', 6, 1, 25]], 'projected bonus added');
  assert.deepEqual(d.away.map(r => [r.player.webName, r.points, r.goals]), [['Isak', 8, 1]], 'no one who didn’t play');
  assert.deepEqual(d.events.home.goals_scored.map(e => [e.player.webName, e.value]), [['Saka', 2]]);
  assert.deepEqual(d.events.away.assists, []);
  // Once FPL confirms bonus, it comes from the breakdown and isn't projected.
  const done = { ...fixture, finished: true, stats: [...fixture.stats, { identifier: 'bonus', h: [{ element: 1, value: 3 }], a: [] }] };
  const live2 = live.map(e => (e.id === 1 ? { id: 1, explain: [ex(10, { minutes: [90, 2], goals_scored: [2, 8], bonus: [3, 3] })] } : e));
  const d2 = matchDetail(done, live2, playersById);
  assert.equal(d2.bonusProjected, false);
  assert.deepEqual(d2.home.map(r => [r.points, r.bonus]), [[13, 3], [5, 0]]);
});

test('a side’s lineup: the eleven who started, then those who came on', () => {
  const r = (element, minutes, started) => ({ element, minutes, started });
  const rows = [r(1, 90, true), r(2, 15, false), r(3, 75, true), ...Array.from({ length: 9 }, (_, i) => r(10 + i, 90, true))];
  const { starters, subs } = lineup(rows);
  assert.equal(starters.length, 11);
  assert.ok(starters.some(s => s.element === 3), 'a starter taken off early is still a starter');
  assert.deepEqual(subs.map(s => s.element), [2]);
  // Without FPL's start counts (or too few), minutes decide.
  const guess = lineup([r(1, 90, false), r(2, 10, false)]);
  assert.deepEqual([guess.starters.length, guess.subs.length], [2, 0]);
});
