// Formula v ML model v their blend (src/lib/blend.js): each one's
// predictions for a finished gameweek, made before its deadline, scored against what the players actually scored —
// player by player (src/lib/accuracy.js) and by the best £100m XI each
// would have picked. For the admin page's head-to-head.
import { summariseAccuracy } from './accuracy.js';
import { buildOptimalTeam, SQUAD_BUDGET } from './predictions.js';

// The best £100m squad `predictedById` would have picked from staticData's
// players and prices, and what its XI scored, captain doubled.
function bestXi(staticData, predictedById, pointsById) {
  const predictionsById = {};
  for (const p of staticData.allPlayers) {
    const v = typeof predictedById[p.id] === 'number' ? predictedById[p.id] : 0;
    predictionsById[p.id] = { predicted: v, nextMatchPredicted: v, selectionValue: v, nextMatchSelectionValue: v };
  }
  const { squad, captainId } = buildOptimalTeam({ ...staticData, predictionsById }, SQUAD_BUDGET);
  const xi = squad.filter(s => s.isStarting).map(s => s.player.id);
  const points = xi.reduce((s, id) => s + (pointsById[id] || 0) * (id === captainId ? 2 : 1), 0);
  return { xiPoints: points, xiPlayerIds: xi, captainId };
}

// The model's figures as the app would use them: the model's file doesn't
// allow for injuries and suspensions (the app scales it when it serves it),
// while the formula's figure does, so a player the formula had at 0 is 0
// for the model too.
export function modelGatedBy(formula, ml) {
  return Object.fromEntries(Object.entries(ml).map(([id, v]) => [id, formula[id] > 0 ? v : 0]));
}

// formula, ml, blend: { [playerId]: points predicted for the gameweek }
// (blend optional). live: FPL's event/{gw}/live/ elements. staticData: the
// players and prices to pick the XI from (today's: FPL doesn't keep a
// gameweek's prices).
export function compareGameweek({ formula, ml, blend = null, live, positionById, staticData }) {
  const pointsById = Object.fromEntries(live.map(el => [el.id, (el.stats && el.stats.total_points) || 0]));
  const score = preds => {
    const summary = summariseAccuracy(preds, live, positionById);
    return summary ? { ...summary, ...bestXi(staticData, preds, pointsById) } : null;
  };
  return { formula: score(formula), ml: score(modelGatedBy(formula, ml)), blend: blend ? score(blend) : null };
}
