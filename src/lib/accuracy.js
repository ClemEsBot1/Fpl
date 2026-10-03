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
export function summariseAccuracy(predictedById, liveElements) {
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

  const round = (x, dp = 1) => Math.round(x * 10 ** dp) / 10 ** dp;
  return {
    playersCompared: n,
    meanAbsError: round(meanAbsError),
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
