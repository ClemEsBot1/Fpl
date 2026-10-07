import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFreeTransferEconomics, ensureCaptaincy, matchExtractedSquad, squadProblems, substitutePlayers, substitutionOptions, suggestTransfers, swapPlayerInSquad } from '../src/lib/squadLogic.js';
import { normalize, playerMatchesSearch, levenshtein } from '../src/lib/format.js';

// A legal 15: 2 GKP, 5 DEF, 5 MID, 3 FWD, each at a different club.
const POSITIONS = [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4];
function players(overrides = {}) {
  return POSITIONS.map((positionId, i) => ({
    id: i + 1, webName: `Player${i + 1}`, firstName: 'A', secondName: `Player${i + 1}`,
    positionId, team: i + 1, price: 5, status: 'a', ...(overrides[i + 1] || {}),
  }));
}
// First GKP, 4 DEF, 4 MID and 2 FWD start (4-4-2).
const STARTER_IDS = new Set([1, 3, 4, 5, 6, 8, 9, 10, 11, 13, 14]);

function slot(player, extra = {}) {
  return { player, predicted: 5, nextMatchPredicted: 5, availNote: null, isStarting: STARTER_IDS.has(player.id), isCaptain: false, isViceCaptain: false, multiplier: STARTER_IDS.has(player.id) ? 1 : 0, ...extra };
}

test('a legal squad has no problems', () => {
  const ps = players();
  assert.deepEqual(squadProblems(ps, ps.filter(p => STARTER_IDS.has(p.id))), []);
});

test('squad problems: duplicates, club limit, too many starters, two keepers', () => {
  const ps = players();
  const twice = [...ps.slice(0, 14), ps[2]];
  assert.match(squadProblems(twice, []).join(' '), /twice/);

  const fourFromOneClub = players({ 2: { team: 1 }, 3: { team: 1 }, 4: { team: 1 } });
  assert.match(squadProblems(fourFromOneClub, []).join(' '), /More than 3 players from one club/);

  const twelve = ps.filter(p => STARTER_IDS.has(p.id) || p.id === 7);
  assert.match(squadProblems(ps, twelve).join(' '), /12 players in the starting XI/);

  const ten = ps.filter(p => STARTER_IDS.has(p.id) && p.id !== 11);
  assert.match(squadProblems(ps, ten).join(' '), /Only 10 players in the starting XI — move 1 from the bench/);
  assert.deepEqual(squadProblems(ps.slice(0, 9), ps.slice(0, 9).filter(p => STARTER_IDS.has(p.id))), [], 'a partly read squad is judged on what was read');

  const twoKeepers = ps.filter(p => STARTER_IDS.has(p.id) && p.id !== 14).concat(ps[1]);
  assert.match(squadProblems(ps, twoKeepers).join(' '), /Only one goalkeeper/);

  const noForward = ps.filter(p => STARTER_IDS.has(p.id) && p.positionId !== 4).concat(ps[6], ps[11]);
  assert.match(squadProblems(ps, noForward).join(' '), /1 FWD/);
});

test('transfer suggestions share one bank and never suggest the same player twice', () => {
  const ps = players();
  const squad = ps.map(p => slot(p, { predicted: [8, 9].includes(p.id) ? 1 : 6 }));
  const star = { id: 100, webName: 'Star', positionId: 3, team: 30, price: 6, status: 'a' };
  const solid = { id: 101, webName: 'Solid', positionId: 3, team: 31, price: 5, status: 'a' };
  const predictionsById = Object.fromEntries([...ps, star, solid].map(p => [p.id, { predicted: p === star ? 8 : p === solid ? 4 : 1 }]));

  // £1.0m in the bank pays for one £1.0m upgrade, not two.
  const suggestions = suggestTransfers(squad, [...ps, star, solid], predictionsById, 10);
  assert.deepEqual(suggestions.map(s => s.inPlayer.id).sort(), [100, 101]);
  const spent = suggestions.reduce((sum, s) => sum + s.costDelta, 0);
  assert.ok(spent <= 1 + 1e-9, `suggestions spend £${spent}m from a £1.0m bank`);
});

test('transfer suggestions respect the club limit after the player leaves', () => {
  // Two players already from club 30, plus the outgoing player from club 30
  // too: selling them makes room for one more from that club.
  const ps = players({ 8: { team: 30 }, 2: { team: 30 }, 7: { team: 30 } });
  const squad = ps.map(p => slot(p, { predicted: p.id === 8 ? 1 : 6 }));
  const sameClub = { id: 100, webName: 'Same', positionId: 3, team: 30, price: 5, status: 'a' };
  const predictionsById = Object.fromEntries([...ps, sameClub].map(p => [p.id, { predicted: p === sameClub ? 8 : 1 }]));
  const [first] = suggestTransfers(squad, [...ps, sameClub], predictionsById, 0);
  assert.equal(first.out.player.id, 8);
  assert.equal(first.inPlayer.id, 100);
});

test("a bench player is only replaced if the new one would start", () => {
  const ps = players();
  const squad = ps.map(p => slot(p));
  // Player 7 (a benched DEF) is injured; every other player predicts 5.
  const predictionsById = Object.fromEntries(ps.map(p => [p.id, { predicted: p.id === 7 ? 0 : 5 }]));
  const okDef = { id: 100, webName: 'OkDef', positionId: 2, team: 30, price: 5, status: 'a' };
  const greatDef = { id: 101, webName: 'GreatDef', positionId: 2, team: 31, price: 5, status: 'a' };
  predictionsById[100] = { predicted: 4 };
  predictionsById[101] = { predicted: 7 };
  assert.deepEqual(suggestTransfers(squad, [...ps, okDef], predictionsById, 0), [], "a 4-pt defender wouldn't make the XI");
  const [first] = suggestTransfers(squad, [...ps, greatDef], predictionsById, 0);
  assert.equal(first.inPlayer.id, 101);
  assert.equal(first.gain, 2); // replaces a 5-pt starter in the XI
});

test('a downgrade that pays for an upgrade is suggested as a pair, cheaper move first', () => {
  const ps = players({ 15: { price: 6 } });
  const squad = ps.map(p => slot(p));
  const predictionsById = Object.fromEntries(ps.map(p => [p.id, { predicted: 5 }]));
  predictionsById[15] = { predicted: 1 }; // bench FWD, £6.0m
  const cheapFwd = { id: 100, webName: 'CheapFwd', positionId: 4, team: 30, price: 4, status: 'a' };
  const starMid = { id: 101, webName: 'StarMid', positionId: 3, team: 31, price: 7, status: 'a' };
  predictionsById[100] = { predicted: 1 };
  predictionsById[101] = { predicted: 9 };
  const suggestions = suggestTransfers(squad, [...ps, cheapFwd, starMid], predictionsById, 0);
  assert.deepEqual(suggestions.map(s => s.inPlayer.id), [100, 101]);
  assert.equal(suggestions[0].group, suggestions[1].group);
  assert.match(suggestions[0].reason, /Frees £2.0m for StarMid/);
});

test('transfers are judged over 4 gameweeks, and a free one must beat rolling it', () => {
  const s = gain => ({ gain });
  // +1.5/wk is +6 over 4 gameweeks: worth a -4 hit.
  assert.equal(applyFreeTransferEconomics([s(1.5)], 0).length, 1);
  assert.equal(applyFreeTransferEconomics([s(1.5)], 0)[0].netGain, 2);
  // +1.0/wk is +4: not a clear win over the hit.
  assert.equal(applyFreeTransferEconomics([s(1.0)], 0).length, 0);
  // +0.3/wk with a free transfer is +1.2: rolling the transfer is better.
  assert.equal(applyFreeTransferEconomics([s(0.3)], 1).length, 0);
  assert.equal(applyFreeTransferEconomics([s(0.5)], 1).length, 1);
  // A pair is kept or dropped together.
  const pair = [{ gain: -0.2, group: 0 }, { gain: 2, group: 0 }];
  assert.equal(applyFreeTransferEconomics(pair, 2).length, 2);
  assert.equal(applyFreeTransferEconomics(pair, 0).length, 0);
});

test('a swapped-in player inherits no armband or old points', () => {
  const ps = players();
  const squad = ps.map(p => slot(p, p.id === 3 ? { isCaptain: true, multiplier: 2, actualPoints: 12, played: true } : {}));
  const incoming = { id: 200, webName: 'New', positionId: 2, team: 40, price: 5, status: 'a' };
  const swapped = swapPlayerInSquad(squad, 3, incoming, { 200: { predicted: 4, nextMatchPredicted: 4 } });
  const slotIn = swapped.find(s => s.player.id === 200);
  assert.equal(slotIn.isCaptain, false);
  assert.equal(slotIn.multiplier, 1);
  assert.ok(!('actualPoints' in slotIn) && !('played' in slotIn));
});

test('a captain on the bench hands the armband to the starting vice', () => {
  const ps = players();
  const squad = ps.map(p => slot(p, p.id === 7 ? { isCaptain: true } : p.id === 13 ? { isViceCaptain: true } : {}));
  const fixed = ensureCaptaincy(squad, 3);
  const captain = fixed.find(s => s.isCaptain);
  assert.equal(captain.player.id, 13);
  assert.equal(captain.multiplier, 3, 'Triple Captain keeps its armband value');
  assert.equal(captain.isViceCaptain, false);
  assert.equal(fixed.find(s => s.player.id === 7).multiplier, 0);
});

test('screenshot armbands go to the player the reader saw, never a bench player', () => {
  const ps = players({ 8: { webName: 'Gomes', secondName: 'Gomes' }, 9: { webName: 'Gomes', secondName: 'Gomes' }, 7: { webName: 'Haaland', secondName: 'Haaland' } });
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  ps.forEach(p => byPos[p.positionId].push(p));
  const entry = p => ({ id: p.id, name: p.webName });
  const starters = ps.filter(p => STARTER_IDS.has(p.id));
  const extracted = {
    starting_xi: {
      goalkeepers: starters.filter(p => p.positionId === 1).map(entry),
      defenders: starters.filter(p => p.positionId === 2).map(entry),
      midfielders: starters.filter(p => p.positionId === 3).map(entry),
      forwards: starters.filter(p => p.positionId === 4).map(entry),
    },
    bench: ps.filter(p => !STARTER_IDS.has(p.id)).map(entry),
    captain: 'Gomes', captain_id: 9,
    vice_captain: 'Haaland', vice_captain_id: 7, // read on a bench player
  };
  const slots = matchExtractedSquad(extracted, byPos, ps, {});
  assert.deepEqual(slots.filter(s => s.isCaptain).map(s => s.matched.id), [9], 'the second Gomes, not the first');
  assert.deepEqual(slots.filter(s => s.isViceCaptain), []);

  // Older readings only have names: a shared name can't be both armbands.
  const byName = matchExtractedSquad({ ...extracted, captain_id: null, vice_captain_id: null, vice_captain: 'Gomes' }, byPos, ps, {});
  assert.equal(byName.filter(s => s.isCaptain).length, 1);
  assert.ok(!byName.some(s => s.isCaptain && s.isViceCaptain));
});

test('names are compared without accents, special letters or spacing', () => {
  assert.equal(normalize('Ødegaard'), 'odegaard');
  assert.equal(normalize('Groß'), 'gross');
  assert.equal(normalize('Muñoz'), 'munoz');
  const taa = { webName: 'Alexander-Arnold', secondName: 'Alexander-Arnold', firstName: 'Trent' };
  assert.ok(playerMatchesSearch(taa, 'alexander arnold'));
  assert.ok(playerMatchesSearch({ webName: 'Ødegaard', secondName: 'Ødegaard', firstName: 'Martin' }, 'odeg'));
  assert.ok(!playerMatchesSearch(taa, 'saka'));
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('', 'abc'), 3);
});

test('substitutes keep the formation legal', () => {
  // 4-4-2: bench is GKP 2, DEF 7, MID 12, FWD 15.
  const squad = players().map(p => slot(p));
  const forStarterDef = substitutionOptions(squad, squad.find(s => s.player.id === 3)).map(s => s.player.id);
  // A defender can go off for a defender, midfielder or forward (4-4-2 to
  // 3-5-2 or 3-4-3), never the keeper.
  assert.deepEqual(forStarterDef.sort((a, b) => a - b), [7, 12, 15]);
  const forBenchKeeper = substitutionOptions(squad, squad.find(s => s.player.id === 2)).map(s => s.player.id);
  assert.deepEqual(forBenchKeeper, [1]);
});

test('a benched captain hands the armband on', () => {
  const squad = players().map(p => slot(p, {
    isCaptain: p.id === 13, isViceCaptain: p.id === 8, multiplier: p.id === 13 ? 2 : STARTER_IDS.has(p.id) ? 1 : 0,
  }));
  const next = substitutePlayers(squad, 13, 15);
  const byId = id => next.find(s => s.player.id === id);
  assert.equal(byId(13).isStarting, false);
  assert.equal(byId(13).isCaptain, false);
  assert.equal(byId(13).multiplier, 0);
  assert.equal(byId(15).isStarting, true);
  assert.equal(byId(15).multiplier, 1);
  assert.equal(byId(8).isCaptain, true, 'the vice-captain takes over');
  assert.equal(byId(8).multiplier, 2);
});
