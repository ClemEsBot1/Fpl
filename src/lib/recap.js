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

function headlineSlide({ points, event }) {
  const average = event && typeof event.average_entry_score === 'number' ? event.average_entry_score : null;
  const highest = event && typeof event.highest_score === 'number' ? event.highest_score : null;
  return { points, average, highest, vsAverage: average === null ? null : points - average };
}

// Overall rank before and after, the gameweek rank, and the best week
// since when.
function rankSlide({ gwId, points, entryHistory, history, totalPlayers }) {
  if (!entryHistory || !entryHistory.overall_rank) return null;
  const earlier = history && Array.isArray(history.current) ? history.current.filter(r => r.event < gwId) : [];
  const before = earlier.length ? earlier[earlier.length - 1].overall_rank || null : null;
  const gwRank = entryHistory.rank || null;
  let bestSince = null;
  if (earlier.length >= 2) {
    const asGood = earlier.filter(r => r.points >= points);
    if (!asGood.length) bestSince = 'season';
    else if (gwId - asGood[asGood.length - 1].event >= 3) bestSince = asGood[asGood.length - 1].event;
  }
  return {
    before, now: entryHistory.overall_rank, move: before ? before - entryHistory.overall_rank : null,
    gwRank, topPercent: gwRank && totalPlayers ? Math.max(0.1, round1((gwRank / totalPlayers) * 100)) : null,
    bestSince,
  };
}

// Who wore the armband (the vice-captain when the captain didn't play),
// what it brought, and what the best player in the XI would have.
function captainSlide({ squad, liveById }) {
  const picked = squad.find(s => s.isCaptain);
  const armband = squad.find(s => (s.multiplier || 0) >= 2) || picked;
  if (!armband) return null;
  const counted = squad.filter(s => (s.multiplier || 0) > 0);
  const best = counted.reduce((a, b) => ((b.actualPoints || 0) > (a.actualPoints || 0) ? b : a), armband);
  const mult = armband.multiplier || 2;
  const vice = squad.find(s => s.isViceCaptain);
  const missed = best !== armband ? ((best.actualPoints || 0) - (armband.actualPoints || 0)) * (mult - 1) : 0;
  return {
    name: armband.player.webName, playerId: armband.player.id, team: armband.player.team,
    base: armband.actualPoints || 0, multiplier: mult, points: (armband.actualPoints || 0) * mult,
    chips: chipsFor(armband.player, liveById[armband.player.id], false),
    viceTookOver: !!picked && armband !== picked ? picked.player.webName : null,
    vice: vice && vice !== armband ? { name: vice.player.webName, points: vice.actualPoints || 0 } : null,
    best: { name: best.player.webName, points: best.actualPoints || 0 },
    missed: missed > 0 ? missed : 0,
  };
}

// The best and worst scorers among the players who counted, with what
// they were predicted and their price.
function starFlopSlide({ squad, liveById }) {
  const counted = squad.filter(s => (s.multiplier || 0) > 0);
  if (counted.length < 2) return null;
  const pts = s => s.actualPoints || 0;
  const star = counted.reduce((a, b) => (pts(b) > pts(a) ? b : a));
  // Of the lowest scorers, the one expected to do most let you down most.
  const flop = counted.filter(s => s !== star).reduce((a, b) => (pts(b) < pts(a) || (pts(b) === pts(a) && b.predicted > a.predicted) ? b : a));
  const card = (s, isFlop) => ({
    name: s.player.webName, team: s.player.team, points: pts(s),
    predicted: round1(s.predicted || 0), diff: round1(pts(s) - (s.predicted || 0)), price: s.player.price,
    chips: chipsFor(s.player, liveById[s.player.id], isFlop),
  });
  return { star: card(star, false), flop: card(flop, true) };
}

// Each transfer made for the gameweek with what the two players scored,
// and the net after any hit.
function transfersSlide({ gwId, transfers, liveById, playersById, entryHistory, activeChip }) {
  const pts = id => (liveById[id] && liveById[id].totalPoints) || 0;
  const name = id => (playersById[id] ? playersById[id].webName : `#${id}`);
  const moves = (Array.isArray(transfers) ? transfers : []).filter(t => t.event === gwId).map(t => ({
    in: { id: t.element_in, name: name(t.element_in), points: pts(t.element_in) },
    out: { id: t.element_out, name: name(t.element_out), points: pts(t.element_out) },
  }));
  const hit = (entryHistory && entryHistory.event_transfers_cost) || 0;
  const pointsIn = moves.reduce((s, m) => s + m.in.points, 0);
  const pointsOut = moves.reduce((s, m) => s + m.out.points, 0);
  return {
    moves, hit, pointsIn, pointsOut, net: pointsIn - pointsOut - hit,
    chip: activeChip === 'wildcard' || activeChip === 'freehit' ? activeChip : null,
  };
}

// Your place in a mini-league before and after the gameweek, the week's
// top scorer there, and how you did against the closest team on points.
// Only for the latest gameweek to have started: the standings are FPL's
// current ones.
function leagueSlide({ league, teamId }) {
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
  const from = Math.max(0, Math.min(at - 1, byRank.length - 3));
  return {
    name: league.name, size: members.length, hasMore: !!league.hasMore,
    was: me.lastRank || null, now: me.rank,
    rows: byRank.slice(from, from + 3).map(m => ({ entry: m.entry, rank: m.rank, teamName: m.teamName, eventTotal: m.eventTotal, total: m.total, isYou: m === me })),
    winners: members.filter(m => (m.eventTotal || 0) === top).map(m => (m === me ? 'You' : m.teamName)),
    winnerPoints: top,
    gapToFirst: leader === me ? 0 : leader.total - me.total,
    leaderName: leader.teamName,
    rival: { teamName: rival.teamName, margin: (me.eventTotal || 0) - (rival.eventTotal || 0) },
  };
}

// Your points against the app's best squad for the gameweek and the best
// XI anyone could have picked, as a share of that best.
function vsModelSlide({ points, modelScore, bestScore }) {
  if (typeof bestScore !== 'number' || bestScore <= 0) return null;
  return {
    you: points, model: typeof modelScore === 'number' ? modelScore : null, best: bestScore,
    percent: Math.round((points / bestScore) * 100),
  };
}

// Each counted player's prediction against what they scored.
function predictionsSlide({ squad }) {
  const counted = squad.filter(s => (s.multiplier || 0) > 0);
  if (!counted.length) return null;
  const rows = counted.map(s => ({
    id: s.player.id, name: s.player.webName, isCaptain: (s.multiplier || 0) >= 2,
    predicted: round1(s.predicted || 0), actual: s.actualPoints || 0, diff: round1((s.actualPoints || 0) - (s.predicted || 0)),
  })).sort((a, b) => b.diff - a.diff);
  return {
    rows,
    predictedTotal: round1(counted.reduce((s, x) => s + (x.predicted || 0) * x.multiplier, 0)),
    actualTotal: counted.reduce((s, x) => s + (x.actualPoints || 0) * x.multiplier, 0),
    beat: rows[0].diff > 0 ? rows[0] : null,
    miss: rows[rows.length - 1].diff < 0 ? rows[rows.length - 1] : null,
  };
}

// Everything the recap shows for one team's gameweek. A slide is null when
// its numbers aren't available.
export function buildRecap(input) {
  const { gwId, gwName, teamName, teamId, squad, entryHistory } = input;
  const actual = squad.reduce((s, x) => s + (x.actualPoints || 0) * (x.multiplier || 0), 0);
  const points = entryHistory && typeof entryHistory.points === 'number' ? entryHistory.points : actual;
  const recap = {
    gwId, gwName, teamName, teamId,
    headline: headlineSlide({ points, event: input.event }),
    rank: rankSlide({ ...input, points }),
    captain: captainSlide({ squad, liveById: input.liveById || {} }),
    starFlop: starFlopSlide({ squad, liveById: input.liveById || {} }),
    transfers: transfersSlide({ ...input, liveById: input.liveById || {}, playersById: input.playersById || {} }),
    league: leagueSlide(input),
    vsModel: vsModelSlide({ points, modelScore: input.modelScore, bestScore: input.bestScore }),
    predictions: predictionsSlide({ squad }),
  };
  return recap;
}
