// Two explanations that sit next to a player's predicted points:
//
//   predictionRange — a rough low–high band around the single predicted
//     number, so a steady pick and a boom-or-bust one don't look the same.
//   pickReasons — a few short phrases for *why* a player is suggested
//     (good fixtures, in form, nailed, on penalties, a differential…).
//
// Both are heuristics built from figures the prediction already trusts
// (see computePlayerPrediction and captaincy.js). The range is a plausible
// spread, not a statistical confidence interval, and is labelled that way
// in the UI.

import { haulChance } from './captaincy.js';

// Points in a genuinely good ("haul") game, by position — a rough ceiling
// a returning player reaches, not an average.
const HAUL_POINTS = { 1: 8, 2: 9, 3: 10, 4: 9 };

// How likely the player is to actually start, from FPL's availability
// flags, falling back to how often he has featured this season. 1 = a
// settled starter, 0 = ruled out.
export function startProbability(player) {
  if (!player) return 1;
  const chance = player.chanceNext;
  const hasChance = chance === 0 || (Number.isFinite(chance) && chance >= 0);
  // A non-'a' status (doubtful, injured, suspended, unavailable, loaned).
  if (player.status && player.status !== 'a') {
    if (hasChance) return Math.max(0, Math.min(1, chance / 100));
    return player.status === 'd' ? 0.5 : 0; // doubtful vs ruled out
  }
  if (hasChance) return Math.max(0, Math.min(1, chance / 100));
  if (Number.isFinite(player.appearanceShare)) return Math.max(0.3, Math.min(1, player.appearanceShare));
  return 1;
}

// A plausible low–high band for the next match. Monotonic in the inputs: a
// higher prediction lifts both ends, a fitness doubt drops the floor, a
// bigger haul chance lifts the ceiling. floor <= expected <= ceiling always.
export function predictionRange(prediction, player) {
  const expected = Math.max(0, (prediction && prediction.nextMatchPredicted) || 0);
  const pos = (player && player.positionId) || 3;
  const sp = startProbability(player);
  const haul = haulChance(pos, expected); // 0..1

  // Floor: a quiet game, dragged towards 0 when a start is in doubt.
  const floor = Math.max(0, expected * (0.35 + 0.35 * sp) - (1 - sp) * 1.5);
  // Ceiling: part of the way from the expected score to a full haul, by how
  // realistic a haul looks for this player.
  const ceiling = expected + (Math.max(HAUL_POINTS[pos], expected) - expected) * Math.min(0.85, 0.2 + haul * 1.5);

  const r = n => Math.round(n * 10) / 10;
  return {
    floor: r(Math.min(floor, expected)),
    expected: r(expected),
    ceiling: r(Math.max(ceiling, expected)),
  };
}

// Up to `max` short phrases explaining why a player stands out, strongest
// first. Only genuinely positive signals — a fitness doubt is a risk shown
// elsewhere, not a reason. Returns [] when nothing stands out.
export function pickReasons(prediction, player, { max = 3 } = {}) {
  if (!prediction || !player) return [];
  const b = prediction.breakdown || {};
  const reasons = [];

  if (prediction.isDoubleThisEvent) reasons.push({ w: 100, text: 'Double gameweek' });

  const fixtureMult = typeof b.fixtureMult === 'number' ? b.fixtureMult : 1;
  if (fixtureMult >= 1.08) reasons.push({ w: 90, text: 'Great fixtures' });
  else if (fixtureMult >= 1.03) reasons.push({ w: 70, text: 'Good fixtures' });

  if (b.formEligible && b.form >= 6) reasons.push({ w: 85, text: 'In hot form' });
  else if (b.formEligible && b.form >= 4.5) reasons.push({ w: 60, text: 'In form' });

  const oddsAdj = typeof b.oddsAdjustment === 'number' ? b.oddsAdjustment : 0;
  if (oddsAdj >= 0.4) reasons.push({ w: 80, text: 'Bookmakers back a return' });

  if (player.penaltiesOrder === 1) reasons.push({ w: 75, text: 'On penalties' });
  else if (player.directFreekicksOrder === 1 || player.cornersOrder === 1) reasons.push({ w: 45, text: 'Takes set pieces' });

  const appear = typeof player.appearanceShare === 'number' ? player.appearanceShare : null;
  if (appear !== null && appear >= 0.9 && (!player.status || player.status === 'a')) reasons.push({ w: 55, text: 'Nailed starter' });

  if (player.selectedBy > 0 && player.selectedBy < 5 && prediction.nextMatchPredicted >= 3.5) {
    reasons.push({ w: 50, text: 'Low-owned differential' });
  }

  if (b.xgAdjustment >= 0.4) reasons.push({ w: 48, text: 'Underlying numbers strong' });

  return reasons.sort((a, c) => c.w - a.w).slice(0, max).map(r => r.text);
}
