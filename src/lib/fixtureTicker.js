// The fixture ticker on the home screen: each club's fixtures over the
// next few gameweeks, easiest run first.
//
// fixturesByTeam: { [teamId]: [{ event, opponent, isHome, difficulty }] }
// (from buildStaticDataFromRaw). Returns rows of
// { team, weeks: [{ gw, fixtures: [{ opponent, isHome, difficulty }] }], ease }.
// `ease` adds up (6 - difficulty) for every fixture in the window, so a
// double gameweek counts twice and a blank gameweek counts for nothing.
export function buildFixtureTicker(fixturesByTeam, teamsById, fromGw, weeks = 5) {
  const gws = Array.from({ length: weeks }, (_, k) => fromGw + k).filter(gw => gw <= 38);
  const rows = Object.values(teamsById || {}).map(team => {
    const list = (fixturesByTeam && fixturesByTeam[team.id]) || [];
    const byWeek = gws.map(gw => ({
      gw,
      fixtures: list.filter(f => f.event === gw).map(f => ({ opponent: teamsById[f.opponent], isHome: f.isHome, difficulty: f.difficulty })),
    }));
    const ease = byWeek.reduce((sum, w) => sum + w.fixtures.reduce((s, f) => s + (6 - (f.difficulty || 3)), 0), 0);
    return { team, weeks: byWeek, ease };
  });
  rows.sort((a, b) => b.ease - a.ease || a.team.short_name.localeCompare(b.team.short_name));
  return { gws, rows };
}
