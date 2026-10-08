// Captaincy beyond the single best prediction: how likely a player is to
// haul (10+ points), and a differential pick for climbing rank.
//
// Haul rates come from 2022-23 to 2025-26 (scripts/backtest.mjs with
// HAUL_TABLE=1): every player's gameweek prediction against whether he
// then scored 10+, by position group. The chance climbs with the
// prediction almost the same way for every position, so the safest
// captain (highest prediction) is also the likeliest to haul. What
// changes the choice is ownership: a haul from a player few others own
// moves your rank far more than one everybody has.

// [prediction, chance of 10+], read between the points.
const HAUL_RATES = {
  def: [[0, 0], [1.5, 0.003], [2.5, 0.021], [3.5, 0.043], [4.5, 0.092], [5.5, 0.134], [6.5, 0.216], [7.5, 0.286], [9, 0.44], [12, 0.6]],
  mid: [[0, 0], [1.5, 0.003], [2.5, 0.027], [3.5, 0.079], [4.5, 0.138], [5.5, 0.187], [6.5, 0.247], [7.5, 0.354], [9, 0.431], [12, 0.6]],
  fwd: [[0, 0], [1.5, 0.006], [2.5, 0.037], [3.5, 0.064], [4.5, 0.113], [5.5, 0.182], [6.5, 0.294], [7.5, 0.36], [9, 0.4], [12, 0.55]],
};

export function haulChance(positionId, predicted) {
  const rows = HAUL_RATES[positionId <= 2 ? 'def' : positionId === 3 ? 'mid' : 'fwd'];
  const x = Math.max(0, predicted || 0);
  if (x >= rows[rows.length - 1][0]) return rows[rows.length - 1][1];
  const k = rows.findIndex(([at]) => at > x);
  const [x0, y0] = rows[k - 1];
  const [x1, y1] = rows[k];
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

// Every starter as a captain option, best prediction first:
// { slot, expected, haul, owned } (owned: % of all managers).
export function captainOptions(starters) {
  return starters
    .map(slot => ({
      slot,
      expected: slot.nextMatchPredicted,
      haul: haulChance(slot.player.positionId, slot.nextMatchPredicted),
      owned: slot.player.selectedBy || 0,
    }))
    .sort((a, b) => b.expected - a.expected);
}

// A captain for climbing rank: close to the best prediction (within
// DIFF_SHARE of it) but owned by far fewer managers, scored by haul chance
// times the share of managers who don't own him. null when the safest
// pick is already the best for that, or nobody qualifies.
const DIFF_SHARE = 0.8;
const DIFF_MAX_OWNED = 20;
export function differentialCaptain(options) {
  const safe = options[0];
  if (!safe) return null;
  const score = o => o.haul * (1 - o.owned / 100);
  const pick = options
    .filter(o => o !== safe && o.expected >= safe.expected * DIFF_SHARE && o.owned <= DIFF_MAX_OWNED && o.owned < safe.owned - 10)
    .sort((a, b) => score(b) - score(a))[0];
  return pick && score(pick) > score(safe) ? pick : null;
}
