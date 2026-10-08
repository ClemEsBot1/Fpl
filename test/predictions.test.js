import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStaticDataFromRaw, buildOptimalTeam, buildOptimalSquad, hydrateSquadSnapshot, isLegalStartingXi, applyAutomaticSubs,
  seasonIdFor, snapshotIsForSeason, pickBestFormation, getDefaultEvent, SQUAD_BUDGET, MAX_PER_REAL_TEAM, computePlayerPrediction, recentMinutesFromLive, DEFAULT_PREDICTION_WEIGHTS,
} from '../src/lib/predictions.js';

// A deterministic synthetic league: 20 clubs × 25 players, with prices and
// FPL expected points that vary so the optimiser has real choices to make.
function league() {
  const teams = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1, code: i + 1, name: `Team ${i + 1}`, short_name: `T${String(i + 1).padStart(2, '0')}`,
    strength: 3, strength_overall_home: 1200, strength_overall_away: 1200,
    strength_attack_home: 1200, strength_attack_away: 1200, strength_defence_home: 1200, strength_defence_away: 1200,
  }));
  const shape = [1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4];
  let id = 0;
  const elements = [];
  teams.forEach(t => shape.forEach((pos, k) => {
    id++;
    const quality = ((id * 37) % 100) / 100; // pseudo-random but fixed
    elements.push({
      id, code: id, web_name: `P${id}`, first_name: 'X', second_name: `P${id}`, team: t.id, element_type: pos,
      now_cost: 40 + Math.round(quality * 90) + (pos === 4 ? 10 : 0), form: (quality * 8).toFixed(1),
      points_per_game: (quality * 7).toFixed(1), total_points: Math.round(quality * 60), ep_next: (1 + quality * 6).toFixed(1),
      status: k % 13 === 0 ? 'i' : 'a', chance_of_playing_next_round: k % 13 === 0 ? 0 : null, minutes: 450,
      news: '', selected_by_percent: '5', expected_goals: '1.0', expected_assists: '1.0', goals_scored: 1, assists: 1,
      penalties_order: null, direct_freekicks_order: null, corners_and_indirect_freekicks_order: null,
    });
  }));
  const now = Date.now();
  const events = Array.from({ length: 38 }, (_, i) => ({ id: i + 1, name: `Gameweek ${i + 1}`, deadline_time: new Date(now + (i - 5.5) * 7 * 864e5).toISOString(), finished: i < 5 }));
  const fixtures = [];
  for (let gw = 1; gw <= 38; gw++) {
    for (let t = 1; t <= 20; t += 2) {
      fixtures.push({ id: gw * 100 + t, event: gw, team_h: t, team_a: t + 1, team_h_difficulty: 3, team_a_difficulty: 3, kickoff_time: new Date(now + (gw - 6) * 7 * 864e5).toISOString(), finished: gw < 6 });
    }
  }
  return { bootstrap: { teams, elements, events, element_types: [1, 2, 3, 4].map(id => ({ id })) }, fixtures };
}

test('optimal squad follows FPL squad rules', () => {
  const { bootstrap, fixtures } = league();
  const staticData = buildStaticDataFromRaw(bootstrap, fixtures);
  const { squad, captainId, viceCaptainId } = buildOptimalTeam(staticData, SQUAD_BUDGET);

  assert.equal(squad.length, 15);
  const byPos = [1, 2, 3, 4].map(p => squad.filter(s => s.player.positionId === p).length);
  assert.deepEqual(byPos, [2, 5, 5, 3]);

  const cost = squad.reduce((sum, s) => sum + s.player.price, 0);
  assert.ok(cost <= SQUAD_BUDGET + 1e-9, `squad costs £${cost.toFixed(1)}m`);

  const perClub = {};
  squad.forEach(s => { perClub[s.player.team] = (perClub[s.player.team] || 0) + 1; });
  assert.ok(Object.values(perClub).every(n => n <= MAX_PER_REAL_TEAM));

  const starters = squad.filter(s => s.isStarting);
  assert.equal(starters.length, 11);
  assert.equal(starters.filter(s => s.player.positionId === 1).length, 1);
  assert.ok(starters.filter(s => s.player.positionId === 2).length >= 3);
  assert.ok(starters.filter(s => s.player.positionId === 4).length >= 1);

  assert.ok(starters.some(s => s.player.id === captainId), 'captain starts');
  assert.notEqual(captainId, viceCaptainId);
});

test('injured players are predicted near zero and never start', () => {
  // The model keeps a 5% sliver for injured/suspended players (FPL's status
  // can lag a recovery), so "near zero" rather than exactly zero.
  const { bootstrap, fixtures } = league();
  const staticData = buildStaticDataFromRaw(bootstrap, fixtures);
  const injuredIds = new Set(bootstrap.elements.filter(e => e.status === 'i').map(e => e.id));
  assert.ok(injuredIds.size > 0);
  injuredIds.forEach(id => assert.ok(staticData.predictionsById[id].nextMatchPredicted < 0.5, `player ${id}`));
  const { squad } = buildOptimalTeam(staticData, SQUAD_BUDGET);
  assert.ok(!squad.some(s => s.isStarting && injuredIds.has(s.player.id)));
});

test('a saved squad keeps its own XI, bank and armbands on starters', () => {
  const { bootstrap, fixtures } = league();
  const staticData = buildStaticDataFromRaw(bootstrap, fixtures);
  const { squad } = buildOptimalTeam(staticData, SQUAD_BUDGET);
  const playerIds = squad.map(s => s.player.id);
  const players = squad.map(s => s.player);
  const bench = squad.filter(s => !s.isStarting);
  const starters = squad.filter(s => s.isStarting);

  // Swap one starting outfielder with a bench player of the same position.
  const benchOutfielder = bench.find(s => s.player.positionId !== 1);
  const starterOut = starters.find(s => s.player.positionId === benchOutfielder.player.positionId);
  const startingIds = starters.map(s => s.player.id).filter(id => id !== starterOut.player.id).concat(benchOutfielder.player.id);
  assert.ok(isLegalStartingXi(startingIds, players));

  // The captain was saved on a player who is now on the bench.
  const snapshot = { playerIds, captainId: starterOut.player.id, viceCaptainId: null, startingIds, bankTenths: 7 };
  const kept = hydrateSquadSnapshot(snapshot, staticData, { keepStartingXi: true });
  assert.deepEqual(kept.squad.filter(s => s.isStarting).map(s => s.player.id).sort(), [...startingIds].sort());
  assert.equal(kept.bankTenths, 7);
  const captain = kept.squad.find(s => s.isCaptain);
  const vice = kept.squad.find(s => s.isViceCaptain);
  assert.ok(captain.isStarting && vice.isStarting && captain !== vice);
  assert.equal(captain.multiplier, 2);

  // The optimal squad's XI is re-picked from today's predictions instead.
  const repicked = hydrateSquadSnapshot(snapshot, staticData);
  assert.notDeepEqual(repicked.squad.filter(s => s.isStarting).map(s => s.player.id).sort(), [...startingIds].sort());

  // An illegal saved XI (two keepers) falls back to the best formation.
  const keepers = players.filter(p => p.positionId === 1).map(p => p.id);
  const illegal = [...keepers, ...startingIds.filter(id => !keepers.includes(id)).slice(0, 9)];
  const fixed = hydrateSquadSnapshot({ ...snapshot, startingIds: illegal }, staticData, { keepStartingXi: true });
  assert.equal(fixed.squad.filter(s => s.isStarting && s.player.positionId === 1).length, 1);
});

test('automatic subs: who came on scores, who went off does not', () => {
  const s = (id, isStarting, multiplier, extra = {}) => ({ player: { id }, isStarting, multiplier, isCaptain: false, isViceCaptain: false, played: true, ...extra });
  const squad = [s(1, true, 1, { played: false }), s(2, true, 2, { isCaptain: true }), s(3, true, 1, { isViceCaptain: true }), s(12, false, 0)];
  const subbed = applyAutomaticSubs(squad, [{ element_out: 1, element_in: 12 }], { finished: true });
  assert.deepEqual(subbed.map(x => [x.player.id, x.isStarting, x.multiplier]), [[1, false, 0], [2, true, 2], [3, true, 1], [12, true, 1]]);
});

test("a captain who didn't play passes the armband on, even with no subs", () => {
  const s = (id, isStarting, multiplier, extra = {}) => ({ player: { id }, isStarting, multiplier, isCaptain: false, isViceCaptain: false, played: true, ...extra });
  // Triple Captain on a player who was then subbed off.
  const tc = [s(1, true, 3, { isCaptain: true, played: false }), s(2, true, 1, { isViceCaptain: true }), s(12, false, 0)];
  const afterTc = applyAutomaticSubs(tc, [{ element_out: 1, element_in: 12 }], { finished: true });
  assert.equal(afterTc.find(x => x.player.id === 2).multiplier, 3);
  assert.equal(afterTc.find(x => x.player.id === 1).multiplier, 0);

  // Bench Boost: nobody is subbed, but the vice still takes over.
  const bb = [s(1, true, 2, { isCaptain: true, played: false }), s(2, true, 1, { isViceCaptain: true }), s(12, false, 1)];
  const afterBb = applyAutomaticSubs(bb, [], { finished: true });
  assert.equal(afterBb.find(x => x.player.id === 2).multiplier, 2);
  assert.equal(afterBb.find(x => x.player.id === 1).multiplier, 1);

  // A vice who is on the bench can't take it.
  const benchVice = [s(1, true, 2, { isCaptain: true, played: false }), s(12, false, 0, { isViceCaptain: true })];
  assert.equal(applyAutomaticSubs(benchVice, [], { finished: true }).find(x => x.player.id === 12).multiplier, 0);
});

test('while a gameweek is being played, a captain yet to play keeps the armband', () => {
  const s = (id, isStarting, multiplier, extra = {}) => ({ player: { id }, isStarting, multiplier, isCaptain: false, isViceCaptain: false, played: true, ...extra });
  // The captain plays on Sunday; the vice already scored on Saturday.
  const squad = [s(1, true, 2, { isCaptain: true, played: false }), s(2, true, 1, { isViceCaptain: true })];
  const now = applyAutomaticSubs(squad, [], { finished: false });
  assert.deepEqual(now.map(x => x.multiplier), [2, 1]);
  assert.deepEqual(applyAutomaticSubs(squad, []).map(x => x.multiplier), [2, 1], 'not finished unless told so');
});

test('saved files from an earlier season are recognised', () => {
  const events = [{ id: 2, deadline_time: '2026-08-21T17:30:00Z' }, { id: 1, deadline_time: '2026-08-14T17:30:00Z' }];
  assert.equal(seasonIdFor(events), '2026-27');
  assert.equal(seasonIdFor([]), null);
  assert.equal(snapshotIsForSeason({ season: '2026-27' }, '2026-27', events), true);
  assert.equal(snapshotIsForSeason({ season: '2025-26' }, '2026-27', events), false);
  // Files saved before seasons were recorded go by when they were built.
  assert.equal(snapshotIsForSeason({ builtAt: '2026-04-30T06:00:00Z' }, '2026-27', events), false);
  assert.equal(snapshotIsForSeason({ savedAt: '2026-08-01T06:00:00Z' }, '2026-27', events), true);
  assert.equal(snapshotIsForSeason(null, '2026-27', events), false);
});

test("the optimiser doesn't keep downgrading a starter's replacement", () => {
  // Only the forwards have alternatives. The best three cost £7m too much.
  let id = 0;
  const pool = [];
  const add = (positionId, price, predicted) => { id++; pool.push({ id, positionId, price, predicted, team: id, status: 'a' }); return id; };
  [4, 1].forEach(v => add(1, 4, v));
  [5, 5, 5, 1, 1].forEach(v => add(2, 4, v));
  [6, 6, 6, 6, 1].forEach(v => add(3, 5, v));
  const a = add(4, 20, 12);
  add(4, 18, 11);
  add(4, 16, 10);
  const nearlyAsGood = add(4, 14, 9.9);
  const decent = add(4, 12, 9);
  add(4, 4, 1);
  const predictionsById = Object.fromEntries(pool.map(p => [p.id, { predicted: p.predicted }]));

  // The cheap first step (£16m forward for a £14m one, almost as good) puts
  // a new starter in. Treating them as a bench player afterwards used to
  // sell them on down to the £4m forward, leaving £5m unspent.
  const squad = buildOptimalSquad(pool, predictionsById, SQUAD_BUDGET);
  const forwards = squad.filter(p => p.positionId === 4).map(p => p.id).sort((x, y) => x - y);
  assert.deepEqual(forwards, [a, nearlyAsGood, decent]);
});

// One player and a fixture list, for checking computePlayerPrediction's
// arithmetic through buildStaticDataFromRaw.
function predictionFor(element, extraFixtures = []) {
  const { bootstrap, fixtures } = league();
  const target = bootstrap.events.find(e => new Date(e.deadline_time).getTime() > Date.now()).id;
  const el = { ...bootstrap.elements[3], ...element }; // a team-1 defender
  bootstrap.elements = [el, ...bootstrap.elements.filter(e => e.id !== el.id)];
  const sd = buildStaticDataFromRaw(bootstrap, [...fixtures, ...extraFixtures]);
  return { pred: sd.predictionsById[el.id], target };
}

test("ep_next isn't scaled for fitness a second time", () => {
  const fit = predictionFor({ ep_next: '6.0', status: 'a', chance_of_playing_next_round: null }).pred;
  const doubt = predictionFor({ ep_next: '6.0', status: 'd', chance_of_playing_next_round: 50 }).pred;
  // FPL already halves ep_next for a 50% player, so only the other inputs
  // (40% of the base) are halved again here.
  const epShare = DEFAULT_PREDICTION_WEIGHTS.epNext * 6.0;
  const expected = epShare + (fit.nextMatchPredicted - epShare) * 0.5;
  assert.ok(Math.abs(doubt.nextMatchPredicted - expected) < 0.11, `${doubt.nextMatchPredicted} vs ${expected}`);
});

test("points per game is scaled by the share of matches played", () => {
  // 6 team matches before the target gameweek; 3 appearances at 7 ppg.
  const rotated = predictionFor({ points_per_game: '7.0', total_points: 21 }).pred;
  assert.equal(rotated.breakdown.appearanceShare, 0.5);
  assert.equal(rotated.breakdown.ppg, 3.5);
});

test('a double gameweek counts in the XI and the 4-week average', () => {
  const { bootstrap, fixtures } = league();
  const target = bootstrap.events.find(e => new Date(e.deadline_time).getTime() > Date.now()).id;
  const kickoff = fixtures.find(f => f.event === target).kickoff_time;
  const extra = [{ id: 9999, event: target, team_h: 1, team_a: 3, team_h_difficulty: 3, team_a_difficulty: 3, kickoff_time: kickoff, finished: false }];
  const sdSingle = buildStaticDataFromRaw(bootstrap, fixtures);
  const el = bootstrap.elements.find(e => e.team === 1 && e.status === 'a' && e.element_type === 3);
  const id = el.id;
  // FPL's ep_next covers both matches of a double.
  el.ep_next = String(Number(el.ep_next) * 2);
  const sd = buildStaticDataFromRaw(bootstrap, [...fixtures, ...extra]);
  assert.ok(sd.predictionsById[id].isDoubleThisEvent);
  assert.ok(sd.predictionsById[id].predicted > sdSingle.predictionsById[id].predicted);
  assert.ok(sd.predictionsById[id].nextMatchPredicted > sd.predictionsById[id].predicted);
});

test("the XI is picked on this gameweek's figure", () => {
  const players = [
    { id: 1, positionId: 1 }, { id: 2, positionId: 1 },
    ...[3, 4, 5, 6, 7].map(id => ({ id, positionId: 2 })),
    ...[8, 9, 10, 11, 12].map(id => ({ id, positionId: 3 })),
    ...[13, 14, 15].map(id => ({ id, positionId: 4 })),
  ];
  const preds = Object.fromEntries(players.map(p => [p.id, { predicted: 4, nextMatchPredicted: 4 }]));
  preds[15] = { predicted: 5, nextMatchPredicted: 0 }; // blank this gameweek
  preds[7] = { predicted: 3, nextMatchPredicted: 8 }; // double this gameweek
  const xi = pickBestFormation(players, preds);
  assert.ok(!xi.has(15));
  assert.ok(xi.has(7));
});

test('the app stays on the gameweek being played until its matches are over', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  const ev = (id, daysFromNow, finished) => ({ id, deadline_time: new Date(now + daysFromNow * 864e5).toISOString(), finished });
  const events = [ev(6, -9, true), ev(7, -2, false), ev(8, 5, false)];
  assert.equal(getDefaultEvent(events, now).id, 7, 'GW7 deadline passed, matches still on');
  events[1].finished = true;
  assert.equal(getDefaultEvent(events, now).id, 8, 'GW7 over: on to GW8');
  assert.equal(getDefaultEvent([ev(1, 3, false), ev(2, 10, false)], now).id, 1, 'before the season');
});

test('a player who has lost his place is marked down, one who has won one is not marked up', () => {
  const base = { id: 1, positionId: 3, team: 1, epNext: 0, pointsPerGame: 6, appearanceShare: 1, form: 6, status: 'a', seasonMinutesShare: 0.9 };
  const fixtures = { 1: [{ event: 10, opponent: 2, isHome: true, difficulty: 3 }] };
  const opts = { targetEventId: 10 };
  const regular = computePlayerPrediction({ ...base, recentMinutesShare: 0.9 }, fixtures, true, null, opts);
  const benched = computePlayerPrediction({ ...base, recentMinutesShare: 0.3 }, fixtures, true, null, opts);
  const unknown = computePlayerPrediction({ ...base, recentMinutesShare: null }, fixtures, true, null, opts);
  const newStarter = computePlayerPrediction({ ...base, seasonMinutesShare: 0.4, recentMinutesShare: 1 }, fixtures, true, null, opts);
  assert.ok(benched.nextMatchPredicted < regular.nextMatchPredicted * 0.75);
  assert.equal(unknown.nextMatchPredicted, regular.nextMatchPredicted);
  assert.equal(newStarter.nextMatchPredicted, regular.nextMatchPredicted);
  assert.equal(benched.breakdown.minutesMult, 0.667);
});

test('recent minutes come from the gameweeks just before the target', () => {
  const el = (id, minutes) => ({ id, stats: { minutes } });
  const live = { 5: [el(1, 90)], 6: [el(1, 90)], 7: [el(1, 0)], 8: [el(1, 45), el(2, 90)], 9: [el(1, 90)] };
  assert.deepEqual(recentMinutesFromLive(live, 9), { 1: 225, 2: 90 });
});

test('bookmaker odds count once per priced match, and only in the weeks priced', () => {
  const base = { id: 1, positionId: 4, team: 1, epNext: 0, pointsPerGame: 4, appearanceShare: 1, form: 4, status: 'a' };
  const fixtures = { 1: [10, 11, 12, 13].map(event => ({ event, opponent: 2, isHome: true, difficulty: 3 })) };
  const opts = { targetEventId: 10 };
  const none = computePlayerPrediction({ ...base }, fixtures, true, null, opts);
  const thisWeek = computePlayerPrediction({ ...base, oddsByEvent: { 10: 0.4 } }, fixtures, true, null, opts);
  const twoWeeks = computePlayerPrediction({ ...base, oddsByEvent: { 10: 0.4, 11: 0.4 } }, fixtures, true, null, opts);
  assert.equal(Math.round((thisWeek.nextMatchPredicted - none.nextMatchPredicted) * 10) / 10, 0.4);
  // The 4-week average gets a quarter of one week's nudge, not all of it.
  assert.equal(Math.round((thisWeek.predicted - none.predicted) * 10) / 10, 0.1);
  assert.equal(Math.round((twoWeeks.predicted - none.predicted) * 10) / 10, 0.2);
  assert.equal(twoWeeks.nextMatchPredicted, thisWeek.nextMatchPredicted);
  // A double gameweek's two priced matches both count.
  const dgw = { 1: [{ event: 10, opponent: 2, isHome: true, difficulty: 3 }, { event: 10, opponent: 3, isHome: false, difficulty: 3 }] };
  const dgwNone = computePlayerPrediction({ ...base }, dgw, true, null, opts);
  const dgwOdds = computePlayerPrediction({ ...base, oddsByEvent: { 10: 0.4 } }, dgw, true, null, opts);
  assert.equal(Math.round((dgwOdds.nextMatchPredicted - dgwNone.nextMatchPredicted) * 10) / 10, 0.8);
});
