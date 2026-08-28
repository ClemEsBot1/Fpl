/* ============================================================================
   SHARED PREDICTION / OPTIMAL-SQUAD LOGIC

   Pure functions only — no fetch, no DOM, no React. This file is imported
   from two places that must never disagree with each other:
     - src/App.jsx (runs in the browser)
     - api/refresh-optimal.js (runs server-side, on a schedule)
   If you tune the prediction formula or the squad-building heuristic, you
   only need to change it here.
============================================================================ */

export const POSITION_ORDER = [1, 2, 3, 4];
export const SQUAD_SLOTS = { 1: 2, 2: 5, 3: 5, 4: 3 }; // required count per position in a full 15-man squad
export const MAX_PER_REAL_TEAM = 3;
export const SQUAD_BUDGET = 100.0; // £100.0m

/* ----------------------------------------------------------------------------
   PREDICTION ENGINE
---------------------------------------------------------------------------- */

export function computePlayerPrediction(p, fixturesByTeam, formEligible) {
  const epNext = p.epNext || 0;
  const ppg = p.pointsPerGame || 0;
  const form = p.form || 0;

  let base;
  if (formEligible && form > 0) {
    base = 0.45 * epNext + 0.35 * ppg + 0.20 * form;
  } else {
    // Early season (before GW5): points_per_game suffers the exact same
    // small-sample problem as form — after one gameweek it's literally just
    // that gameweek's score (a single big haul reads as an 11.0 ppg that's
    // nowhere near sustainable). Lean on FPL's own next-gameweek model
    // instead, which already accounts for this rather than getting fooled
    // by it — e.g. a defender who scored 11 points in GW1 still shows a
    // sober ep_next around 2.5, not an inflated one.
    base = epNext;
  }

  function fixtureMultFor(diff) {
    return Math.max(0.8, Math.min(1.18, 1 + (3 - diff) * 0.075));
  }

  const fixtures = fixturesByTeam[p.team] || [];
  const upcoming = fixtures.slice(0, 4);
  let fixtureMult = 1;
  if (upcoming.length) {
    const avgDiff = upcoming.reduce((s, f) => s + f.difficulty, 0) / upcoming.length;
    fixtureMult = fixtureMultFor(avgDiff);
  }

  // Captaincy is a free pick every gameweek, so only the very next fixture's
  // difficulty is relevant there — not the 4-game rolling average used above
  // for the general "predicted" figure (which suits squad/transfer decisions,
  // since you're stuck with those players over several weeks).
  const nextFixtureMult = upcoming.length ? fixtureMultFor(upcoming[0].difficulty) : 1;

  let availMult = 1;
  let availNote = null;
  if (p.status === 'i') { availMult = 0.05; availNote = 'Injured'; }
  else if (p.status === 's') { availMult = 0.05; availNote = 'Suspended'; }
  else if (p.status === 'u' || p.status === 'n') { availMult = 0; availNote = 'Unavailable'; }
  else if (typeof p.chanceNext === 'number' && p.chanceNext !== null) {
    availMult = p.chanceNext / 100;
    if (p.chanceNext <= 75) availNote = `${p.chanceNext}% chance of playing`;
  } else if (p.status === 'd') {
    availMult = 0.7; availNote = 'Doubtful';
  }

  const predicted = Math.max(0, base * fixtureMult * availMult);
  const nextMatchPredicted = Math.max(0, base * nextFixtureMult * availMult);
  const baseAvail = Math.max(0, base * availMult);
  return {
    predicted: Math.round(predicted * 10) / 10,
    nextMatchPredicted: Math.round(nextMatchPredicted * 10) / 10,
    baseAvail,
    availNote,
    fixtureMult,
    upcomingFixtures: upcoming,
  };
}

/* ----------------------------------------------------------------------------
   RAW FPL JSON -> NORMALISED STATIC DATA
   Pure transform: takes the two raw bootstrap-static / fixtures payloads
   (however they were fetched — via the browser's /api/fpl proxy, or a direct
   server-side fetch) and returns the same shape both callers rely on.
---------------------------------------------------------------------------- */

/* ----------------------------------------------------------------------------
   TARGET GAMEWEEK
   The gameweek the app should be planning for: the earliest one whose
   transfer deadline hasn't passed yet. FPL's own `is_current` flag doesn't
   suit this — it stays true for a gameweek for as long as its matches are
   being played, which can be days after that gameweek's own deadline has
   passed and the next gameweek is the one you can actually still act on.
   Everything gameweek-dependent (optimal squad, predictions, transfer
   suggestions, the gameweek picker) should derive from this one function,
   so the whole app switches over together the instant a deadline passes.
---------------------------------------------------------------------------- */

export function getTargetEvent(events, now = Date.now()) {
  const upcoming = events
    .filter(e => new Date(e.deadline_time).getTime() > now)
    .sort((a, b) => a.id - b.id);
  if (upcoming.length) return upcoming[0];
  return events[events.length - 1]; // every deadline has passed — season's over, show the last gameweek
}

// A gameweek is "closed" once its deadline has passed: picks are locked in,
// so it's safe to browse as history and nothing about it should recompute.
export function isEventLocked(event, now = Date.now()) {
  return new Date(event.deadline_time).getTime() <= now;
}

export function buildStaticDataFromRaw(bootstrap, fixturesRaw, options = {}) {
  const teamsById = {};
  bootstrap.teams.forEach(t => { teamsById[t.id] = t; });

  const targetEvent = options.forceGwId
    ? (bootstrap.events.find(e => e.id === options.forceGwId) || getTargetEvent(bootstrap.events))
    : getTargetEvent(bootstrap.events);
  // FPL's "form" is a trailing-30-day average. At roughly a gameweek a week,
  // GW1-4 cover under 30 days of actual season data, so form is either empty
  // or still mostly noise until GW5 — don't let it influence predictions
  // before then.
  const formEligible = targetEvent.id >= 5;

  const fixturesByTeam = {};
  bootstrap.teams.forEach(t => { fixturesByTeam[t.id] = []; });
  fixturesRaw
    .filter(f => f.event !== null && f.event !== undefined && f.event >= (targetEvent ? targetEvent.id : 1))
    .sort((a, b) => a.event - b.event)
    .forEach(f => {
      if (fixturesByTeam[f.team_h]) {
        fixturesByTeam[f.team_h].push({ event: f.event, opponent: f.team_a, isHome: true, difficulty: f.team_h_difficulty, kickoff: f.kickoff_time });
      }
      if (fixturesByTeam[f.team_a]) {
        fixturesByTeam[f.team_a].push({ event: f.event, opponent: f.team_h, isHome: false, difficulty: f.team_a_difficulty, kickoff: f.kickoff_time });
      }
    });

  const allPlayers = bootstrap.elements.map(e => ({
    id: e.id,
    webName: e.web_name,
    firstName: e.first_name,
    secondName: e.second_name,
    team: e.team,
    positionId: e.element_type,
    price: e.now_cost / 10,
    form: parseFloat(e.form) || 0,
    pointsPerGame: parseFloat(e.points_per_game) || 0,
    totalPoints: e.total_points,
    epNext: parseFloat(e.ep_next) || 0,
    status: e.status,
    chanceNext: e.chance_of_playing_next_round,
    news: e.news,
    selectedBy: parseFloat(e.selected_by_percent) || 0,
  }));

  const playersById = {};
  const playersByPosition = { 1: [], 2: [], 3: [], 4: [] };
  allPlayers.forEach(p => { playersById[p.id] = p; playersByPosition[p.positionId].push(p); });

  const predictionsById = {};
  allPlayers.forEach(p => { predictionsById[p.id] = computePlayerPrediction(p, fixturesByTeam, formEligible); });

  return { teamsById, allPlayers, playersById, playersByPosition, fixturesByTeam, targetEvent, allEvents: bootstrap.events, formEligible, predictionsById };
}

/* ----------------------------------------------------------------------------
   OPTIMAL SQUAD BUILDER
   Builds the strongest possible 15-man squad within budget: 2 GKP, 5 DEF,
   5 MID, 3 FWD, max 3 players from any one real club. This is a heuristic
   (start with the best XV regardless of price, then repeatedly downgrade
   whichever swap sheds the fewest predicted points per pound saved, until
   under budget) rather than a provably-optimal solver — in practice it lands
   very close to optimal and runs instantly.
---------------------------------------------------------------------------- */

export function buildOptimalSquad(allPlayers, predictionsById, budget, options = {}) {
  // Default eligibility excludes unavailable/injured/suspended/not-in-squad
  // players — the normal "what should I actually pick" question. Callers
  // building a hindsight squad for a gameweek that's already over pass
  // `isEligible: () => true`, since a player who got injured *after* that
  // gameweek shouldn't be excluded from "what was the best XI that week" —
  // they were perfectly fine to own at the time.
  const isEligible = options.isEligible || (p => !['u', 'n', 'i', 's'].includes(p.status));
  const eligible = allPlayers.filter(isEligible);
  const byPosition = { 1: [], 2: [], 3: [], 4: [] };
  eligible.forEach(p => byPosition[p.positionId].push(p));
  POSITION_ORDER.forEach(pos => {
    byPosition[pos].sort((a, b) => predictionsById[b.id].predicted - predictionsById[a.id].predicted);
  });

  // Step 1: fill every slot with the best available player at that position,
  // respecting only the 3-per-club cap — ignore price for now.
  const squad = [];
  const teamCounts = {};
  POSITION_ORDER.forEach(pos => {
    let need = SQUAD_SLOTS[pos];
    for (const p of byPosition[pos]) {
      if (need <= 0) break;
      if ((teamCounts[p.team] || 0) < MAX_PER_REAL_TEAM) {
        squad.push(p);
        teamCounts[p.team] = (teamCounts[p.team] || 0) + 1;
        need--;
      }
    }
  });

  // Step 2: while over budget, find the single swap (any squad player ->
  // any cheaper same-position player not already in the squad) that loses
  // the fewest predicted points per pound freed up, and apply it. Repeat.
  const totalCost = (sq) => sq.reduce((s, p) => s + p.price, 0);
  let guard = 0;
  while (totalCost(squad) > budget + 1e-9 && guard < 500) {
    guard++;
    const squadIds = new Set(squad.map(p => p.id));
    let bestSwap = null;
    squad.forEach((out, idx) => {
      const projectedCounts = { ...teamCounts, [out.team]: (teamCounts[out.team] || 0) - 1 };
      for (const inP of byPosition[out.positionId]) {
        if (squadIds.has(inP.id)) continue;
        const moneySaved = out.price - inP.price;
        if (moneySaved <= 0) continue;
        if ((projectedCounts[inP.team] || 0) >= MAX_PER_REAL_TEAM) continue;
        const pointsLost = predictionsById[out.id].predicted - predictionsById[inP.id].predicted;
        const ratio = pointsLost / moneySaved;
        if (!bestSwap || ratio < bestSwap.ratio) bestSwap = { idx, inP, ratio };
      }
    });
    if (!bestSwap) break; // no downgrade available — shouldn't normally happen with real FPL prices
    const out = squad[bestSwap.idx];
    teamCounts[out.team] -= 1;
    teamCounts[bestSwap.inP.team] = (teamCounts[bestSwap.inP.team] || 0) + 1;
    squad[bestSwap.idx] = bestSwap.inP;
  }

  // Step 3: spend any leftover budget. While money remains, find the single
  // swap (any squad player -> any pricier same-position player not already
  // in the squad, within remaining budget) that gains the most predicted
  // points per pound spent, and apply it. Repeat until no swap helps.
  guard = 0;
  while (guard < 500) {
    guard++;
    const remaining = budget - totalCost(squad);
    if (remaining <= 1e-9) break;
    const squadIds = new Set(squad.map(p => p.id));
    let bestUpgrade = null;
    squad.forEach((out, idx) => {
      const projectedCounts = { ...teamCounts, [out.team]: (teamCounts[out.team] || 0) - 1 };
      for (const inP of byPosition[out.positionId]) {
        if (squadIds.has(inP.id)) continue;
        const extraCost = inP.price - out.price;
        if (extraCost <= 0 || extraCost > remaining + 1e-9) continue;
        if ((projectedCounts[inP.team] || 0) >= MAX_PER_REAL_TEAM) continue;
        const pointsGained = predictionsById[inP.id].predicted - predictionsById[out.id].predicted;
        if (pointsGained <= 0) continue;
        const ratio = pointsGained / extraCost;
        if (!bestUpgrade || ratio > bestUpgrade.ratio) bestUpgrade = { idx, inP, ratio };
      }
    });
    if (!bestUpgrade) break; // no affordable upgrade left — leftover money genuinely can't be spent well
    const out = squad[bestUpgrade.idx];
    teamCounts[out.team] -= 1;
    teamCounts[bestUpgrade.inP.team] = (teamCounts[bestUpgrade.inP.team] || 0) + 1;
    squad[bestUpgrade.idx] = bestUpgrade.inP;
  }

  return squad;
}

// Picks the highest-predicted valid formation (1 GKP + 10 outfield in a
// legal DEF/MID/FWD split) from a 15-man squad.
export function pickBestFormation(squad15, predictionsById) {
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  squad15.forEach(p => byPos[p.positionId].push(p));
  POSITION_ORDER.forEach(pos => byPos[pos].sort((a, b) => predictionsById[b.id].predicted - predictionsById[a.id].predicted));

  const gk = byPos[1][0];
  if (!gk) throw new Error(`pickBestFormation: squad has no goalkeeper (${squad15.length} players supplied)`);

  let best = null;
  for (let d = 3; d <= 5; d++) {
    for (let m = 2; m <= 5; m++) {
      const f = 10 - d - m;
      if (f < 1 || f > 3) continue;
      if (d > byPos[2].length || m > byPos[3].length || f > byPos[4].length) continue;
      const defs = byPos[2].slice(0, d);
      const mids = byPos[3].slice(0, m);
      const fwds = byPos[4].slice(0, f);
      const total = [...defs, ...mids, ...fwds].reduce((s, p) => s + predictionsById[p.id].predicted, 0);
      if (!best || total > best.total) best = { defs, mids, fwds, total };
    }
  }

  if (!best) {
    throw new Error(
      `pickBestFormation: no legal formation fits this squad ` +
      `(GKP:${byPos[1].length} DEF:${byPos[2].length} MID:${byPos[3].length} FWD:${byPos[4].length}) — ` +
      `needs at least 3 DEF, 2 MID and 1 FWD to field a valid XI.`
    );
  }

  const startersSet = new Set([gk.id, ...best.defs.map(p => p.id), ...best.mids.map(p => p.id), ...best.fwds.map(p => p.id)]);
  return startersSet;
}

// Wraps actual scored points (for one closed gameweek) in the same shape
// computePlayerPrediction returns, so buildOptimalSquad/pickBestFormation —
// which only ever read `.predicted` — can operate on "what actually
// happened" instead of a forecast, with no other changes needed.
function buildActualPredictionsById(allPlayers, liveEventPointsById) {
  const predictionsById = {};
  allPlayers.forEach(p => {
    const live = liveEventPointsById[p.id];
    const actual = live ? live.totalPoints : 0;
    predictionsById[p.id] = {
      predicted: actual,
      nextMatchPredicted: actual,
      baseAvail: actual,
      availNote: null,
      fixtureMult: 1,
      upcomingFixtures: [],
    };
  });
  return predictionsById;
}

// Builds the hindsight-optimal squad for a CLOSED gameweek: the strongest
// possible 15 (and XI, and captain) given how everyone actually scored that
// week, rather than what was predicted beforehand. Eligibility ignores
// current injury/suspension status entirely (isEligible: () => true) — the
// question is purely "what would have scored best", so a player who got
// injured after this gameweek, or who's since been suspended, still counts;
// they were fine to own at the time and their points that week were real.
export function buildHindsightSquad(allPlayers, liveEventPointsById, budget = SQUAD_BUDGET) {
  const predictionsById = buildActualPredictionsById(allPlayers, liveEventPointsById);
  const squad15 = buildOptimalSquad(allPlayers, predictionsById, budget, { isEligible: () => true });
  const startersSet = pickBestFormation(squad15, predictionsById);

  const starters15 = squad15.filter(p => startersSet.has(p.id))
    .sort((a, b) => predictionsById[b.id].predicted - predictionsById[a.id].predicted);
  const captainId = starters15[0] ? starters15[0].id : null;
  const viceCaptainId = starters15[1] ? starters15[1].id : null;

  const squad = squad15.map(p => {
    const pred = predictionsById[p.id];
    const isCaptain = p.id === captainId;
    const live = liveEventPointsById[p.id];
    return {
      player: p, predicted: pred.predicted, nextMatchPredicted: pred.nextMatchPredicted, availNote: null,
      isStarting: startersSet.has(p.id), isCaptain, isViceCaptain: p.id === viceCaptainId,
      multiplier: isCaptain ? 2 : 1,
      actualPoints: live ? live.totalPoints : 0,
      played: live ? live.minutes > 0 : false,
    };
  });

  const totalCost = squad15.reduce((s, p) => s + p.price, 0);
  const bankTenths = Math.round((budget - totalCost) * 10);

  // What this squad would actually have scored: starting XI's actual
  // points with the captain doubled — bench doesn't count, same as real
  // FPL scoring for any squad.
  const totalScore = squad.reduce((s, slot) => (
    slot.isStarting ? s + slot.actualPoints * slot.multiplier : s
  ), 0);

  return { squad, bankTenths, captainId, viceCaptainId, totalScore };
}

// Given a fixed 15-man squad (as saved by a user — playerIds plus their
// chosen captain/vice), works out what it would actually have scored in a
// given closed gameweek: picks the best starting XI *from those exact 15*
// using real points (not predictions), and doubles the saved captain's
// score — falling back to the saved vice-captain, then simply the top
// scorer among starters, if the original captain didn't end up playing.
// Used to compare a user's own saved squad against the predicted-optimal
// and hindsight-best squads for the same gameweek. Returns null if none of
// the saved player ids resolve against current data (e.g. a since-removed
// player).
export function buildSavedSquadActualPerformance(playerIds, captainId, viceCaptainId, liveEventPointsById, playersById) {
  const players = playerIds.map(id => playersById[id]).filter(Boolean);
  if (players.length === 0) return null;

  const predictionsById = {};
  players.forEach(p => {
    const live = liveEventPointsById[p.id];
    predictionsById[p.id] = { predicted: live ? live.totalPoints : 0 };
  });

  let startersSet;
  try {
    startersSet = pickBestFormation(players, predictionsById);
  } catch (e) {
    return null; // saved squad doesn't have a legal formation (shouldn't happen for a squad built through this app, but data can go stale)
  }

  const starters = players.filter(p => startersSet.has(p.id))
    .sort((a, b) => predictionsById[b.id].predicted - predictionsById[a.id].predicted);
  const resolvedCaptainId = startersSet.has(captainId) ? captainId
    : (startersSet.has(viceCaptainId) ? viceCaptainId : (starters[0] ? starters[0].id : null));

  const squad = players.map(p => {
    const live = liveEventPointsById[p.id];
    const isCaptain = p.id === resolvedCaptainId;
    return {
      player: p,
      isStarting: startersSet.has(p.id),
      isCaptain,
      isViceCaptain: p.id === viceCaptainId && p.id !== resolvedCaptainId,
      multiplier: isCaptain ? 2 : 1,
      actualPoints: live ? live.totalPoints : 0,
      played: live ? live.minutes > 0 : false,
    };
  });

  const totalScore = squad.reduce((s, slot) => (slot.isStarting ? s + slot.actualPoints * slot.multiplier : s), 0);
  return { squad, totalScore, captainId: resolvedCaptainId };
}

export function buildOptimalTeam(staticData, budget = SQUAD_BUDGET) {
  const squad15 = buildOptimalSquad(staticData.allPlayers, staticData.predictionsById, budget);
  const startersSet = pickBestFormation(squad15, staticData.predictionsById);

  const starters15 = squad15.filter(p => startersSet.has(p.id))
    .sort((a, b) => staticData.predictionsById[b.id].nextMatchPredicted - staticData.predictionsById[a.id].nextMatchPredicted);
  const captainId = starters15[0] ? starters15[0].id : null;
  const viceCaptainId = starters15[1] ? starters15[1].id : null;

  const squad = squad15.map(p => {
    const pred = staticData.predictionsById[p.id];
    const isCaptain = p.id === captainId;
    return {
      player: p, predicted: pred.predicted, nextMatchPredicted: pred.nextMatchPredicted, availNote: pred.availNote,
      isStarting: startersSet.has(p.id), isCaptain, isViceCaptain: p.id === viceCaptainId,
      multiplier: isCaptain ? 2 : 1,
    };
  });

  const totalCost = squad15.reduce((s, p) => s + p.price, 0);
  const bankTenths = Math.round((budget - totalCost) * 10);
  return { squad, bankTenths, captainId, viceCaptainId };
}

// Rebuilds squad-slot objects for a CLOSED gameweek from its frozen
// snapshot ({playerIds, startingIds, captainId, viceCaptainId,
// predictedById}). Deliberately does NOT recompute predictions or formation
// against today's live data — that gameweek is over, so "predicted points"
// should stay exactly what was predicted at the time, not drift as prices
// and fixtures move on. Optionally merges in each player's actual points for
// that gameweek (liveEventPointsById: {playerId: {totalPoints, minutes}}) —
// pass null/undefined if that hasn't been fetched.
export function hydrateFrozenSquadSnapshot(snapshot, staticData, liveEventPointsById) {
  if (!snapshot || !Array.isArray(snapshot.playerIds)) return null;
  const players = snapshot.playerIds.map(pid => staticData.playersById[pid] || staticData.allPlayers.find(p => p.id === pid)).filter(Boolean);
  if (players.length !== 15) return null;

  const startingIds = new Set(Array.isArray(snapshot.startingIds) ? snapshot.startingIds : []);
  const predictedById = snapshot.predictedById || {};

  const squad = players.map(p => {
    const isCaptain = p.id === snapshot.captainId;
    const predicted = predictedById[p.id] ?? predictedById[String(p.id)] ?? 0;
    const live = liveEventPointsById ? liveEventPointsById[p.id] : null;
    return {
      player: p, predicted, nextMatchPredicted: predicted, availNote: null,
      isStarting: startingIds.has(p.id),
      isCaptain, isViceCaptain: p.id === snapshot.viceCaptainId,
      multiplier: isCaptain ? 2 : 1,
      actualPoints: live ? live.totalPoints : null,
      played: live ? live.minutes > 0 : false,
    };
  });

  const totalCost = players.reduce((s, p) => s + p.price, 0);
  const bankTenths = Math.round((SQUAD_BUDGET - totalCost) * 10);
  return { squad, bankTenths };
}

// Rebuilds full squad-slot objects (predicted points, starting/bench,
// captaincy) from a compact saved snapshot ({playerIds, captainId,
// viceCaptainId}) against a fresh staticData — used both for the browser's
// localStorage cache and for the server-computed snapshot, so prices and
// predictions are always re-hydrated against current live data rather than
// frozen at whenever the snapshot was built.
export function hydrateSquadSnapshot(snapshot, staticData) {
  if (!snapshot || !Array.isArray(snapshot.playerIds)) return null;
  const players = snapshot.playerIds.map(pid => staticData.playersById[pid] || staticData.allPlayers.find(p => p.id === pid)).filter(Boolean);
  if (players.length !== 15) return null;

  const startersSet = pickBestFormation(players, staticData.predictionsById);
  const squad = players.map(p => {
    const pred = staticData.predictionsById[p.id];
    const isCaptain = p.id === snapshot.captainId;
    return {
      player: p, predicted: pred.predicted, nextMatchPredicted: pred.nextMatchPredicted, availNote: pred.availNote,
      isStarting: startersSet.has(p.id),
      isCaptain, isViceCaptain: p.id === snapshot.viceCaptainId,
      multiplier: isCaptain ? 2 : 1,
    };
  });
  const bankTenths = Math.round((SQUAD_BUDGET - players.reduce((s, p) => s + p.price, 0)) * 10);
  return { squad, bankTenths };
}