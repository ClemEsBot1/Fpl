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

// seasonsOldestToNewest: the master `seasons` array from the imported blob
// (chronological order, e.g. ['2016-17', ..., '2025-26']).
export function computeCareerBaseline(playerHistoryEntry, seasonsOldestToNewest) {
  if (!playerHistoryEntry || !playerHistoryEntry.seasons || !seasonsOldestToNewest) return null;
  const recentFirst = [...seasonsOldestToNewest].reverse();
  let weightedPoints = 0;
  let weightedMinutes = 0;
  let weightIdx = 0;
  for (const season of recentFirst) {
    const stats = playerHistoryEntry.seasons[season];
    if (!stats || !stats.minutes || stats.minutes <= 0 || stats.total_points === undefined) continue;
    const weight = RECENCY_WEIGHTS[weightIdx] ?? 1;
    weightedPoints += weight * stats.total_points;
    weightedMinutes += weight * stats.minutes;
    weightIdx++;
    if (weightIdx >= RECENCY_WEIGHTS.length) break;
  }
  if (weightedMinutes <= 0) return null; // no usable playing-time history at all
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
