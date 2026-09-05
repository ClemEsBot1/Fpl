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

// seasonsOldestToNewest: the master `seasons` array from the imported blob
// (chronological order, e.g. ['2016-17', ..., '2025-26']).
export function computeCareerBaseline(playerHistoryEntry, seasonsOldestToNewest) {
  if (!playerHistoryEntry || !playerHistoryEntry.seasons || !seasonsOldestToNewest) return null;
  const recentFirst = [...seasonsOldestToNewest].reverse();
  let weightedPoints = 0;
  let weightedMinutes = 0;
  let totalMinutes = 0; // unweighted, for the sample-size floor below
  let weightIdx = 0;
  for (const season of recentFirst) {
    const stats = playerHistoryEntry.seasons[season];
    if (!stats || !stats.minutes || stats.minutes <= 0 || stats.total_points === undefined) continue;
    const weight = RECENCY_WEIGHTS[weightIdx] ?? 1;
    weightedPoints += weight * stats.total_points;
    weightedMinutes += weight * stats.minutes;
    totalMinutes += stats.minutes;
    weightIdx++;
    if (weightIdx >= RECENCY_WEIGHTS.length) break;
  }
  if (weightedMinutes <= 0) return null; // no usable playing-time history at all
  if (totalMinutes < MIN_CAREER_MINUTES) return null; // sample too small to trust
  return (weightedPoints / weightedMinutes) * 90;
}

// Precomputes a { [code]: careerBaseline } lookup once per
// buildStaticDataFromRaw call, rather than recomputing per-player-lookup —
// playerHistoryData may be null/undefined (import not run yet), in which
// case this just returns an empty lookup and every player falls back to the
// position-average baseline, unchanged from before this feature existed.
export function buildCareerBaselineByCode(playerHistoryData) {
  const byCode = {};
  if (!playerHistoryData || !playerHistoryData.players || !playerHistoryData.seasons) return byCode;
  Object.entries(playerHistoryData.players).forEach(([code, entry]) => {
    const baseline = computeCareerBaseline(entry, playerHistoryData.seasons);
    if (baseline !== null) byCode[code] = baseline;
  });
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
export function buildLastSeasonStatsByCode(playerHistoryData) {
  const byCode = {};
  if (!playerHistoryData || !playerHistoryData.players || !playerHistoryData.seasons) return byCode;
  Object.entries(playerHistoryData.players).forEach(([code, entry]) => {
    const stats = getLastSeasonStats(entry, playerHistoryData.seasons);
    if (stats !== null) byCode[code] = stats;
  });
  return byCode;
}