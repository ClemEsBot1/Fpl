// Squad rules and suggestions used by the screens: formations, captaincy,
// transfer suggestions, chip timing, squad scoring/export, and matching a
// screenshot's read names to real players for the review screen.
import { POSITION_LABELS, findTopMatches, similarity } from './format.js';
import { POSITION_ORDER, SQUAD_BUDGET, buildOptimalTeam } from './predictions.js';

export function suggestCaptain(starters) {
  if (!starters.length) return null;
  return [...starters].sort((a, b) => b.nextMatchPredicted - a.nextMatchPredicted)[0];
}

// All legal FPL starting formations: 1 GKP fixed + DEF/MID/FWD split summing
// to 10 outfield players, within the same bounds used by pickBestFormation
// (3-5 DEF, 2-5 MID, 1-3 FWD).
export function getValidFormations() {
  const list = [];
  for (let d = 3; d <= 5; d++) {
    for (let m = 2; m <= 5; m++) {
      const f = 10 - d - m;
      if (f < 1 || f > 3) continue;
      list.push({ key: `${d}-${m}-${f}`, d, m, f });
    }
  }
  return list;
}

// Given a 15-man squad and an explicit formation shape, picks the highest-
// predicted players at each position to fill it (used by the manual squad
// builder, where the formation is chosen by the person rather than solved
// for). Returns a Set of starting player ids.
export function pickFormationStarters(squad15, formation, predictionsById) {
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  squad15.forEach(p => byPos[p.positionId].push(p));
  POSITION_ORDER.forEach(pos => byPos[pos].sort((a, b) => predictionsById[b.id].predicted - predictionsById[a.id].predicted));
  const gk = byPos[1][0];
  const defs = byPos[2].slice(0, formation.d);
  const mids = byPos[3].slice(0, formation.m);
  const fwds = byPos[4].slice(0, formation.f);
  return new Set([gk, ...defs, ...mids, ...fwds].filter(Boolean).map(p => p.id));
}

// Swaps a single player out of an existing squad-slot array for a new one,
// carrying over the slot's starting/bench status but clearing captaincy on
// the replaced slot (a brand-new player shouldn't inherit an old armband).
export function swapPlayerInSquad(squad, outPlayerId, inPlayer, predictionsById) {
  const pred = predictionsById[inPlayer.id];
  return squad.map(s => {
    if (s.player.id !== outPlayerId) return s;
    return {
      ...s,
      player: inPlayer,
      predicted: pred.predicted,
      nextMatchPredicted: pred.nextMatchPredicted,
      availNote: pred.availNote,
      breakdown: pred.breakdown,
      isCaptain: false,
      isViceCaptain: false,
      multiplier: 1,
    };
  });
}

// If a swap removed the captain, promote the vice-captain (or, failing
// that, the highest-predicted starter) so the squad is never captain-less.
export function ensureCaptaincy(squad) {
  if (squad.some(s => s.isCaptain)) return squad;
  const vice = squad.find(s => s.isViceCaptain);
  const starters = squad.filter(s => s.isStarting);
  const promote = vice || suggestCaptain(starters);
  if (!promote) return squad;
  return squad.map(s => s.player.id === promote.player.id ? { ...s, isCaptain: true, multiplier: 2 } : s);
}

// buildOptimalTeam now lives in ./lib/predictions.js (imported above)

export const MAX_TRANSFER_SUGGESTIONS = 5;

export function suggestTransfers(squad, allPlayers, predictionsById, bankTenths) {
  const starters = squad.filter(s => s.isStarting);
  const isBad = (s) => !!s.availNote;
  const flagged = starters.filter(isBad);
  const sortedByPred = [...starters].sort((a, b) => a.predicted - b.predicted);
  const lowPerformers = sortedByPred.filter(s => !isBad(s)).slice(0, MAX_TRANSFER_SUGGESTIONS);

  const seen = new Set();
  const candidates = [];
  [...flagged, ...lowPerformers].forEach(s => {
    if (!seen.has(s.player.id)) { seen.add(s.player.id); candidates.push(s); }
  });

  const squadIds = new Set(squad.map(s => s.player.id));
  const teamCounts = {};
  squad.forEach(s => { teamCounts[s.player.team] = (teamCounts[s.player.team] || 0) + 1; });

  const suggestions = [];
  for (const out of candidates) {
    if (suggestions.length >= MAX_TRANSFER_SUGGESTIONS) break;
    const budget = out.player.price + bankTenths / 10;
    const pool = allPlayers.filter(p =>
      p.positionId === out.player.positionId &&
      !squadIds.has(p.id) &&
      p.price <= budget + 0.05 &&
      p.status === 'a' &&
      (teamCounts[p.team] || 0) < 3
    );
    pool.sort((a, b) => predictionsById[b.id].predicted - predictionsById[a.id].predicted);
    const top = pool[0];
    if (top) {
      const gain = predictionsById[top.id].predicted - out.predicted;
      if (gain > 0.3) {
        suggestions.push({
          out,
          inPlayer: top,
          inPredicted: predictionsById[top.id].predicted,
          gain: Math.round(gain * 10) / 10,
          costDelta: Math.round((top.price - out.player.price) * 10) / 10,
          reason: out.availNote || 'Below-average returns for the position',
        });
      }
    }
  }
  suggestions.sort((a, b) => b.gain - a.gain);
  return suggestions;
}

// Each read player is either a bare name string (older JSON shape) or
// { id, name, club, price_millions } from the screenshot reader, where
// `id` is the FPL player it already resolved the name to.
export function readPlayerEntry(entry) {
  if (typeof entry === 'string') return { id: null, name: entry, club: null, price: null };
  return {
    id: (entry && entry.id) || null,
    ambiguous: !!(entry && entry.ambiguous),
    name: (entry && entry.name) || '',
    club: (entry && entry.club) || null,
    price: entry && typeof entry.price_millions === 'number' ? entry.price_millions : null,
  };
}

export function matchExtractedSquad(extracted, playersByPosition, allPlayers, teamsById) {
  const slots = [];
  const posMap = { goalkeepers: 1, defenders: 2, midfielders: 3, forwards: 4 };
  function addSlot(entry, posId, candidates, isStarting) {
    const read = readPlayerEntry(entry);
    if (!read.name) return;
    let top = findTopMatches(read.name, candidates, 3, { club: read.club, price: read.price, teamsById });
    const resolved = read.id ? candidates.find(p => p.id === read.id) : null;
    // A name shared by several players (two "Gomes") keeps the reader's
    // guess but scores below the confidence bar, so the review screen
    // flags it and offers the alternatives.
    if (resolved) top = [{ player: resolved, score: read.ambiguous ? 0.7 : 1 }, ...top.filter(t => t.player.id !== resolved.id)].slice(0, 3);
    slots.push({
      extractedName: read.name, extractedClub: read.club, extractedPrice: read.price, posId, isStarting,
      top, matched: resolved || ((top[0] && top[0].score > 0.72) ? top[0].player : null),
      isCaptain: false, isViceCaptain: false,
    });
  }
  Object.entries(posMap).forEach(([key, posId]) => {
    (extracted.starting_xi && extracted.starting_xi[key] || []).forEach(entry => addSlot(entry, posId, playersByPosition[posId] || [], true));
  });
  (extracted.bench || []).forEach(entry => addSlot(entry, null, allPlayers, false));

  function markByName(name, field) {
    if (!name) return;
    let best = null, bestScore = 0;
    slots.forEach(s => {
      const score = similarity(name, s.extractedName);
      if (score > bestScore) { bestScore = score; best = s; }
    });
    if (best && bestScore > 0.5) best[field] = true;
  }
  markByName(extracted.captain, 'isCaptain');
  markByName(extracted.vice_captain, 'isViceCaptain');

  return slots;
}

// Only chips that actually change a gameweek's score are previewable here —
// Wildcard and Free Hit affect your transfers, not how this squad scores.
export const CHIP_INFO = {
  bboost: { label: 'Bench Boost', desc: 'All 15 squad players score this gameweek, not just your starting XI.' },
  '3xc': { label: 'Triple Captain', desc: "Your captain's points count 3x instead of 2x this gameweek." },
};

// suggestTransfers ranks candidates purely by predicted-points gain — it
// has no idea how many free transfers you actually have. A real transfer
// beyond your free one(s) costs -4 points off your gameweek total, so a
// "+0.5 pts" suggestion is a bad idea to actually make if it costs a hit,
// while the exact same suggestion is a no-brainer if it's free. This is a
// pure presentation-layer transform over suggestTransfers' output — it
// doesn't change what gets suggested, just whether each one is free or
// would cost a hit, and hides hit-costing swaps too marginal to be worth
// it (kept ones still show the true net gain, hit included, so the person
// sees an honest number either way).
export const TRANSFER_HIT_COST = 4;

export function applyFreeTransferEconomics(suggestions, freeTransfers) {
  const ft = Math.max(0, Number(freeTransfers) || 0);
  return suggestions
    .map((s, i) => {
      const isFree = i < ft;
      const hitCost = isFree ? 0 : TRANSFER_HIT_COST;
      return { ...s, isFree, hitCost, netGain: Math.round((s.gain - hitCost) * 10) / 10 };
    })
    // A free swap is always worth showing (even a marginal +0.1 pts costs
    // nothing to take). One that costs a hit needs to clear a real margin
    // above simply breaking even, or it's not worth the -4 for a coin-flip.
    .filter(s => s.isFree || s.netGain > 0.5);
}

// Squad Score: the optimal squad (best possible XI within budget) is defined
// as 100. Every other squad is scored relative to it — its predicted points
// as a percentage of the optimal squad's predicted points, capped at 100.
// Squads below optimal are penalised a bit more steeply than a straight
// percentage would: the shortfall below 100 is scaled up by PUNISH_FACTOR
// before being subtracted, so falling short of the optimal squad costs
// slightly more Squad Score than 1-for-1.
export const PUNISH_FACTOR = 1.15;

export function computeSquadScore(xiTotal, optimalXiTotal) {
  if (!optimalXiTotal || optimalXiTotal <= 0) return 0;
  const pct = (xiTotal / optimalXiTotal) * 100;
  const score = pct >= 100 ? pct : 100 - (100 - pct) * PUNISH_FACTOR;
  return Math.round(Math.max(0, Math.min(100, score)));
}

// Predicted points of the best possible squad within budget, used as the
// 100-point reference for every score. Computed once per session and cached.
export function computeOptimalXiTotal(staticData) {
  const { squad } = buildOptimalTeam(staticData, SQUAD_BUDGET);
  return squad.reduce((total, s) => total + (s.isStarting ? s.predicted * (s.multiplier || 1) : 0), 0);
}

// Scans upcoming fixtures (already loaded per-team, several gameweeks out) to
// estimate which future gameweek would be strongest for Triple Captain and
// for Bench Boost. For each candidate week we compute the *whole squad's*
// expected total for that week, not just a single player's points, so the
// numbers shown are directly comparable to a normal no-chip gameweek score:
//   - normalXi: starting XI only, best-available captain doubled (2x) —
//     this is what the week would score with no chip played.
//   - tripleXi: same, but the captain is tripled (3x) instead of doubled —
//     this is the expected total if Triple Captain were played that week.
//   - benchBoostXi: all 15 squad players score, captain still doubled —
//     this is the expected total if Bench Boost were played that week.
// This is an estimate based on currently scheduled fixtures — blank/double
// gameweeks not yet announced by FPL obviously can't be accounted for.
export function fixtureMultFor(diff) {
  return Math.max(0.8, Math.min(1.18, 1 + (3 - diff) * 0.075));
}

export function analyzeChipTiming(squad, fixturesByTeam, allEvents, predictionsById) {
  const gwSet = new Set();
  Object.values(fixturesByTeam).forEach(list => list.forEach(f => gwSet.add(f.event)));
  // Consider every scheduled gameweek for the rest of the season (FPL runs 38),
  // not just an early window — blank/double gameweeks can land anywhere.
  const gwIds = Array.from(gwSet).sort((a, b) => a - b).slice(0, 38);
  const eventsById = {};
  (allEvents || []).forEach(e => { eventsById[e.id] = e; });

  const weekStats = gwIds.map(gw => {
    let totalAll = 0;
    let startersTotal = 0;
    let bestCaptain = null;
    squad.forEach(s => {
      const fixtures = (fixturesByTeam[s.player.team] || []).filter(f => f.event === gw);
      if (!fixtures.length) return;
      // Use the fixture-difficulty-free base here, then apply this specific
      // gameweek's own fixture multiplier once. Using `s.predicted` instead
      // would double-apply fixture difficulty, since predicted already bakes
      // in a 4-fixture rolling average multiplier of its own.
      const baseAvail = predictionsById[s.player.id].baseAvail;
      let playerTotal = 0;
      fixtures.forEach(f => { playerTotal += baseAvail * fixtureMultFor(f.difficulty); });
      totalAll += playerTotal;
      if (s.isStarting) {
        startersTotal += playerTotal;
        if (!bestCaptain || playerTotal > bestCaptain.pts) {
          bestCaptain = { player: s.player, pts: playerTotal, fixtureCount: fixtures.length };
        }
      }
    });
    const capPts = bestCaptain ? bestCaptain.pts : 0;
    return {
      gw, gwName: eventsById[gw] ? eventsById[gw].name : `GW${gw}`,
      bestCaptain,
      normalXi: startersTotal + capPts,       // captain at 2x
      tripleXi: startersTotal + capPts * 2,   // captain at 3x
      benchBoostXi: totalAll + capPts,        // all 15 play, captain still at 2x
      hasFixtures: totalAll > 0,
    };
  }).filter(w => w.hasFixtures);

  if (weekStats.length === 0) return null;

  const bestBenchBoost = weekStats.reduce((best, w) => (!best || w.benchBoostXi > best.benchBoostXi) ? w : best, null);
  const bestTripleCaptain = weekStats.reduce((best, w) => (w.bestCaptain && (!best || w.tripleXi > best.tripleXi)) ? w : best, null);

  return { bestBenchBoost, bestTripleCaptain };
}

// Builds a clean, portable JSON snapshot of a squad for export (download or
// clipboard) — just the human-relevant facts (who, what position, price,
// predicted points, starting/bench, captaincy), not the internal slot
// objects React uses to render, which carry a lot that wouldn't mean
// anything outside this app.
export function buildSquadExportPayload(data) {
  const { squad, entryMeta, bankTenths, isOptimalBuild, isPastGw, gwId, targetEvent, teamsById, builtAt } = data;
  return {
    exportedAt: new Date().toISOString(),
    source: isOptimalBuild ? 'optimal-squad' : 'my-squad',
    teamName: (entryMeta && entryMeta.teamName) || null,
    gameweek: isPastGw ? gwId : (targetEvent ? targetEvent.id : gwId),
    builtAt: builtAt || null,
    bank: bankTenths !== null && bankTenths !== undefined ? +(bankTenths / 10).toFixed(1) : null,
    players: squad.map(s => ({
      name: s.player.webName,
      position: POSITION_LABELS[s.player.positionId],
      team: (teamsById && teamsById[s.player.team] && teamsById[s.player.team].name) || null,
      price: s.player.price,
      predictedPoints: s.nextMatchPredicted,
      starting: s.isStarting,
      captain: s.isCaptain,
      viceCaptain: s.isViceCaptain,
    })),
  };
}
