// How well did last gameweek's predictions do? Compares what the model
// predicted for each player before the deadline (saved by the daily
// refresh job, see api/refresh-optimal.js) with what they actually scored.

export function predictionsPathnameFor(gwId) {
  return `predictions-gw${gwId}.json`;
}

// predictedById: { [playerId]: predicted points }
// liveElements: FPL's event/{gw}/live/ `elements` ({ id, stats: { total_points, minutes } })
//
// Only players who actually played are scored — a prediction for someone
// who didn't feature says more about team news after the deadline than
// about the model.
// positionById (optional): { [playerId]: 1-4 }, for the miss by position.
export function summariseAccuracy(predictedById, liveElements, positionById = null) {
  const pairs = [];
  liveElements.forEach(el => {
    const predicted = predictedById[el.id];
    if (typeof predicted !== 'number' || !el.stats || !(el.stats.minutes > 0)) return;
    pairs.push({ id: el.id, predicted, actual: el.stats.total_points });
  });
  if (pairs.length < 20) return null;

  const n = pairs.length;
  const meanAbsError = pairs.reduce((s, p) => s + Math.abs(p.predicted - p.actual), 0) / n;
  const meanP = pairs.reduce((s, p) => s + p.predicted, 0) / n;
  const meanA = pairs.reduce((s, p) => s + p.actual, 0) / n;
  let cov = 0, varP = 0, varA = 0;
  pairs.forEach(p => {
    cov += (p.predicted - meanP) * (p.actual - meanA);
    varP += (p.predicted - meanP) ** 2;
    varA += (p.actual - meanA) ** 2;
  });
  const correlation = varP > 0 && varA > 0 ? cov / Math.sqrt(varP * varA) : 0;

  // Of the 10 players we rated highest, how did they actually do compared
  // with the average player who played?
  const top = [...pairs].sort((a, b) => b.predicted - a.predicted).slice(0, 10);
  const topAverageActual = top.reduce((s, p) => s + p.actual, 0) / top.length;
  const best = top[0];

  // How far off predictions usually are: half of players land within the
  // 50th percentile of misses, eight in ten within the 80th.
  const misses = pairs.map(p => Math.abs(p.predicted - p.actual)).sort((a, b) => a - b);
  const percentile = q => misses[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))];

  const round = (x, dp = 1) => Math.round(x * 10 ** dp) / 10 ** dp;

  // The typical miss for each position: { GKP: { players, meanAbsError }, … }.
  let byPosition = null;
  if (positionById) {
    byPosition = {};
    [[1, 'GKP'], [2, 'DEF'], [3, 'MID'], [4, 'FWD']].forEach(([pos, label]) => {
      const group = pairs.filter(p => positionById[p.id] === pos);
      if (group.length) byPosition[label] = { players: group.length, meanAbsError: round(group.reduce((s, p) => s + Math.abs(p.predicted - p.actual), 0) / group.length) };
    });
  }

  return {
    byPosition,
    playersCompared: n,
    meanAbsError: round(meanAbsError),
    missP50: round(percentile(0.5)),
    missP80: round(percentile(0.8)),
    missP90: round(percentile(0.9)),
    correlation: round(correlation, 2),
    topTenAverageActual: round(topAverageActual),
    averageActual: round(meanA),
    topPick: { id: best.id, predicted: round(best.predicted), actual: best.actual },
  };
}

// The latest gameweek that has finished and had its points confirmed.
export function latestFinishedEvent(events) {
  const done = (events || []).filter(e => e.finished && e.data_checked !== false);
  return done.length ? done[done.length - 1] : null;
}
