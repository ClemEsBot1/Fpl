// Two quick suggestions for the coming gameweek, from every available
// player (not just your squad):
//
//   captain — the single highest predicted score this gameweek, the safe
//     armband pick.
//   differential — a lightly-owned player with real upside, scored by haul
//     chance weighted by how few managers own him, for climbing rank.
//
// Built from the same per-player predictions the rest of the app uses.

import { haulChance } from './captaincy.js';

const AVAILABLE = status => !['u', 'n', 'i', 's'].includes(status);

export function weeklyPicks(staticData, { diffMaxOwned = 8, diffShare = 0.6 } = {}) {
  if (!staticData || !Array.isArray(staticData.allPlayers)) return null;
  const pool = staticData.allPlayers
    .filter(p => AVAILABLE(p.status))
    .map(p => ({ p, pred: staticData.predictionsById[p.id] }))
    .filter(x => x.pred && x.pred.nextMatchPredicted > 0);
  if (!pool.length) return null;

  const captain = pool.reduce((best, x) => (x.pred.nextMatchPredicted > best.pred.nextMatchPredicted ? x : best));
  const topPred = captain.pred.nextMatchPredicted;

  const score = x => haulChance(x.p.positionId, x.pred.nextMatchPredicted) * (1 - x.p.selectedBy / 100);
  const differential = pool
    .filter(x => x.p.id !== captain.p.id && x.p.selectedBy > 0 && x.p.selectedBy <= diffMaxOwned && x.pred.nextMatchPredicted >= topPred * diffShare)
    .sort((a, b) => score(b) - score(a))[0] || null;

  return {
    captain: {
      player: captain.p,
      predicted: Math.round(captain.pred.nextMatchPredicted * 10) / 10,
      haul: haulChance(captain.p.positionId, captain.pred.nextMatchPredicted),
    },
    differential: differential ? {
      player: differential.p,
      predicted: Math.round(differential.pred.nextMatchPredicted * 10) / 10,
      owned: differential.p.selectedBy,
    } : null,
  };
}
