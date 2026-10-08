import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOddsByTeam, computeOddsAdjustment, devigMatchOdds, matchOddsToFixtures, normalizeTeamName, oddsAdjustmentForMatches } from '../src/lib/oddsAdjustment.js';

test("bookmakers' team names match FPL's", () => {
  const same = (a, b) => assert.equal(normalizeTeamName(a), normalizeTeamName(b), `${a} / ${b}`);
  same('Leicester City', 'Leicester');
  same('Ipswich Town', 'Ipswich');
  same('Brighton & Hove Albion', 'Brighton');
  same('West Bromwich Albion', 'West Brom');
  same('AFC Bournemouth', 'Bournemouth');
  same('Manchester City', 'Man City');
  same('Tottenham Hotspur', 'Spurs');
  assert.notEqual(normalizeTeamName('Manchester United'), normalizeTeamName('Manchester City'));
});

test('odds are matched to the fixture by team names and kickoff', () => {
  const teamsById = { 1: { id: 1, name: 'Leicester', short_name: 'LEI' }, 2: { id: 2, name: 'Man City', short_name: 'MCI' } };
  const fixtures = [{ event: 3, team_h: 1, team_a: 2, kickoff_time: '2026-08-30T14:00:00Z' }];
  const outcomes = [{ name: 'Leicester City', price: 6 }, { name: 'Draw', price: 4.5 }, { name: 'Manchester City', price: 1.5 }];
  const events = [{ commence_time: '2026-08-30T14:00:00Z', home_team: 'Leicester City', away_team: 'Manchester City', bookmakers: [{ markets: [{ key: 'h2h', outcomes }] }] }];
  assert.deepEqual(matchOddsToFixtures(events, fixtures, teamsById), [{ event: 3, homeTeamId: 1, awayTeamId: 2, homeWinOdds: 6, drawOdds: 4.5, awayWinOdds: 1.5 }]);
});

test('a double gameweek averages the odds nudge over both matches', () => {
  const oddsData = [
    { event: 5, homeTeamId: 1, awayTeamId: 2, homeWinOdds: 1.4, drawOdds: 5, awayWinOdds: 8 },
    { event: 5, homeTeamId: 3, awayTeamId: 1, homeWinOdds: 1.4, drawOdds: 5, awayWinOdds: 8 },
    { event: 6, homeTeamId: 1, awayTeamId: 4, homeWinOdds: 2, drawOdds: 3.4, awayWinOdds: 3.8 },
  ];
  const byTeam = Object.fromEntries(Object.entries(buildOddsByTeam(oddsData, 5)).map(([team, byEvent]) => [team, byEvent[5]]));
  assert.equal(byTeam[1].length, 2, 'both of team 1\'s matches that week');
  assert.equal(byTeam[4], undefined);
  const probs = devigMatchOdds(1.4, 5, 8);
  const homeFavourite = computeOddsAdjustment({ probs, isHome: true, positionId: 4 });
  const awayUnderdog = computeOddsAdjustment({ probs, isHome: false, positionId: 4 });
  assert.ok(homeFavourite > 0 && awayUnderdog < 0);
  assert.equal(oddsAdjustmentForMatches(byTeam[1], 4), (homeFavourite + awayUnderdog) / 2);
  assert.equal(oddsAdjustmentForMatches(undefined, 4), 0);
});

test('odds are kept for every priced gameweek from the target on', () => {
  const m = (event, homeTeamId, awayTeamId) => ({ event, homeTeamId, awayTeamId, homeWinOdds: 2, drawOdds: 3.4, awayWinOdds: 3.8 });
  const byTeam = buildOddsByTeam([m(4, 1, 2), m(5, 1, 3), m(6, 2, 1), m(6, 4, 5)], 5);
  assert.deepEqual(Object.keys(byTeam[1]), ['5', '6']);
  assert.equal(byTeam[1][6][0].isHome, false);
  assert.equal(byTeam[2][4], undefined, 'before the target');
});
