// Pages for the FPL searches people make every week, built from live data
// on request (api/optimal-squad.js?page=…):
//   /fpl-price-changes     who's likely to rise or fall at the next change
//   /fpl-deadline          this gameweek's deadline (UK time) and the next ones
//   /fpl-double-gameweek   clubs playing twice, gameweek by gameweek
//   /fpl-blank-gameweek    clubs not playing, gameweek by gameweek
//   /fpl-differentials     low-owned players with the most predicted points
//   /compare/<a>-vs-<b>    two players side by side
//
// Pure like src/lib/seoDynamic.js: the API route hands the model in.

import { escapeHtml, layout, list, playerLink, section } from './seoPage.js';
import { AHEAD, POS_SHORT, byAhead, comparePathOf, difficultyWord, fixtureText, playersTable } from './seoDynamic.js';
import { nextPriceChangeAt, predictPriceChange } from './transferTrends.js';

const POSITIONS = { 1: 'Goalkeepers', 2: 'Defenders', 3: 'Midfielders', 4: 'Forwards' };
const fmt = n => (Math.round(n * 10) / 10).toFixed(1);
const money = p => `£${p.toFixed(1)}m`;
const gwShort = id => `GW${id}`;
const thousands = n => Math.round(n).toLocaleString('en-GB');
const clubLink = t => `<a href="/team/${t.slug}">${escapeHtml(t.name)}</a>`;
const ukTime = (iso, opts = {}) => new Date(iso).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London', ...opts });
const available = p => p.status === 'a' && p.ahead !== null;

/* ---------------------------------------------------------- price changes */

// Every player FPL (or the estimate) expects to move: { rises, falls,
// changed: { up, down } } where rises/falls are [{ player, change, net }].
export function priceData(model) {
  const rows = model.players
    .map(p => ({ player: p, change: predictPriceChange(p, model.totalPlayers), net: p.transfersInEvent - p.transfersOutEvent }))
    .filter(r => r.change);
  const order = { 'very likely': 0, likely: 1, possible: 2 };
  const sort = dir => rows.filter(r => r.change.dir === dir)
    .sort((a, b) => order[a.change.confidence] - order[b.change.confidence] || Math.abs(b.change.percent ?? b.net) - Math.abs(a.change.percent ?? a.net));
  return {
    rises: sort('rise'),
    falls: sort('fall'),
    changed: {
      up: model.players.filter(p => p.costChangeEvent > 0).sort((a, b) => b.costChangeEvent - a.costChangeEvent || b.selectedBy - a.selectedBy),
      down: model.players.filter(p => p.costChangeEvent < 0).sort((a, b) => a.costChangeEvent - b.costChangeEvent || b.selectedBy - a.selectedBy),
    },
    official: rows.some(r => typeof r.change.percent === 'number'),
  };
}

export function priceChangesPage(model, now = new Date()) {
  const d = priceData(model);
  const at = nextPriceChangeAt(now);
  const when = ukTime(at.toISOString(), { weekday: 'long', day: 'numeric', month: 'long', hour: undefined, minute: undefined });
  const table = (caption, rows) => `<table><caption>${escapeHtml(caption)}</caption><thead><tr><th scope="col">Player</th><th scope="col">Club</th><th scope="col">Price</th><th scope="col">Chance</th><th scope="col" class="num">Net transfers</th></tr></thead><tbody>${
    rows.map(r => `<tr><td>${playerLink(r.player)}</td><td>${escapeHtml(r.player.team)}</td><td>${money(r.player.price)}</td><td>${escapeHtml(r.change.confidence)}${typeof r.change.percent === 'number' ? ` (${Math.round(Math.abs(r.change.percent))}%)` : ''}</td><td class="num">${r.net > 0 ? '+' : ''}${thousands(r.net)}</td></tr>`).join('')
  }</tbody></table>`;
  const moved = (caption, players, sign) => `<table><caption>${escapeHtml(caption)}</caption><thead><tr><th scope="col">Player</th><th scope="col">Club</th><th scope="col">Now</th><th scope="col" class="num">This GW</th></tr></thead><tbody>${
    players.slice(0, 15).map(p => `<tr><td>${playerLink(p)}</td><td>${escapeHtml(p.team)}</td><td>${money(p.price)}</td><td class="num">${sign}£${(Math.abs(p.costChangeEvent) / 10).toFixed(1)}m</td></tr>`).join('')
  }</tbody></table>`;
  const how = d.official
    ? 'From FPL’s own price change progress: 100% means FPL expects the change at the next update.'
    : 'Estimated from this gameweek’s net transfers compared with how many managers own each player. Falls happen more easily than rises.';
  const body = section('Likely price rises', d.rises.length ? `${table('Heading for a rise', d.rises.slice(0, 20))}` : '<p>Nobody is close to a rise right now.</p>')
    + section('Likely price falls', d.falls.length ? `${table('Heading for a fall', d.falls.slice(0, 20))}` : '<p>Nobody is close to a fall right now.</p>')
    + section('How this works', `<p>${how} FPL changes prices once a day, overnight UK time; this page updates through the day.</p>`)
    + (d.changed.up.length || d.changed.down.length ? section(`Price changes so far in ${model.event.name}`,
      (d.changed.up.length ? moved('Risen', d.changed.up, '+') : '') + (d.changed.down.length ? moved('Fallen', d.changed.down, '−') : '')) : '')
    + section('More', list([
      '<a href="/fpl-transfer-suggestions">Transfer suggestions for your team</a>',
      '<a href="/fpl-tips">This week’s FPL tips</a>',
      '<a href="/fpl-players">Every player’s predicted points</a>',
    ]));
  const top = arr => arr.slice(0, 3).map(r => r.player.name).join(', ');
  return layout({
    path: '/fpl-price-changes',
    title: 'FPL Price Changes Tonight — predicted rises and falls | FPL Checker',
    description: `FPL price change predictions: who is likely to rise or fall at the next price update${d.rises.length ? ` (rises: ${top(d.rises)})` : ''}, and every price change so far this gameweek.`,
    h1: 'FPL price changes',
    intro: `Who is likely to rise or fall in price at the next FPL update, early on ${escapeHtml(when)}. Buy risers before they go up; sell fallers before they drop.`,
    body,
    faq: [
      ['What time do FPL prices change?', 'Once a day, overnight UK time. A player’s price moves at most once a day.'],
      ['Who will rise in price tonight in FPL?', d.rises.length ? `Most likely: ${top(d.rises)}.` : 'Nobody is close to a rise right now.'],
      ['Who will fall in price tonight in FPL?', d.falls.length ? `Most likely: ${top(d.falls)}.` : 'Nobody is close to a fall right now.'],
      ['How do FPL price changes work?', 'A player’s price moves when enough managers buy or sell him compared with how many own him. You get half of any rise (rounded down to £0.1m) when you sell.'],
    ],
    cta: { href: '/', label: 'Check my team' },
  });
}

/* --------------------------------------------------------------- deadline */

export function deadlinePage(model) {
  const gw = model.event;
  const coming = model.events.filter(e => e.id >= gw.id && e.deadline_time).slice(0, 6);
  const deadline = gw.deadline_time ? ukTime(gw.deadline_time) : null;
  const captains = model.players.filter(p => p.status === 'a' && p.predicted !== null && p.teamRef && p.teamRef.fixtures.some(f => f.event === gw.id))
    .sort((a, b) => b.predicted - a.predicted).slice(0, 3);
  const body = section(`${gw.name} deadline`, `<p><b>${deadline ? `<time datetime="${escapeHtml(gw.deadline_time)}">${escapeHtml(deadline)}</time>` : 'Not set yet'}</b> (UK time)</p><p>Transfers, captain and chips must be set before then.</p>`)
    + (coming.length > 1 ? section('Next deadlines', `<table><caption>Upcoming FPL deadlines (UK time)</caption><thead><tr><th scope="col">Gameweek</th><th scope="col">Deadline</th></tr></thead><tbody>${
      coming.map(e => `<tr><td><a href="/gw/${e.id}">${escapeHtml(e.name)}</a></td><td>${escapeHtml(ukTime(e.deadline_time))}</td></tr>`).join('')
    }</tbody></table>`) : '')
    + (captains.length ? section('Before the deadline', `<p>Top captain picks for ${escapeHtml(gw.name)}: ${captains.map(p => `${playerLink(p)} (${fmt(p.predicted)})`).join(', ')}.</p>${list([
      '<a href="/fpl-tips">This week’s tips</a>',
      '<a href="/fpl-price-changes">Tonight’s price changes</a>',
      '<a href="/rate-my-fpl-team">Rate my team</a>',
    ])}`) : '');
  return layout({
    path: '/fpl-deadline',
    title: `FPL Deadline ${gwShort(gw.id)} — ${gw.name} deadline time (UK) | FPL Checker`,
    description: `The FPL ${gw.name} deadline is ${deadline || 'not set yet'} UK time. Every upcoming FPL deadline, plus the top captain picks before it.`,
    h1: `FPL ${gw.name} deadline`,
    intro: `When you need your FPL team set for ${escapeHtml(gw.name)}${deadline ? `: <b>${escapeHtml(deadline)}</b>, UK time` : ''}.`,
    body,
    faq: [
      [`What time is the FPL ${gwShort(gw.id)} deadline?`, deadline ? `${deadline}, UK time.` : 'FPL hasn’t set it yet.'],
      ['When is the next FPL deadline?', coming[1] ? `After ${gw.name}, the next is ${coming[1].name}: ${ukTime(coming[1].deadline_time)}, UK time.` : `${gw.name}: ${deadline || 'not set yet'}.`],
      ['Can I make FPL transfers after the deadline?', 'Yes, but they count for the gameweek after. Your team for this gameweek is locked at the deadline.'],
    ],
    cta: { href: '/', label: 'Check my team' },
  });
}

/* ------------------------------------------------- double / blank gameweeks */

// [{ event, teams: [{ team, count }] }] for each gameweek from the one
// being planned where a club plays twice (double) or not at all (blank).
export function scheduleWeeks(model, kind) {
  const out = [];
  for (const e of model.events.filter(ev => ev.id >= model.event.id)) {
    const teams = model.teams.map(t => ({ team: t, count: t.fixtures.filter(f => f.event === e.id).length }))
      .filter(x => (kind === 'double' ? x.count > 1 : x.count === 0));
    if (teams.length) out.push({ event: e, teams });
  }
  return out;
}

export function scheduleGwPage(model, kind) {
  const double = kind === 'double';
  const weeks = scheduleWeeks(model, kind);
  const gwPoints = (p, gwId) => (p.weeks.find(w => w.event === gwId) || {}).points ?? null;
  const weekHtml = ({ event: e, teams }) => {
    const ids = new Set(teams.map(x => x.team.id));
    const best = double ? model.players.filter(p => p.teamRef && ids.has(p.teamRef.id) && p.status === 'a' && gwPoints(p, e.id) !== null)
      .sort((a, b) => gwPoints(b, e.id) - gwPoints(a, e.id)).slice(0, 8) : [];
    return section(`${e.name}${double ? ' double gameweek' : ' blank gameweek'}`,
      `<p>${double ? 'Playing twice' : 'Not playing'}: ${teams.map(x => clubLink(x.team)).join(', ')}.</p>${
        double ? `<p>${teams.map(x => `${escapeHtml(x.team.short)}: ${x.team.fixtures.filter(f => f.event === e.id).map(f => `${fixtureText(f)}, ${difficultyWord(f.difficulty)}`).join(' and ')}`).join('<br>')}</p>` : ''
      }${best.length ? `<table><caption>Best ${escapeHtml(e.name)} picks from these clubs</caption><thead><tr><th scope="col">Player</th><th scope="col">Club</th><th scope="col">Price</th><th scope="col" class="num">Pts</th></tr></thead><tbody>${
        best.map(p => `<tr><td>${playerLink(p)}</td><td>${escapeHtml(p.team)}</td><td>${money(p.price)}</td><td class="num">${fmt(gwPoints(p, e.id))}</td></tr>`).join('')
      }</tbody></table>` : ''}`);
  };
  const unscheduled = model.unscheduled.length
    ? section('Matches still to be scheduled', `<p>These were postponed and haven’t been given a gameweek yet. When they are, they usually make a double gameweek for both clubs.</p>${list(model.unscheduled.map(f => `${clubLink(f.home)} v ${clubLink(f.away)}`))}`)
    : '';
  const name = double ? 'double gameweeks' : 'blank gameweeks';
  const firstText = weeks.length ? `${weeks[0].event.name}: ${weeks[0].teams.map(x => x.team.name).join(', ')}` : null;
  return layout({
    path: double ? '/fpl-double-gameweek' : '/fpl-blank-gameweek',
    title: `FPL ${double ? 'Double' : 'Blank'} Gameweeks — every ${double ? 'DGW' : 'BGW'} this season | FPL Checker`,
    description: `Every FPL ${name} left this season: which clubs ${double ? 'play twice' : 'don’t play'} and when${double ? ', with the best picks for each' : ''}. Updated as fixtures move.`,
    h1: `FPL ${name}`,
    intro: weeks.length
      ? `${weeks.length} ${double ? 'double' : 'blank'} gameweek${weeks.length === 1 ? '' : 's'} on the fixture list so far. ${double ? 'Players from these clubs get two matches, so twice the chance of points.' : 'Players from these clubs score nothing that gameweek; plan transfers or a Free Hit around it.'}`
      : `No ${name} on the fixture list right now. ${double ? 'They appear when postponed matches are rescheduled.' : 'They appear when matches are moved, usually for cup games.'}`,
    body: weeks.map(weekHtml).join('') + unscheduled
      + section('More', list([
        double ? '<a href="/fpl-blank-gameweek">FPL blank gameweeks</a>' : '<a href="/fpl-double-gameweek">FPL double gameweeks</a>',
        '<a href="/fpl-tips">This week’s FPL tips</a>',
        '<a href="/fpl-players">Every club’s fixtures</a>',
      ])),
    faq: [
      [`When is the next FPL ${double ? 'double' : 'blank'} gameweek?`, firstText ? `${firstText}.` : `None is on the fixture list yet.`],
      [`What is a ${double ? 'double' : 'blank'} gameweek in FPL?`, double ? 'A gameweek where a club plays twice, so its players can score points in both matches.' : 'A gameweek where a club has no match, so its players score nothing unless you transfer them out or use a Free Hit.'],
    ],
    cta: { href: '/', label: 'Check my team' },
  });
}

/* ----------------------------------------------------------- differentials */

export function differentialsPage(model) {
  const gw = model.event;
  const pool = model.players.filter(p => available(p) && p.selectedBy < 10).sort(byAhead);
  const deep = pool.filter(p => p.selectedBy < 3);
  const body = section(`Top differentials for the next ${AHEAD} gameweeks`, playersTable('Owned by under 10%', pool.slice(0, 15)))
    + [1, 2, 3, 4].map(pos => section(`Differential ${POSITIONS[pos].toLowerCase()}`, playersTable(POSITIONS[pos], pool.filter(p => p.positionId === pos).slice(0, 6)))).join('')
    + (deep.length ? section('Deep differentials', `${playersTable('Owned by under 3%', deep.slice(0, 8))}<p>Hardly anyone owns these: big gains if they score.</p>`) : '')
    + section('More', list([
      '<a href="/fpl-tips">This week’s FPL tips</a>',
      '<a href="/fpl-players">Every player ranked</a>',
      '<a href="/fpl-price-changes">Tonight’s price changes</a>',
    ]));
  const top = pool.slice(0, 3);
  return layout({
    path: '/fpl-differentials',
    title: `FPL Differentials ${gwShort(gw.id)} — best low-owned picks | FPL Checker`,
    description: `The best FPL differentials for ${gw.name}: players in fewer than 10% of teams with the most predicted points over the next ${AHEAD} gameweeks, by position.`,
    h1: `FPL differentials for ${gw.name}`,
    intro: `Players owned by fewer than 10% of managers, ranked by predicted points over the next ${AHEAD} gameweeks. When they score, you gain on almost everyone.`,
    body,
    faq: [
      [`Who are the best FPL differentials for ${gwShort(gw.id)}?`, top.length ? top.map(p => `${p.name} (${p.selectedBy}% owned, ${fmt(p.ahead)} predicted over ${p.weeks.length} gameweeks)`).join(', ') + '.' : 'See the table above.'],
      ['What is an FPL differential?', 'A player few managers own. If he scores, your rank rises against everyone who doesn’t have him.'],
    ],
    crumbs: [{ name: 'Players', path: '/fpl-players' }],
    cta: { href: '/', label: 'Check my team' },
  });
}

/* ----------------------------------------------------------------- compare */

// The canonical address for a pair: slugs in alphabetical order.
export const comparePath = comparePathOf;

// "erling-haaland-vs-mohamed-salah" → the two players, or null.
export function parseCompare(model, pair) {
  const parts = String(pair || '').split('-vs-');
  if (parts.length !== 2) return null;
  const [a, b] = parts.map(s => model.playerBySlug[s]);
  return a && b && a.id !== b.id ? [a, b] : null;
}

// The pairs worth listing in the sitemap: the best-predicted players of
// each position against each other.
export function comparePairs(model, perPos = { 1: 4, 2: 8, 3: 8, 4: 8 }) {
  const pairs = [];
  for (const pos of [1, 2, 3, 4]) {
    const top = model.players.filter(p => p.positionId === pos && available(p)).sort(byAhead).slice(0, perPos[pos]);
    top.forEach((a, i) => top.slice(i + 1).forEach(b => pairs.push(comparePath(a, b))));
  }
  return pairs;
}

export function comparePage(model, a, b) {
  const [x, y] = [a, b].sort((p, q) => p.slug.localeCompare(q.slug));
  const gw = model.event;
  const fx = (p, gwId) => (p.teamRef ? p.teamRef.fixtures.filter(f => f.event === gwId).map(fixtureText).join(', ') : '') || 'Blank';
  const rows = [
    ['Club', p => (p.teamRef ? clubLink(p.teamRef) : '–')],
    ['Position', p => POS_SHORT[p.positionId]],
    ['Price', p => money(p.price)],
    ['Selected by', p => `${p.selectedBy}%`],
    [`${gwShort(gw.id)} predicted`, p => (p.predicted === null ? '–' : fmt(p.predicted))],
    [`Next ${AHEAD} GWs predicted`, p => (p.ahead === null ? '–' : fmt(p.ahead))],
    ['FPL points', p => p.totalPoints],
    ['Form', p => fmt(p.form)],
    ['Points per match', p => fmt(p.ppg)],
    ['Minutes', p => p.minutes],
    ['Goals', p => p.goals],
    ['Assists', p => p.assists],
    ['xG', p => fmt(p.xg)],
    ['xA', p => fmt(p.xa)],
  ];
  const weeks = [...new Set([...x.weeks, ...y.weeks].map(w => w.event))].sort((m, n) => m - n);
  const pts = (p, id) => { const w = p.weeks.find(v => v.event === id); return w ? fmt(w.points) : '–'; };
  const better = x.ahead !== null && y.ahead !== null && x.ahead !== y.ahead ? (x.ahead > y.ahead ? [x, y] : [y, x]) : null;
  const verdict = better
    ? `<p><b>${playerLink(better[0])}</b> is predicted ${fmt(better[0].ahead - better[1].ahead)} more points than ${playerLink(better[1])} over the next ${AHEAD} gameweeks${better[0].price !== better[1].price ? `, and costs ${money(Math.abs(better[0].price - better[1].price))} ${better[0].price > better[1].price ? 'more' : 'less'}` : ''}.${better[1].status !== 'a' && better[1].news ? ` ${escapeHtml(better[1].name)}: ${escapeHtml(better[1].news)}.` : ''}</p>`
    : '<p>They’re predicted the same over the next few gameweeks.</p>';
  const head = `<thead><tr><th scope="col"></th><th scope="col">${playerLink(x)}</th><th scope="col">${playerLink(y)}</th></tr></thead>`;
  const body = section('Verdict', verdict)
    + section('Side by side', `<table><caption>${escapeHtml(x.name)} vs ${escapeHtml(y.name)}</caption>${head}<tbody>${rows.map(([k, f]) => `<tr><th scope="row">${k}</th><td>${f(x)}</td><td>${f(y)}</td></tr>`).join('')}</tbody></table>`)
    + (weeks.length ? section('Gameweek by gameweek', `<table><caption>Predicted points and fixtures</caption>${head}<tbody>${weeks.map(id => `<tr><th scope="row">${gwShort(id)}</th><td>${pts(x, id)} <span class="seo-dim">${escapeHtml(fx(x, id))}</span></td><td>${pts(y, id)} <span class="seo-dim">${escapeHtml(fx(y, id))}</span></td></tr>`).join('')}</tbody></table>`) : '')
    + section('More', list([
      `<a href="/player/${x.slug}">${escapeHtml(x.name)} prediction</a>`,
      `<a href="/player/${y.slug}">${escapeHtml(y.name)} prediction</a>`,
      '<a href="/fpl-players">Every player ranked</a>',
    ]));
  return layout({
    path: comparePath(x, y),
    title: `${x.name} vs ${y.name} FPL — who to pick for ${gwShort(gw.id)} | FPL Checker`,
    description: `${x.name} or ${y.name} in FPL? Predicted points for ${gw.name} and the next ${AHEAD} gameweeks, fixtures, price, form and xG side by side.`,
    h1: `${x.name} vs ${y.name}`,
    intro: `${escapeHtml(x.fullName)} (${money(x.price)}) against ${escapeHtml(y.fullName)} (${money(y.price)}) for Fantasy Premier League: predicted points, fixtures and stats.`,
    body,
    faq: better ? [[`Should I pick ${x.name} or ${y.name} in FPL?`, `${better[0].name}: predicted ${fmt(better[0].ahead)} points over the next ${AHEAD} gameweeks to ${better[1].name}’s ${fmt(better[1].ahead)}.`]] : [],
    crumbs: [{ name: 'Players', path: '/fpl-players' }],
    cta: { href: '/', label: 'Check my team' },
  });
}
