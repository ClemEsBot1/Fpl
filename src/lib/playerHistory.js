/* ============================================================================
   PLAYER HISTORY (past-season baseline)

   Pure functions only. Reads the aggregated player-history.json blob (built
   once — and re-run once a season — by scripts/import-player-history.mjs
   from the community vaastav/Fantasy-Premier-League archive) and turns a
   player's past-season totals into a single "career baseline" figure —
   recency-weighted points-per-90-minutes — for use as the ep_next shrinkage
   target early in a new season (see computePlayerPrediction in
   predictions.js). A player's own track record is a much better prior than
   a generic position-wide average; the latter is only a fallback for
   players with no usable history (new to the Premier League, injury-wiped
   recent seasons, etc).

   Matching is by FPL's stable per-player `code` field — the same field
   FPL's own API uses in element-summary's `history_past` — not by name, so
   it survives transfers, renames, and re-registration between seasons.
============================================================================ */

// Most recent seasons weighted more heavily — a player who's declined or
// improved recently should look like that, not like their peak from years
// ago. Seasons with no minutes played (injury-wiped, out of the league that
// year, etc.) are skipped entirely rather than burning a weight slot on a
// zero.
const RECENCY_WEIGHTS = [3, 2, 1]; // most-recent-first

// A per-90 extrapolation from a handful of career minutes is noise, not
// signal — a fringe/academy player who picked up a couple of points in one
// substitute cameo would otherwise extrapolate to a rate that looks like a
// nailed-on starter's. 450 minutes (~5 full matches) is a rough floor for
// "enough of a sample that the rate means something"; below that, return
// null so the caller (buildStaticDataFromRaw) falls back to the
// position-wide average instead of trusting the noisy per-90 figure.
const MIN_CAREER_MINUTES = 450;

// Minutes a regular starter plays in a season: about 85% of 38 full games
// (rotation, the odd knock or suspension). Used to turn a per-90 scoring
// rate into points per gameweek below.
const REGULAR_SEASON_MINUTES = 38 * 90 * 0.85;

// seasonsOldestToNewest: the master `seasons` array from the imported blob
// (chronological order, e.g. ['2016-17', ..., '2025-26']).
//
// Returns expected points per gameweek. The baseline stands in for FPL's
// ep_next early in a season, and ep_next already allows for a player not
// playing every minute, so a per-90 rate on its own overrates squad
// players: one point from a 20-minute cameo is 4.5 per 90. The per-90 rate
// is scaled by the player's share of a regular starter's minutes (capped at
// 1, so regular starters keep their full rate).
export function computeCareerBaseline(playerHistoryEntry, seasonsOldestToNewest) {
  if (!playerHistoryEntry || !playerHistoryEntry.seasons || !seasonsOldestToNewest) return null;
  const recentFirst = [...seasonsOldestToNewest].reverse();
  let weightedPoints = 0;
  let weightedMinutes = 0;
  let weightSum = 0;
  let totalMinutes = 0; // unweighted, for the sample-size floor below
  let weightIdx = 0;
  for (const season of recentFirst) {
    const stats = playerHistoryEntry.seasons[season];
    if (!stats || !stats.minutes || stats.minutes <= 0 || stats.total_points === undefined) continue;
    const weight = RECENCY_WEIGHTS[weightIdx] ?? 1;
    weightedPoints += weight * stats.total_points;
    weightedMinutes += weight * stats.minutes;
    weightSum += weight;
    totalMinutes += stats.minutes;
    weightIdx++;
    if (weightIdx >= RECENCY_WEIGHTS.length) break;
  }
  if (weightedMinutes <= 0) return null; // no usable playing-time history at all
  if (totalMinutes < MIN_CAREER_MINUTES) return null; // sample too small to trust
  const per90 = (weightedPoints / weightedMinutes) * 90;
  const playingShare = Math.min(1, weightedMinutes / (weightSum * REGULAR_SEASON_MINUTES));
  return per90 * playingShare;
}

// Precomputes a { [code]: careerBaseline } lookup, rather than recomputing
// per-player-lookup — playerHistoryData may be null/undefined (import not
// run yet), in which case this just returns an empty lookup and every
// player falls back to the position-average baseline, unchanged from before
// this feature existed. Also accepts the compact form /api/player-history
// serves (baselines already worked out server-side). The result only
// depends on the history data, so it's worked out once per history object
// (a past gameweek view or a calibration run rebuilds static data many
// times with the same history).
const careerBaselineCache = new WeakMap();
export function buildCareerBaselineByCode(playerHistoryData) {
  if (!playerHistoryData) return {};
  if (playerHistoryData.careerBaselineByCode) return playerHistoryData.careerBaselineByCode;
  if (!playerHistoryData.players || !playerHistoryData.seasons) return {};
  const cached = careerBaselineCache.get(playerHistoryData);
  if (cached) return cached;
  const byCode = {};
  Object.entries(playerHistoryData.players).forEach(([code, entry]) => {
    const baseline = computeCareerBaseline(entry, playerHistoryData.seasons);
    if (baseline !== null) byCode[code] = baseline;
  });
  careerBaselineCache.set(playerHistoryData, byCode);
  return byCode;
}

// Literal last-season totals for display (GW1's "(LS)" row stat) — distinct
// from computeCareerBaseline above, which recency-weights across up to
// three seasons and applies a 450-minute noise floor for use as a
// *prediction input*. This is just "what actually happened last season",
// so no floor/weighting: even a low-minutes season is real and worth
// showing, and we only ever look at the single most recent season on
// record for that player.
// Returns null if the player has no recorded season at all (new to the
// dataset), not if that season happens to have low/zero minutes.
export function getLastSeasonStats(playerHistoryEntry, seasonsOldestToNewest) {
  if (!playerHistoryEntry || !playerHistoryEntry.seasons || !seasonsOldestToNewest) return null;
  const recentFirst = [...seasonsOldestToNewest].reverse();
  for (const season of recentFirst) {
    const stats = playerHistoryEntry.seasons[season];
    if (!stats || stats.total_points === undefined) continue;
    // points_per_game is FPL's own official figure for that season, present
    // for imports run after this field was added to NUMERIC_FIELDS in
    // scripts/import-player-history.mjs; older blobs won't have it, so fall
    // back to a minutes-based approximation rather than showing nothing.
    const pointsPerGame = stats.points_per_game !== undefined
      ? stats.points_per_game
      : (stats.minutes > 0 ? (stats.total_points / (stats.minutes / 90)) : 0);
    return { season, totalPoints: stats.total_points, pointsPerGame };
  }
  return null;
}

// Precomputes a { [code]: { season, totalPoints, pointsPerGame } } lookup,
// mirroring buildCareerBaselineByCode's pattern. Only worth calling for
// GW1 (see buildStaticDataFromRaw) — for every other gameweek the current
// season's own totals are shown instead and this lookup is skipped
// entirely.
const lastSeasonStatsCache = new WeakMap();
export function buildLastSeasonStatsByCode(playerHistoryData) {
  if (!playerHistoryData) return {};
  if (playerHistoryData.lastSeasonStatsByCode) return playerHistoryData.lastSeasonStatsByCode;
  if (!playerHistoryData.players || !playerHistoryData.seasons) return {};
  const cached = lastSeasonStatsCache.get(playerHistoryData);
  if (cached) return cached;
  const byCode = {};
  Object.entries(playerHistoryData.players).forEach(([code, entry]) => {
    const stats = getLastSeasonStats(entry, playerHistoryData.seasons);
    if (stats !== null) byCode[code] = stats;
  });
  lastSeasonStatsCache.set(playerHistoryData, byCode);
  return byCode;
}

// The compact form of the history blob that /api/player-history serves:
// only the two per-player lookups the app uses (about a tenth of the size
// of the full archive, which the browser would otherwise download and
// parse on every visit).
export function compactPlayerHistory(playerHistoryData) {
  if (!playerHistoryData || !playerHistoryData.players || !playerHistoryData.seasons) return null;
  const round2 = x => Math.round(x * 100) / 100;
  const careerBaselineByCode = {};
  Object.entries(buildCareerBaselineByCode(playerHistoryData)).forEach(([code, v]) => { careerBaselineByCode[code] = round2(v); });
  const lastSeasonStatsByCode = {};
  Object.entries(buildLastSeasonStatsByCode(playerHistoryData)).forEach(([code, s]) => {
    lastSeasonStatsByCode[code] = { season: s.season, totalPoints: s.totalPoints, pointsPerGame: round2(s.pointsPerGame) };
  });
  return { format: 'compact-v1', careerBaselineByCode, lastSeasonStatsByCode };
}