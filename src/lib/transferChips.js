// The two transfer chips for your own squad, with your own money (what your
// players sell for plus the bank), and when each is worth playing:
//
//   Wildcard — the new squad stays, so it's picked on the predictions over
//              the next few gameweeks (wildcardSquad), and judged on what it
//              adds across them.
//   Free Hit — the squad goes back after the deadline, so each week's Free
//              Hit squad is picked on that one gameweek's points alone, and
//              the best week is the one where that beats your squad by most.
//
// Each week is scored as the best XI with the captain doubled
// (xiPointsForWeek), for your squad and the chip's alike.

import { buildOptimalTeam } from './predictions.js';
import { sellPriceOf, wildcardSquad } from './squadLogic.js';
import { xiPointsForWeek } from './transferPlan.js';

export const PLAN_WEEKS = 5;
// The first of each chip has to be played by this gameweek; the second
// comes in the gameweek after (FPL gives one of each per half).
export const FIRST_HALF_LAST_GW = 19;

const round1 = v => Math.round(v * 10) / 10;
const pointsAt = (predictionsById, id, k) => {
  const byGw = predictionsById[id] && predictionsById[id].byGw;
  return byGw && byGw[k] ? byGw[k].points : 0;
};
// The gameweeks covered, from any player's byGw.
function planEvents(predictionsById, weeks) {
  const any = Object.values(predictionsById).find(p => p && Array.isArray(p.byGw) && p.byGw.length);
  return any ? any.byGw.slice(0, weeks).map(w => w.event) : [];
}
const xiAt = (players, predictionsById, k) => xiPointsForWeek(players, p => pointsAt(predictionsById, p.id, k), k);

// The squad you'd change to and what goes out and comes in, for a squad
// built by buildOptimalTeam from `squad`'s own players and the market.
function changes(squad, built) {
  const mine = new Set(squad.map(s => s.player.id));
  const next = new Set(built.squad.map(s => s.player.id));
  return {
    ins: built.squad.filter(s => !mine.has(s.player.id)).map(s => s.player).sort((a, b) => a.positionId - b.positionId),
    outs: squad.filter(s => !next.has(s.player.id)).map(s => s.player).sort((a, b) => a.positionId - b.positionId),
  };
}

// Wildcard: the squad from wildcardSquad, with your squad's and its points
// week by week over the next PLAN_WEEKS: { ...wildcardSquad, weeks: [{
// event, now, chip, gain }], gain } (gain: the weeks' total).
export function wildcardPlan(squad, bankTenths, allPlayers, predictionsById, weeks = PLAN_WEEKS) {
  const wc = wildcardSquad(squad, bankTenths, allPlayers, predictionsById);
  const mine = squad.map(s => s.player);
  const theirs = wc.squad.map(s => s.player);
  const rows = planEvents(predictionsById, weeks).map((event, k) => {
    const now = xiAt(mine, predictionsById, k);
    const chip = xiAt(theirs, predictionsById, k);
    return { event, now: round1(now), chip: round1(chip), gain: round1(chip - now) };
  });
  return { ...wc, weeks: rows, gain: round1(rows.reduce((s, w) => s + w.gain, 0)) };
}

// Free Hit: for each of the next PLAN_WEEKS gameweeks, the best squad for
// that week only, against yours: { weeks: [{ event, now, chip, gain, squad,
// ins, outs, bankTenths }], best } (best: the week it adds most, or null).
// Owned players count at their selling price, as on a wildcard.
export function freeHitPlan(squad, bankTenths, allPlayers, predictionsById, weeks = PLAN_WEEKS) {
  const sell = new Map(squad.map(s => [s.player.id, sellPriceOf(s)]));
  const budgetTenths = squad.reduce((sum, s) => sum + Math.round(sellPriceOf(s) * 10), 0) + (bankTenths || 0);
  const players = allPlayers.map(p => (sell.has(p.id) ? { ...p, price: sell.get(p.id) } : p));
  const mine = squad.map(s => s.player);
  const rows = planEvents(predictionsById, weeks).map((event, k) => {
    // That week's points stand in for every prediction the squad builder
    // reads. This week keeps its shrunk selection value, as the best squad
    // does; later weeks have only their points.
    const week = {};
    Object.entries(predictionsById).forEach(([id, p]) => {
      const v = pointsAt(predictionsById, id, k);
      const pick = k === 0 && Number.isFinite(p.nextMatchSelectionValue) ? p.nextMatchSelectionValue : v;
      week[id] = { ...p, predicted: v, nextMatchPredicted: v, selectionValue: pick, nextMatchSelectionValue: pick };
    });
    const built = buildOptimalTeam({ allPlayers: players, predictionsById: week }, budgetTenths / 10);
    const now = xiAt(mine, predictionsById, k);
    const chip = xiAt(built.squad.map(s => s.player), predictionsById, k);
    return { event, now: round1(now), chip: round1(chip), gain: round1(chip - now), squad: built.squad, bankTenths: built.bankTenths, ...changes(squad, built) };
  });
  const best = rows.reduce((top, w) => (!top || w.gain > top.gain ? w : top), null);
  return { budgetTenths, weeks: rows, best };
}
