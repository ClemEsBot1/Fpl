// More pages for common FPL searches, built from live data on request
// (api/optimal-squad.js?page=…):
//   /fpl-best-goalkeepers, -defenders, -midfielders, -forwards
//                            each position ranked by predicted points
//   /fpl-budget-players      the best cheap picks in each position
//   /fpl-fixture-difficulty  every club's next five fixtures, easiest first
//   /fpl-injuries            injured, suspended and doubtful players
//   /fpl-most-owned          the most selected players and how they rate
//   /fpl-in-form             players in form, and whether it should last
//
// Pure like src/lib/seoDynamic.js: the API route hands the model in.

import { escapeHtml, layout, list, playerLink, section } from './seoPage.js';
import { AHEAD, POS_SHORT, byAhead, difficultyWord, playersTable } from './seoDynamic.js';

const fmt = n => (Math.round(n * 10) / 10).toFixed(1);
const money = p => `£${p.toFixed(1)}m`;
const gwShort = id => `GW${id}`;
const available = p => p.status === 'a' && p.ahead !== null;
const clubLink = t => (t ? `<a href="/team/${t.slug}">${escapeHtml(t.short)}</a>` : '');

/* --------------------------------------------------------------- positions */

export const POSITION_PAGES = {
  goalkeepers: { id: 1, one: 'goalkeeper', title: 'Goalkeepers' },
  defenders: { id: 2, one: 'defender', title: 'Defenders' },
  midfielders: { id: 3, one: 'midfielder', title: 'Midfielders' },
  forwards: { id: 4, one: 'forward', title: 'Forwards' },
};

// The most a "budget" pick costs in each position.
export const BUDGET = { 1: 4.5, 2: 4.5, 3: 5.5, 4: 6.0 };

export function positionPage(model, key) {
  const pos = POSITION_PAGES[key];
  const gw = model.event;
  const ranked = model.players.filter(p => p.positionId === pos.id && available(p)).sort(byAhead);
  const thisWeek = [...ranked].sort((a, b) => (b.predicted ?? -1) - (a.predicted ?? -1));
  const cheap = ranked.filter(p => p.price <= BUDGET[pos.id]);
  const lowOwned = ranked.filter(p => p.selectedBy < 10);
  const path = `/fpl-best-${key}`;
  const top = ranked.slice(0, 3);
  const body = section(`Best FPL ${pos.title.toLowerCase()} for the next ${AHEAD} gameweeks`, playersTable(`${pos.title} by predicted points, ${gwShort(gw.id)}–${gwShort(Math.min(38, gw.id + AHEAD - 1))}`, ranked.slice(0, 20)))
    + section(`Best ${pos.title.toLowerCase()} for ${gw.name} only`, playersTable(`${pos.title} by predicted points this gameweek`, thisWeek.slice(0, 10)))
    + (cheap.length ? section(`Budget ${pos.title.toLowerCase()}`, playersTable(`${money(BUDGET[pos.id])} or less`, cheap.slice(0, 8))) : '')
    + (lowOwned.length ? section(`Differential ${pos.title.toLowerCase()}`, playersTable('Owned by under 10%', lowOwned.slice(0, 6))) : '')
    + section('Other positions', list(Object.entries(POSITION_PAGES).filter(([k]) => k !== key).map(([k, v]) => `<a href="/fpl-best-${k}">Best FPL ${v.title.toLowerCase()}</a>`)));
  return layout({
    path,
    title: `Best FPL ${pos.title} ${gwShort(gw.id)} — top ${pos.one}s ranked | FPL Checker`,
    description: `The best Fantasy Premier League ${pos.title.toLowerCase()} for ${gw.name} and the next ${AHEAD} gameweeks, ranked by predicted points, with budget and differential ${pos.one}s.`,
    h1: `Best FPL ${pos.title.toLowerCase()} for ${gw.name}`,
    intro: `Every available ${pos.one} ranked by FPL Checker’s predicted points over the next ${AHEAD} gameweeks, from fixtures, minutes, form, betting odds and injury news. Updated every day.`,
    body,
    faq: [
      [`Who is the best FPL ${pos.one} for ${gwShort(gw.id)}?`, top.length ? `${top.map(p => `${p.name} (${p.team}, ${money(p.price)}, ${fmt(p.ahead)} predicted over ${p.weeks.length} gameweeks)`).join(', ')}.` : 'See the table above.'],
      [`Who is the best cheap FPL ${pos.one}?`, cheap.length ? `${cheap[0].name} at ${money(cheap[0].price)} is predicted ${fmt(cheap[0].ahead)} points over the next ${cheap[0].weeks.length} gameweeks, the most of any ${pos.one} at ${money(BUDGET[pos.id])} or less.` : `No ${pos.one} at ${money(BUDGET[pos.id])} or less is predicted to start regularly right now.`],
    ],
    crumbs: [{ name: 'Players', path: '/fpl-players' }],
    cta: { href: '/', label: 'Check my team' },
  });
}

/* ------------------------------------------------------------------ budget */

export function budgetPage(model) {
  const gw = model.event;
  const ranked = model.players.filter(available).sort(byAhead);
  const byPos = Object.fromEntries([1, 2, 3, 4].map(pos => [pos, ranked.filter(p => p.positionId === pos && p.price <= BUDGET[pos])]));
  const value = ranked.filter(p => p.ahead > 0).map(p => ({ p, perMillion: p.ahead / p.price })).sort((a, b) => b.perMillion - a.perMillion).slice(0, 15);
  const body = Object.entries(POSITION_PAGES).map(([, v]) => section(`Budget ${v.title.toLowerCase()} (${money(BUDGET[v.id])} or less)`, byPos[v.id].length ? playersTable(v.title, byPos[v.id].slice(0, 8)) : '<p>None predicted to start right now.</p>')).join('')
    + section('Best value: points per £1m', `<table><caption>Predicted points over ${AHEAD} gameweeks per £1m</caption><thead><tr><th scope="col">Player</th><th scope="col">Pos</th><th scope="col">Price</th><th scope="col" class="num">Next ${AHEAD}</th><th scope="col" class="num">Per £1m</th></tr></thead><tbody>${value.map(({ p, perMillion }) => `<tr><td>${playerLink(p)}</td><td>${POS_SHORT[p.positionId]}</td><td>${money(p.price)}</td><td class="num">${fmt(p.ahead)}</td><td class="num">${fmt(perMillion)}</td></tr>`).join('')}</tbody></table>`)
    + section('More', list(['<a href="/fpl-differentials">FPL differentials</a>', '<a href="/fpl-transfer-suggestions">Transfer suggestions for your team</a>', '<a href="/fpl-price-changes">Price changes tonight</a>']));
  const firsts = [1, 2, 3, 4].map(pos => byPos[pos][0]).filter(Boolean);
  return layout({
    path: '/fpl-budget-players',
    title: `Best Cheap FPL Players ${gwShort(gw.id)} — budget enablers | FPL Checker`,
    description: `The best cheap Fantasy Premier League players for ${gw.name}: budget goalkeepers, defenders, midfielders and forwards ranked by predicted points, plus the best value per £1m.`,
    h1: `Best cheap FPL players for ${gw.name}`,
    intro: `Budget picks free up money for premiums. These are the cheapest players in each position predicted to earn their place over the next ${AHEAD} gameweeks.`,
    body,
    faq: [
      ['Who are the best budget FPL players?', firsts.length ? `${firsts.map(p => `${p.name} (${POS_SHORT[p.positionId]}, ${money(p.price)})`).join(', ')}: the most predicted points in each position at budget prices.` : 'See the tables above.'],
      ['What is an FPL enabler?', 'A cheap player who starts regularly, so you can spend more on premium players elsewhere without a weak spot in your team.'],
    ],
    crumbs: [{ name: 'Players', path: '/fpl-players' }],
    cta: { href: '/', label: 'Check my team' },
  });
}

/* ------------------------------------------------------- fixture difficulty */

// Every club's next AHEAD gameweeks of fixtures, and their average
// difficulty (a blank counts as the hardest, 5; a double as the average of
// its two, less one for the extra game).
export function fixtureRows(model) {
  const from = model.event.id;
  return model.teams.map(team => {
    const weeks = [];
    for (let gw = from; gw < from + AHEAD && gw <= 38; gw++) weeks.push({ event: gw, fixtures: team.fixtures.filter(f => f.event === gw) });
    const scores = weeks.map(w => (w.fixtures.length ? w.fixtures.reduce((s, f) => s + f.difficulty, 0) / w.fixtures.length - (w.fixtures.length - 1) : 5));
    return { team, weeks, average: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 5 };
  }).sort((a, b) => a.average - b.average || a.team.name.localeCompare(b.team.name));
}

export function fixtureDifficultyPage(model) {
  const gw = model.event;
  const rows = fixtureRows(model);
  const last = Math.min(38, gw.id + AHEAD - 1);
  const head = rows[0] ? rows[0].weeks.map(w => `<th scope="col">${gwShort(w.event)}</th>`).join('') : '';
  const cell = w => (w.fixtures.length
    ? `<td>${w.fixtures.map(f => `<span class="seo-fdr seo-fdr-${f.difficulty}" title="${difficultyWord(f.difficulty)}">${escapeHtml(f.opponent.short)} (${f.home ? 'H' : 'A'})</span>`).join(' ')}</td>`
    : '<td><span class="seo-fdr seo-fdr-blank">Blank</span></td>');
  const table = `<div class="seo-scroll"><table><caption>Next ${AHEAD} gameweeks, easiest run first (1 easy – 5 hard)</caption><thead><tr><th scope="col">Club</th>${head}<th scope="col" class="num">Avg</th></tr></thead><tbody>${
    rows.map(r => `<tr><td>${clubLink(r.team)}</td>${r.weeks.map(cell).join('')}<td class="num">${fmt(r.average)}</td></tr>`).join('')
  }</tbody></table></div>`;
  const easy = rows.slice(0, 3).map(r => r.team);
  const hard = rows.slice(-3).reverse().map(r => r.team);
  const body = section(`FPL fixture difficulty, ${gwShort(gw.id)}–${gwShort(last)}`, `${table}<p>Difficulty is FPL’s own rating of each match. A double gameweek counts as easier, a blank as the hardest.</p>`)
    + section('Easiest fixtures', `<p>${easy.map(t => `<a href="/team/${t.slug}">${escapeHtml(t.name)}</a>`).join(', ')}: their players are worth a look for the next few weeks.</p>`)
    + section('Hardest fixtures', `<p>${hard.map(t => `<a href="/team/${t.slug}">${escapeHtml(t.name)}</a>`).join(', ')}: think about selling or benching their players.</p>`)
    + section('More', list(['<a href="/fpl-double-gameweek">Double gameweeks</a>', '<a href="/fpl-blank-gameweek">Blank gameweeks</a>', '<a href="/fpl-predictions">This gameweek’s predictions</a>']));
  return layout({
    path: '/fpl-fixture-difficulty',
    title: `FPL Fixture Difficulty ${gwShort(gw.id)}–${gwShort(last)} — fixture ticker | FPL Checker`,
    description: `FPL fixture ticker: every Premier League club’s next ${AHEAD} fixtures from ${gw.name}, rated for difficulty and sorted from the easiest run to the hardest.`,
    h1: `FPL fixture difficulty from ${gw.name}`,
    intro: `Every club’s next ${AHEAD} fixtures, home or away, coloured by FPL’s difficulty rating and sorted so the easiest runs come first.`,
    body,
    faq: [
      [`Which teams have the best FPL fixtures from ${gwShort(gw.id)}?`, easy.length ? `${easy.map(t => t.name).join(', ')} have the easiest runs over the next ${AHEAD} gameweeks.` : 'See the table above.'],
      ['What is FPL fixture difficulty (FDR)?', 'FPL rates every match from 1 (easiest) to 5 (hardest) for each side, based on the opponent’s strength. It helps you pick players with good runs of fixtures.'],
    ],
    cta: { href: '/', label: 'Check my team' },
  });
}

/* ---------------------------------------------------------------- injuries */

const STATUS = { i: 'Injured', s: 'Suspended', d: 'Doubtful', u: 'Unavailable', n: 'Not in squad' };

export function injuriesPage(model) {
  const gw = model.event;
  const out = model.players.filter(p => p.status !== 'a' && p.news && (p.selectedBy >= 0.5 || p.status === 'd'))
    .sort((a, b) => b.selectedBy - a.selectedBy);
  const table = (caption, players) => `<table><caption>${escapeHtml(caption)}</caption><thead><tr><th scope="col">Player</th><th scope="col">Club</th><th scope="col">News</th><th scope="col" class="num">Owned</th></tr></thead><tbody>${
    players.map(p => `<tr><td>${playerLink(p)}</td><td>${clubLink(p.teamRef)}</td><td>${escapeHtml(p.news)}</td><td class="num">${p.selectedBy}%</td></tr>`).join('')
  }</tbody></table>`;
  const groups = ['d', 'i', 's', 'u', 'n'].map(s => [s, out.filter(p => p.status === s)]).filter(([, ps]) => ps.length);
  const body = (groups.length ? groups.map(([s, ps]) => section(`${STATUS[s]} (${ps.length})`, table(STATUS[s], ps.slice(0, 40)))).join('') : section('No injury news', '<p>Every player in at least one in 200 teams is available.</p>'))
    + section('More', list(['<a href="/fpl-transfer-suggestions">Replace an injured player</a>', '<a href="/fpl-deadline">This gameweek’s deadline</a>', '<a href="/fpl-price-changes">Price changes tonight</a>']));
  const top = out.slice(0, 3);
  return layout({
    path: '/fpl-injuries',
    title: `FPL Injuries ${gwShort(gw.id)} — injury and suspension news | FPL Checker`,
    description: `FPL injury news for ${gw.name}: every injured, suspended and doubtful Fantasy Premier League player, with FPL’s latest news and how many managers own him.`,
    h1: `FPL injuries and suspensions for ${gw.name}`,
    intro: 'Every flagged player owned by at least one in 200 managers, most owned first, with the latest news from FPL. Doubtful players’ predictions are scaled by their chance of playing.',
    body,
    faq: [
      [`Who is injured in FPL for ${gwShort(gw.id)}?`, top.length ? `${top.map(p => `${p.name} (${p.news})`).join('; ')}. The full list is above.` : 'No widely owned player is flagged right now.'],
      ['What do the FPL injury percentages mean?', 'FPL gives a flagged player a chance of playing next round: 75%, 50% or 25% for a doubt, 0% when he is ruled out.'],
    ],
    crumbs: [{ name: 'Players', path: '/fpl-players' }],
    cta: { href: '/', label: 'Check my team' },
  });
}

/* -------------------------------------------------------------- most owned */

export function mostOwnedPage(model) {
  const gw = model.event;
  const owned = model.players.filter(p => p.ahead !== null).sort((a, b) => b.selectedBy - a.selectedBy);
  const rank = new Map(model.players.filter(p => p.ahead !== null).sort(byAhead).map((p, i) => [p.id, i + 1]));
  const table = `<table><caption>Most selected players</caption><thead><tr><th scope="col">Player</th><th scope="col">Club</th><th scope="col" class="num">Owned</th><th scope="col" class="num">Next ${AHEAD}</th><th scope="col" class="num">Rank</th></tr></thead><tbody>${
    owned.slice(0, 30).map(p => `<tr><td>${playerLink(p)}</td><td>${clubLink(p.teamRef)}</td><td class="num">${p.selectedBy}%</td><td class="num">${fmt(p.ahead)}</td><td class="num">${rank.get(p.id)}</td></tr>`).join('')
  }</tbody></table>`;
  const overrated = owned.slice(0, 40).filter(p => rank.get(p.id) > 60).slice(0, 8);
  const body = section('The most owned players', `${table}<p>Rank is where the player comes among all players for predicted points over the next ${AHEAD} gameweeks.</p>`)
    + (overrated.length ? section('Popular, but predicted to disappoint', playersTable('Widely owned, outside the top 60 for predicted points', overrated)) : '')
    + section('More', list(['<a href="/fpl-differentials">Differentials: low owned, high predicted</a>', '<a href="/rate-my-fpl-team">Rate my FPL team</a>']));
  const top = owned.slice(0, 3);
  return layout({
    path: '/fpl-most-owned',
    title: `Most Owned FPL Players ${gwShort(gw.id)} — the template team | FPL Checker`,
    description: `The most selected Fantasy Premier League players for ${gw.name}, how many managers own them and how they rank for predicted points: who’s worth the hype and who isn’t.`,
    h1: `Most owned FPL players for ${gw.name}`,
    intro: 'The players most managers own, the so-called template, next to how FPL Checker rates them for the coming gameweeks.',
    body,
    faq: [
      ['Who is the most owned player in FPL?', top.length ? `${top.map(p => `${p.name} (${p.selectedBy}%)`).join(', ')}.` : 'See the table above.'],
      ['Should I own the template players?', 'Owning the most popular players protects your rank, because when they score everyone gains. Differentials are how you climb past people.'],
    ],
    crumbs: [{ name: 'Players', path: '/fpl-players' }],
    cta: { href: '/', label: 'Check my team' },
  });
}

/* ------------------------------------------------------------------ form */

export function inFormPage(model) {
  const gw = model.event;
  const inForm = model.players.filter(p => p.status === 'a' && p.form > 0 && p.ahead !== null).sort((a, b) => b.form - a.form || byAhead(a, b));
  const table = (caption, players) => `<table><caption>${escapeHtml(caption)}</caption><thead><tr><th scope="col">Player</th><th scope="col">Club</th><th scope="col">Price</th><th scope="col" class="num">Form</th><th scope="col" class="num">Next ${AHEAD}</th></tr></thead><tbody>${
    players.map(p => `<tr><td>${playerLink(p)}</td><td>${clubLink(p.teamRef)}</td><td>${money(p.price)}</td><td class="num">${fmt(p.form)}</td><td class="num">${fmt(p.ahead)}</td></tr>`).join('')
  }</tbody></table>`;
  const top = inForm.slice(0, 20);
  const median = top.length ? [...top].sort((a, b) => a.ahead - b.ahead)[Math.floor(top.length / 2)].ahead : 0;
  const lasting = top.filter(p => p.ahead >= median).slice(0, 8);
  const body = section('In form now', `${table('Highest FPL form (average points over the last 30 days)', top)}<p>Form looks back; the predictions look ahead at fixtures and minutes.</p>`)
    + (lasting.length ? section('In form, with fixtures to keep it going', table('In form and predicted well', lasting)) : '')
    + [1, 2, 3, 4].map(pos => {
      const ps = inForm.filter(p => p.positionId === pos).slice(0, 5);
      return ps.length ? section(`In-form ${Object.values(POSITION_PAGES).find(v => v.id === pos).title.toLowerCase()}`, table(POS_SHORT[pos], ps)) : '';
    }).join('');
  return layout({
    path: '/fpl-in-form',
    title: `In-Form FPL Players ${gwShort(gw.id)} — who to buy on form | FPL Checker`,
    description: `The most in-form Fantasy Premier League players for ${gw.name}, by FPL form, next to their predicted points for the next ${AHEAD} gameweeks so you can tell who will keep it up.`,
    h1: `In-form FPL players for ${gw.name}`,
    intro: `FPL form is a player’s average points over the last 30 days. Here it is next to FPL Checker’s predictions for the next ${AHEAD} gameweeks, because good form with hard fixtures often doesn’t last.`,
    body,
    faq: [
      ['Who is the most in-form FPL player?', top.length ? `${top.slice(0, 3).map(p => `${p.name} (form ${fmt(p.form)})`).join(', ')}.` : 'See the table above.'],
      ['Should I buy players on form?', 'Form helps, but fixtures and minutes matter more for the weeks ahead. A player in form with an easy run is the best buy.'],
    ],
    crumbs: [{ name: 'Players', path: '/fpl-players' }],
    cta: { href: '/', label: 'Check my team' },
  });
}
