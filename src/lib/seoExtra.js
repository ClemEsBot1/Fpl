// More pages made from live data (api/optimal-squad.js?page=…):
//   /fpl-tips          this gameweek's tips, written out from the predictions
//   /embed/captains    the top captain picks, small enough to embed on
//                      another site in an iframe (see /fpl-widget)
//   /league/<id>       a mini-league's standings with each team's captain
//                      and predicted points, to share with the league

import { SITE, escapeHtml, layout, list, playerLink, section } from './seoPage.js';
import { AHEAD, POSITION, byAhead, difficultyWord, fixtureText, ordinal } from './seoDynamic.js';

const fmt = n => (Math.round(n * 10) / 10).toFixed(1);
const money = p => `£${p.toFixed(1)}m`;
const available = p => p.predicted !== null && p.status === 'a';
const fixturesOf = (p, gwId) => (p.teamRef ? p.teamRef.fixtures.filter(f => f.event === gwId) : []);
const fixtureLine = (p, gwId) => {
  const fx = fixturesOf(p, gwId);
  return fx.length ? fx.map(f => `${fixtureText(f)}, ${difficultyWord(f.difficulty)}`).join(' and ') : 'no fixture';
};
const deadlineText = iso => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : null);

// The picks a tips page is written from.
export function tipsData(model) {
  const gw = model.event;
  // Captains must play this gameweek.
  const ranked = model.players.filter(p => available(p) && fixturesOf(p, gw.id).length).sort((a, b) => b.predicted - a.predicted);
  const captains = ranked.slice(0, 3);
  const differentialCaptain = ranked.find(p => p.selectedBy < 10 && !captains.includes(p)) || null;
  const differentials = model.players.filter(p => available(p) && p.selectedBy < 10 && p.ahead !== null).sort(byAhead).slice(0, 5);
  // Owned by many but doubtful, or predicted poorly for the next five.
  const popular = model.players.filter(p => p.selectedBy >= 15 && p.predicted !== null);
  const doubts = popular.filter(p => p.status !== 'a').sort((a, b) => b.selectedBy - a.selectedBy);
  const samePosRank = p => model.players.filter(o => o.positionId === p.positionId && o.ahead !== null).sort(byAhead).indexOf(p) + 1;
  const weak = popular.filter(p => p.status === 'a' && p.ahead !== null && samePosRank(p) > 25).sort((a, b) => a.ahead - b.ahead);
  const sells = [...doubts, ...weak].slice(0, 5).map(p => ({ player: p, reason: p.status !== 'a' ? p.news || 'flagged by FPL' : `predicted ${fmt(p.ahead)} over the next ${p.weeks.length} gameweeks, ${ordinal(samePosRank(p))} among ${POSITION[p.positionId]}s` }));
  const budget = [[1, 4.5], [2, 4.5], [3, 5.5], [4, 6.0]].map(([pos, max]) => model.players.filter(p => available(p) && p.positionId === pos && p.price <= max && p.ahead !== null).sort(byAhead)[0]).filter(Boolean);
  const avg = t => {
    const fx = t.fixtures.filter(f => f.event < gw.id + AHEAD);
    return fx.length ? fx.reduce((s, f) => s + f.difficulty, 0) / fx.length : null;
  };
  const runs = model.teams.filter(t => avg(t) !== null).sort((a, b) => avg(a) - avg(b)).map(t => ({ team: t, avg: avg(t), games: t.fixtures.filter(f => f.event < gw.id + AHEAD).length }));
  return { gw, captains, differentialCaptain, differentials, sells, budget, easiest: runs.slice(0, 3), hardest: runs.slice(-3).reverse() };
}

export function tipsPage(model, { image } = {}) {
  const t = tipsData(model);
  const { gw } = t;
  const deadline = deadlineText(gw.deadline_time);
  const [first, second, third] = t.captains;
  const clubLink = team => `<a href="/team/${team.slug}">${escapeHtml(team.name)}</a>`;

  const captainHtml = first ? `<p><b>${playerLink(first)}</b> (${escapeHtml(first.team)}, ${fixtureLine(first, gw.id)}) is the top captain pick for ${escapeHtml(gw.name)}, predicted <b>${fmt(first.predicted)} points</b>${second ? `, ${fmt(first.predicted - second.predicted)} more than anyone else` : ''}. He is in ${first.selectedBy}% of teams, so captaining him mostly protects your rank.</p>`
    + (second ? `<p>Next best: ${playerLink(second)} (${fmt(second.predicted)}, ${fixtureLine(second, gw.id)})${third ? ` and ${playerLink(third)} (${fmt(third.predicted)}, ${fixtureLine(third, gw.id)})` : ''}.</p>` : '')
    + (t.differentialCaptain ? `<p><b>Differential captain:</b> ${playerLink(t.differentialCaptain)}, owned by only ${t.differentialCaptain.selectedBy}% and predicted ${fmt(t.differentialCaptain.predicted)}. Worth the risk if you need to catch up in your mini-league.</p>` : '') : '';

  const body = section(`Who to captain in ${gw.name}`, captainHtml)
    + (t.differentials.length ? section(`Best FPL differentials for ${gw.name}`, `<p>Players in fewer than 10% of teams with the most predicted points over the next ${AHEAD} gameweeks. If they score, you gain on almost everyone.</p>${list(t.differentials.map(p => `${playerLink(p)} (${escapeHtml(p.team)}, ${money(p.price)}, ${p.selectedBy}% owned): ${fmt(p.ahead)} points over the next ${p.weeks.length} gameweeks, ${fmt(p.predicted)} this week (${fixtureLine(p, gw.id)}).`))}`) : '')
    + (t.sells.length ? section('Players to think about selling', `<p>Popular picks (owned by 15% or more) who are doubtful or predicted poorly for the weeks ahead.</p>${list(t.sells.map(s => `${playerLink(s.player)} (${escapeHtml(s.player.team)}, ${s.player.selectedBy}% owned): ${escapeHtml(s.reason)}.`))}`) : '')
    + (t.budget.length ? section('Budget picks', `<p>The best-predicted cheap player at each position, to free up money for premiums.</p>${list(t.budget.map(p => `${POSITION[p.positionId][0].toUpperCase()}${POSITION[p.positionId].slice(1)}: ${playerLink(p)} (${escapeHtml(p.team)}, ${money(p.price)}), ${fmt(p.ahead)} over the next ${p.weeks.length} gameweeks.`))}`) : '')
    + (t.easiest.length ? section('Fixture swings', `<p>Average difficulty over the next ${AHEAD} gameweeks (1 easy, 5 hard).</p><p><b>Easiest runs:</b> ${t.easiest.map(r => `${clubLink(r.team)} ${r.avg.toFixed(1)}${r.games > AHEAD ? ` (${r.games} games)` : ''}`).join(', ')}.</p><p><b>Hardest runs:</b> ${t.hardest.map(r => `${clubLink(r.team)} ${r.avg.toFixed(1)}`).join(', ')}.</p>`) : '')
    + section('More for this gameweek', list([
      `<a href="/fpl-predictions">${escapeHtml(gw.name)} predictions and best XI</a>`,
      '<a href="/fpl-players">Every player ranked</a>',
      '<a href="/fpl-transfer-suggestions">Transfer suggestions for your own team</a>',
    ]));

  const updated = new Date().toISOString();
  return layout({
    path: '/fpl-tips',
    title: `FPL GW${gw.id} Tips — captain, differentials and transfers | FPL Checker`,
    description: `FPL tips for ${gw.name}${first ? `: captain ${first.name}` : ''}, the best differentials, who to sell, budget picks and fixture swings, from predicted points for every player.`,
    h1: `FPL ${gw.name} tips`,
    intro: `Captain, differentials, transfers and fixtures for ${escapeHtml(gw.name)}${deadline ? `, deadline ${escapeHtml(deadline)}` : ''}. Written from FPL Checker’s predicted points for every player, updated every day.`,
    body,
    faq: [
      ...(first ? [[`Who should I captain in FPL ${gw.name}?`, `${first.name} is predicted the most points (${fmt(first.predicted)})${second ? `, ahead of ${second.name} (${fmt(second.predicted)})` : ''}.${t.differentialCaptain ? ` For a differential, ${t.differentialCaptain.name} is owned by ${t.differentialCaptain.selectedBy}%.` : ''}`]] : []),
      ...(t.differentials.length ? [[`What are the best FPL differentials for ${gw.name}?`, `${t.differentials.slice(0, 3).map(p => `${p.name} (${p.selectedBy}% owned)`).join(', ')}, by predicted points over the next ${AHEAD} gameweeks.`]] : []),
      ...(t.easiest.length ? [['Which teams have the best FPL fixtures?', `${t.easiest.map(r => r.team.name).join(', ')} have the easiest runs over the next ${AHEAD} gameweeks.`]] : []),
    ],
    crumbs: [{ name: 'Gameweeks', path: '/fpl-predictions' }],
    cta: { href: '/', label: 'Check my team' },
    ...(image ? { image } : {}),
    extraJsonLd: [{
      '@context': 'https://schema.org', '@type': 'Article', headline: `FPL ${gw.name} tips`, dateModified: updated,
      author: { '@type': 'Organization', name: 'FPL Checker', url: SITE }, publisher: { '@type': 'Organization', name: 'FPL Checker', url: SITE },
      mainEntityOfPage: `${SITE}/fpl-tips`,
    }],
  });
}

/* ----------------------------------------------------------------- widget */

// The captain picks as a small self-contained page for an iframe on
// another site. theme: 'dark' (default) or 'light'.
export function embedCaptainsHtml(model, { theme = 'dark' } = {}) {
  const gw = model.event;
  const top = model.players.filter(available).sort((a, b) => b.predicted - a.predicted).slice(0, 5);
  const light = theme === 'light';
  const c = light
    ? { bg: '#FFFFFF', ink: '#14122B', dim: '#5E5C78', line: '#E6E5F0', accent: '#5B21B6', chip: '#EEF9C8' }
    : { bg: '#0A081E', ink: '#FBFAFF', dim: 'rgba(251,250,255,0.68)', line: 'rgba(255,255,255,0.12)', accent: '#CEFF10', chip: 'rgba(206,255,16,0.14)' };
  const rows = top.map((p, i) => `<li><span class="n">${i + 1}</span><a class="p" href="${SITE}/player/${p.slug}" target="_blank" rel="noopener">${escapeHtml(p.name)}</a><span class="f">${escapeHtml(fixturesOf(p, gw.id).map(fixtureText).join(', ') || '–')}</span><span class="s">${fmt(p.predicted)}</span></li>`).join('');
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FPL ${escapeHtml(gw.name)} captain picks | FPL Checker</title><meta name="robots" content="noindex">
<style>
*{box-sizing:border-box}body{margin:0;background:${c.bg};color:${c.ink};font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.w{padding:14px 16px}h1{margin:0 0 2px;font-size:16px}p{margin:0 0 10px;color:${c.dim};font-size:12px}
ol{list-style:none;margin:0;padding:0}li{display:grid;grid-template-columns:20px 1fr auto 44px;gap:8px;align-items:center;padding:7px 0;border-top:1px solid ${c.line}}
.n{color:${c.dim};font-size:12px}.p{color:${c.ink};font-weight:600;text-decoration:none}.p:hover{text-decoration:underline}.f{color:${c.dim};font-size:12px;white-space:nowrap}
.s{justify-self:end;padding:2px 8px;border-radius:999px;background:${c.chip};color:${light ? c.ink : c.accent};font-weight:700;font-variant-numeric:tabular-nums}
.by{display:block;margin-top:10px;color:${c.dim};font-size:12px;text-decoration:none}.by b{color:${c.accent}}
</style></head><body><div class="w">
<h1>${escapeHtml(gw.name)} captain picks</h1><p>Predicted points this gameweek</p>
<ol>${rows || '<li>Predictions aren’t ready yet.</li>'}</ol>
<a class="by" href="${SITE}/fpl-captain-picks" target="_blank" rel="noopener">Predictions by <b>FPL Checker</b></a>
</div></body></html>`;
}

/* ----------------------------------------------------------------- league */

// A mini-league's standings, each team's captain this gameweek and what
// its current XI is predicted to score in the gameweek being planned.
// standings: FPL's leagues-classic/<id>/standings/; picks: { [entry]:
// event/<gw>/picks `picks` } for the teams fetched.
export function leaguePage(model, id, standings, picks) {
  const gw = model.event;
  const name = standings.league && standings.league.name ? standings.league.name : `League ${id}`;
  const rows = ((standings.standings && standings.standings.results) || []).map(r => {
    const team = picks[r.entry];
    let captain = null;
    let predicted = null;
    if (Array.isArray(team)) {
      const cap = team.find(p => p.is_captain);
      captain = cap ? model.playerById[cap.element] : null;
      predicted = team.filter(p => p.position <= 11).reduce((s, p) => {
        const pl = model.playerById[p.element];
        return s + (pl && pl.predicted !== null ? pl.predicted * (p.is_captain ? 2 : 1) : 0);
      }, 0);
    }
    return { ...r, captain, predicted };
  });
  const best = rows.filter(r => r.predicted !== null).sort((a, b) => b.predicted - a.predicted)[0];
  const capCounts = {};
  rows.forEach(r => { if (r.captain) capCounts[r.captain.id] = (capCounts[r.captain.id] || 0) + 1; });
  const popularCap = Object.entries(capCounts).sort((a, b) => b[1] - a[1])[0];
  const body = section(`${name} standings`, `<table><caption>Top ${rows.length}</caption><thead><tr><th scope="col">#</th><th scope="col">Team</th><th scope="col" class="num">GW</th><th scope="col" class="num">Total</th><th scope="col">Captain</th><th scope="col" class="num">${escapeHtml(gw.name.replace('Gameweek ', 'GW'))} pred.</th></tr></thead><tbody>${
    rows.map(r => `<tr><td>${r.rank}</td><td>${escapeHtml(r.entry_name)}<br><span class="seo-dim">${escapeHtml(r.player_name)}</span></td><td class="num">${r.event_total}</td><td class="num">${r.total}</td><td>${r.captain ? playerLink(r.captain) : '–'}</td><td class="num">${r.predicted === null ? '–' : fmt(r.predicted)}</td></tr>`).join('')
  }</tbody></table><p>Predicted points are for each team as it stands now, captain doubled; transfers before the deadline will change them.</p>`)
    + section('In this league', list([
      ...(best ? [`Best-predicted team for ${escapeHtml(gw.name)}: <b>${escapeHtml(best.entry_name)}</b> (${fmt(best.predicted)}).`] : []),
      ...(popularCap ? [`Most popular captain: ${playerLink(model.playerById[popularCap[0]])} (${popularCap[1]} of ${rows.filter(r => r.captain).length} teams).`] : []),
    ]))
    + section('See your own', `<p>Open FPL Checker for your team’s predicted points, best captain and transfers, and the full mini-league view with differentials and head-to-head.</p>`);
  return layout({
    path: `/league/${id}`,
    title: `${name} — FPL mini-league predictions | FPL Checker`,
    description: `${name} FPL mini-league: standings, every team's captain and predicted points for ${gw.name}.`,
    h1: name,
    intro: `FPL mini-league standings with each team’s captain and predicted points for ${escapeHtml(gw.name)}. Share this page with your league.`,
    body,
    noindex: true,
    cta: { href: '/', label: 'Check my team' },
  });
}
