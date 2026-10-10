import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameweekShapes, planChips, squadChipWeeks } from '../src/lib/chipPlanner.js';

// Build staticData.fixturesByTeam for `teams` teams over a set of events,
// where `doubles[event]` teams play twice and `blanks[event]` teams don't
// play. Any team not doubled or blanked plays once.
function makeStatic({ target = 10, teams = 20, perEvent }) {
  const fixturesByTeam = {};
  for (let t = 1; t <= teams; t++) fixturesByTeam[t] = [];
  perEvent.forEach(({ event, doubles = 0, blanks = 0 }) => {
    for (let t = 1; t <= teams; t++) {
      const games = t <= doubles ? 2 : (t > teams - blanks ? 0 : 1);
      for (let g = 0; g < games; g++) fixturesByTeam[t].push({ event, opponent: 99, isHome: g === 0, difficulty: 3 });
    }
  });
  return { targetEvent: { id: target }, fixturesByTeam };
}

test('gameweek shapes count doubling and blanking teams', () => {
  const sd = makeStatic({ target: 10, perEvent: [
    { event: 10, doubles: 0, blanks: 0 },
    { event: 11, doubles: 8, blanks: 0 },
    { event: 12, doubles: 0, blanks: 9 },
  ] });
  const shapes = gameweekShapes(sd, { horizon: 5 });
  const byEvent = Object.fromEntries(shapes.map(s => [s.event, s]));
  assert.equal(byEvent[11].doubleTeams, 8);
  assert.equal(byEvent[12].blankTeams, 9);
  assert.equal(byEvent[10].doubleTeams, 0);
  assert.equal(byEvent[10].blankTeams, 0);
});

test('chips point at the biggest double and blank', () => {
  const sd = makeStatic({ target: 10, perEvent: [
    { event: 11, doubles: 4 },
    { event: 13, doubles: 8 },
    { event: 14, blanks: 7 },
  ] });
  const plan = planChips(sd, { horizon: 10 });
  assert.equal(plan.benchBoost.event, 13);
  assert.equal(plan.benchBoost.strength, 'strong');
  assert.equal(plan.tripleCaptain.event, 13);
  assert.equal(plan.freeHit.event, 14);
  assert.equal(plan.freeHit.strength, 'strong');
  // Wildcard lands the week before the big double.
  assert.equal(plan.wildcard.event, 12);
});

test('no doubles or blanks means no suggestions', () => {
  const sd = makeStatic({ target: 10, perEvent: [{ event: 10 }, { event: 11 }, { event: 12 }] });
  const plan = planChips(sd, { horizon: 5 });
  assert.equal(plan.benchBoost, null);
  assert.equal(plan.freeHit, null);
  assert.equal(plan.wildcard, null);
});

test('a small double is suggested but not marked strong, and skips a wildcard', () => {
  const sd = makeStatic({ target: 10, perEvent: [{ event: 12, doubles: 3 }] });
  const plan = planChips(sd, { horizon: 5 });
  assert.equal(plan.benchBoost.event, 12);
  assert.equal(plan.benchBoost.strength, 'ok');
  assert.equal(plan.wildcard, null, 'wildcard only before a big double');
});

test("a squad's chip weeks: Bench Boost adds the four outside the best XI, Triple Captain the captain once more", () => {
  // 2 GKP, 5 DEF, 5 MID, 3 FWD scoring 1..15 in GW7.
  const pos = [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4];
  const players = pos.map((positionId, i) => ({ id: i + 1, positionId }));
  const pointsById = Object.fromEntries(players.map((p, i) => [p.id, [i + 1, 1, 2]]));
  const plan = squadChipWeeks(players, pointsById, [7, 8, 9]);
  // Left out in GW7: the 1-point keeper and 3, 4 and 8.
  assert.deepEqual(plan.weeks[0], { event: 7, benchBoost: 16, tripleCaptain: 15 });
  assert.deepEqual(plan.benchBoost, { event: 7, gain: 16 });
  assert.deepEqual(plan.tripleCaptain, { event: 7, gain: 15 });
  assert.deepEqual(squadChipWeeks([], {}, []), { weeks: [], benchBoost: null, tripleCaptain: null });
});
