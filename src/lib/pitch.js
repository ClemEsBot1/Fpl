// Small helpers for drawing a squad on a pitch (src/components/Pitch.jsx).
import { POSITION_LABELS } from './format.js';

// FPL's own shirt images, by the club's code (goalkeepers wear _1).
export function shirtUrl(team, isKeeper) {
  return team && team.code ? `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${team.code}${isKeeper ? '_1' : ''}-110.webp` : null;
}

// The next fixture as FPL writes it: "MCI (H)".
export function nextFixtureLabel(player, fixturesByTeam, teamsById) {
  const next = fixturesByTeam && fixturesByTeam[player.team] ? fixturesByTeam[player.team][0] : null;
  if (!next) return '';
  const opp = teamsById[next.opponent];
  return `${opp ? opp.short_name : '?'} (${next.isHome ? 'H' : 'A'})`;
}

// The bench as FPL labels it: the goalkeeper, then the outfield
// substitutes in the order they come on ("1. FWD", "2. DEF").
export function benchLabels(bench) {
  let outfield = 0;
  return bench.map(slot => {
    if (slot.player.positionId === 1) return 'GKP';
    outfield += 1;
    return `${outfield}. ${POSITION_LABELS[slot.player.positionId]}`;
  });
}
