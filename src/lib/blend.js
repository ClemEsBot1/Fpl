// The app's predictions blend the formula's (src/lib/predictions.js) with
// the ML model's (scripts/ml/): w × model + (1 − w) × formula, with one
// weight w per position. The weights are learned from finished gameweeks
// (fitBlendWeights, run by the daily refresh job, see
// src/lib/modelWeeks.js), so whichever of the two has been nearer lately
// counts for more, while both keep improving on their own: the model is
// retrained every day and the formula has its own calibration.

// Before there are finished gameweeks to learn from, and to shrink toward
// while there are only a few: half each.
export const BLEND_PRIOR = { 1: 0.5, 2: 0.5, 3: 0.5, 4: 0.5 };
// How many gameweeks the prior counts as: with 4 weeks of results the
// fitted weight and the prior count the same.
export const BLEND_PRIOR_WEEKS = 4;
// Both always count for something, so neither drops out of the app's
// figures on a few odd weeks.
export const BLEND_MIN = 0.1;
export const BLEND_MAX = 0.9;

const GRID = Array.from({ length: 21 }, (_, i) => i / 20);
const round2 = x => Math.round(x * 100) / 100;

export function blendValue(formula, ml, w) {
  return w * ml + (1 - w) * formula;
}

// Valid weights ({ 1..4: 0-1 }) from a saved weights file, or the prior.
export function blendWeightsFrom(data) {
  const w = data && data.weights;
  if (!w) return { ...BLEND_PRIOR };
  const out = {};
  for (const pos of [1, 2, 3, 4]) {
    const v = Number(w[pos]);
    out[pos] = Number.isFinite(v) && v >= 0 && v <= 1 ? v : BLEND_PRIOR[pos];
  }
  return out;
}

// { [playerId]: blended points } from the two models' { [playerId]: points }.
// A player the model has nothing for keeps the formula's figure.
export function blendPredictions(formula, ml, positionById, weights) {
  const out = {};
  for (const [id, f] of Object.entries(formula)) {
    const m = ml[id];
    const w = weights[positionById[id]];
    out[id] = typeof m === 'number' && typeof w === 'number' ? round2(blendValue(f, m, w)) : f;
  }
  return out;
}

// The weight per position that would have missed by least (mean absolute
// error, players who played, as src/lib/accuracy.js scores) over `weeks`:
// [{ formula, ml, live, positionById }], formula and ml being
// { [playerId]: points } and live FPL's event/{gw}/live/ elements. Shrunk
// toward the prior by how many weeks there were, and kept within
// BLEND_MIN-BLEND_MAX.
export function fitBlendWeights(weeks, prior = BLEND_PRIOR) {
  const weights = {};
  const weeksByPosition = {};
  for (const pos of [1, 2, 3, 4]) {
    const errors = GRID.map(() => 0);
    let n = 0;
    let weeksUsed = 0;
    for (const { formula, ml, live, positionById } of weeks) {
      let used = false;
      for (const el of live) {
        if (positionById[el.id] !== pos || !el.stats || !(el.stats.minutes > 0)) continue;
        const f = formula[el.id];
        const m = ml[el.id];
        if (typeof f !== 'number' || typeof m !== 'number') continue;
        const actual = el.stats.total_points;
        GRID.forEach((w, i) => { errors[i] += Math.abs(blendValue(f, m, w) - actual); });
        n++;
        used = true;
      }
      if (used) weeksUsed++;
    }
    const best = n ? GRID[errors.indexOf(Math.min(...errors))] : prior[pos];
    const shrunk = (weeksUsed * best + BLEND_PRIOR_WEEKS * prior[pos]) / (weeksUsed + BLEND_PRIOR_WEEKS);
    weights[pos] = round2(Math.min(BLEND_MAX, Math.max(BLEND_MIN, shrunk)));
    weeksByPosition[pos] = weeksUsed;
  }
  return { weights, weeks: Math.max(0, ...Object.values(weeksByPosition)) };
}
