// Point-in-time player data: what each player's numbers looked like just
// before a past gameweek's deadline, built only from the gameweeks before
// it. FPL's API only serves *current* totals, form and expected points, so
// using those to "predict" an old gameweek leaks what happened since.
// Instead, sum FPL's per-gameweek live stats (event/{gw}/live/) for
// gameweeks 1..N-1:
//
//   aggregateLiveStats()  — server (api/as-of.js): live payloads → compact table
//   applyAsOfStats()      — browser: rewrite bootstrap elements from that table
//
// Not available historically, so left at today's values: prices and
// set-piece duties. Injury/availability flags can't be reconstructed either;
// everyone is treated as available rather than applying today's injuries
// to an old gameweek.

const FORM_WINDOW = 4; // FPL's form is a ~30-day average ≈ the last 4 gameweeks

// Column order of each row in the compact table.
export const AS_OF_FIELDS = ['points', 'minutes', 'appearances', 'goals', 'assists', 'xg', 'xa', 'formPoints'];

// Matches a player appeared in during one gameweek. A double gameweek is two
// matches, and FPL's points per game is per match, so count the fixtures in
// `explain` where they got minutes; without that breakdown, any minutes
// count as one appearance.
function matchesPlayed(el, minutes) {
  if (minutes <= 0) return 0;
  const fromExplain = Array.isArray(el.explain)
    ? el.explain.filter(fx => (fx.stats || []).some(st => st.identifier === 'minutes' && st.value > 0)).length
    : 0;
  return Math.max(1, fromExplain);
}

// liveByEvent: { [gwId]: elements[] } from event/{gw}/live/, for every
// gameweek before `gwId`. Returns { gwId, fields, players: { [id]: row } }.
export function aggregateLiveStats(liveByEvent, gwId) {
  const totals = new Map();
  const formFrom = gwId - FORM_WINDOW;
  for (let gw = 1; gw < gwId; gw++) {
    for (const el of liveByEvent[gw] || []) {
      const s = el.stats || {};
      let t = totals.get(el.id);
      if (!t) { t = [0, 0, 0, 0, 0, 0, 0, 0]; totals.set(el.id, t); }
      const points = Number(s.total_points) || 0;
      const minutes = Number(s.minutes) || 0;
      t[0] += points;
      t[1] += minutes;
      t[2] += matchesPlayed(el, minutes);
      t[3] += Number(s.goals_scored) || 0;
      t[4] += Number(s.assists) || 0;
      t[5] += parseFloat(s.expected_goals) || 0;
      t[6] += parseFloat(s.expected_assists) || 0;
      if (gw >= formFrom) t[7] += points;
    }
  }
  const players = {};
  totals.forEach((t, id) => {
    players[id] = t.map(v => Math.round(v * 100) / 100);
  });
  return { gwId, fields: AS_OF_FIELDS, players };
}

// Returns a copy of `bootstrap` whose players carry their pre-`gwId`
// numbers. Pass the result to buildStaticDataFromRaw with forceGwId.
export function applyAsOfStats(bootstrap, asOf) {
  const gwId = asOf.gwId;
  const played = Math.max(0, gwId - 1);
  const formWeeks = Math.min(FORM_WINDOW, played);
  const elements = bootstrap.elements.map(e => {
    const row = asOf.players[e.id];
    const [points, minutes, appearances, goals, assists, xg, xa, formPoints] = row || [0, 0, 0, 0, 0, 0, 0, 0];
    const ppg = appearances ? points / appearances : 0;
    const form = formWeeks ? formPoints / formWeeks : 0;
    return {
      ...e,
      total_points: points,
      minutes,
      goals_scored: goals,
      assists,
      expected_goals: xg.toFixed(2),
      expected_assists: xa.toFixed(2),
      points_per_game: ppg.toFixed(1),
      form: form.toFixed(1),
      // FPL's own expected points isn't published historically; its value
      // tracks recent form closely, so use that (season average before
      // form means anything).
      ep_next: (gwId >= 5 ? form : ppg).toFixed(1),
      status: 'a',
      chance_of_playing_next_round: null,
      news: '',
    };
  });
  return { ...bootstrap, elements };
}
