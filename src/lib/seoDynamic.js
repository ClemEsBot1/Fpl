// Pages built from live FPL data on request (api/optimal-squad.js?page=…),
// for searches like "Haaland FPL prediction", "Arsenal fixtures FPL" or
// "FPL GW8 predictions": one per player (/player/<name>), per club
// (/team/<name>) and per gameweek (/gw/<n>), the hub that links them all
// (/fpl-players) and the sitemap that lists them (/sitemap-fpl.xml).
//
// Everything here is pure: the API route fetches FPL's data and the saved
// predictions and hands them in.

import { SITE, escapeHtml, layout, list, playerLink, section } from './seoPage.js';

const POSITION = { 1: 'goalkeeper', 2: 'defender', 3: 'midfielder', 4: 'forward' };
const POSITIONS = { 1: 'Goalkeepers', 2: 'Defenders', 3: 'Midfielders', 4: 'Forwards' };
const POS_SHORT = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
// Gameweeks a page looks ahead: the one being planned and the next four.
export const AHEAD = 5;

const fmt = n => (Math.round(n * 10) / 10).toFixed(1);
const money = p => `£${p.toFixed(1)}m`;
const gwShort = id => `GW${id}`;
const sum = xs => xs.reduce((s, x) => s + x, 0);

// "Martin Ødegaard" → "martin-odegaard".
export function slugify(text) {
  return String(text || '')
    .replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'ae').replace(/ß/g, 'ss').replace(/[łŁ]/g, 'l').replace(/[đĐ]/g, 'd').replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function difficultyWord(d) {
  return d <= 2 ? 'easy' : d === 3 ? 'medium' : 'hard';
}

// Everything the pages need, from FPL's bootstrap-static and fixtures and
// the predictions saved for `event` (the gameweek being planned):
// saved = { predictedById, byGwById? } where byGwById[id] is that gameweek
// and the next four. Players are keyed by a slug of their full name, with
// the id added where two players share one.
export function seoModel({ bootstrap, fixtures, event, saved }) {
  const teams = bootstrap.teams.map(t => ({ id: t.id, name: t.name, short: t.short_name, slug: slugify(t.name), fixtures: [] }));
  const teamById = Object.fromEntries(teams.map(t => [t.id, t]));
  (fixtures || [])
    .filter(f => f.event && f.event >= event.id && !f.finished)
    .sort((a, b) => a.event - b.event || String(a.kickoff_time).localeCompare(String(b.kickoff_time)))
    .forEach(f => {
      const h = teamById[f.team_h];
      const a = teamById[f.team_a];
      if (h && a) {
        h.fixtures.push({ event: f.event, opponent: a, home: true, difficulty: f.team_h_difficulty });
        a.fixtures.push({ event: f.event, opponent: h, home: false, difficulty: f.team_a_difficulty });
      }
    });

  const predicted = (saved && saved.predictedById) || {};
  const byGw = (saved && saved.byGwById) || {};
  const count = {};
  const base = bootstrap.elements.map(e => slugify(`${e.first_name} ${e.second_name}`) || String(e.id));
  base.forEach(s => { count[s] = (count[s] || 0) + 1; });
  const players = bootstrap.elements.map((e, i) => {
    const team = teamById[e.team];
    const next = typeof predicted[e.id] === 'number' ? predicted[e.id] : null;
    const weeks = Array.isArray(byGw[e.id]) && byGw[e.id].length
      ? byGw[e.id].slice(0, AHEAD).map((points, k) => ({ event: event.id + k, points })).filter(w => w.event <= 38)
      : next === null ? [] : [{ event: event.id, points: next }];
    return {
      id: e.id,
      slug: count[base[i]] > 1 ? `${base[i]}-${e.id}` : base[i],
      name: e.web_name,
      fullName: `${e.first_name} ${e.second_name}`.trim(),
      team: team ? team.short : '',
      teamRef: team,
      positionId: e.element_type,
      price: e.now_cost / 10,
      selectedBy: parseFloat(e.selected_by_percent) || 0,
      status: e.status,
      news: e.news || '',
      chance: e.chance_of_playing_next_round,
      totalPoints: e.total_points || 0,
      form: parseFloat(e.form) || 0,
      ppg: parseFloat(e.points_per_game) || 0,
      minutes: e.minutes || 0,
      goals: e.goals_scored || 0,
      assists: e.assists || 0,
      cleanSheets: e.clean_sheets || 0,
      bonus: e.bonus || 0,
      xg: parseFloat(e.expected_goals) || 0,
      xa: parseFloat(e.expected_assists) || 0,
      predicted: next,
      weeks,
      ahead: weeks.length ? Math.round(sum(weeks.map(w => w.points)) * 10) / 10 : null,
    };
  });
  return {
    event,
    teams,
    teamBySlug: Object.fromEntries(teams.map(t => [t.slug, t])),
    players,
    playerBySlug: Object.fromEntries(players.map(p => [p.slug, p])),
    playerById: Object.fromEntries(players.map(p => [p.id, p])),
  };
}

// Players with a page worth listing: still at a club, or predicted.
export const listed = p => p.status !== 'u' || p.predicted !== null;

const byAhead = (a, b) => (b.ahead ?? -1) - (a.ahead ?? -1) || (b.predicted ?? -1) - (a.predicted ?? -1);

// A table of players: name (linked), club, price and the gameweek's
// prediction plus the next five gameweeks'.
function playersTable(caption, players, { club = true } = {}) {
  return `<table><caption>${escapeHtml(caption)}</caption><thead><tr><th scope="col">Player</th>${club ? '<th scope="col">Club</th>' : '<th scope="col">Pos</th>'}<th scope="col">Price</th><th scope="col" class="num">Next GW</th><th scope="col" class="num">Next ${AHEAD}</th></tr></thead><tbody>${
    players.map(p => `<tr><td>${playerLink(p)}</td><td>${club ? (p.teamRef ? `<a href="/team/${p.teamRef.slug}">${escapeHtml(p.team)}</a>` : '') : POS_SHORT[p.positionId]}</td><td>${money(p.price)}</td><td class="num">${p.predicted === null ? '–' : fmt(p.predicted)}</td><td class="num">${p.ahead === null ? '–' : fmt(p.ahead)}</td></tr>`).join('')
  }</tbody></table>`;
}

function fixtureText(f) {
  return `${f.opponent.short} (${f.home ? 'H' : 'A'})`;
}

// The next gameweeks of a club's fixtures: [{ event, fixtures }], blank
// gameweeks included.
function weeksOf(team, from, n) {
  const out = [];
  for (let gw = from; gw < from + n && gw <= 38; gw++) out.push({ event: gw, fixtures: team.fixtures.filter(f => f.event === gw) });
  return out;
}

// Links to the gameweeks around the one being planned.
export const gwNav = (model, current) => {
  const target = model.event.id;
  const links = [];
  for (let gw = Math.max(1, target - 3); gw <= Math.min(38, target + AHEAD - 1); gw++) {
    links.push(gw === current ? `<b>${gwShort(gw)}</b>` : `<a href="/gw/${gw}">${gwShort(gw)}</a>`);
  }
  return `<p class="seo-links">${links.join(' ')}</p>`;
};

/* ---------------------------------------------------------------- player */

// history: element-summary's `history` ([{ round, total_points, minutes,
// opponent_team, was_home }]), when it could be fetched.
export function playerPage(model, p, history = null) {
  const gw = model.event;
  const team = p.teamRef;
  const position = POSITION[p.positionId];
  const samePos = model.players.filter(o => o.positionId === p.positionId && o.ahead !== null).sort(byAhead);
  const rank = samePos.findIndex(o => o.id === p.id) + 1;
  const alternatives = samePos.filter(o => o.id !== p.id && Math.abs(o.price - p.price) <= 1.0).slice(0, 6);
  const unavailable = p.status !== 'a' && p.news;

  const weekRows = p.weeks.map(w => {
    const fx = team ? team.fixtures.filter(f => f.event === w.event) : [];
    return `<tr><td>${gwShort(w.event)}</td><td>${fx.length ? fx.map(fixtureText).join(', ') : 'Blank'}</td><td>${fx.length ? fx.map(f => `${f.difficulty} (${difficultyWord(f.difficulty)})`).join(', ') : '–'}</td><td class="num">${fmt(w.points)}</td></tr>`;
  }).join('');
  const recent = Array.isArray(history) ? history.slice(-5) : [];
  const teamById = Object.fromEntries(model.teams.map(t => [t.id, t]));

  const body = (unavailable ? section('Availability', `<p><b>${escapeHtml(p.news)}</b>${typeof p.chance === 'number' ? ` FPL gives him a ${p.chance}% chance of playing next round, and his prediction is scaled by it.` : ''}</p>`) : '')
    + (p.weeks.length ? section(`${p.name}’s predicted points`, `<table><caption>Next ${p.weeks.length} gameweeks</caption><thead><tr><th scope="col">GW</th><th scope="col">Fixture</th><th scope="col">Difficulty</th><th scope="col" class="num">Pts</th></tr></thead><tbody>${weekRows}</tbody></table>${rank ? `<p>That’s ${fmt(p.ahead)} points over the next ${p.weeks.length} gameweeks, <b>${ordinal(rank)} of ${samePos.length} ${position}s</b>.</p>` : ''}`) : '')
    + section('This season', `<table><caption>${escapeHtml(p.fullName)} so far</caption><tbody>${[
      ['FPL points', p.totalPoints], ['Points per match', fmt(p.ppg)], ['Form', fmt(p.form)], ['Minutes', p.minutes],
      ['Goals', p.goals], ['Assists', p.assists], ...(p.positionId <= 2 ? [['Clean sheets', p.cleanSheets]] : []), ['Bonus points', p.bonus],
      ['Expected goals (xG)', fmt(p.xg)], ['Expected assists (xA)', fmt(p.xa)], ['Price', money(p.price)], ['Selected by', `${p.selectedBy}%`],
    ].map(([k, v]) => `<tr><th scope="row">${k}</th><td class="num">${v}</td></tr>`).join('')}</tbody></table>`)
    + (recent.length ? section('Last gameweeks', `<table><caption>Points by gameweek</caption><thead><tr><th scope="col">GW</th><th scope="col">Opponent</th><th scope="col" class="num">Mins</th><th scope="col" class="num">Pts</th></tr></thead><tbody>${recent.map(h => `<tr><td>${gwShort(h.round)}</td><td>${teamById[h.opponent_team] ? fixtureText({ opponent: teamById[h.opponent_team], home: h.was_home }) : ''}</td><td class="num">${h.minutes}</td><td class="num">${h.total_points}</td></tr>`).join('')}</tbody></table>`) : '')
    + (alternatives.length ? section(`Similar ${position}s`, `${playersTable(`${POSITIONS[p.positionId]} within £1m of ${money(p.price)}`, alternatives)}<p>Compare them side by side in <a href="/">FPL Checker</a>.</p>`) : '')
    + section('More', list([
      ...(team ? [`<a href="/team/${team.slug}">${escapeHtml(team.name)} fixtures and players</a>`] : []),
      `<a href="/gw/${gw.id}">${escapeHtml(gw.name)} predictions</a>`,
      '<a href="/fpl-captain-picks">Best FPL captain this week</a>',
      '<a href="/fpl-players">Every player’s prediction</a>',
    ]));

  const next = p.weeks[0];
  const nextFx = team ? team.fixtures.find(f => f.event >= gw.id) : null;
  const faq = [
    ...(next ? [[`How many points will ${p.name} score in ${gw.name}?`, `FPL Checker predicts ${fmt(next.points)} points for ${p.name} in ${gw.name}${p.ahead !== null ? `, and ${fmt(p.ahead)} over the next ${p.weeks.length} gameweeks` : ''}. Predictions use form, minutes, fixtures, betting odds and injury news, and are updated every day.`]] : []),
    ...(rank ? [[`Is ${p.name} a good FPL pick?`, `Over the next ${p.weeks.length} gameweeks he is predicted ${ordinal(rank)} of ${samePos.length} ${position}s at ${money(p.price)}${alternatives.length ? `. The best-predicted ${position} within £1m of his price is ${alternatives[0].ahead > p.ahead ? alternatives[0].name : p.name}` : ''}.`]] : []),
    ...(nextFx ? [[`Who do ${team.name} play next?`, `${team.name} play ${nextFx.opponent.name} ${nextFx.home ? 'at home' : 'away'} in Gameweek ${nextFx.event}, rated ${nextFx.difficulty} of 5 for difficulty (${difficultyWord(nextFx.difficulty)}).`]] : []),
  ];
  const nextText = next ? `predicted to score <b>${fmt(next.points)} points</b> in ${escapeHtml(gw.name)}${p.ahead !== null && p.weeks.length > 1 ? ` and ${fmt(p.ahead)} over the next ${p.weeks.length} gameweeks` : ''}` : 'not predicted this gameweek';
  return layout({
    path: `/player/${p.slug}`,
    title: `${p.name} FPL Prediction ${gwShort(gw.id)} — points, fixtures and price | FPL Checker`,
    description: `${p.fullName} FPL: ${next ? `${fmt(next.points)} predicted points in ${gw.name}` : 'no prediction this gameweek'}, ${money(p.price)}, owned by ${p.selectedBy}%. Fixtures, form, xG and similar ${position}s.`,
    h1: `${p.name} FPL prediction`,
    intro: `${escapeHtml(p.fullName)} (${team ? escapeHtml(team.name) : 'no club'}, ${position}, ${money(p.price)}) is ${nextText}. He is in ${p.selectedBy}% of FPL teams.`,
    body,
    faq,
    crumbs: [{ name: 'Players', path: '/fpl-players' }, ...(team ? [{ name: team.name, path: `/team/${team.slug}` }] : [])],
    cta: { href: '/', label: 'Check my team' },
    extraJsonLd: [{
      '@context': 'https://schema.org', '@type': 'Person', name: p.fullName, alternateName: p.name,
      ...(team ? { memberOf: { '@type': 'SportsTeam', name: team.name, sport: 'Football' } } : {}),
    }],
  });
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ------------------------------------------------------------------ team */

export function teamPage(model, team) {
  const gw = model.event;
  const weeks = weeksOf(team, gw.id, 6);
  const squad = model.players.filter(p => p.teamRef === team && listed(p)).sort(byAhead);
  const top = squad.filter(p => p.ahead !== null);
  const avg = t => {
    const fx = t.fixtures.filter(f => f.event < gw.id + AHEAD);
    return fx.length ? sum(fx.map(f => f.difficulty)) / fx.length : null;
  };
  const ranked = model.teams.filter(t => avg(t) !== null).sort((a, b) => avg(a) - avg(b));
  const runRank = ranked.indexOf(team) + 1;
  const mine = avg(team);

  const body = section(`${team.name} fixtures`, `<table><caption>Next ${weeks.length} gameweeks</caption><thead><tr><th scope="col">GW</th><th scope="col">Opponent</th><th scope="col">Difficulty</th></tr></thead><tbody>${
    weeks.map(w => `<tr><td><a href="/gw/${w.event}">${gwShort(w.event)}</a></td><td>${w.fixtures.length ? w.fixtures.map(f => `<a href="/team/${f.opponent.slug}">${escapeHtml(fixtureText(f))}</a>`).join(', ') : 'Blank'}</td><td>${w.fixtures.length ? w.fixtures.map(f => `${f.difficulty} (${difficultyWord(f.difficulty)})`).join(', ') : '–'}</td></tr>`).join('')
  }</tbody></table>${runRank ? `<p>Average difficulty over the next ${AHEAD} gameweeks: <b>${mine.toFixed(1)}</b>, the ${ordinal(runRank)} easiest run of ${ranked.length} clubs.</p>` : ''}`)
    + (top.length ? section(`Best ${team.name} players for FPL`, playersTable(`${team.short} players by predicted points`, top.slice(0, 10), { club: false })) : '')
    + (squad.length > 10 ? section(`All ${team.name} players`, `<p class="seo-links">${squad.slice(top.length ? 10 : 0).map(p => playerLink(p)).join(' · ')}</p>`) : '')
    + section('Other clubs', `<p class="seo-links">${model.teams.filter(t => t !== team).map(t => `<a href="/team/${t.slug}">${escapeHtml(t.name)}</a>`).join(' · ')}</p>`);

  const best = top[0];
  const nextFx = team.fixtures[0];
  return layout({
    path: `/team/${team.slug}`,
    title: `${team.name} FPL Fixtures and Best Players — ${gwShort(gw.id)} | FPL Checker`,
    description: `${team.name} FPL guide: fixtures and difficulty for the next ${AHEAD} gameweeks and every ${team.name} player’s predicted points, price and ownership.`,
    h1: `${team.name} FPL fixtures and players`,
    intro: `${escapeHtml(team.name)}’s upcoming Fantasy Premier League fixtures and the predicted points of every ${escapeHtml(team.name)} player, updated every day.${best ? ` Their best-predicted player over the next ${AHEAD} gameweeks is ${playerLink(best)}.` : ''}`,
    body,
    faq: [
      ...(best ? [[`Who is the best ${team.name} player in FPL right now?`, `${best.name} (${POSITION[best.positionId]}, ${money(best.price)}), predicted ${fmt(best.ahead)} points over the next ${best.weeks.length} gameweeks.`]] : []),
      ...(runRank ? [[`Do ${team.name} have good FPL fixtures?`, `Their next ${AHEAD} gameweeks average ${mine.toFixed(1)} on FPL’s 1–5 difficulty scale, the ${ordinal(runRank)} easiest of ${ranked.length} clubs.`]] : []),
      ...(nextFx ? [[`Who do ${team.name} play next?`, `${nextFx.opponent.name}, ${nextFx.home ? 'at home' : 'away'}, in Gameweek ${nextFx.event}.`]] : []),
    ],
    crumbs: [{ name: 'Players', path: '/fpl-players' }],
    extraJsonLd: [{ '@context': 'https://schema.org', '@type': 'SportsTeam', name: team.name, sport: 'Football' }],
  });
}

/* ------------------------------------------------------------- gameweeks */

// A gameweek after the one being planned, from the predictions for the
// next five gameweeks.
export function futureGwPage(model, gwId, eventName) {
  const players = model.players
    .map(p => ({ ...p, predicted: (p.weeks.find(w => w.event === gwId) || {}).points ?? null }))
    .filter(p => p.predicted !== null)
    .sort((a, b) => b.predicted - a.predicted);
  const doubles = model.teams.filter(t => t.fixtures.filter(f => f.event === gwId).length > 1);
  const blanks = model.teams.filter(t => !t.fixtures.some(f => f.event === gwId));
  const row = p => `<tr><td>${playerLink(p)}</td><td>${p.teamRef ? `<a href="/team/${p.teamRef.slug}">${escapeHtml(p.team)}</a>` : ''}</td><td>${money(p.price)}</td><td class="num">${fmt(p.predicted)}</td></tr>`;
  const table = (caption, rows) => `<table><caption>${escapeHtml(caption)}</caption><thead><tr><th scope="col">Player</th><th scope="col">Club</th><th scope="col">Price</th><th scope="col" class="num">Pts</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table>`;
  const body = section('Gameweeks', gwNav(model, gwId))
    + ((doubles.length || blanks.length) ? section('Doubles and blanks', `<p>${doubles.length ? `Playing twice: ${doubles.map(t => escapeHtml(t.name)).join(', ')}. ` : ''}${blanks.length ? `Not playing: ${blanks.map(t => escapeHtml(t.name)).join(', ')}.` : ''}</p>`) : '')
    + section(`Top 15 predicted players for ${eventName}`, table('Highest predicted points', players.slice(0, 15)))
    + [1, 2, 3, 4].map(pos => section(`Best ${POSITIONS[pos].toLowerCase()} for ${eventName}`, table(POSITIONS[pos], players.filter(p => p.positionId === pos).slice(0, 8)))).join('');
  return layout({
    path: `/gw/${gwId}`,
    title: `FPL ${eventName} Predictions — early look at the top players | FPL Checker`,
    description: `Early FPL predictions for ${eventName}: the top predicted players overall and by position, plus double and blank gameweeks. Updated daily until the deadline.`,
    h1: `FPL ${eventName} predictions`,
    intro: `An early look at ${escapeHtml(eventName)}, ${gwId - model.event.id} gameweek${gwId - model.event.id === 1 ? '' : 's'} ahead. Predictions this far out use fixtures and form; they firm up as team news arrives.`,
    body,
    crumbs: [{ name: 'Gameweeks', path: '/fpl-predictions' }],
  });
}

// A gameweek whose deadline has passed: what was predicted before it, and
// once it's been played, what happened. saved: the predictions file for it;
// snap: the best squad saved for it; live: event/<n>/live elements, or null.
export function pastGwPage(model, gwId, eventName, { saved, snap, live }) {
  const scored = live ? Object.fromEntries(live.map(el => [el.id, el.stats || {}])) : null;
  const rows = Object.entries(saved.predictedById)
    .map(([id, predicted]) => {
      const p = model.playerById[id];
      return p ? { ...p, predicted, actual: scored && scored[id] ? scored[id].total_points : null, minutes: scored && scored[id] ? scored[id].minutes : 0 } : null;
    })
    .filter(Boolean);
  const head = `<thead><tr><th scope="col">Player</th><th scope="col">Club</th><th scope="col" class="num">Predicted</th>${scored ? '<th scope="col" class="num">Scored</th>' : ''}</tr></thead>`;
  const row = p => `<tr><td>${playerLink(p)}</td><td>${escapeHtml(p.team)}</td><td class="num">${fmt(p.predicted)}</td>${scored ? `<td class="num">${p.actual ?? '–'}</td>` : ''}</tr>`;
  const topPredicted = [...rows].sort((a, b) => b.predicted - a.predicted).slice(0, 15);
  const played = rows.filter(p => p.minutes > 0);
  const topScorers = scored ? [...played].sort((a, b) => b.actual - a.actual).slice(0, 10) : [];
  const miss = played.length >= 20 ? sum(played.map(p => Math.abs(p.predicted - p.actual))) / played.length : null;

  let xiHtml = '';
  if (snap && Array.isArray(snap.startingIds)) {
    const xi = snap.startingIds.map(id => rows.find(r => r.id === id)).filter(Boolean).sort((a, b) => a.positionId - b.positionId);
    const total = list => sum(list.map(p => (p.id === snap.captainId ? 2 : 1) * p.predicted));
    const actual = scored ? sum(xi.map(p => (p.id === snap.captainId ? 2 : 1) * (p.actual || 0))) : null;
    xiHtml = section(`Best XI for ${eventName}`, `<p>Picked before the deadline, predicted <b>${fmt(total(xi))} points</b>${actual !== null ? ` and it scored <b>${actual}</b>` : ''} (captain doubled).</p><table><caption>Best XI</caption><thead><tr><th scope="col">Pos</th><th scope="col">Player</th><th scope="col" class="num">Predicted</th>${scored ? '<th scope="col" class="num">Scored</th>' : ''}</tr></thead><tbody>${
      xi.map(p => `<tr><td>${POS_SHORT[p.positionId]}</td><td>${playerLink(p)}${p.id === snap.captainId ? ' (C)' : ''}</td><td class="num">${fmt(p.predicted)}</td>${scored ? `<td class="num">${p.actual ?? '–'}</td>` : ''}</tr>`).join('')
    }</tbody></table>`);
  }
  const body = section('Gameweeks', gwNav(model, gwId))
    + (miss !== null ? section('How the predictions did', `<p>For the ${played.length} players who played, predictions missed by <b>${fmt(miss)} points</b> on average. See <a href="/fpl-points-predictor">how the predictions work</a>.</p>`) : '')
    + xiHtml
    + section(`Top predicted players for ${eventName}`, `<table><caption>Predicted before the deadline</caption>${head}<tbody>${topPredicted.map(row).join('')}</tbody></table>`)
    + (topScorers.length ? section(`Top scorers in ${eventName}`, `<table><caption>Most points</caption>${head}<tbody>${topScorers.map(row).join('')}</tbody></table>`) : '');
  return layout({
    path: `/gw/${gwId}`,
    title: `FPL ${eventName} Predictions and Results — best XI and top scorers | FPL Checker`,
    description: `FPL ${eventName}: the points predicted for every player before the deadline${scored ? ', what they scored, and how the best XI did' : ' and the best XI'}.`,
    h1: `FPL ${eventName} predictions${scored ? ' and results' : ''}`,
    intro: `What FPL Checker predicted for ${escapeHtml(eventName)} before its deadline${scored ? ', next to what each player scored' : ''}. For the gameweek coming up, see <a href="/fpl-predictions">this week’s FPL predictions</a>.`,
    body,
    crumbs: [{ name: 'Gameweeks', path: '/fpl-predictions' }],
  });
}

/* ------------------------------------------------------------------- hub */

export function playersHubPage(model) {
  const gw = model.event;
  const ranked = model.players.filter(p => p.ahead !== null).sort(byAhead);
  const body = section(`Top 20 players for the next ${AHEAD} gameweeks`, playersTable('Most predicted points', ranked.slice(0, 20)))
    + [1, 2, 3, 4].map(pos => section(`Best ${POSITIONS[pos].toLowerCase()}`, playersTable(POSITIONS[pos], ranked.filter(p => p.positionId === pos).slice(0, 10)))).join('')
    + section('Budget picks', playersTable(`Under £5.5m`, ranked.filter(p => p.price < 5.5).slice(0, 10)))
    + section('Clubs', `<p class="seo-links">${model.teams.map(t => `<a href="/team/${t.slug}">${escapeHtml(t.name)}</a>`).join(' · ')}</p>`)
    + section('Gameweeks', gwNav(model, null));
  return layout({
    path: '/fpl-players',
    title: `FPL Player Predictions ${gwShort(gw.id)} — every player ranked | FPL Checker`,
    description: `Every Fantasy Premier League player ranked by predicted points for ${gw.name} and the next ${AHEAD} gameweeks, by position, budget and club.`,
    h1: 'FPL player predictions',
    intro: `Every Fantasy Premier League player ranked by predicted points for ${escapeHtml(gw.name)} and the ${AHEAD} gameweeks from it. Open a player for his fixtures, form and similar picks, or a club for its fixtures.`,
    body,
    faq: [
      ['Who are the best FPL players right now?', ranked.length ? `Over the next ${AHEAD} gameweeks: ${ranked.slice(0, 3).map(p => `${p.name} (${fmt(p.ahead)})`).join(', ')}. The table above lists the top 20.` : 'The table above lists the top players once predictions are ready.'],
      ['Who are the best cheap FPL players?', ranked.some(p => p.price < 5.5) ? `Under £5.5m: ${ranked.filter(p => p.price < 5.5).slice(0, 3).map(p => `${p.name} (${money(p.price)})`).join(', ')}.` : 'See the budget picks table above.'],
    ],
  });
}

/* --------------------------------------------------------------- sitemap */

// gwIds: the gameweeks with a page (saved predictions, or ahead).
export function sitemapXml(model, gwIds) {
  const url = (path, freq) => `  <url>\n    <loc>${SITE}${path}</loc>\n    <changefreq>${freq}</changefreq>\n  </url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[
    url('/fpl-players', 'daily'),
    ...model.teams.map(t => url(`/team/${t.slug}`, 'daily')),
    ...gwIds.map(id => url(`/gw/${id}`, id >= model.event.id ? 'daily' : 'monthly')),
    ...model.players.filter(listed).map(p => url(`/player/${p.slug}`, 'daily')),
  ].join('\n')}\n</urlset>\n`;
}

export function notFoundPage(path, what) {
  return layout({
    path,
    title: `${what} not found | FPL Checker`,
    description: `${what} isn’t on FPL Checker.`,
    h1: `${what} not found`,
    intro: 'It may have left the Premier League, or the address is mistyped. Try the <a href="/fpl-players">player list</a>.',
    body: '',
    noindex: true,
  });
}
