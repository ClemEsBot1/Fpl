import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecap, lastFinishedGw, missVerdict, mostOwnedXi, recapText } from '../src/lib/recap.js';

const player = (id, webName, positionId, price = 6) => ({ id, webName, positionId, team: 1, price });
const slot = (p, actualPoints, predicted, extra = {}) => ({ player: p, actualPoints, predicted, isStarting: true, multiplier: 1, ...extra });

const salah = player(1, 'Salah', 3, 14.5);
const haaland = player(2, 'Haaland', 4, 15);
const gabriel = player(3, 'Gabriel', 2, 6.3);
const saka = player(4, 'Saka', 3, 10);
const benchGk = player(5, 'Raya', 1, 5.5);

const squad = [
  slot(haaland, 13, 8.2, { isCaptain: true, multiplier: 2 }),
  slot(salah, 15, 7.1),
  slot(saka, 6, 6, { isViceCaptain: true }),
  slot(gabriel, 1, 5.3),
  slot(benchGk, 9, 3, { isStarting: false, multiplier: 0 }),
];

const base = {
  gwId: 19, gwName: 'Gameweek 19', teamName: 'Test XI', teamId: 77, squad,
  event: { id: 19, average_entry_score: 52, highest_score: 121 },
  entryHistory: { points: 48, rank: 412005, overall_rank: 862190, event_transfers_cost: 4 },
  history: { current: [
    { event: 15, points: 60, overall_rank: 1500000 },
    { event: 16, points: 40, overall_rank: 1400000 },
    { event: 17, points: 41, overall_rank: 1300000 },
    { event: 18, points: 44, overall_rank: 1204331 },
    { event: 19, points: 48, overall_rank: 862190 },
  ] },
  totalPlayers: 10000000,
  liveById: {
    1: { totalPoints: 15, minutes: 90, goals: 2, assists: 1, bonus: 3 },
    2: { totalPoints: 13, minutes: 90, goals: 1, bonus: 2 },
    3: { totalPoints: 1, minutes: 63, conceded: 2 },
    10: { totalPoints: 9 }, 11: { totalPoints: 2 },
  },
  playersById: { 10: { webName: 'Mbeumo' }, 11: { webName: 'Bowen' } },
  transfers: [{ event: 19, element_in: 10, element_out: 11 }, { event: 12, element_in: 3, element_out: 4 }],
};

test('the recap is for the latest gameweek to finish', () => {
  assert.equal(lastFinishedGw([{ id: 1, finished: true }, { id: 2, finished: true }, { id: 3, finished: false }]), 2);
  assert.equal(lastFinishedGw([{ id: 1, finished: false }]), null);
});

test('the headline and rank compare the week with the average and the week before', () => {
  const r = buildRecap(base);
  assert.deepEqual({ ...r.headline, teams: undefined }, { points: 48, average: 52, highest: 121, vsAverage: -4, teams: undefined });
  assert.equal(r.headline.teams.you.total, 48);
  assert.deepEqual(r.headline.teams.you.rows.map(x => x.pos), ['DEF', 'MID', 'MID', 'FWD']);
  assert.equal(r.rank.before, 1204331);
  assert.equal(r.rank.move, 342141);
  assert.equal(r.rank.topPercent, 4.1);
  // 48 beats every week since GW15's 60.
  assert.equal(r.rank.bestSince, 15);
});

test('the captain slide says what the best player in the XI would have added', () => {
  const r = buildRecap(base);
  assert.equal(r.captain.name, 'Haaland');
  assert.equal(r.captain.points, 26);
  assert.equal(r.captain.best.name, 'Salah');
  assert.equal(r.captain.missed, 2);
  assert.deepEqual(r.captain.vice, { name: 'Saka', points: 6 });
  assert.deepEqual(r.captain.chips, ['1 goal', '2 bonus']);
});

test("the vice-captain's armband counts when the captain didn't play", () => {
  const s = [slot(haaland, 0, 8, { isCaptain: true, multiplier: 1 }), slot(saka, 6, 6, { isViceCaptain: true, multiplier: 2 }), slot(salah, 4, 5)];
  const r = buildRecap({ ...base, squad: s });
  assert.equal(r.captain.name, 'Saka');
  assert.equal(r.captain.viceTookOver, 'Haaland');
  assert.equal(r.captain.missed, 0);
});

test('star and flop leave out the bench and carry the prediction and price', () => {
  const { star, flop } = buildRecap(base).starFlop;
  assert.equal(star.name, 'Salah');
  assert.equal(star.predicted, 7.1);
  assert.equal(star.diff, 7.9);
  assert.equal(star.price, 14.5);
  assert.deepEqual(star.chips, ['2 goals', '1 assist', '3 bonus']);
  assert.equal(flop.name, 'Gabriel');
  assert.deepEqual(flop.chips, ['63 minutes', '2 conceded']);
});

test("transfers count only the gameweek's, less the hit", () => {
  const t = buildRecap(base).transfers;
  assert.equal(t.moves.length, 1);
  assert.deepEqual(t.moves[0].in, { id: 10, name: 'Mbeumo', points: 9, price: null, next: [] });
  assert.deepEqual(t.moves[0].out, { id: 11, name: 'Bowen', points: 2, price: null });
  assert.equal(t.net, 3);
});

test('the mini-league slide finds the week winner and the closest rival', () => {
  const league = { name: 'Office', members: [
    { entry: 1, teamName: 'Sam', rank: 1, lastRank: 1, total: 1124, eventTotal: 58 },
    { entry: 77, teamName: 'Test XI', rank: 2, lastRank: 5, total: 1109, eventTotal: 74 },
    { entry: 3, teamName: 'Jo FC', rank: 3, lastRank: 2, total: 1102, eventTotal: 41 },
    { entry: 4, teamName: 'Al', rank: 4, lastRank: 3, total: 1000, eventTotal: 30 },
  ] };
  const l = buildRecap({ ...base, league }).league;
  assert.equal(l.was, 5);
  assert.equal(l.now, 2);
  assert.deepEqual(l.winners, ['You']);
  assert.equal(l.gapToFirst, 15);
  assert.deepEqual(l.rival, { teamName: 'Jo FC', margin: 33, totalGap: 7 });
  assert.deepEqual(l.riser, { teamName: 'You', move: 3 });
  assert.deepEqual(l.table.map(r => r.move), [0, 3, -1, -1]);
  assert.deepEqual(l.rows.map(r => r.rank), [1, 2, 3]);
  assert.equal(buildRecap({ ...base, league: { ...league, members: league.members.filter(m => m.entry !== 77) } }).league, null);
});

test('you against the model is a share of the best possible XI', () => {
  const v = buildRecap({ ...base, modelScore: 68, bestScore: 120 }).vsModel;
  assert.deepEqual({ ...v, teams: undefined }, { you: 48, model: 68, best: 120, percent: 40, teams: undefined });
  assert.equal(v.teams.model, null);
  assert.equal(buildRecap(base).vsModel, null);
});

test('the prediction check sorts players by how far they beat their prediction', () => {
  const p = buildRecap(base).predictions;
  assert.deepEqual(p.rows.map(r => r.name), ['Salah', 'Haaland', 'Saka', 'Gabriel']);
  assert.equal(p.predictedTotal, 34.8);
  assert.equal(p.actualTotal, 48);
  assert.equal(p.beat.name, 'Salah');
  assert.equal(p.miss.name, 'Gabriel');
});

test('the most-owned XI keeps a legal formation and doubles the most captained', () => {
  const pl = (id, positionId, selectedBy) => ({ id, webName: `P${id}`, positionId, selectedBy });
  const all = [pl(1, 1, 40), pl(2, 1, 30), ...[3, 4, 5, 6, 7, 8].map(i => pl(i, 2, 60 - i)), ...[9, 10, 11, 12, 13].map(i => pl(i, 3, 80 - i)), pl(14, 4, 90), pl(15, 4, 5), pl(16, 4, 4)];
  const live = Object.fromEntries(all.map(p => [p.id, { totalPoints: 2 }]));
  const xi = mostOwnedXi(all, live, 14);
  assert.equal(xi.rows.length, 11);
  assert.deepEqual(xi.rows.map(r => r.pos).filter(p => p === 'GKP'), ['GKP']);
  assert.ok(xi.rows.filter(r => r.pos === 'DEF').length >= 3);
  assert.equal(xi.rows.find(r => r.isCaptain).id, 14);
  assert.equal(xi.total, 24);
});

test("the highest scorer's team and the season's transfers come through", () => {
  const top = { name: "Kev's Krew", picks: { picks: [{ element: 1, multiplier: 2 }, { element: 3, multiplier: 1 }, { element: 2, multiplier: 0 }], entry_history: { event_transfers_cost: 4 } } };
  const playersById = { ...base.playersById, 1: salah, 2: haaland, 3: gabriel };
  const history = { current: [...base.history.current.map(r => ({ ...r, event_transfers: 1, event_transfers_cost: r.event === 16 ? 4 : 0 }))] };
  const r = buildRecap({ ...base, top, playersById, history, predictionsById: { 10: { predicted: 5 }, 11: { predicted: 4 } } });
  assert.equal(r.headline.teams.top.name, "Kev's Krew");
  assert.equal(r.headline.teams.top.total, 27);
  assert.equal(r.transfers.seasonTransfers, 5);
  assert.deepEqual(r.transfers.seasonHits, { count: 1, points: 4 });
  assert.equal(r.transfers.nextIn, 15);
  assert.equal(r.transfers.nextOut, 12);
  assert.deepEqual(r.rank.series.map(x => x.event), [15, 16, 17, 18, 19]);
});

test('captain options list every counted player as captain, best first', () => {
  const c = buildRecap(base).captain;
  assert.deepEqual(c.options.map(o => [o.name, o.points, o.isYours]), [['Salah', 30, false], ['Haaland', 26, true], ['Saka', 12, false], ['Gabriel', 2, false]]);
});

test('the recap reads as a few lines of text', () => {
  const text = recapText(buildRecap(base));
  assert.equal(text.split('\n')[0], 'Test XI, Gameweek 19: 48 pts (−4 vs avg)');
  assert.match(text, /C Haaland 26 · Star Salah 15/);
});

test("each player's miss is judged against how far off every player was", () => {
  const accuracy = { meanAbsError: 2, topTenAverageActual: 6, averageActual: 3, missP50: 1.5, missP80: 3, missP90: 4.5 };
  const p = buildRecap({ ...base, accuracy }).predictions;
  // Salah +7.9, Haaland +4.8, Saka 0, Gabriel −4.3.
  assert.deepEqual(p.rows.map(r => r.verdict), ['way-off', 'way-off', 'close', 'off']);
  assert.equal(p.withinUsual, 1);
  assert.equal(p.judged, 4);
  assert.deepEqual(p.wayOff, ['Salah', 'Haaland']);
  // (7.9 + 4.8 + 0 + 4.3) / 4 = 4.25 against 2 for everyone.
  assert.equal(p.missCompared, 'much-bigger');
  assert.equal(missVerdict(-5, 0, p.range), 'dnp');
  assert.equal(buildRecap(base).predictions.range, null);
});
