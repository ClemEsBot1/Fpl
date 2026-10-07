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

// One member's numbers for the league analysis, from their picks for the
// latest gameweek to have started (`gw`), FPL's live scores for it, their
// transfers, entry/{id}/ and entry/{id}/history/. Anything missing is null.
export function memberWeekStats({ gw, picks, liveById = {}, transfers, entry, history }) {
  const pts = id => (liveById[id] && liveById[id].totalPoints) || 0;
  const list = picks && Array.isArray(picks.picks) ? picks.picks : [];
  const captain = list.find(p => p.is_captain) || null;
  const thisWeek = Array.isArray(transfers) ? transfers.filter(t => t.event === gw) : [];
  const hit = (picks && picks.entry_history && picks.entry_history.event_transfers_cost) || 0;
  const pastRanks = history && Array.isArray(history.past) ? history.past.map(s => s.rank).filter(r => r > 0) : [];
  const overall = entry && entry.summary_overall_rank > 0 ? entry.summary_overall_rank : null;
  const ranks = overall ? [...pastRanks, overall] : pastRanks;
  return {
    playerIds: list.map(p => p.element),
    captainId: captain ? captain.element : null,
    captainPoints: captain ? pts(captain.element) : null,
    benchPoints: list.length ? list.filter(p => !p.multiplier).reduce((s, p) => s + pts(p.element), 0) : null,
    transfersIn: thisWeek.map(t => t.element_in),
    transfersOut: thisWeek.map(t => t.element_out),
    // What this week's transfers gained: the incoming players' points less
    // the outgoing players', less any hit. null with no transfers.
    transferGain: thisWeek.length ? thisWeek.reduce((s, t) => s + pts(t.element_in) - pts(t.element_out), 0) - hit : null,
    seasonTransfers: entry && Number.isFinite(entry.last_deadline_total_transfers) ? entry.last_deadline_total_transfers : null,
    teamValue: picks && picks.entry_history && picks.entry_history.value ? picks.entry_history.value / 10
      : (entry && entry.last_deadline_value ? entry.last_deadline_value / 10 : null),
    bestRank: ranks.length ? Math.min(...ranks) : null,
  };
}

// The league analysis: who leads each category among members whose teams
// have loaded. Each entry is { key, label, winners: [{ name, entry }], value }
// (winners share the value; an empty list when nobody has the number).
export function leagueHighlights(members, teams) {
  const rows = members
    .filter(m => teams[m.entry] && teams[m.entry].status === 'ready')
    .map(m => ({ m, t: teams[m.entry], s: teams[m.entry].stats || {} }));
  const pick = (key, label, valueOf, best) => {
    const scored = rows.map(r => ({ r, v: valueOf(r) })).filter(x => typeof x.v === 'number' && Number.isFinite(x.v));
    if (!scored.length) return { key, label, winners: [], value: null };
    const top = best === 'max' ? Math.max(...scored.map(x => x.v)) : Math.min(...scored.map(x => x.v));
    return { key, label, value: top, winners: scored.filter(x => x.v === top).map(x => ({ name: x.r.m.teamName, entry: x.r.m.entry })) };
  };
  const gwPoints = r => (typeof r.t.livePoints === 'number' ? r.t.livePoints : r.m.eventTotal);
  const rankMove = r => (r.m.lastRank > 0 ? r.m.lastRank - r.m.rank : null);
  const managers = [
    pick('motw', 'Manager of the Week', gwPoints, 'max'),
    pick('worst', 'Worst Manager of the Week', gwPoints, 'min'),
    pick('rise', 'Biggest Rise', r => { const v = rankMove(r); return v > 0 ? v : null; }, 'max'),
    pick('fall', 'Biggest Fall', r => { const v = rankMove(r); return v < 0 ? -v : null; }, 'max'),
    pick('bestTransfers', 'Best Transfers this Week', r => r.s.transferGain, 'max'),
    pick('worstTransfers', 'Worst Transfers this Week', r => r.s.transferGain, 'min'),
    pick('bench', 'Most Points on Bench this Week', r => r.s.benchPoints, 'max'),
    pick('mostTransfers', 'Most Transfers this Season', r => r.s.seasonTransfers, 'max'),
    pick('leastTransfers', 'Least Transfers this Season', r => r.s.seasonTransfers, 'min'),
    pick('bestValue', 'Best Team Value', r => r.s.teamValue, 'max'),
    pick('lowestValue', 'Lowest Team Value', r => r.s.teamValue, 'min'),
    pick('bestRank', 'Best All-time Rank', r => r.s.bestRank, 'min'),
    pick('bestCaptain', 'Best Captain Pick this Week', r => r.s.captainPoints, 'max'),
    pick('worstCaptain', 'Worst Captain Pick this Week', r => r.s.captainPoints, 'min'),
  ];
  // Players: how many members captained, own, bought and sold each one.
  const most = (key, label, idsOf) => {
    const counts = new Map();
    rows.forEach(r => new Set(idsOf(r.s) || []).forEach(id => { if (id) counts.set(id, (counts.get(id) || 0) + 1); }));
    if (!counts.size) return { key, label, players: [], count: null };
    const top = Math.max(...counts.values());
    return { key, label, count: top, players: [...counts].filter(([, c]) => c === top).map(([id]) => id) };
  };
  const players = [
    most('captained', 'Most Captained', s => (s.captainId ? [s.captainId] : [])),
    most('owned', 'Most Owned', s => s.playerIds),
    most('in', 'Most Transferred In', s => s.transfersIn),
    most('out', 'Most Transferred Out', s => s.transfersOut),
  ];
  return { managers, players, counted: rows.length };
}
