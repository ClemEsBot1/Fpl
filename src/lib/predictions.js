/* ============================================================================
   SHARED PREDICTION / OPTIMAL-SQUAD LOGIC

   Pure functions only — no fetch, no DOM, no React. This file is imported
   from two places that must never disagree with each other:
     - src/App.jsx (runs in the browser)
     - api/refresh-optimal.js (runs server-side, on a schedule)
   If you tune the prediction formula or the squad-building heuristic, you
   only need to change it here.
============================================================================ */

import { buildCareerBaselineByCode, buildLastSeasonStatsByCode } from './playerHistory.js';
import { buildOddsByTeamForEvent, computeOddsAdjustment } from './oddsAdjustment.js';

export const POSITION_ORDER = [1, 2, 3, 4];
export const SQUAD_SLOTS = { 1: 2, 2: 5, 3: 5, 4: 3 }; // required count per position in a full 15-man squad
export const MAX_PER_REAL_TEAM = 3;
export const SQUAD_BUDGET = 100.0; // £100.0m

// How much a bench player's predicted points count toward budget decisions,
// relative to a starter's (1.0). Bench points only ever matter via an
// auto-sub, which is a minority of gameweeks for any one bench slot — 0.03
// is a reasoned "mostly discount it, don't zero it out entirely" starting
// point, not backtested. Used only in buildOptimalSquad's budget-fitting
// steps below, so real starters' points are never touched by this constant.
const BENCH_WEIGHT = 0.03;

// Every tunable weight the prediction formula uses, in one place — so
// scripts/calibrate-weights.mjs can grid-search combinations against real
// results without touching this file. These defaults are reasoned
// starting points (documented inline below), not backtest-tuned; running
// the calibration script against a range of past gameweeks is how you'd
// replace a guess here with an evidence-based one.
export const DEFAULT_PREDICTION_WEIGHTS = {
  epNext: 0.45, ppg: 0.35, form: 0.20,          // must sum to 1 — the post-GW5 blended formula
  xgRegression: 0.15,                            // how much of the xG/actual gap to credit, per computePlayerPrediction
  selectionShrinkage: 0.85,                      // "winner's curse" correction — see buildStaticDataFromRaw
  oddsAdjustment: 1.0,                           // scales the already-capped nudge from src/lib/oddsAdjustment.js; 1.0 = trust it at face value
};

/* ----------------------------------------------------------------------------
   PREDICTION ENGINE
---------------------------------------------------------------------------- */

export function computePlayerPrediction(p, fixturesByTeam, formEligible, epNextShrink = null, options = {}) {
  const weights = { ...DEFAULT_PREDICTION_WEIGHTS, ...options.weights };
  const rawEpNext = p.epNext || 0;
  const ppg = p.pointsPerGame || 0;
  const form = p.form || 0;

  // ep_next is FPL's own next-gameweek model, and it's the input the rest of
  // this function leans on hardest (100% of the base early season, still the
  // largest single weight once form kicks in). But it has the exact same
  // small-sample problem as form/ppg: this early it's built from only a
  // couple of games, so a hot start reads as a sustained one — a cheap
  // rotation-priced defender can show an ep_next of 10 after two clean
  // sheets, when the honest expectation is more like half that. Shrink it
  // toward the position-wide average ep_next (computed once across the
  // player pool in buildStaticDataFromRaw) in proportion to how little of
  // the season has actually happened, so early gameweeks don't take these
  // extremes at full face value; by ~6 gameweeks in, confidence reaches 1
  // and ep_next is trusted as-is again.
  const confidence = epNextShrink ? epNextShrink.confidence : 1;
  const epNext = (epNextShrink && confidence < 1)
    ? confidence * rawEpNext + (1 - confidence) * epNextShrink.baseline
    : rawEpNext;

  let base;
  if (formEligible && form > 0) {
    base = weights.epNext * epNext + weights.ppg * ppg + weights.form * form;
  } else {
    // Early season (before GW5): points_per_game suffers the exact same
    // small-sample problem as form — after one gameweek it's literally just
    // that gameweek's score (a single big haul reads as an 11.0 ppg that's
    // nowhere near sustainable). Lean on FPL's own next-gameweek model
    // instead (now shrunk toward the position average above, for the same
    // small-sample reason), rather than getting fooled by either one.
    base = epNext;
  }

  // Set-piece duty is a real, low-noise signal FPL already publishes but
  // the formula above never used: a confirmed penalty taker has a
  // materially higher expected-points floor than their open-play output
  // alone suggests, and it doesn't suffer from the small-sample problems
  // above (who's on penalties doesn't get less certain early in a season).
  // Modest and additive, applied before the fixture/availability
  // multipliers below so it still scales down for a hard fixture or an
  // injury doubt, same as everything else — this isn't meant to be a large
  // driver, just credit for information the formula was otherwise ignoring.
  let setPieceBonus = 0;
  if (p.penaltiesOrder === 1) setPieceBonus += 0.45;
  else if (p.penaltiesOrder === 2) setPieceBonus += 0.15;
  if (p.directFreekicksOrder === 1) setPieceBonus += 0.15;
  if (p.cornersOrder === 1) setPieceBonus += 0.15;
  base += setPieceBonus;

  // xG/xA regression-to-underlying-rate nudge: compares ACTUAL goal
  // involvements this season to what the underlying chances (expected_goals
  // + expected_assists) say they "should" have produced. A player scoring
  // MORE than their xG suggests is finishing at a rate that's unlikely to
  // hold (nudged down); one under-performing xG is getting into good
  // positions without the run of luck yet (nudged up). Crucially this needs
  // far fewer minutes to mean something than raw goals/assists, since xG
  // doesn't care whether the shot actually went in — the same small-sample
  // idea as the ep_next shrinkage above, applied to a different input.
  // Requires a meaningful sample (2 full games' worth of minutes) and the
  // result is capped to a modest swing either way: this is a nudge on top
  // of the formula above, not a replacement for it.
  const minutesPlayed = p.minutes || 0;
  let xgAdjustment = 0;
  if (minutesPlayed >= 180) {
    const actualGI = (p.goalsScored || 0) + (p.assists || 0);
    const expectedGI = (p.expectedGoals || 0) + (p.expectedAssists || 0);
    const per90Gap = (expectedGI - actualGI) / (minutesPlayed / 90); // +ve = under-performing xG (unlucky so far)
    const goalPointsForPosition = { 1: 6, 2: 6, 3: 5, 4: 4 }[p.positionId] || 5;
    const pointsGapPer90 = per90Gap * ((goalPointsForPosition + 3) / 2); // rough blended value per involvement (goal vs assist)
    xgAdjustment = Math.max(-1.0, Math.min(1.0, pointsGapPer90 * weights.xgRegression));
  }
  base += xgAdjustment;

  // Bookmaker-odds nudge (see src/lib/oddsAdjustment.js for the full
  // reasoning): p.oddsAdjustment is pre-computed once per player in
  // buildStaticDataFromRaw from that player's NEXT fixture's odds only —
  // odds aren't available/reliable for fixtures further out the way FPL's
  // own fixture-difficulty rating is, so unlike fixtureMult below (a 4-game
  // average) this only ever reflects the immediate next match. Already
  // capped small in computeOddsAdjustment; weights.oddsAdjustment just
  // scales trust in it, same role xgRegression plays above.
  base += (p.oddsAdjustment || 0) * weights.oddsAdjustment;

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

  // Short-rest rotation risk: a team playing again within a handful of days
  // is more likely to rotate its squad. This can only see Premier League
  // fixture scheduling (the gap between kickoffs FPL's own /fixtures/
  // endpoint gives us) — it has no visibility into European or domestic cup
  // fixtures, which is the more common real-world driver of rotation for
  // clubs in continental competition. So this under-detects congestion for
  // those clubs specifically, but a genuinely short PL-to-PL turnaround
  // (rearranged or festive-period fixtures) is still a real, if partial,
  // signal worth a modest discount rather than none at all.
  const REST_DAYS_THRESHOLD = 4; // a normal gap is ~7 days
  const CONGESTION_DISCOUNT = 0.92;
  const restDays = p.daysSinceLastFixture;
  const congestionMult = (typeof restDays === 'number' && restDays < REST_DAYS_THRESHOLD) ? CONGESTION_DISCOUNT : 1;

  const predicted = Math.max(0, base * fixtureMult * availMult * congestionMult);
  const nextMatchPredicted = Math.max(0, base * nextFixtureMult * availMult * congestionMult);
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

  // At GW1, "points so far this season" and "points per match this season"
  // are both trivially 0/undefined for every player — there's nothing to
  // show yet. Falling back to last season's real totals (labelled "(LS)" in
  // the UI, see PlayerRow in App.jsx) gives the person something actually
  // useful to look at instead of a wall of zeros. Only computed for GW1 —
  // every other gameweek shows the current season's own in-progress totals.
  const isGw1 = targetEvent.id === 1;
  const lastSeasonStatsByCode = isGw1 ? buildLastSeasonStatsByCode(options.playerHistoryData) : {};

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

  // Rest-days-per-team, for the short-rest rotation-risk discount in
  // computePlayerPrediction: for each team's next upcoming fixture, find
  // the most recent PREVIOUS fixture (by kickoff time, from the full
  // fixture list — not just the future-filtered one above) and measure the
  // gap in days. Deliberately keyed off actual kickoff timestamps rather
  // than gameweek numbers, so a postponed/rearranged fixture doesn't throw
  // the gap off.
  const restDaysByTeam = {};
  bootstrap.teams.forEach(t => {
    const next = fixturesByTeam[t.id][0];
    if (!next || !next.kickoff) return;
    const nextTime = new Date(next.kickoff).getTime();
    const prior = fixturesRaw
      .filter(f => (f.team_h === t.id || f.team_a === t.id) && f.kickoff_time && new Date(f.kickoff_time).getTime() < nextTime)
      .sort((a, b) => new Date(b.kickoff_time).getTime() - new Date(a.kickoff_time).getTime())[0];
    if (!prior) return;
    restDaysByTeam[t.id] = (nextTime - new Date(prior.kickoff_time).getTime()) / (1000 * 60 * 60 * 24);
  });

  // Bookmaker-odds lookup for the target gameweek only — see the note on
  // p.oddsAdjustment above for why this can't cover the full 4-game window.
  // options.oddsData is the array produced by matchOddsToFixtures() in
  // src/lib/oddsAdjustment.js (already resolved to FPL team ids/event
  // numbers) — best-effort, like playerHistoryData: no odds fetched yet, or
  // the fetch/matching failed for this gameweek, just means oddsAdjustment
  // is 0 for everyone, same as before this feature existed.
  const oddsByTeamForTargetEvent = buildOddsByTeamForEvent(options.oddsData, targetEvent.id);

  const allPlayers = bootstrap.elements.map(e => {
    const seasonPoints = e.total_points;
    const seasonPPG = parseFloat(e.points_per_game) || 0;
    // Last-season fallback only ever applies at GW1 (lastSeasonStatsByCode
    // is an empty lookup for every other gameweek) — see the note above
    // isGw1. A player with no recorded last season (new to the league)
    // just keeps showing this season's (zero) totals, same as before this
    // feature existed.
    const lastSeason = lastSeasonStatsByCode[e.code];
    const useLastSeason = isGw1 && !!lastSeason;
    return {
      id: e.id,
      code: e.code,
      webName: e.web_name,
      firstName: e.first_name,
      secondName: e.second_name,
      team: e.team,
      positionId: e.element_type,
      price: e.now_cost / 10,
      form: parseFloat(e.form) || 0,
      pointsPerGame: seasonPPG,
      totalPoints: seasonPoints,
      // What a player's row actually displays for "points so far" / "points
      // per match" (see PlayerRow/HindsightPlayerRow in App.jsx) — this
      // season's own in-progress totals normally, or last season's real
      // numbers at GW1 when this season's totals are still all zero.
      // displayIsLastSeason drives the "(LS)" label; totalPoints/
      // pointsPerGame above are untouched so anything else that needs this
      // season's actual (possibly zero) figures still gets them.
      displaySeasonPoints: useLastSeason ? lastSeason.totalPoints : seasonPoints,
      displaySeasonPPG: useLastSeason ? lastSeason.pointsPerGame : seasonPPG,
      displayIsLastSeason: useLastSeason,
      epNext: parseFloat(e.ep_next) || 0,
      status: e.status,
      chanceNext: e.chance_of_playing_next_round,
      news: e.news,
      selectedBy: parseFloat(e.selected_by_percent) || 0,
      penaltiesOrder: e.penalties_order === null || e.penalties_order === undefined ? null : Number(e.penalties_order),
      directFreekicksOrder: e.direct_freekicks_order === null || e.direct_freekicks_order === undefined ? null : Number(e.direct_freekicks_order),
      cornersOrder: e.corners_and_indirect_freekicks_order === null || e.corners_and_indirect_freekicks_order === undefined ? null : Number(e.corners_and_indirect_freekicks_order),
      minutes: Number(e.minutes) || 0,
      goalsScored: Number(e.goals_scored) || 0,
      assists: Number(e.assists) || 0,
      expectedGoals: parseFloat(e.expected_goals) || 0,
      expectedAssists: parseFloat(e.expected_assists) || 0,
      daysSinceLastFixture: restDaysByTeam[e.team] ?? null,
      oddsAdjustment: (() => {
        const info = oddsByTeamForTargetEvent[e.team];
        return info ? computeOddsAdjustment({ probs: info.probs, isHome: info.isHome, positionId: e.element_type }) : 0;
      })(),
    };
  });

  const playersById = {};
  const playersByPosition = { 1: [], 2: [], 3: [], 4: [] };
  allPlayers.forEach(p => { playersById[p.id] = p; playersByPosition[p.positionId].push(p); });

  // ep_next shrinkage setup (see computePlayerPrediction): confidence ramps
  // linearly from 0 at GW1 to 1 once EPNEXT_CONFIDENCE_GAMES gameweeks have
  // been played. The shrinkage target is, in priority order: (1) the
  // player's own recency-weighted career points-per-90 from past seasons
  // (options.playerHistoryData — see src/lib/playerHistory.js — built by
  // scripts/import-player-history.mjs; a real track record beats a generic
  // average), falling back to (2) the position-wide average ep_next among
  // players who are actually available to play, for anyone with no usable
  // history (new to the league, or the import hasn't been run) — an
  // injured/suspended/unavailable player's near-zero ep_next would
  // otherwise drag that average down and under-shrink everyone else's
  // early-season number.
  const EPNEXT_CONFIDENCE_GAMES = 5;
  const gamesPlayed = Math.max(0, targetEvent.id - 1);
  const epNextConfidence = Math.min(1, gamesPlayed / EPNEXT_CONFIDENCE_GAMES);
  const epNextBaselineByPosition = {};
  POSITION_ORDER.forEach(pos => {
    const available = playersByPosition[pos].filter(p => !['u', 'n', 'i', 's'].includes(p.status));
    const pool = available.length ? available : playersByPosition[pos];
    epNextBaselineByPosition[pos] = pool.length ? pool.reduce((s, p) => s + p.epNext, 0) / pool.length : 0;
  });
  const careerBaselineByCode = buildCareerBaselineByCode(options.playerHistoryData);
  const weights = { ...DEFAULT_PREDICTION_WEIGHTS, ...options.weights };

  const predictionsById = {};
  allPlayers.forEach(p => {
    const baseline = careerBaselineByCode[p.code] ?? epNextBaselineByPosition[p.positionId];
    const epNextShrink = { confidence: epNextConfidence, baseline };
    predictionsById[p.id] = computePlayerPrediction(p, fixturesByTeam, formEligible, epNextShrink, { weights });
  });

  // "Winner's curse" correction for SELECTION only (squad-picking and
  // captaincy) — never for what's displayed. Picking the single
  // highest-predicted player at each slot systematically favours players
  // whose forecast happened to run hot, a standard regression-to-the-mean
  // effect in any pick-the-top-of-a-noisy-ranking system (the same reason
  // "last year's best fund" tends to underperform next). Shrinking the
  // value used purely for ranking/selection toward the position-wide
  // average dampens that without changing the number shown to the user —
  // `predicted`/`nextMatchPredicted` above are untouched; only this new
  // `selectionValue`/`nextMatchSelectionValue` pair feeds buildOptimalSquad,
  // pickBestFormation, and captain choice. weights.selectionShrinkage is a
  // reasonable starting point, not backtest-tuned — see
  // scripts/calibrate-weights.mjs if you want to calibrate it against real
  // results.
  const avgPredictedByPosition = {};
  const avgNextMatchByPosition = {};
  POSITION_ORDER.forEach(pos => {
    const available = playersByPosition[pos].filter(p => !['u', 'n', 'i', 's'].includes(p.status));
    const pool = available.length ? available : playersByPosition[pos];
    avgPredictedByPosition[pos] = pool.length ? pool.reduce((s, p) => s + predictionsById[p.id].predicted, 0) / pool.length : 0;
    avgNextMatchByPosition[pos] = pool.length ? pool.reduce((s, p) => s + predictionsById[p.id].nextMatchPredicted, 0) / pool.length : 0;
  });
  allPlayers.forEach(p => {
    const pred = predictionsById[p.id];
    pred.selectionValue = weights.selectionShrinkage * pred.predicted + (1 - weights.selectionShrinkage) * avgPredictedByPosition[p.positionId];
    pred.nextMatchSelectionValue = weights.selectionShrinkage * pred.nextMatchPredicted + (1 - weights.selectionShrinkage) * avgNextMatchByPosition[p.positionId];
  });

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
  // Ranking value for selection decisions: prefers the "winner's curse"
  // shrunk selectionValue (see buildStaticDataFromRaw) when it's present,
  // falling back to the raw predicted/actual figure for callers that build
  // a minimal predictionsById of their own — buildActualPredictionsById
  // (hindsight) and buildSavedSquadActualPerformance both do this, and
  // neither should be shrunk: there's no forecast noise to correct for in
  // "what actually happened".
  const selVal = id => predictionsById[id].selectionValue ?? predictionsById[id].predicted;

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
    byPosition[pos].sort((a, b) => selVal(b.id) - selVal(a.id));
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
  // Uses weightedVal (below), not raw selVal, so a bench player's points
  // barely count here — the algorithm naturally reaches for bench downgrades
  // long before it ever touches a starter, without needing a separate
  // bench-only code path.
  const totalCost = (sq) => sq.reduce((s, p) => s + p.price, 0);
  const startingIdsFor = (sq) => pickBestFormation(sq, predictionsById);
  const weightedVal = (id, startingIds) => selVal(id) * (startingIds.has(id) ? 1 : BENCH_WEIGHT);

  let startingIds = startingIdsFor(squad);
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
        const pointsLost = weightedVal(out.id, startingIds) - selVal(inP.id) * (startingIds.has(out.id) ? 1 : BENCH_WEIGHT);
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
  startingIds = startingIdsFor(squad); // prices changed in Step 2 — refresh who'd actually start now

  // Step 3: minimize bench cost. Unconditional — run this BEFORE spending
  // leftover budget on starters, not paired with a specific starter upgrade.
  // The earlier version of this only trimmed a bench player when it could
  // immediately pair that trim with an affordable starter upgrade in the
  // same step, and gave up on the whole thing otherwise — which is exactly
  // why bench cost stayed high even with money still unspent: a bench
  // player being expensive costs almost nothing at BENCH_WEIGHT (0.03), so
  // trimming them is essentially free regardless of whether a starter
  // upgrade happens to be available yet. Doing this unconditionally first,
  // then letting the next step spend whatever it freed, is simpler and
  // actually reaches the minimum bench cost.
  guard = 0;
  while (guard < 500) {
    guard++;
    const squadIds = new Set(squad.map(p => p.id));
    let bestTrim = null;
    squad.forEach((out, idx) => {
      if (startingIds.has(out.id)) return; // starters aren't touched here — that's Step 4
      const projectedCounts = { ...teamCounts, [out.team]: (teamCounts[out.team] || 0) - 1 };
      for (const inP of byPosition[out.positionId]) {
        if (squadIds.has(inP.id)) continue;
        const moneySaved = out.price - inP.price;
        if (moneySaved <= 0) continue;
        if ((projectedCounts[inP.team] || 0) >= MAX_PER_REAL_TEAM) continue;
        if (!bestTrim || moneySaved > bestTrim.moneySaved) bestTrim = { idx, inP, moneySaved };
      }
    });
    if (!bestTrim) break; // every bench player is already at the cheapest eligible option for their position
    const out = squad[bestTrim.idx];
    teamCounts[out.team] -= 1;
    teamCounts[bestTrim.inP.team] = (teamCounts[bestTrim.inP.team] || 0) + 1;
    squad[bestTrim.idx] = bestTrim.inP;
  }
  startingIds = startingIdsFor(squad);

  // Step 4: spend all remaining budget (now substantially more, thanks to
  // Step 3) on starters — and ONLY starters. Single-swap greedy: find the
  // swap (any STARTING squad player -> pricier same-position player, within
  // remaining budget) that gains the most predicted points per pound spent,
  // apply it, repeat.
  //
  // The `if (!startingIds.has(out.id)) return;` line below is load-bearing:
  // without it, this step's own "pointsGained > 0" check is satisfiable by
  // bench players too, because a bench swap's gain is measured against the
  // CURRENT (already cheap) bench occupant, so even a marginal predicted-
  // points edge on a pricier replacement clears it. Once no more starter
  // upgrades fit the shrinking remaining budget, the greedy search would
  // then happily spend leftover pennies re-inflating the very bench Step 3
  // just minimized — which is exactly the bug this line fixes. (Previously
  // this was "handled" only by weighting the incoming player's gain by
  // BENCH_WEIGHT when swapping OUT a bench player, but that weight applies
  // symmetrically to the outgoing player's current value too, so it doesn't
  // actually suppress bench-vs-bench upgrades — only an explicit skip does.)
  guard = 0;
  while (guard < 500) {
    guard++;
    const remaining = budget - totalCost(squad);
    if (remaining <= 1e-9) break;
    const squadIds = new Set(squad.map(p => p.id));
    let bestUpgrade = null;
    squad.forEach((out, idx) => {
      if (!startingIds.has(out.id)) return; // bench players are never touched here — Step 3 already minimized them
      const projectedCounts = { ...teamCounts, [out.team]: (teamCounts[out.team] || 0) - 1 };
      for (const inP of byPosition[out.positionId]) {
        if (squadIds.has(inP.id)) continue;
        const extraCost = inP.price - out.price;
        if (extraCost <= 0 || extraCost > remaining + 1e-9) continue;
        if ((projectedCounts[inP.team] || 0) >= MAX_PER_REAL_TEAM) continue;
        // inP isn't in the squad yet, so it can't be "starting" under the
        // current formation — but out.id always is (guarded above), so
        // this is a straight starter-vs-starter comparison; no bench
        // weighting needed on either side.
        const pointsGained = selVal(inP.id) - selVal(out.id);
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
  const selVal = id => predictionsById[id].selectionValue ?? predictionsById[id].predicted;
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  squad15.forEach(p => byPos[p.positionId].push(p));
  POSITION_ORDER.forEach(pos => byPos[pos].sort((a, b) => selVal(b.id) - selVal(a.id)));

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
      const total = [...defs, ...mids, ...fwds].reduce((s, p) => s + selVal(p.id), 0);
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

  const nextSelVal = id => staticData.predictionsById[id].nextMatchSelectionValue ?? staticData.predictionsById[id].nextMatchPredicted;
  const starters15 = squad15.filter(p => startersSet.has(p.id))
    .sort((a, b) => nextSelVal(b.id) - nextSelVal(a.id));

  // Captaincy doubles a single gameweek's score, so a pick with fitness
  // doubt risks doubling zero — a downside a plain point-estimate ranking
  // doesn't weight heavily enough (the EV hit from a lower chance-of-playing
  // is already baked into their predicted score via availMult, but the risk
  // of a captain BLANK specifically matters more than that EV alone
  // suggests). Prefer the highest-ranked starter with no injury/rotation
  // doubt for both captain and vice; only fall back to the top-ranked pick
  // regardless of doubt if every starter has some flag.
  const isCaptainSafe = p => p.status === 'a' && (p.chanceNext === null || p.chanceNext === undefined || p.chanceNext >= 90);
  const safeCaptain = starters15.find(p => isCaptainSafe(p));
  const captainId = (safeCaptain || starters15[0])?.id ?? null;
  const viceCandidates = starters15.filter(p => p.id !== captainId);
  const safeVice = viceCandidates.find(p => isCaptainSafe(p));
  const viceCaptainId = (safeVice || viceCandidates[0])?.id ?? null;

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