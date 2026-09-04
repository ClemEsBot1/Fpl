/* ============================================================================
   BOOKMAKER ODDS ADJUSTMENT

   Pure functions only — same rule as predictions.js, and for the same reason:
   this is imported from both src/App.jsx (browser) and api/refresh-optimal.js
   (server cron), so the two must never disagree.

   Two independent, small, CAPPED nudges — odds are a signal on top of the
   existing formula, not a replacement for it, exactly like the xG-regression
   and fixture-congestion adjustments already in predictions.js:

     1. Attacking nudge (MID/FWD): a team more likely to win a given match
        creates more chances on average, so its players' attacking returns
        get nudged up a little relative to an even match; the opposite for
        the side less likely to win.
     2. Clean-sheet nudge (GKP/DEF): favourites concede less on average, so
        their defenders/keeper get nudged up; underdogs down.

   Bookmaker odds only exist for the next handful of days, so — unlike
   set-piece duty, which is a standing trait — this only ever covers the very
   next fixture, not the 4-game rolling window `predicted` otherwise uses.
   That's a real limitation (see the note in predictions.js at the call site)
   worth knowing about, not something this file can fix on its own.
============================================================================ */

export const ODDS_WEIGHTS = {
  attackingNudgeCap: 0.5,   // max points added/removed for MID/FWD, per match
  cleanSheetNudgeCap: 0.5,  // max points added/removed for GKP/DEF, per match
};

// Removes the bookmaker's overround (vig) from decimal 1X2 odds using the
// standard proportional method: implied prob = (1/odds) / sum(1/odds_i).
// Returns null if any odds are missing/invalid so callers can fall back to
// "no odds signal" rather than dividing by garbage.
export function devigMatchOdds(oddsHomeWin, oddsDraw, oddsAwayWin) {
  if (!(oddsHomeWin > 1) || !(oddsDraw > 1) || !(oddsAwayWin > 1)) return null;
  const rawHome = 1 / oddsHomeWin;
  const rawDraw = 1 / oddsDraw;
  const rawAway = 1 / oddsAwayWin;
  const overround = rawHome + rawDraw + rawAway;
  if (!(overround > 0)) return null;
  return {
    homeWinProb: rawHome / overround,
    drawProb: rawDraw / overround,
    awayWinProb: rawAway / overround,
  };
}

// Approximation, not a real market: there's no widely-available free
// clean-sheet or team-goals market to pull this from directly, so it's
// estimated from devigged win/draw probability instead — a heavy favourite
// concedes rarely, an even match is roughly a coin flip on a clean sheet, a
// heavy underdog almost never keeps one. Reasoned starting coefficients
// (0.7 / 0.45), not backtested. If you later get access to a real
// clean-sheet/team-total-goals market, replace the body of this function
// with that number directly — nothing else in this file needs to change.
export function estimateCleanSheetProbability(teamWinProb, drawProb) {
  return Math.max(0, Math.min(1, teamWinProb * 0.7 + drawProb * 0.45));
}

// probs: { homeWinProb, drawProb, awayWinProb } from devigMatchOdds.
// isHome: whether the player's team is the home side in this fixture.
// positionId: FPL element_type (1=GKP, 2=DEF, 3=MID, 4=FWD).
// Returns a capped points adjustment (can be 0 if there's no odds signal).
export function computeOddsAdjustment({ probs, isHome, positionId }) {
  if (!probs) return 0;
  const teamWinProb = isHome ? probs.homeWinProb : probs.awayWinProb;
  const drawProb = probs.drawProb;

  if (positionId === 1 || positionId === 2) {
    const csProb = estimateCleanSheetProbability(teamWinProb, drawProb);
    const leagueAverageCleanSheetRate = 0.30; // rough long-run PL average, not per-season tuned
    const raw = (csProb - leagueAverageCleanSheetRate) * 4; // scale factor, reasoned not backtested
    return Math.max(-ODDS_WEIGHTS.cleanSheetNudgeCap, Math.min(ODDS_WEIGHTS.cleanSheetNudgeCap, raw));
  }

  const evenMatchBaseline = 1 / 3;
  const raw = (teamWinProb - evenMatchBaseline) * 3; // scale factor, reasoned not backtested
  return Math.max(-ODDS_WEIGHTS.attackingNudgeCap, Math.min(ODDS_WEIGHTS.attackingNudgeCap, raw));
}

/* ----------------------------------------------------------------------------
   MATCHING BOOKMAKER FIXTURES TO FPL FIXTURES

   Odds providers identify matches by team NAME and kickoff time; FPL's own
   data identifies them by numeric team id and gameweek ("event"). This is
   the one messy part of the whole feature — team-name spelling varies by
   provider ("Man Utd" vs "Manchester United", "Spurs" vs "Tottenham
   Hotspur") — so matching is done by normalising names AND requiring the
   kickoff times to be close, not name alone.
---------------------------------------------------------------------------- */

const TEAM_NAME_ALIASES = {
  'man utd': 'manchester united', 'man united': 'manchester united',
  'man city': 'manchester city',
  'spurs': 'tottenham hotspur', 'tottenham': 'tottenham hotspur',
  'wolves': 'wolverhampton wanderers',
  "nott'm forest": 'nottingham forest', 'forest': 'nottingham forest',
  'newcastle': 'newcastle united',
  'west ham': 'west ham united',
  'leeds': 'leeds united',
  'brighton': 'brighton and hove albion', 'brighton & hove albion': 'brighton and hove albion',
  'sheffield utd': 'sheffield united',
};

function normalizeTeamName(name) {
  if (!name) return '';
  const lower = name.toLowerCase().trim().replace(/\bfc\b/g, '').replace(/\s+/g, ' ').trim();
  return TEAM_NAME_ALIASES[lower] || lower;
}

// oddsApiEvents: raw events from an odds provider, each shaped roughly like
// The Odds API's /v4/sports/{sport}/odds response —
//   { commence_time, home_team, away_team, bookmakers: [{ markets: [{ key: 'h2h', outcomes: [{name, price}] }] }] }
// If you're using a different provider, adapt the shape to this before
// calling this function, or rewrite extractH2hOdds below — nothing else in
// this file depends on a specific provider's schema.
// fplFixturesRaw: the raw array from FPL's /fixtures/ endpoint.
// teamsById: bootstrap.teams keyed by id (for the name lookup).
// Returns: [{ event, homeTeamId, awayTeamId, homeWinOdds, drawOdds, awayWinOdds }]
export function matchOddsToFixtures(oddsApiEvents, fplFixturesRaw, teamsById) {
  if (!Array.isArray(oddsApiEvents) || !Array.isArray(fplFixturesRaw)) return [];

  const fplTeamIdByName = {};
  Object.values(teamsById || {}).forEach(t => {
    fplTeamIdByName[normalizeTeamName(t.name)] = t.id;
    if (t.short_name) fplTeamIdByName[normalizeTeamName(t.short_name)] = t.id;
  });

  const MATCH_WINDOW_MS = 3 * 60 * 60 * 1000; // kickoff times rarely disagree by more than this between providers
  const matched = [];

  oddsApiEvents.forEach(evt => {
    const homeOdds = extractH2hOdds(evt);
    if (!homeOdds) return;

    const homeTeamId = fplTeamIdByName[normalizeTeamName(evt.home_team)];
    const awayTeamId = fplTeamIdByName[normalizeTeamName(evt.away_team)];
    if (!homeTeamId || !awayTeamId) return; // unmatched team name — see TEAM_NAME_ALIASES if this keeps happening

    const commence = new Date(evt.commence_time).getTime();
    if (!commence) return;

    const fixture = fplFixturesRaw.find(f =>
      f.team_h === homeTeamId && f.team_a === awayTeamId &&
      f.kickoff_time && Math.abs(new Date(f.kickoff_time).getTime() - commence) <= MATCH_WINDOW_MS
    );
    if (!fixture || fixture.event === null || fixture.event === undefined) return;

    matched.push({
      event: fixture.event,
      homeTeamId, awayTeamId,
      homeWinOdds: homeOdds.homeWinOdds, drawOdds: homeOdds.drawOdds, awayWinOdds: homeOdds.awayWinOdds,
    });
  });

  return matched;
}

// Averages the h2h market across whichever bookmakers the provider included,
// rather than trusting a single one — steadier, and immune to one outlier
// bookmaker's price. Returns null if no bookmaker has a usable h2h market.
function extractH2hOdds(evt) {
  if (!Array.isArray(evt.bookmakers)) return null;
  const home = [], draw = [], away = [];
  evt.bookmakers.forEach(bm => {
    const market = (bm.markets || []).find(m => m.key === 'h2h');
    if (!market) return;
    (market.outcomes || []).forEach(o => {
      if (normalizeTeamName(o.name) === normalizeTeamName(evt.home_team)) home.push(o.price);
      else if (normalizeTeamName(o.name) === normalizeTeamName(evt.away_team)) away.push(o.price);
      else if (o.name.toLowerCase() === 'draw') draw.push(o.price);
    });
  });
  if (!home.length || !draw.length || !away.length) return null;
  const avg = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
  return { homeWinOdds: avg(home), drawOdds: avg(draw), awayWinOdds: avg(away) };
}

// oddsData: the matched-fixtures array this file produces above.
// targetEventId: only the immediate next gameweek — bookmaker markets for
// fixtures further out are thin/unreliable/often not posted yet, unlike
// FPL's own fixture-difficulty rating which covers the full 4-game window
// `predicted` uses. This is why the odds nudge only ever affects
// nextMatchPredicted-scale decisions in practice, not the longer horizon.
// Returns { [teamId]: { probs, isHome } } for teams playing that gameweek.
export function buildOddsByTeamForEvent(oddsData, targetEventId) {
  const byTeam = {};
  (oddsData || []).forEach(m => {
    if (m.event !== targetEventId) return;
    const probs = devigMatchOdds(m.homeWinOdds, m.drawOdds, m.awayWinOdds);
    if (!probs) return;
    byTeam[m.homeTeamId] = { probs, isHome: true };
    byTeam[m.awayTeamId] = { probs, isHome: false };
  });
  return byTeam;
}
