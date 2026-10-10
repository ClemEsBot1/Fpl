// When to play each chip. Looks across the upcoming gameweeks and finds the
// ones with the most favourable shape:
//
//   Bench Boost  — a double gameweek, where your whole 15 play twice.
//   Triple Captain — a double gameweek, for the extra captain match.
//   Free Hit — a blank gameweek, when many teams don't play and a normal
//              XI is hard to field.
//   Wildcard — a run of easy fixtures, or just before a big double.
//
// It works from the fixture list alone (not your squad), so it answers "the
// best week for this chip" rather than "how many points you'd gain". A
// double gameweek is one where some teams play twice; a blank is one where
// several teams don't play at all. squadChipWeeks, at the end, does answer
// it for your own squad.

import { xiPointsForWeek } from './transferPlan.js';

// How many teams playing twice makes a gameweek worth a Bench Boost or
// Triple Captain, and how many teams missing makes a Free Hit worth it.
const BIG_DOUBLE = 6;
const BIG_BLANK = 6;

// For each upcoming gameweek, how many teams play 0, 1 or 2+ times. Built
// from staticData.fixturesByTeam, which already lists only fixtures from
// the target gameweek onwards.
export function gameweekShapes(staticData, { horizon = 12 } = {}) {
  if (!staticData || !staticData.fixturesByTeam) return [];
  const target = staticData.targetEvent ? staticData.targetEvent.id : 1;
  const teamIds = Object.keys(staticData.fixturesByTeam);
  const totalTeams = teamIds.length || 20;

  // event -> team -> count
  const perEvent = new Map();
  teamIds.forEach(teamId => {
    staticData.fixturesByTeam[teamId].forEach(fx => {
      if (fx.event < target || fx.event > target + horizon - 1) return;
      let m = perEvent.get(fx.event);
      if (!m) { m = new Map(); perEvent.set(fx.event, m); }
      m.set(teamId, (m.get(teamId) || 0) + 1);
    });
  });

  const events = [];
  for (let e = target; e <= target + horizon - 1; e++) {
    const m = perEvent.get(e);
    if (!m) continue; // no fixtures loaded this far out
    let doubleTeams = 0;
    let playingTeams = 0;
    m.forEach(count => { playingTeams++; if (count >= 2) doubleTeams++; });
    const blankTeams = totalTeams - playingTeams;
    events.push({ event: e, doubleTeams, blankTeams, playingTeams });
  }
  return events;
}

// The best upcoming gameweek for each chip, or null when nothing upcoming
// stands out. Each suggestion: { chip, event, reason, strength } where
// strength is 'strong' | 'ok'.
export function planChips(staticData, { horizon = 12 } = {}) {
  const shapes = gameweekShapes(staticData, { horizon });
  if (!shapes.length) return { benchBoost: null, tripleCaptain: null, freeHit: null, wildcard: null };

  const doubles = shapes.filter(s => s.doubleTeams > 0).sort((a, b) => b.doubleTeams - a.doubleTeams);
  const blanks = shapes.filter(s => s.blankTeams > 0).sort((a, b) => b.blankTeams - a.blankTeams);

  const bestDouble = doubles[0] || null;
  const bestBlank = blanks[0] || null;

  const benchBoost = bestDouble ? {
    chip: 'Bench Boost',
    event: bestDouble.event,
    reason: `${bestDouble.doubleTeams} teams play twice in GW${bestDouble.event}, so all 15 of your players get two matches.`,
    strength: bestDouble.doubleTeams >= BIG_DOUBLE ? 'strong' : 'ok',
  } : null;

  const tripleCaptain = bestDouble ? {
    chip: 'Triple Captain',
    event: bestDouble.event,
    reason: `Captain a player from one of the ${bestDouble.doubleTeams} teams with two games in GW${bestDouble.event}.`,
    strength: bestDouble.doubleTeams >= BIG_DOUBLE ? 'strong' : 'ok',
  } : null;

  const freeHit = bestBlank ? {
    chip: 'Free Hit',
    event: bestBlank.event,
    reason: `${bestBlank.blankTeams} teams blank in GW${bestBlank.event}; a Free Hit fields a full XI without wrecking your squad.`,
    strength: bestBlank.blankTeams >= BIG_BLANK ? 'strong' : 'ok',
  } : null;

  // Wildcard: the gameweek just before the biggest double is a natural spot
  // to reshape the squad towards the teams with two games. Otherwise leave
  // it — an easy-fixture run needs your actual squad to judge.
  let wildcard = null;
  if (bestDouble && bestDouble.doubleTeams >= BIG_DOUBLE && bestDouble.event > (staticData.targetEvent ? staticData.targetEvent.id : 1)) {
    wildcard = {
      chip: 'Wildcard',
      event: bestDouble.event - 1,
      reason: `Reshape before the GW${bestDouble.event} double (${bestDouble.doubleTeams} teams play twice) so your squad is loaded with two-game players.`,
      strength: 'ok',
    };
  }

  return { benchBoost, tripleCaptain, freeHit, wildcard };
}

// The same question for your own squad, from its predictions week by week
// (each player's byGw): what Bench Boost and Triple Captain would add in
// each of the next few gameweeks. Bench Boost adds the four left out of the
// best XI; Triple Captain adds the captain's points once more.
// players: the 15 player objects. pointsById: { [id]: [week 0, week 1, …] }.
// events: the gameweek of each week. Returns { weeks: [{ event, benchBoost,
// tripleCaptain }], benchBoost, tripleCaptain }, the last two being the
// best week for each ({ event, gain }), or null with nothing to go on.
export function squadChipWeeks(players, pointsById, events) {
  if (!players.length || !events.length) return { weeks: [], benchBoost: null, tripleCaptain: null };
  const pointsOf = (p, k) => ((pointsById[p.id] || [])[k] || 0);
  const round = v => Math.round(v * 10) / 10;
  const weeks = events.map((event, k) => {
    const all = players.map(p => pointsOf(p, k));
    const captain = Math.max(0, ...all);
    const xi = xiPointsForWeek(players, pointsOf, k);
    return { event, benchBoost: round(Math.max(0, all.reduce((s, v) => s + v, 0) + captain - xi)), tripleCaptain: round(captain) };
  });
  const best = key => weeks.reduce((top, w) => (!top || w[key] > top.gain ? { event: w.event, gain: w[key] } : top), null);
  return { weeks, benchBoost: best('benchBoost'), tripleCaptain: best('tripleCaptain') };
}
