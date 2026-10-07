// Mini-leagues: the classic leagues a team is in, a league's standings, and
// what each member's team is predicted to score. Pure functions; the
// fetching is done by the mini-league screen.

// The private classic leagues on an FPL entry (entry/{id}/), the ones
// people mean by "mini-league". FPL's own leagues (overall, country, club,
// gameweek joined) have league_type 's'.
export function privateLeagues(entry) {
  const classic = entry && entry.leagues && Array.isArray(entry.leagues.classic) ? entry.leagues.classic : [];
  return classic
    .filter(l => l && l.league_type !== 's')
    .map(l => ({ id: l.id, name: l.name, rank: l.entry_rank ?? null }));
}

// leagues-classic/{id}/standings/ as { league: { id, name }, members, hasMore }.
// FPL sends 50 members a page; only the first page is used.
export function parseStandings(json) {
  if (!json || !json.league || !json.standings) return null;
  const members = (json.standings.results || []).map(r => ({
    entry: r.entry,
    teamName: r.entry_name,
    managerName: r.player_name,
    rank: r.rank,
    lastRank: r.last_rank,
    total: r.total,
    eventTotal: r.event_total,
  }));
  return { league: { id: json.league.id, name: json.league.name }, members, hasMore: !!json.standings.has_next };
}

// A squad's predicted points: the starting XI's, captain doubled (or
// tripled under Triple Captain) — the same figure as "predicted XI points"
// on Home and My team.
export function predictedXiTotal(squad) {
  return squad.reduce((sum, s) => (s.isStarting ? sum + s.predicted * (s.multiplier || 1) : sum), 0);
}

// Runs `fn` over `items` with at most `limit` at a time, calling `onEach`
// as each one settles. Errors are passed to onEach, never thrown.
export async function forEachLimited(items, limit, fn, onEach) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const item = items[next++];
      try { onEach(item, await fn(item), null); } catch (error) { onEach(item, null, error); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// A team's points so far in a gameweek from its picks and FPL's live
// scores: each pick's points times its multiplier (0 on the bench, 2 or 3
// for the captain, 1 for everyone under Bench Boost), less any transfer
// hit. Automatic substitutions aren't applied: FPL only confirms them
// once the gameweek is over.
export function livePointsFor(picks, liveById) {
  if (!picks || !Array.isArray(picks.picks)) return null;
  const points = picks.picks.reduce((sum, p) => sum + ((liveById[p.element] && liveById[p.element].totalPoints) || 0) * (p.multiplier || 0), 0);
  const hit = (picks.entry_history && picks.entry_history.event_transfers_cost) || 0;
  return points - hit;
}

// Where each member is expected to be after the next gameweek: their total
// (with live points for the gameweek in progress in place of FPL's figure)
// plus their predicted points. Members still loading are placed on their
// total alone. Ties share a position. Returns { [entry]: { projected, position } }.
export function expectedPositions(members, teams) {
  const projected = members.map(m => {
    const team = teams[m.entry];
    const ready = team && team.status === 'ready';
    const live = ready && typeof team.livePoints === 'number' ? team.livePoints : null;
    const base = live === null ? m.total : m.total - (m.eventTotal || 0) + live;
    return { entry: m.entry, projected: base + (ready ? team.xiTotal : 0) };
  });
  const sorted = [...projected].sort((a, b) => b.projected - a.projected);
  const out = {};
  sorted.forEach((p, i) => {
    const position = i > 0 && Math.abs(p.projected - sorted[i - 1].projected) < 1e-9 ? out[sorted[i - 1].entry].position : i + 1;
    out[p.entry] = { projected: Math.round(p.projected * 10) / 10, position };
  });
  return out;
}
