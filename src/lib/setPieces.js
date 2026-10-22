// Who takes penalties, direct free kicks and corners, from FPL's own
// per-player order (1 = first choice): tags for a player's row and each
// club's takers for the set-piece table.

// A player's duties: first choice for each, and second on penalties (a
// second taker still gets them often enough to matter).
export function setPieceTags(p) {
  const tags = [];
  if (p.penaltiesOrder === 1) tags.push('Pens');
  else if (p.penaltiesOrder === 2) tags.push('Pens (2nd)');
  if (p.directFreekicksOrder === 1) tags.push('FKs');
  if (p.cornersOrder === 1) tags.push('Corners');
  return tags;
}

const ordered = (players, key) => players
  .filter(p => Number.isInteger(p[key]) && p[key] > 0)
  .sort((a, b) => a[key] - b[key]);

// [{ team, penalties, freekicks, corners }] for every club, by name; each
// list is that club's players in FPL's order.
export function clubSetPieces(allPlayers, teamsById) {
  const byTeam = {};
  (allPlayers || []).forEach(p => { (byTeam[p.team] = byTeam[p.team] || []).push(p); });
  return Object.values(teamsById || {})
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .map(team => {
      const players = byTeam[team.id] || [];
      return {
        team,
        penalties: ordered(players, 'penaltiesOrder'),
        freekicks: ordered(players, 'directFreekicksOrder'),
        corners: ordered(players, 'cornersOrder'),
      };
    });
}
