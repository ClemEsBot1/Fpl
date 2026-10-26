// A player's profile (src/components/PlayerProfile.jsx): every match this
// season with what was predicted for it, his next fixtures with their
// predictions, and his past seasons. Pure functions over FPL's
// element-summary/{id}/ and the saved predictions (/api/accuracy?all=1).

// His photo on the Premier League's site, from FPL's `code`: where the
// site keeps them now (every current player), then the older address
// (which has players who have since left), tried in that order.
export const photoUrls = code => [
  `https://resources.premierleague.com/premierleague25/photos/players/110x140/${code}.png`,
  `https://resources.premierleague.com/premierleague/photos/players/110x140/p${code}.png`,
];

const round1 = n => Math.round(n * 10) / 10;

function match(teamsById, opponentId, home, scoreFor, scoreAgainst, difficulty = null) {
  const team = teamsById[opponentId];
  const played = typeof scoreFor === 'number' && typeof scoreAgainst === 'number';
  return {
    opponent: team ? team.short_name : '?',
    opponentId,
    home: !!home,
    score: played ? [scoreFor, scoreAgainst] : null,
    result: played ? (scoreFor > scoreAgainst ? 'W' : scoreFor < scoreAgainst ? 'L' : 'D') : null,
    difficulty,
  };
}

// One row per gameweek, newest first. Played gameweeks come from
// summary.history (a double gameweek's matches are summed into one row),
// upcoming ones from summary.fixtures.
//   predictedByGw: { [gw]: points } saved before each deadline
//   upcomingByGw:  { [gw]: points } predicted now (the byGw of his prediction)
//   finishedGws:   Set of gameweeks that are over
// diff is his points less the prediction, once the gameweek is over.
//   workedOutGws:  Set of gameweeks whose prediction was worked out afterwards
export function profileRows(summary, { teamsById = {}, predictedByGw = {}, upcomingByGw = {}, finishedGws = new Set(), workedOutGws = new Set() } = {}) {
  const rows = new Map();
  const row = gw => {
    if (!rows.has(gw)) rows.set(gw, { gw, matches: [], points: null, minutes: 0, starts: 0, goals: 0, assists: 0, xg: 0, xa: 0, played: false });
    return rows.get(gw);
  };
  for (const h of (summary && summary.history) || []) {
    if (!h.round) continue;
    const r = row(h.round);
    const [us, them] = h.was_home ? [h.team_h_score, h.team_a_score] : [h.team_a_score, h.team_h_score];
    r.matches.push(match(teamsById, h.opponent_team, h.was_home, us, them));
    r.points = (r.points || 0) + (Number(h.total_points) || 0);
    r.minutes += Number(h.minutes) || 0;
    r.starts += Number(h.starts) || 0;
    r.goals += Number(h.goals_scored) || 0;
    r.assists += Number(h.assists) || 0;
    // Expected goals and assists (FPL sends them as strings).
    r.xg += Number(h.expected_goals) || 0;
    r.xa += Number(h.expected_assists) || 0;
    r.played = true;
  }
  // A match under way is in both lists.
  const started = new Set(((summary && summary.history) || []).map(h => h.fixture).filter(Boolean));
  for (const f of (summary && summary.fixtures) || []) {
    if (!f.event || started.has(f.id)) continue; // not scheduled yet, or started
    const r = row(f.event);
    r.matches.push(match(teamsById, f.is_home ? f.team_a : f.team_h, f.is_home, null, null, f.difficulty || null));
  }
  return [...rows.values()]
    .map(r => {
      const finished = finishedGws.has(r.gw);
      const saved = predictedByGw[r.gw];
      const predicted = typeof saved === 'number' ? saved : (!r.played && typeof upcomingByGw[r.gw] === 'number' ? upcomingByGw[r.gw] : null);
      const diff = finished && r.played && predicted !== null ? round1(r.points - predicted) : null;
      return { ...r, xg: Math.round(r.xg * 100) / 100, xa: Math.round(r.xa * 100) / 100, finished, predicted, diff, workedOut: typeof saved === 'number' && workedOutGws.has(r.gw) };
    })
    .sort((a, b) => b.gw - a.gw);
}

// How far off his predictions have been in the gameweeks he played:
// the average miss either way (±) and the average of points less
// prediction (+ he beat them, − he fell short). null with none to judge.
export function predictionError(rows) {
  const judged = rows.filter(r => r.diff !== null && r.minutes > 0);
  if (!judged.length) return null;
  const n = judged.length;
  return {
    n,
    meanMiss: round1(judged.reduce((s, r) => s + Math.abs(r.diff), 0) / n),
    bias: round1(judged.reduce((s, r) => s + r.diff, 0) / n),
  };
}

// His past Premier League seasons, newest first.
export function pastSeasons(summary) {
  return ((summary && summary.history_past) || [])
    .map(s => ({
      season: s.season_name,
      points: Number(s.total_points) || 0,
      starts: Number(s.starts) || 0,
      minutes: Number(s.minutes) || 0,
      goals: Number(s.goals_scored) || 0,
      assists: Number(s.assists) || 0,
      xgi: Number(s.expected_goal_involvements) || 0,
    }))
    .reverse();
}

// "+2.1", "−0.4" or "0.0" (a real minus sign).
export const signed = n => (n > 0 ? `+${n.toFixed(1)}` : n < 0 ? `−${Math.abs(n).toFixed(1)}` : '0.0');

// Saved predictions as { [gw]: points } for one player, from the
// /api/accuracy?all=1 answer ({ gws: { [gw]: { [id]: points } } }).
export function savedFor(all, playerId) {
  const out = {};
  for (const [gw, byId] of Object.entries((all && all.gws) || {})) {
    const v = byId && byId[playerId];
    if (typeof v === 'number') out[gw] = v;
  }
  return out;
}

// Opening a player's profile from anywhere: the app (App.jsx) shows it.
const EVENT = 'fpl-player-profile';
export function openPlayerProfile(id) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: Number(id) }));
}
export function onOpenPlayerProfile(fn) {
  if (typeof window === 'undefined') return () => {};
  const handler = e => fn(e.detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

// His price through the season: [{ gw, price }] (£m), one point a
// gameweek (FPL's history[].value, in tenths, at each match).
export function priceSeries(summary) {
  const byGw = new Map();
  for (const h of (summary && summary.history) || []) {
    if (h.round && Number.isFinite(Number(h.value))) byGw.set(h.round, Number(h.value) / 10);
  }
  return [...byGw.entries()].sort((a, b) => a[0] - b[0]).map(([gw, price]) => ({ gw, price }));
}

// Predicted points over the next gameweeks (his prediction's byGw).
const nextWeeks = pred => ((pred && pred.byGw) || []).reduce((s, w) => s + (w.points || 0), 0);

// Up to `n` players like him for less: the same position, at least
// £0.5m cheaper, fit to play (no injury, suspension or doubt under 75%),
// predicted at least 80% of his points over the next gameweeks; the best
// predicted first. [{ player, prediction, saving, next, share }]
export function cheaperAlternatives(player, allPlayers, predictionsById, { n = 3, minSaving = 0.5, minShare = 0.8 } = {}) {
  const mine = nextWeeks(predictionsById[player.id]);
  if (!(mine > 0)) return [];
  return (allPlayers || [])
    .filter(p => p.id !== player.id && p.positionId === player.positionId && p.price <= player.price - minSaving + 1e-9)
    .filter(p => !['i', 's', 'u', 'n'].includes(p.status) && !(typeof p.chanceNext === 'number' && p.chanceNext < 75))
    .map(p => ({ player: p, prediction: predictionsById[p.id], next: round1(nextWeeks(predictionsById[p.id])) }))
    .filter(a => a.prediction && a.next >= mine * minShare)
    .sort((a, b) => b.next - a.next)
    .slice(0, n)
    .map(a => ({ ...a, saving: round1(player.price - a.player.price), share: a.next / mine }));
}

// His goals and assists this season against what his chances were worth:
// { goals, xg, assists, xa } over the gameweeks played, or null before any.
export function xgSummary(rows) {
  const played = rows.filter(r => r.played);
  if (!played.length) return null;
  const sum = k => played.reduce((s, r) => s + (r[k] || 0), 0);
  const r2 = n => Math.round(n * 100) / 100;
  return { goals: sum('goals'), xg: r2(sum('xg')), assists: sum('assists'), xa: r2(sum('xa')) };
}
