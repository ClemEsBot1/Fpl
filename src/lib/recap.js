// The gameweek recap: the slides that pop up once a gameweek is over,
// summing up how your team did. Pure functions; App.jsx fetches what they
// need and src/components/GwRecap.jsx draws the slides.

const SEEN_KEY = 'fpl_recap_seen';

// The latest gameweek whose matches have all been played, or null before
// the first one ends.
export function lastFinishedGw(events) {
  const done = (events || []).filter(e => e && e.finished);
  return done.length ? done.reduce((a, b) => (b.id > a.id ? b : a)).id : null;
}

// The last gameweek whose recap popped up for a team on this device.
export function recapSeenFor(teamId) {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    return Number(seen[teamId]) || 0;
  } catch { return 0; }
}

export function markRecapSeen(teamId, gwId) {
  try {
    const seen = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    if ((Number(seen[teamId]) || 0) >= gwId) return;
    localStorage.setItem(SEEN_KEY, JSON.stringify({ ...seen, [teamId]: gwId }));
  } catch { /* storage unavailable: it pops up again next visit */ }
}


const round1 = n => Math.round(n * 10) / 10;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const counts = s => (s.multiplier || 0) > 0;

// What a player did, as short chips: "2 goals", "1 assist", "3 bonus".
// `flop` describes a bad week instead: minutes and goals conceded.
function chipsFor(player, live, flop) {
  if (!live) return [];
  const defends = player.positionId === 1 || player.positionId === 2;
  if (flop) {
    if (!live.minutes) return ["Didn't play"];
    return [
      plural(live.minutes, 'minute'),
      defends && live.conceded ? `${live.conceded} conceded` : null,
      live.goals ? plural(live.goals, 'goal') : null,
    ].filter(Boolean);
  }
  return [
    live.goals ? plural(live.goals, 'goal') : null,
    live.assists ? plural(live.assists, 'assist') : null,
    live.cleanSheets && player.positionId !== 4 ? 'Clean sheet' : null,
    live.bonus ? `${live.bonus} bonus` : null,
  ].filter(Boolean);
}

// A team's counted players as rows for a list: position, name, points
// (captain's multiplied), in formation order.
function xiRows(slots, liveById) {
  return slots
    .filter(counts)
    .map(s => {
      const base = s.actualPoints !== undefined ? s.actualPoints : ((liveById[s.player.id] && liveById[s.player.id].totalPoints) || 0);
      return { id: s.player.id, pos: POS[s.player.positionId], positionId: s.player.positionId, name: s.player.webName, points: base * (s.multiplier || 1), isCaptain: (s.multiplier || 0) >= 2 };
    })
    .sort((a, b) => a.positionId - b.positionId);
}
const total = rows => rows.reduce((s, r) => s + r.points, 0);

// The 11 players picked by the most managers in a legal formation (one
// goalkeeper, at least three defenders, two midfielders and one forward),
// with the most-captained player as captain: a stand-in for the average
// team, which FPL doesn't publish.
export function mostOwnedXi(allPlayers, liveById, captainId) {
  const byOwnership = [...(allPlayers || [])].sort((a, b) => (b.selectedBy || 0) - (a.selectedBy || 0));
  const of = pos => byOwnership.filter(p => p.positionId === pos);
  const gk = of(1).slice(0, 1);
  if (!gk.length) return null;
  const min = { 2: 3, 3: 2, 4: 1 };
  const max = { 2: 5, 3: 5, 4: 3 };
  const picked = [...of(2).slice(0, 3), ...of(3).slice(0, 2), ...of(4).slice(0, 1)];
  const left = byOwnership.filter(p => p.positionId !== 1 && !picked.includes(p));
  for (const p of left) {
    if (picked.length === 10) break;
    if (picked.filter(x => x.positionId === p.positionId).length < max[p.positionId]) picked.push(p);
  }
  if (picked.length < 10 || Object.keys(min).some(pos => picked.filter(x => x.positionId === Number(pos)).length < min[pos])) return null;
  const xi = [...gk, ...picked];
  const captain = xi.some(p => p.id === captainId) ? captainId : xi.reduce((a, b) => ((b.selectedBy || 0) > (a.selectedBy || 0) ? b : a)).id;
  const rows = xiRows(xi.map(p => ({ player: p, multiplier: p.id === captain ? 2 : 1 })), liveById);
  return { rows, total: total(rows) };
}

// The highest-scoring manager's team for the week, from their picks.
function topTeam(top, playersById, liveById) {
  if (!top || !top.picks || !Array.isArray(top.picks.picks)) return null;
  const slots = top.picks.picks.map(p => ({ player: playersById[p.element], multiplier: p.multiplier })).filter(s => s.player);
  const rows = xiRows(slots, liveById);
  const hit = (top.picks.entry_history && top.picks.entry_history.event_transfers_cost) || 0;
  return { name: top.name, rows, total: total(rows) - hit };
}

function headlineSlide({ points, event, squad, liveById, allPlayers, playersById, top }) {
  const average = event && typeof event.average_entry_score === 'number' ? event.average_entry_score : null;
  const highest = event && typeof event.highest_score === 'number' ? event.highest_score : null;
  const you = xiRows(squad, liveById);
  return {
    points, average, highest, vsAverage: average === null ? null : points - average,
    teams: {
      you: { rows: you, total: total(you) },
      template: mostOwnedXi(allPlayers, liveById, event && event.most_captained),
      top: topTeam(top, playersById, liveById),
    },
  };
}

// Overall rank before and after, the gameweek rank, the best week since
// when, and the season so far week by week.
function rankSlide({ gwId, points, entryHistory, history, totalPlayers, events }) {
  if (!entryHistory || !entryHistory.overall_rank) return null;
  const rows = history && Array.isArray(history.current) ? history.current : [];
  const earlier = rows.filter(r => r.event < gwId);
  const before = earlier.length ? earlier[earlier.length - 1].overall_rank || null : null;
  const gwRank = entryHistory.rank || null;
  let bestSince = null;
  if (earlier.length >= 2) {
    const asGood = earlier.filter(r => r.points >= points);
    if (!asGood.length) bestSince = 'season';
    else if (gwId - asGood[asGood.length - 1].event >= 3) bestSince = asGood[asGood.length - 1].event;
  }
  const upTo = rows.filter(r => r.event <= gwId);
  const averages = (events || []).filter(e => e.id <= gwId && typeof e.average_entry_score === 'number' && e.average_entry_score > 0);
  return {
    before, now: entryHistory.overall_rank, move: before ? before - entryHistory.overall_rank : null,
    gwRank, topPercent: gwRank && totalPlayers ? Math.max(0.1, round1((gwRank / totalPlayers) * 100)) : null,
    bestSince,
    series: upTo.map(r => ({ event: r.event, overallRank: r.overall_rank || null, points: r.points })),
    totalPoints: entryHistory.total_points || (upTo.length ? upTo[upTo.length - 1].total_points : null) || null,
    value: entryHistory.value ? entryHistory.value / 10 : null,
    averagePoints: averages.length ? Math.round(averages.reduce((s, e) => s + e.average_entry_score, 0) / averages.length) : null,
  };
}

// Who wore the armband (the vice-captain when the captain didn't play),
// what it brought, what the best player in the XI would have, and who
// FPL and your mini-league captained.
function captainSlide({ squad, liveById, event, playersById, league }) {
  const picked = squad.find(s => s.isCaptain);
  const armband = squad.find(s => (s.multiplier || 0) >= 2) || picked;
  if (!armband) return null;
  const counted = squad.filter(counts);
  const best = counted.reduce((a, b) => ((b.actualPoints || 0) > (a.actualPoints || 0) ? b : a), armband);
  const mult = armband.multiplier || 2;
  const vice = squad.find(s => s.isViceCaptain);
  const missed = best !== armband ? ((best.actualPoints || 0) - (armband.actualPoints || 0)) * (mult - 1) : 0;
  const name = id => (playersById[id] ? playersById[id].webName : null);
  const topInfo = event && event.top_element_info;
  return {
    name: armband.player.webName, playerId: armband.player.id, team: armband.player.team,
    base: armband.actualPoints || 0, multiplier: mult, points: (armband.actualPoints || 0) * mult,
    predicted: round1((armband.nextMatchPredicted ?? armband.predicted ?? 0) * mult),
    chips: chipsFor(armband.player, liveById[armband.player.id], false),
    viceTookOver: !!picked && armband !== picked ? picked.player.webName : null,
    vice: vice && vice !== armband ? { name: vice.player.webName, points: vice.actualPoints || 0 } : null,
    best: { name: best.player.webName, points: best.actualPoints || 0 },
    missed: missed > 0 ? missed : 0,
    // Each counted player's points as captain, best first.
    options: counted
      .map(s => ({ id: s.player.id, name: s.player.webName, points: (s.actualPoints || 0) * mult, isYours: s === armband }))
      .sort((a, b) => b.points - a.points).slice(0, 6),
    fplCaptain: event && event.most_captained ? name(event.most_captained) : null,
    topPlayer: topInfo && name(topInfo.id) ? { name: name(topInfo.id), points: topInfo.points } : null,
    league: league && league.captains ? leagueCaptains(league) : null,
  };
}

// The most captained players in a league, from its members' picks.
function leagueCaptains(league) {
  const list = Object.entries(league.captains.byPlayer || {}).map(([id, n]) => ({ id: Number(id), name: league.captains.names[id] || `#${id}`, count: n }))
    .sort((a, b) => b.count - a.count);
  return list.length ? { leagueName: league.name, counted: league.captains.counted, top: list.slice(0, 3) } : null;
}

// A player's next three fixtures, from the current fixture list.
function nextFixtures(teamId, fixturesByTeam, teamsById) {
  const list = (fixturesByTeam && fixturesByTeam[teamId]) || [];
  return list.slice(0, 3).map(f => ({
    opponent: teamsById && teamsById[f.opponent] ? teamsById[f.opponent].short_name : '?', isHome: !!f.isHome, difficulty: f.difficulty || 3,
  }));
}

// The best and worst scorers among the players who counted, with what
// they were predicted, their price, ownership and match stats.
function starFlopSlide({ squad, liveById, playersById, teamsById, fixturesByTeam }) {
  const counted = squad.filter(counts);
  if (counted.length < 2) return null;
  const pts = s => s.actualPoints || 0;
  const star = counted.reduce((a, b) => (pts(b) > pts(a) ? b : a));
  // Of the lowest scorers, the one expected to do most let you down most.
  const flop = counted.filter(s => s !== star).reduce((a, b) => (pts(b) < pts(a) || (pts(b) === pts(a) && b.predicted > a.predicted) ? b : a));
  const card = (s, isFlop) => {
    const live = liveById[s.player.id] || {};
    const defends = s.player.positionId <= 2;
    return {
      name: s.player.webName, team: s.player.team, club: teamsById && teamsById[s.player.team] ? teamsById[s.player.team].short_name : '',
      points: pts(s), predicted: round1(s.predicted || 0), diff: round1(pts(s) - (s.predicted || 0)), price: s.player.price,
      // Ownership now, from today's data.
      ownership: typeof (playersById[s.player.id] || s.player).selectedBy === 'number' ? (playersById[s.player.id] || s.player).selectedBy : null,
      chips: chipsFor(s.player, liveById[s.player.id], isFlop),
      stats: isFlop
        ? [['Minutes', live.minutes || 0], defends ? ['Conceded', live.conceded || 0] : ['Goals', live.goals || 0], ['Bonus', live.bonus || 0], ['Yellow', live.yellow || 0]]
        : [['Minutes', live.minutes || 0], ['Goals', live.goals || 0], ['Assists', live.assists || 0], ['Bonus', live.bonus || 0]],
      next: nextFixtures(s.player.team, fixturesByTeam, teamsById),
    };
  };
  return {
    star: card(star, false), flop: card(flop, true),
    rest: counted.filter(s => s !== star && s !== flop).map(s => ({ id: s.player.id, name: s.player.webName, points: pts(s) * (s.multiplier || 1) })),
  };
}

// Each transfer made for the gameweek with what the two players scored,
// the net after any hit, and how the players brought in look from here.
function transfersSlide({ gwId, transfers, liveById, playersById, entryHistory, activeChip, history, entry, predictionsById, teamsById, fixturesByTeam }) {
  const pts = id => (liveById[id] && liveById[id].totalPoints) || 0;
  const player = id => playersById[id] || null;
  const side = id => ({ id, name: player(id) ? player(id).webName : `#${id}`, points: pts(id), price: player(id) && typeof player(id).price === 'number' ? player(id).price : null });
  const all = Array.isArray(transfers) ? transfers : [];
  const moves = all.filter(t => t.event === gwId).map(t => ({
    in: { ...side(t.element_in), next: player(t.element_in) ? nextFixtures(player(t.element_in).team, fixturesByTeam, teamsById) : [] },
    out: side(t.element_out),
  }));
  const hit = (entryHistory && entryHistory.event_transfers_cost) || 0;
  const pointsIn = moves.reduce((s, m) => s + m.in.points, 0);
  const pointsOut = moves.reduce((s, m) => s + m.out.points, 0);
  // Predicted points over the next three gameweeks: three typical weeks.
  const ahead = ids => round1(ids.reduce((s, id) => s + ((predictionsById && predictionsById[id] && predictionsById[id].predicted) || 0), 0) * 3);
  const rows = history && Array.isArray(history.current) ? history.current.filter(r => r.event <= gwId) : [];
  const hitWeeks = rows.filter(r => r.event_transfers_cost > 0);
  return {
    moves, hit, pointsIn, pointsOut, net: pointsIn - pointsOut - hit,
    chip: activeChip === 'wildcard' || activeChip === 'freehit' ? activeChip : null,
    nextIn: moves.length && predictionsById ? ahead(moves.map(m => m.in.id)) : null,
    nextOut: moves.length && predictionsById ? ahead(moves.map(m => m.out.id)) : null,
    seasonTransfers: rows.length ? rows.reduce((s, r) => s + (r.event_transfers || 0), 0) : (entry && Number.isFinite(entry.last_deadline_total_transfers) ? entry.last_deadline_total_transfers : null),
    seasonHits: rows.length ? { count: hitWeeks.length, points: hitWeeks.reduce((s, r) => s + r.event_transfers_cost, 0) } : null,
  };
}

// Your place in a mini-league before and after the gameweek, the week's
// top scorer there, and how you did against the closest team on points.
// Only for the latest gameweek to have started: the standings are FPL's
// current ones. `league` is { id, name, members, hasMore, captains? }.
export function leagueSlide(league, teamId) {
  if (!league || !Array.isArray(league.members)) return null;
  const members = league.members;
  const me = members.find(m => m.entry === teamId);
  if (!me || members.length < 2) return null;
  const others = members.filter(m => m !== me);
  const top = Math.max(...members.map(m => m.eventTotal || 0));
  const rival = others.reduce((a, b) => (Math.abs(b.total - me.total) < Math.abs(a.total - me.total) ? b : a));
  const leader = members.reduce((a, b) => (b.total > a.total ? b : a));
  const byRank = [...members].sort((a, b) => a.rank - b.rank);
  const at = byRank.indexOf(me);
  const around = n => {
    const from = Math.max(0, Math.min(at - Math.floor((n - 1) / 2), byRank.length - n));
    return byRank.slice(from, from + n).map(m => ({
      entry: m.entry, rank: m.rank, teamName: m.teamName, eventTotal: m.eventTotal, total: m.total, isYou: m === me,
      move: m.lastRank ? m.lastRank - m.rank : 0,
    }));
  };
  const moved = members.filter(m => m.lastRank).map(m => ({ m, move: m.lastRank - m.rank }));
  const riser = moved.length ? moved.reduce((a, b) => (b.move > a.move ? b : a)) : null;
  const captains = league.captains ? leagueCaptains(league) : null;
  return {
    id: league.id, name: league.name, size: members.length, hasMore: !!league.hasMore,
    was: me.lastRank || null, now: me.rank,
    rows: around(3), table: around(8),
    winners: members.filter(m => (m.eventTotal || 0) === top).map(m => (m === me ? 'You' : m.teamName)),
    winnerPoints: top,
    gapToFirst: leader === me ? 0 : leader.total - me.total,
    leaderName: leader.teamName,
    rival: { teamName: rival.teamName, margin: (me.eventTotal || 0) - (rival.eventTotal || 0), totalGap: me.total - rival.total },
    riser: riser && riser.move > 0 ? { teamName: riser.m === me ? 'You' : riser.m.teamName, move: riser.move } : null,
    topCaptain: captains ? captains.top[0] : null, captainsCounted: captains ? captains.counted : null,
  };
}

// Your points against the app's best squad for the gameweek and the best
// XI anyone could have picked, as a share of that best, with all three
// teams.
function vsModelSlide({ points, modelScore, bestScore, squad, modelSquad, bestSquad, liveById }) {
  if (typeof bestScore !== 'number' || bestScore <= 0) return null;
  const list = slots => (slots ? xiRows(slots.filter(s => s.isStarting), liveById) : null);
  return {
    you: points, model: typeof modelScore === 'number' ? modelScore : null, best: bestScore,
    percent: Math.round((points / bestScore) * 100),
    teams: { you: xiRows(squad, liveById), model: list(modelSquad), best: list(bestSquad) },
  };
}

// How a player's miss compares with every player's that week (`range`,
// the 50th, 80th and 90th percentiles of misses from /api/accuracy):
// close, usual, off or way off. A player who didn't play isn't a miss.
export function missVerdict(diff, minutes, range) {
  if (minutes === 0) return 'dnp';
  if (!range) return null;
  const miss = Math.abs(diff);
  if (miss <= range.p50) return 'close';
  if (miss <= range.p80) return 'usual';
  if (miss <= range.p90) return 'off';
  return 'way-off';
}

// Each player's prediction against what they scored, the bench too, and
// how the app's predictions did across all players (`accuracy`, from
// /api/accuracy), with whether your players' misses were in the usual range.
function predictionsSlide({ squad, liveById, accuracy }) {
  const counted = squad.filter(counts);
  if (!counted.length) return null;
  const all = accuracy && typeof accuracy.meanAbsError === 'number' ? accuracy : null;
  const range = all && typeof all.missP80 === 'number' ? { p50: all.missP50, p80: all.missP80, p90: all.missP90 } : null;
  const row = s => {
    const minutes = liveById[s.player.id] ? liveById[s.player.id].minutes || 0 : null;
    const diff = round1((s.actualPoints || 0) - (s.predicted || 0));
    return {
      id: s.player.id, name: s.player.webName, pos: POS[s.player.positionId], isCaptain: (s.multiplier || 0) >= 2,
      predicted: round1(s.predicted || 0), actual: s.actualPoints || 0, diff, minutes,
      verdict: missVerdict(diff, minutes, range),
    };
  };
  const rows = counted.map(row).sort((a, b) => b.diff - a.diff);
  const typicalMiss = round1(rows.reduce((s, r) => s + Math.abs(r.diff), 0) / rows.length);
  const judged = rows.filter(r => r.verdict && r.verdict !== 'dnp');
  // Your XI's typical miss against every player's: about usual within a
  // quarter either way.
  const ratio = all && all.meanAbsError > 0 ? typicalMiss / all.meanAbsError : null;
  return {
    rows,
    bench: squad.filter(s => !counts(s)).map(row),
    predictedTotal: round1(counted.reduce((s, x) => s + (x.predicted || 0) * x.multiplier, 0)),
    actualTotal: counted.reduce((s, x) => s + (x.actualPoints || 0) * x.multiplier, 0),
    beat: rows[0].diff > 0 ? rows[0] : null,
    miss: rows[rows.length - 1].diff < 0 ? rows[rows.length - 1] : null,
    typicalMiss,
    missCompared: ratio === null ? null : ratio < 0.75 ? 'smaller' : ratio <= 1.25 ? 'usual' : ratio <= 1.75 ? 'bigger' : 'much-bigger',
    range,
    withinUsual: range ? judged.filter(r => r.verdict === 'close' || r.verdict === 'usual').length : null,
    judged: range ? judged.length : null,
    wayOff: rows.filter(r => r.verdict === 'way-off').map(r => r.name),
    allPlayers: all ? { typicalMiss: round1(all.meanAbsError), topTen: round1(all.topTenAverageActual), average: round1(all.averageActual) } : null,
  };
}

// Everything the recap shows for one team's gameweek. A slide is null when
// its numbers aren't available.
export function buildRecap(input) {
  const { gwId, gwName, teamName, teamId, squad, entryHistory } = input;
  const liveById = input.liveById || {};
  const playersById = input.playersById || {};
  const actual = squad.reduce((s, x) => s + (x.actualPoints || 0) * (x.multiplier || 0), 0);
  const points = entryHistory && typeof entryHistory.points === 'number' ? entryHistory.points : actual;
  const ctx = { ...input, liveById, playersById, points };
  return {
    gwId, gwName, teamName, teamId,
    headline: headlineSlide(ctx),
    rank: rankSlide(ctx),
    captain: captainSlide(ctx),
    starFlop: starFlopSlide(ctx),
    transfers: transfersSlide(ctx),
    league: leagueSlide(input.league, teamId),
    leagues: input.league ? input.leagues || [] : [],
    vsModel: vsModelSlide(ctx),
    predictions: predictionsSlide(ctx),
  };
}

// The recap as a few lines of text, for pasting into a chat.
export function recapText(recap) {
  const h = recap.headline;
  const n = v => v.toLocaleString('en-GB');
  const ord = v => `${v}${(v % 100 >= 11 && v % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] || 'th'}`;
  return [
    `${recap.teamName}, ${recap.gwName}: ${h.points} pts${h.vsAverage !== null ? ` (${h.vsAverage >= 0 ? '+' : '−'}${Math.abs(h.vsAverage)} vs avg)` : ''}`,
    recap.rank ? `Rank ${n(recap.rank.now)}${recap.rank.move ? ` ${recap.rank.move > 0 ? '▲' : '▼'}${n(Math.abs(recap.rank.move))}` : ''}` : null,
    [recap.captain ? `C ${recap.captain.name} ${recap.captain.points}` : null, recap.starFlop ? `Star ${recap.starFlop.star.name} ${recap.starFlop.star.points}` : null].filter(Boolean).join(' · ') || null,
    recap.league ? `${recap.league.name} ${recap.league.was ? `${ord(recap.league.was)} → ` : ''}${ord(recap.league.now)}` : null,
  ].filter(Boolean).join('\n');
}
