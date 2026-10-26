import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedPositions, forEachLimited, leagueHighlights, livePointsFor, memberWeekStats, liveLeagueRank, membersAtGw, parseStandings, predictedXiTotal, privateLeagues } from '../src/lib/leagues.js';

test("a team's mini-leagues leave out FPL's own leagues", () => {
  const entry = { leagues: { classic: [
    { id: 314, name: 'Overall', league_type: 's', entry_rank: 900000 },
    { id: 1234, name: 'Work league', league_type: 'x', entry_rank: 3 },
  ] } };
  assert.deepEqual(privateLeagues(entry), [{ id: 1234, name: 'Work league', rank: 3 }]);
  assert.deepEqual(privateLeagues(null), []);
});

test('standings are read from FPL\'s league page', () => {
  const json = {
    league: { id: 1234, name: 'Work league' },
    standings: { has_next: false, results: [{ entry: 7, entry_name: 'Sam XI', player_name: 'Sam Lee', rank: 1, last_rank: 2, total: 400, event_total: 61 }] },
  };
  assert.deepEqual(parseStandings(json), {
    league: { id: 1234, name: 'Work league' }, hasMore: false,
    members: [{ entry: 7, teamName: 'Sam XI', managerName: 'Sam Lee', rank: 1, lastRank: 2, total: 400, eventTotal: 61 }],
  });
  assert.equal(parseStandings({ detail: 'Not found.' }), null);
});

test('predicted points count the XI with the captain doubled', () => {
  const squad = [
    { isStarting: true, isCaptain: true, predicted: 5, multiplier: 2 },
    { isStarting: true, predicted: 3, multiplier: 1 },
    { isStarting: false, predicted: 9, multiplier: 0 },
  ];
  assert.equal(predictedXiTotal(squad), 13);
  // The captain didn't play and FPL passed the armband to the vice: the
  // prediction still doubles the captain picked.
  const passed = [
    { isStarting: true, isCaptain: true, predicted: 5, multiplier: 0 },
    { isStarting: true, isViceCaptain: true, predicted: 3, multiplier: 2 },
  ];
  assert.equal(predictedXiTotal(passed), 13);
});

test('team loads run a few at a time and report every result', async () => {
  let running = 0, peak = 0;
  const seen = [];
  await forEachLimited([1, 2, 3, 4, 5], 2, async n => {
    running++; peak = Math.max(peak, running);
    await new Promise(r => setTimeout(r, 5));
    running--;
    if (n === 3) throw new Error('nope');
    return n * 10;
  }, (n, value, error) => seen.push([n, value, error ? error.message : null]));
  assert.equal(peak, 2);
  assert.deepEqual(seen.sort((a, b) => a[0] - b[0]), [[1, 10, null], [2, 20, null], [3, null, 'nope'], [4, 40, null], [5, 50, null]]);
});

test('live points count multipliers and leave the hit to the season total', () => {
  const picks = { picks: [{ element: 1, multiplier: 2 }, { element: 2, multiplier: 1 }, { element: 3, multiplier: 0 }], entry_history: { event_transfers_cost: 4 } };
  const live = { 1: { totalPoints: 10 }, 2: { totalPoints: 3 }, 3: { totalPoints: 15 } };
  assert.equal(livePointsFor(picks, live), 23);
  assert.equal(livePointsFor(null, live), null);
});

test('expected positions add predicted points to totals with live points', () => {
  const members = [
    { entry: 1, rank: 1, total: 500, eventTotal: 40 },
    { entry: 2, rank: 2, total: 495, eventTotal: 30 },
    { entry: 3, rank: 3, total: 480, eventTotal: 20 },
  ];
  const teams = {
    1: { status: 'ready', livePoints: 45, xiTotal: 50 }, // 460 + 45 + 50 = 555
    2: { status: 'ready', livePoints: 30, xiTotal: 70 }, // 465 + 30 + 70 = 565
    3: { status: 'loading' }, // 480 so far
  };
  const exp = expectedPositions(members, teams);
  assert.deepEqual([exp[2].position, exp[1].position, exp[3].position], [1, 2, 3]);
  assert.equal(exp[1].projected, 555);
  const tied = expectedPositions(members.slice(0, 2), { 1: { status: 'ready', xiTotal: 10 }, 2: { status: 'ready', xiTotal: 15 } });
  assert.equal(tied[1].position, 1);
  assert.equal(tied[2].position, 1, 'level on points share a position');
});

test("a member's week: captain, bench, transfers, value and best rank", () => {
  const live = { 1: { totalPoints: 12 }, 2: { totalPoints: 2 }, 3: { totalPoints: 7 }, 4: { totalPoints: 1 }, 9: { totalPoints: 5 } };
  const stats = memberWeekStats({
    gw: 8,
    picks: { picks: [{ element: 1, multiplier: 2, is_captain: true }, { element: 2, multiplier: 1 }, { element: 3, multiplier: 0 }], entry_history: { event_transfers_cost: 4, value: 1012 } },
    liveById: live,
    transfers: [{ event: 8, element_in: 2, element_out: 9 }, { event: 7, element_in: 4, element_out: 1 }],
    entry: { summary_overall_rank: 50000, last_deadline_total_transfers: 9 },
    history: { past: [{ rank: 12000 }, { rank: 300000 }] },
  });
  assert.deepEqual(stats, {
    playerIds: [1, 2, 3], captainId: 1, captainPoints: 12, benchPoints: 7,
    transfersIn: [2], transfersOut: [9], transferGain: 2 - 5 - 4,
    seasonTransfers: 9, teamValue: 101.2, bestRank: 12000,
  });
});

test('league highlights pick the leaders, sharing ties', () => {
  const members = [
    { entry: 1, teamName: 'A', rank: 1, lastRank: 3, eventTotal: 60 },
    { entry: 2, teamName: 'B', rank: 2, lastRank: 1, eventTotal: 40 },
    { entry: 3, teamName: 'C', rank: 3, lastRank: 2, eventTotal: 60 },
  ];
  const s = (o) => ({ status: 'ready', stats: { playerIds: [], transfersIn: [], transfersOut: [], ...o } });
  const teams = {
    1: s({ captainId: 10, captainPoints: 4, playerIds: [10, 11], seasonTransfers: 3 }),
    2: s({ captainId: 10, captainPoints: 14, playerIds: [10, 12], seasonTransfers: 8, transfersIn: [12] }),
    3: s({ captainId: 11, captainPoints: 4, playerIds: [10, 11], seasonTransfers: 3, transfersIn: [12] }),
  };
  const { managers, players } = leagueHighlights(members, teams);
  const byKey = Object.fromEntries([...managers, ...players].map(h => [h.key, h]));
  assert.deepEqual(byKey.motw.winners.map(w => w.name), ['A', 'C']);
  assert.equal(byKey.motw.value, 60);
  assert.deepEqual(byKey.rise.winners.map(w => w.name), ['A']);
  assert.equal(byKey.rise.value, 2);
  assert.deepEqual(byKey.fall.winners.map(w => w.name), ['B', 'C']);
  assert.deepEqual(byKey.leastTransfers.winners.map(w => w.name), ['A', 'C']);
  assert.deepEqual(byKey.bestCaptain.winners.map(w => w.name), ['B']);
  assert.deepEqual(byKey.captained.players, [10]);
  assert.equal(byKey.captained.count, 2);
  assert.deepEqual(byKey.owned.players, [10]);
  assert.equal(byKey.owned.count, 3);
  assert.deepEqual(byKey.in.players, [12]);
  assert.deepEqual(byKey.out.players, []);
  assert.equal(byKey.bestValue.value, null, 'nobody has a value yet');
});

test('a league as it stood after an earlier gameweek comes from each history', () => {
  const members = [
    { entry: 1, teamName: 'A', rank: 1, total: 300, eventTotal: 50 },
    { entry: 2, teamName: 'B', rank: 2, total: 290, eventTotal: 70 },
    { entry: 3, teamName: 'C', rank: 3, total: 280, eventTotal: 60 },
  ];
  const teams = {
    1: { status: 'ready', xiTotal: 40, history: [{ event: 4, points: 60, total: 200 }, { event: 5, points: 30, total: 230 }] },
    2: { status: 'ready', xiTotal: 50, history: [{ event: 4, points: 50, total: 190 }, { event: 5, points: 45, total: 235 }] },
    3: { status: 'loading' },
  };
  const at5 = membersAtGw(members, teams, 5);
  assert.deepEqual(at5.map(m => [m.entry, m.rank, m.lastRank, m.total, m.eventTotal]), [[1, 2, 1, 230, 30], [2, 1, 2, 235, 45], [3, null, null, null, null]]);
  // Had everyone scored their prediction in GW5: A 200 + 40, B 190 + 50.
  assert.deepEqual(expectedPositions(at5, teams, { beforeWeek: true }), { 1: { projected: 240, position: 1 }, 2: { projected: 240, position: 1 } });
  // A week still being played uses the live points.
  const live = membersAtGw(members, { ...teams, 1: { ...teams[1], livePoints: 70 } }, 5, { finished: false });
  assert.equal(live[0].total, 270);
  assert.equal(live[0].rank, 1);
  // A transfer hit comes off the total, not the week's points.
  const hit = membersAtGw(members, { ...teams, 1: { ...teams[1], livePoints: 70, liveHit: 4 } }, 5, { finished: false });
  assert.equal(hit[0].eventTotal, 70);
  assert.equal(hit[0].total, 266);
});

test('league ownership counts captains twice and the bench not at all', async () => {
  const { leagueOwnership, leagueDifferentials } = await import('../src/lib/leagues.js');
  const p = id => ({ id, webName: `P${id}` });
  const slot = (id, mult, pred = 5) => ({ player: p(id), multiplier: mult, isStarting: mult > 0, nextMatchPredicted: pred });
  const members = [
    { entry: 1, teamName: 'You', rank: 2, total: 100 },
    { entry: 2, teamName: 'Leader', rank: 1, total: 110 },
    { entry: 3, teamName: 'Third', rank: 3, total: 90 },
  ];
  const teams = {
    1: { status: 'ready', squad: [slot(10, 2), slot(11, 1), slot(12, 0)] },
    2: { status: 'ready', squad: [slot(10, 1), slot(13, 2, 6), slot(12, 1)] },
    3: { status: 'ready', squad: [slot(13, 2, 6), slot(11, 0), slot(12, 1)] },
  };
  const { counted, byId } = leagueOwnership(members, teams);
  assert.equal(counted, 3);
  assert.equal(byId[10], 1); // (2 + 1 + 0) / 3
  assert.equal(byId[13], 4 / 3);
  const d = leagueDifferentials(members, teams, 1);
  // Your captain 10 is your biggest edge; 13, captained by two others, the biggest threat.
  assert.equal(d.edges[0].player.id, 10);
  assert.equal(d.threats[0].player.id, 13);
  assert.equal(d.rival.teamName, 'Leader');
  assert.equal(d.rival.gap, 10);
  // Against the leader: 10 (+1 × 5), 11 (+1 × 5), 12 (−1 × 5), 13 (−2 × 6).
  assert.equal(d.rival.swing, 5 + 5 - 5 - 12);
  assert.equal(leagueDifferentials(members, { 1: teams[1] }, 1), null, 'nobody to compare with');
});

test('head-to-head splits shared and unique players and totals the edge', async () => {
  const { headToHead } = await import('../src/lib/leagues.js');
  const p = id => ({ id, webName: `P${id}`, positionId: 3, team: 1 });
  const slot = (id, { starting = true, captain = false, pred = 5 } = {}) => ({ player: p(id), isStarting: starting, isCaptain: captain, nextMatchPredicted: pred });
  const you = { xiTotal: 50, squad: [slot(1, { captain: true, pred: 8 }), slot(2), slot(3, { starting: false, pred: 2 })] };
  const rival = { xiTotal: 47, squad: [slot(1, { pred: 8 }), slot(4, { pred: 6, captain: true }), slot(5, { starting: false, pred: 1 })] };
  const h = headToHead(you, rival);
  assert.deepEqual(h.shared.map(s => s.player.id), [1]);
  assert.deepEqual(h.yourOnly.map(s => s.player.id), [2, 3]);
  assert.deepEqual(h.theirOnly.map(s => s.player.id), [4, 5]);
  assert.equal(h.yourCaptain.id, 1);
  assert.equal(h.theirCaptain.id, 4);
  // Starting-only edge: yours 2 (5) vs theirs 4 (6) = -1.
  assert.equal(h.edge, -1);
  assert.equal(h.yourXiTotal, 50);
  assert.equal(h.theirXiTotal, 47);
});

test('head-to-head needs both squads', async () => {
  const { headToHead } = await import('../src/lib/leagues.js');
  assert.equal(headToHead(null, { squad: [] }), null);
  assert.equal(headToHead({ squad: [] }, { squad: [] }), null);
});

test('a rival’s latest gameweek of transfers', async () => {
  const { latestTransfers } = await import('../src/lib/leagues.js');
  assert.equal(latestTransfers([]), null);
  assert.equal(latestTransfers(null), null);
  const list = [
    { event: 6, element_in: 1, element_out: 2 },
    { event: 8, element_in: 3, element_out: 4 },
    { event: 8, element_in: 5, element_out: 6 },
  ];
  assert.deepEqual(latestTransfers(list), { gw: 8, moves: [{ inId: 3, outId: 4 }, { inId: 5, outId: 6 }] });
});

test('your live place in a league counts every member’s live points, once all are in', () => {
  const team = (before, live, hit = 0) => ({ status: 'ready', livePoints: live, liveHit: hit, history: [{ event: 7, points: 50, total: before }, { event: 8, points: live, total: before + live }] });
  const standings = { hasMore: false, members: [{ entry: 1, rank: 1 }, { entry: 2, rank: 2 }, { entry: 3, rank: 3 }] };
  // You (3) started 20 behind but are 30 up on the week, less a 4 point hit.
  const teams = { 1: team(500, 40), 2: team(490, 30), 3: team(480, 70, 4) };
  assert.equal(liveLeagueRank(standings, teams, 8, '3'), 1);
  assert.equal(liveLeagueRank(standings, teams, 8, 2), 3);
  assert.equal(liveLeagueRank(standings, { ...teams, 2: { status: 'loading' } }, 8, 3), null);
  assert.equal(liveLeagueRank({ ...standings, hasMore: true }, teams, 8, 3), null);
  assert.equal(liveLeagueRank(standings, teams, null, 3), null);
});

test('head-to-head leagues: your leagues, the table, and a gameweek of matches with yours first', async () => {
  const { h2hLeagues, parseH2hStandings, parseH2hMatches } = await import('../src/lib/leagues.js');
  assert.deepEqual(h2hLeagues({ leagues: { h2h: [{ id: 3612, name: 'Discord H2H', entry_rank: 4 }] } }), [{ id: 3612, name: 'Discord H2H', rank: 4 }]);
  assert.deepEqual(h2hLeagues({}), []);
  const table = parseH2hStandings({ league: { id: 3612, name: 'Discord H2H' }, standings: { has_next: true, results: [
    { entry: 9, entry_name: 'Change Name', player_name: 'Ahmed W', rank: 1, last_rank: 2, matches_won: 8, matches_drawn: 0, matches_lost: 0, total: 24, points_for: 569 },
  ] } });
  assert.deepEqual(table.rows[0], { entry: 9, teamName: 'Change Name', managerName: 'Ahmed W', rank: 1, lastRank: 2, won: 8, drawn: 0, lost: 0, leaguePoints: 24, pointsFor: 569 });
  assert.equal(table.hasMore, true);
  const matches = parseH2hMatches({ results: [
    { id: 1, entry_1_entry: 5, entry_1_name: 'A', entry_1_player_name: 'a', entry_1_points: 40, entry_2_entry: 6, entry_2_name: 'B', entry_2_player_name: 'b', entry_2_points: 50, winner: 6, is_bye: false },
    { id: 2, entry_1_entry: 7, entry_1_name: 'You', entry_1_player_name: 'me', entry_1_points: 45, entry_2_entry: 8, entry_2_name: 'C', entry_2_player_name: 'c', entry_2_points: 45, winner: null, is_bye: false },
    { id: 3, entry_1_entry: 9, entry_1_name: 'D', entry_1_player_name: 'd', entry_1_points: 30, entry_2_entry: null, is_bye: true, winner: null },
  ] }, 7);
  assert.deepEqual(matches.map(m => [m.id, m.isYou, m.winner]), [[2, true, null], [1, false, 'away'], [3, false, null]]);
  assert.equal(matches[2].away, null, 'a bye');
});
