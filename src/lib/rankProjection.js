// Where a manager's overall rank is heading by the end of the season if they
// keep scoring as they have, with a range for a good or bad run, from their
// FPL history and each gameweek's average score. A "what if", not a
// forecast: checked against 2026-27's GW5 to GW8, ranks move about as much
// as the range allows, but no more predictably than "stays where it is".
//
// A rank is how far your total is above the average manager's, against how
// spread out everyone's totals are. Both grow through the season:
//   - your gap to the average grows at your pace: half your season's
//     points-above-average a week, half the last few weeks';
//   - the spread grows about as gameweeks^0.56 (fitted to managers' ranks
//     and gaps through 2026-27 so far). Today's spread is read off your own
//     rank and gap, which also covers the field being lopsided (a long tail
//     of teams far below average makes it wider below than above).
// The range is 1.5 times your week-to-week swing either way over the weeks
// left, which held about two thirds of the actual ranks in that check.

export const LAST_GW = 38;
const GROWTH = 0.56;
const RECENT_WEEKS = 6;
const PERSIST = 1; // share of your pace that carries on
const RANGE_SCALE = 1.5;
const MIN_WEEKS = 4;
// Spread a gameweek in, when your rank is too close to the middle to read
// it: above the average, and below it (wider: the tail of idle teams).
const SPREAD_ABOVE = 17;
const SPREAD_BELOW = 37;

// The standard normal's cumulative distribution (Abramowitz–Stegun 7.1.26).
export function normCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const k = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * k - 1.453152027) * k) + 1.421413741) * k - 0.284496736) * k + 0.254829592) * k * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// Its inverse (Acklam's approximation), for p in (0, 1).
export function normInv(p) {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155211313];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const tail = q => (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  if (p < 0.02425) return tail(Math.sqrt(-2 * Math.log(p)));
  if (p > 1 - 0.02425) return -tail(Math.sqrt(-2 * Math.log(1 - p)));
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

// Rounded the way people say ranks: 2 significant figures (253,481 → 250,000).
export function roundRank(rank) {
  if (!(rank >= 1)) return 1;
  if (rank < 100) return Math.round(rank);
  const step = 10 ** (Math.floor(Math.log10(rank)) - 1);
  return Math.round(rank / step) * step;
}

// current: FPL's entry/<id>/history/ current list ([{ event, points,
// total_points, overall_rank, event_transfers_cost }]); averages: { [gw]:
// average score } (bootstrap events' average_entry_score); totalPlayers:
// bootstrap's total_players. Returns { rank, best, worst, gw, weeksLeft,
// pace } or null when there's too little to go on (under four gameweeks)
// or the season is over.
export function rankProjection(current, averages, totalPlayers, lastGw = LAST_GW, { persist = PERSIST, rangeScale = RANGE_SCALE, growth = GROWTH } = {}) {
  const rows = (Array.isArray(current) ? current : [])
    .filter(r => r && Number.isFinite(r.points) && Number.isFinite(r.total_points) && r.overall_rank > 0 && Number.isFinite(averages[r.event]))
    .sort((a, b) => a.event - b.event);
  if (rows.length < MIN_WEEKS || !(totalPlayers > 1)) return null;
  const latest = rows[rows.length - 1];
  const weeksLeft = lastGw - latest.event;
  if (weeksLeft < 1) return null;

  // Each week's points above the average (after any hit), and the gap so far.
  const weekly = rows.map(r => r.points - (r.event_transfers_cost || 0) - averages[r.event]);
  const averageTotal = Object.entries(averages).filter(([gw]) => Number(gw) <= latest.event).reduce((s, [, v]) => s + v, 0);
  const gap = latest.total_points - averageTotal;
  const recent = weekly.slice(-RECENT_WEEKS);
  const mean = list => list.reduce((s, v) => s + v, 0) / list.length;
  const pace = persist * (gap / latest.event + mean(recent)) / 2;
  const swing = Math.max(10, Math.sqrt(mean(weekly.map(v => (v - mean(weekly)) ** 2))));

  // Today's spread, from where your rank puts your gap; the usual one when
  // you're near the middle, where that can't be read.
  const zNow = normInv(Math.min(1 - 1e-9, Math.max(1e-9, 1 - latest.overall_rank / totalPlayers)));
  const usual = (gap >= 0 ? SPREAD_ABOVE : SPREAD_BELOW) * latest.event ** growth;
  const spreadNow = Math.abs(zNow) >= 0.3 && Math.sign(zNow) === Math.sign(gap) ? gap / zNow : usual;
  const spreadEnd = spreadNow * (lastGw / latest.event) ** growth;

  const rankFor = endGap => Math.max(1, Math.min(totalPlayers, totalPlayers * (1 - normCdf(endGap / spreadEnd))));
  const endGap = gap + pace * weeksLeft;
  const spreadOfGap = rangeScale * swing * Math.sqrt(weeksLeft);
  return {
    rank: roundRank(rankFor(endGap)),
    best: roundRank(rankFor(endGap + spreadOfGap)),
    worst: roundRank(rankFor(endGap - spreadOfGap)),
    gw: latest.event,
    weeksLeft,
    pace: Math.round(pace * 10) / 10,
  };
}
