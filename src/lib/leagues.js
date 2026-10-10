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
// With `beforeWeek` (a gameweek that has started, see membersAtGw) it's the
// position after that gameweek had everyone scored their prediction for
// it: the total before it plus the prediction. Members whose total isn't
// known are left out.
export function expectedPositions(members, teams, { beforeWeek = false } = {}) {
  const projected = members.map(m => {
    const team = teams[m.entry];
    const ready = team && team.status === 'ready';
    if (beforeWeek) {
      return typeof m.totalBefore === 'number' ? { entry: m.entry, projected: m.totalBefore + (ready ? team.xiTotal || 0 : 0) } : null;
    }
    const live = ready && typeof team.livePoints === 'number' ? team.livePoints : null;
    const base = live === null ? m.total : m.total - (m.eventTotal || 0) + live;
    return { entry: m.entry, projected: base + (ready ? team.xiTotal : 0) };
  }).filter(Boolean);
  const sorted = [...projected].sort((a, b) => b.projected - a.projected);
  const out = {};
  sorted.forEach((p, i) => {
    const position = i > 0 && Math.abs(p.projected - sorted[i - 1].projected) < 1e-9 ? out[sorted[i - 1].entry].position : i + 1;
    out[p.entry] = { projected: Math.round(p.projected * 10) / 10, position };
  });
  return out;
}

// Positions shared by equal totals: 1, 2, 2, 4.
function rankBy(list, valueOf) {
  const sorted = [...list].sort((a, b) => valueOf(b) - valueOf(a));
  const out = new Map();
  sorted.forEach((x, i) => {
    out.set(x, i > 0 && valueOf(x) === valueOf(sorted[i - 1]) ? out.get(sorted[i - 1]) : i + 1);
  });
  return out;
}

// A league as it stood after gameweek `gwId`, for a gameweek that has
// started: each member's total, points that week and position after it and
// before it, from their FPL history (team.history: [{ event, points, total }]).
// For a gameweek still being played (`finished` false) the week's live
// points stand in for FPL's figure. Members whose history hasn't loaded
// have null positions and totals.
export function membersAtGw(members, teams, gwId, { finished = true } = {}) {
  const rows = members.map(m => {
    const team = teams[m.entry];
    const history = team && team.status === 'ready' && Array.isArray(team.history) ? team.history : null;
    if (!history) return { ...m, rank: null, lastRank: null, total: null, totalBefore: null, eventTotal: null };
    const at = history.find(r => r.event === gwId);
    const earlier = history.filter(r => r.event < gwId);
    const totalBefore = earlier.length ? earlier[earlier.length - 1].total : 0;
    const live = !finished && typeof team.livePoints === 'number' ? team.livePoints : null;
    const eventTotal = live !== null ? live : (at ? at.points : 0);
    const total = live !== null ? totalBefore + live : (at ? at.total : totalBefore);
    return { ...m, total, totalBefore, eventTotal };
  });
  const known = rows.filter(r => r.total !== null);
  const after = rankBy(known, r => r.total);
  const before = rankBy(known, r => r.totalBefore);
  return rows.map(r => (r.total === null ? r : { ...r, rank: after.get(r), lastRank: before.get(r) }));
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

// A slot's armband multiplier for this week: 0 on the bench, 2 or 3 for the
// captain, otherwise 1.
const multOf = slot => (typeof slot.multiplier === 'number' ? slot.multiplier : slot.isStarting ? (slot.isCaptain ? 2 : 1) : 0);

// Effective ownership in the league: for each player, the average
// multiplier across members whose teams have loaded (a captain counts 2,
// a benched player 0), so 1.2 means the league scores his points 1.2 times
// on average. { counted, byId: { [id]: eo } }.
export function leagueOwnership(members, teams) {
  const ready = members.filter(m => teams[m.entry] && teams[m.entry].status === 'ready' && Array.isArray(teams[m.entry].squad) && teams[m.entry].squad.length);
  const sum = {};
  ready.forEach(m => teams[m.entry].squad.forEach(slot => { sum[slot.player.id] = (sum[slot.player.id] || 0) + multOf(slot); }));
  const byId = {};
  Object.entries(sum).forEach(([id, total]) => { byId[id] = total / ready.length; });
  return { counted: ready.length, byId };
}

// Where your team differs from the league's this week, in expected points:
// `edges` are players you have more of than the league (if they score, you
// gain on most members), `threats` ones the league has more of. Each
// { player, yours, eo, swing } with swing = (yours − eo) × predicted.
// `rival` compares you with the member just above you (the one just below
// if you lead): the points between you and what your differing players are
// predicted to swing this week.
export function leagueDifferentials(members, teams, youEntry, { limit = 5 } = {}) {
  const you = teams[youEntry];
  if (!you || you.status !== 'ready' || !Array.isArray(you.squad) || !you.squad.length) return null;
  const { counted, byId } = leagueOwnership(members, teams);
  if (counted < 2) return null;
  const predictedOf = slot => slot.nextMatchPredicted ?? slot.predicted ?? 0;
  const mine = new Map(you.squad.map(s => [s.player.id, s]));
  const rows = new Map();
  you.squad.forEach(s => rows.set(s.player.id, { player: s.player, yours: multOf(s), predicted: predictedOf(s) }));
  members.forEach(m => {
    const t = teams[m.entry];
    if (!t || t.status !== 'ready' || !Array.isArray(t.squad)) return;
    t.squad.forEach(s => { if (!rows.has(s.player.id)) rows.set(s.player.id, { player: s.player, yours: 0, predicted: predictedOf(s) }); });
  });
  const all = [...rows.values()].map(r => ({ ...r, eo: byId[r.player.id] || 0, swing: ((r.yours - (byId[r.player.id] || 0)) * r.predicted) }));
  const round = v => Math.round(v * 10) / 10;
  const edges = all.filter(r => r.swing > 0.05).sort((a, b) => b.swing - a.swing).slice(0, limit).map(r => ({ ...r, eo: round(r.eo), swing: round(r.swing) }));
  const threats = all.filter(r => r.swing < -0.05).sort((a, b) => a.swing - b.swing).slice(0, limit).map(r => ({ ...r, eo: round(r.eo), swing: round(r.swing) }));

  // The member just above you, or just below if you lead.
  const order = [...members].sort((a, b) => a.rank - b.rank);
  const at = order.findIndex(m => m.entry === youEntry);
  let rival = null;
  const other = at > 0 ? order[at - 1] : order[1];
  const theirs = other && teams[other.entry];
  if (at >= 0 && theirs && theirs.status === 'ready' && Array.isArray(theirs.squad)) {
    const theirMult = new Map(theirs.squad.map(s => [s.player.id, s]));
    const ids = new Set([...mine.keys(), ...theirMult.keys()]);
    const diff = [...ids].map(id => {
      const a = mine.get(id);
      const b = theirMult.get(id);
      const slot = a || b;
      return { player: slot.player, swing: round((multOf(a || {}) - multOf(b || {})) * predictedOf(slot)) };
    }).filter(d => Math.abs(d.swing) >= 0.05);
    const you_ = order[at];
    rival = {
      teamName: other.teamName,
      entry: other.entry,
      ahead: at > 0,
      gap: Math.abs((other.total || 0) - (you_.total || 0)),
      swing: round(diff.reduce((s, d) => s + d.swing, 0)),
      yourEdge: diff.filter(d => d.swing > 0).sort((a, b) => b.swing - a.swing).slice(0, 3),
      theirEdge: diff.filter(d => d.swing < 0).sort((a, b) => a.swing - b.swing).slice(0, 3),
    };
  }
  return { counted, edges, threats, rival };
}

// A full head-to-head between your team and one chosen rival, for the
// gameweek their squads are loaded for. Returns the players only one of you
// has (where the gameweek is won or lost) and the players you share, plus
// each side's predicted starting XI total. `you` and `rival` are the loaded
// team objects ({ squad, xiTotal }); null when either isn't ready.
export function headToHead(you, rival) {
  if (!you || !rival || !Array.isArray(you.squad) || !Array.isArray(rival.squad) || !you.squad.length || !rival.squad.length) return null;
  const predictedOf = slot => slot.nextMatchPredicted ?? slot.predicted ?? 0;
  const round = v => Math.round(v * 10) / 10;
  const mine = new Map(you.squad.map(s => [s.player.id, s]));
  const theirs = new Map(rival.squad.map(s => [s.player.id, s]));

  const shared = [];
  const yourOnly = [];
  const theirOnly = [];
  you.squad.forEach(s => {
    if (theirs.has(s.player.id)) shared.push({ player: s.player, predicted: round(predictedOf(s)) });
    else yourOnly.push({ player: s.player, predicted: round(predictedOf(s)), starting: !!s.isStarting });
  });
  rival.squad.forEach(s => {
    if (!mine.has(s.player.id)) theirOnly.push({ player: s.player, predicted: round(predictedOf(s)), starting: !!s.isStarting });
  });
  const byPred = (a, b) => b.predicted - a.predicted;
  yourOnly.sort(byPred);
  theirOnly.sort(byPred);
  shared.sort(byPred);

  const captainOf = team => { const c = team.squad.find(s => s.isCaptain); return c ? c.player : null; };
  return {
    shared,
    yourOnly,
    theirOnly,
    yourXiTotal: round(typeof you.xiTotal === 'number' ? you.xiTotal : 0),
    theirXiTotal: round(typeof rival.xiTotal === 'number' ? rival.xiTotal : 0),
    yourCaptain: captainOf(you),
    theirCaptain: captainOf(rival),
    // The predicted swing from the differing players only (yours minus theirs).
    edge: round(yourOnly.reduce((s, r) => s + (r.starting ? r.predicted : 0), 0) - theirOnly.reduce((s, r) => s + (r.starting ? r.predicted : 0), 0)),
  };
}
