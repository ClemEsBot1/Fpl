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
