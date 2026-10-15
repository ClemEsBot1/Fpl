// Plain HTML pages for search engines: each one answers a common FPL search
// ("FPL points predictor", "best FPL captain this week" …) in words Google
// can read without running the app, and links into the app. The fixed ones
// are written to public/ by scripts/make-seo-pages.mjs; the weekly
// predictions page (/fpl-predictions) is rendered on request by
// api/optimal-squad.js?page=predictions from the latest saved predictions.

export const SITE = 'https://fplchecker.co.uk';
export const SITE_NAME = 'FPL Checker';

const POSITIONS = { 1: 'Goalkeepers', 2: 'Defenders', 3: 'Midfielders', 4: 'Forwards' };
const POS_SHORT = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The guide pages, in the order they're linked.
export const GUIDES = [
  { path: '/fpl-predictions', label: 'This gameweek’s predictions' },
  { path: '/fpl-points-predictor', label: 'FPL points predictor' },
  { path: '/fpl-captain-picks', label: 'Best FPL captain' },
  { path: '/fpl-transfer-suggestions', label: 'FPL transfer suggestions' },
  { path: '/rate-my-fpl-team', label: 'Rate my FPL team' },
  { path: '/fpl-players', label: 'Every player and club' },
  { path: '/fpl-tips', label: 'This week’s FPL tips' },
  { path: '/fpl-deadline', label: 'FPL deadline' },
  { path: '/fpl-price-changes', label: 'FPL price changes' },
  { path: '/fpl-differentials', label: 'FPL differentials' },
  { path: '/fpl-double-gameweek', label: 'Double gameweeks' },
  { path: '/fpl-blank-gameweek', label: 'Blank gameweeks' },
  { path: '/fpl-prediction-accuracy', label: 'How accurate are the predictions?' },
  { path: '/fpl-widget', label: 'Free FPL widget for your site' },
];

// The guide pages rendered from live data on request (api/optimal-squad.js)
// rather than written to public/.
export const DYNAMIC_GUIDES = ['/fpl-predictions', '/fpl-players', '/fpl-tips', '/fpl-deadline', '/fpl-price-changes', '/fpl-differentials', '/fpl-double-gameweek', '/fpl-blank-gameweek', '/fpl-prediction-accuracy'];

// A whole page. body is HTML; faq is [[question, answer]] (plain text).
// crumbs are the pages between the home page and this one ([{ name, path }]);
// canonical is the address search engines should list it under, when
// that's another page; noindex keeps a not-found page out of search.
export function layout({ path, title, description, h1, intro, body, faq = [], cta = { href: '/', label: 'Open FPL Checker' }, extraJsonLd = [], crumbs = [], canonical = path, noindex = false, image = '/og-image.png' }) {
  const url = SITE + path;
  const trail = [{ name: SITE_NAME, path: '/' }, ...crumbs, { name: h1, path }];
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: SITE + c.path })),
    },
    ...(faq.length ? [{
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    }] : []),
    ...extraJsonLd,
  ];
  const nav = GUIDES.map(g => `<a href="${g.path}"${g.path === path ? ' aria-current="page"' : ''}>${escapeHtml(g.label)}</a>`).join('');
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${SITE + canonical}">`}
<meta name="theme-color" content="#0a081e">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon-96x96.png" type="image/png" sizes="96x96">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}${image}">
<meta name="twitter:card" content="summary_large_image">
<link rel="preload" href="/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/seo.css">
${jsonLd.map(d => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head>
<body>
<header class="seo-head"><a class="seo-brand" href="/"><i aria-hidden="true"></i>FPL <span>CHECKER</span></a><a class="seo-btn" href="${cta.href}">${escapeHtml(cta.label)}</a></header>
<main class="seo-main">
${crumbs.length ? `<nav class="seo-crumbs" aria-label="Breadcrumb">${trail.slice(0, -1).map(c => `<a href="${c.path}">${escapeHtml(c.name)}</a>`).join(' / ')}</nav>` : ''}
<h1>${escapeHtml(h1)}</h1>
<p class="seo-intro">${intro}</p>
<p><a class="seo-btn seo-btn-big" href="${cta.href}">${escapeHtml(cta.label)}</a></p>
${body}
${faq.length ? `<section class="seo-card"><h2>Questions</h2>${faq.map(([q, a]) => `<h3>${escapeHtml(q)}</h3><p>${escapeHtml(a)}</p>`).join('')}</section>` : ''}
<nav class="seo-card seo-nav" aria-label="More FPL guides"><h2>More from FPL Checker</h2>${nav}</nav>
</main>
<footer class="seo-foot"><p><a href="/">FPL Checker</a> is a free Fantasy Premier League tool. It isn't affiliated with the Premier League or Fantasy Premier League.</p></footer>
</body>
</html>
`;
}

// A player's name, linked to his page when he has one (p.slug).
export const playerLink = p => (p.slug ? `<a href="/player/${p.slug}">${escapeHtml(p.name)}</a>` : escapeHtml(p.name));

export const section = (title, html) => `<section class="seo-card"><h2>${escapeHtml(title)}</h2>${html}</section>`;
export const list = items => `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
const steps = items => `<ol>${items.map(i => `<li>${i}</li>`).join('')}</ol>`;

// The fixed guide pages: { path, html }.
export function staticPages() {
  return [
    {
      path: '/fpl-points-predictor',
      html: layout({
        path: '/fpl-points-predictor',
        title: 'FPL Points Predictor — predicted points for every player | FPL Checker',
        description: 'Free FPL points predictor: predicted Fantasy Premier League points for every player this gameweek and the next five, from form, fixtures, minutes, betting odds and injury news.',
        h1: 'FPL points predictor',
        intro: 'FPL Checker predicts how many Fantasy Premier League points every player will score this gameweek and over the next five. Enter your FPL Team ID to see your whole squad predicted, or browse every player.',
        body: section('How the predictions work', `<p>Each player's prediction starts from FPL's own expected points and his points per game, then adjusts for:</p>${list([
          '<b>Fixtures</b>: how hard each opponent is, home or away, and double or blank gameweeks.',
          '<b>Minutes</b>: whether he has been starting lately, so a benched player isn’t predicted like a regular.',
          '<b>Form and underlying stats</b>: recent points, expected goals and assists, set pieces.',
          '<b>Betting odds</b>: the bookmakers’ view of goals and clean sheets for each match.',
          '<b>Injury and suspension news</b>: a player FPL rules out is predicted 0; a doubt is scaled by his chance of playing.',
        ])}<p>A machine-learning model trained on every gameweek since 2020 runs alongside, and its figure is shown next to each player for comparison.</p>`)
          + section('What you can do with it', list([
            'See your squad’s predicted points for the gameweek, captain doubled.',
            'Pick the best starting XI and bench order automatically.',
            'Plan transfers over the next five gameweeks, with hits counted.',
            'Compare up to three players side by side.',
            'Check afterwards how the predictions did, player by player.',
          ])),
        faq: [
          ['How accurate are FPL points predictions?', 'No prediction can know who will score, so a single player’s prediction for one gameweek misses by around 1.3 points on average. Predictions are much better at ranking players than at exact scores, which is what picking a team, a captain or a transfer needs. FPL Checker shows how its predictions did after every gameweek.'],
          ['Is the FPL points predictor free?', 'Yes. FPL Checker is free and needs no account; an account only saves your teams across devices.'],
          ['How often are the predictions updated?', 'Every day, and again in the hours before each deadline so late injury news is included.'],
        ],
      }),
    },
    {
      path: '/fpl-captain-picks',
      html: layout({
        path: '/fpl-captain-picks',
        title: 'Best FPL Captain This Gameweek — captain picks and differentials | FPL Checker',
        description: 'Who to captain in FPL this gameweek: the top captain options ranked by predicted points, each with their chance of a 10-point haul and how many managers own them.',
        h1: 'Best FPL captain this gameweek',
        intro: 'Your captain scores double, so he is the biggest decision you make each week. FPL Checker ranks every player in your squad as a captain and suggests a safe pick and a differential.',
        body: section('How the captain pick is made', `${list([
          '<b>Safe pick</b>: the player with the most predicted points, who gives you the best average score.',
          '<b>Differential</b>: a player close to the safe pick but owned by far fewer managers, for climbing your mini-league or overall rank.',
          '<b>Chance of a haul</b>: how often a player predicted like this has scored 10 or more, from four seasons of results.',
          '<b>Likely range</b>: a quiet game to a good one, so you can see who has the higher ceiling.',
        ])}<p>A doubtful player is a risky captain: if he doesn’t play, the armband doubles nothing. His prediction is already scaled by his chance of playing, and the best squad gives the armband to someone fit.</p>`)
          + section('See this week’s picks', `<p>The <a href="/fpl-predictions">gameweek predictions page</a> lists the top predicted players, or open your own team to compare your top five captain options side by side.</p>`),
        faq: [
          ['Who should I captain in FPL this week?', 'Usually your player with the highest predicted points who is certain to start. FPL Checker shows that pick for your squad, plus a differential if one is close enough to be worth the risk.'],
          ['When is a differential captain worth it?', 'When you need to gain on rivals: if most of your league captains the same player, a different captain who hauls gains you points on all of them. If you are protecting a lead, the safe pick is better.'],
          ['What about Triple Captain?', 'FPL Checker shows what Triple Captain would add with your squad in each of the next five gameweeks, so you can save it for the best one.'],
        ],
      }),
    },
    {
      path: '/fpl-transfer-suggestions',
      html: layout({
        path: '/fpl-transfer-suggestions',
        title: 'FPL Transfer Suggestions — who to buy and sell this week | FPL Checker',
        description: 'FPL transfer suggestions for your team: who to sell, who to bring in, and whether a -4 hit pays off, planned over the next five gameweeks within your budget.',
        h1: 'FPL transfer suggestions',
        intro: 'Enter your FPL Team ID and FPL Checker suggests the transfers that add the most predicted points to your squad, within your bank and the three-per-club rule.',
        body: section('How transfers are suggested', `${list([
          '<b>Over five gameweeks, not one</b>: a player with an easy run ahead is worth more than one good fixture.',
          '<b>Hits counted</b>: a -4 is only suggested when the points it gains over the next weeks are more than 4.',
          '<b>Rolling free transfers</b>: sometimes the best move is none, and banking the transfer for next week.',
          '<b>Price changes</b>: alerts when a player in your squad is about to drop in price, so you can sell first.',
        ])}`)
          + section('Plan it yourself', steps([
            'Open your team and press <b>Transfers</b>.',
            'Remove a player and pick a replacement, or use <b>Auto pick</b>.',
            'See the predicted change over the next five gameweeks, after any hit, before you make it in FPL.',
          ])),
        faq: [
          ['Should I take a -4 hit in FPL?', 'Only when the incoming player is predicted to outscore the outgoing one by more than 4 points over the next few gameweeks. FPL Checker shows that figure for every planned transfer.'],
          ['Does FPL Checker make transfers for me?', 'No. It never logs into FPL; you make the transfers on the FPL site or app. It reads your public team from your Team ID.'],
          ['Where do I find my FPL Team ID?', 'On the FPL website, open the Points page: your Team ID is the number after /entry/ in the address.'],
        ],
      }),
    },
    {
      path: '/rate-my-fpl-team',
      html: layout({
        path: '/rate-my-fpl-team',
        title: 'Rate My FPL Team — free FPL team checker | FPL Checker',
        description: 'Rate your FPL team for free: predicted points for your squad, a squad score against the best possible team, your best XI, captain and transfer suggestions. From your Team ID or a screenshot.',
        h1: 'Rate my FPL team',
        intro: 'FPL Checker checks your Fantasy Premier League team: how many points it is predicted to score, how it compares with the best squad £100m can buy, and what to change.',
        body: section('What the team check shows', list([
          '<b>Squad score</b>: your predicted points against the best possible squad this gameweek.',
          '<b>Best XI and bench order</b>, with the formation picked for you.',
          '<b>Captain</b>: the best pick and a differential.',
          '<b>Flags</b>: injured, suspended or doubtful players and those about to drop in price.',
          '<b>Chips</b>: the best week for Bench Boost and Triple Captain with your squad.',
          '<b>Mini-leagues</b>: where you are expected to finish, and your differentials against each rival.',
        ]))
          + section('Three ways to load your team', steps([
            '<b>Team ID</b>: the number after /entry/ on your FPL Points page.',
            '<b>Screenshot</b>: upload a screenshot of your team from the FPL app; it is read on your device.',
            '<b>Build one</b>: pick a squad yourself to try out ideas before the season or a Wildcard.',
          ])),
        faq: [
          ['Is my FPL team any good?', 'Compare its predicted points with the best squad for the same gameweek: FPL Checker shows this as a squad score, and which changes would close the gap.'],
          ['Do I need to log in with my FPL account?', 'No. Your Team ID only shows FPL Checker what is already public; it can’t change your team.'],
          ['Can it rate my team before the deadline?', 'Yes. Your picks for the coming gameweek are hidden by FPL until the deadline, so FPL Checker uses your latest visible team, which is the same unless you have made transfers.'],
        ],
      }),
    },
    {
      path: '/fpl-widget',
      html: layout({
        path: '/fpl-widget',
        title: 'Free FPL Widget — captain picks for your website | FPL Checker',
        description: 'Add this week’s top FPL captain picks to your website or blog for free: a small widget that updates itself every day, in a dark or light style.',
        h1: 'Free FPL captain picks widget',
        intro: 'Show your readers this week’s top five FPL captain picks, by predicted points, on your own site. It updates itself every day and before each deadline. Free, no sign-up.',
        body: section('Dark', `<iframe src="/embed/captains" title="FPL captain picks" width="100%" height="300" style="border:0;max-width:420px;border-radius:12px" loading="lazy"></iframe><p>Paste this where you want it:</p><pre class="seo-code"><code>${escapeHtml(widgetSnippet('dark'))}</code></pre>`)
          + section('Light', `<iframe src="/embed/captains?theme=light" title="FPL captain picks, light" width="100%" height="300" style="border:0;max-width:420px;border-radius:12px" loading="lazy"></iframe><pre class="seo-code"><code>${escapeHtml(widgetSnippet('light'))}</code></pre>`),
        faq: [
          ['Is the FPL widget free?', 'Yes. Use it on any site, blog or forum signature that allows iframes; keep the credit link under it.'],
          ['How often does it update?', 'Every day, and again before each deadline, from the same predictions as FPL Checker.'],
        ],
      }),
    },
  ];
}

// The embed code for the captain-picks widget (/embed/captains): an
// iframe, and a plain link under it so the credit is a real link.
export function widgetSnippet(theme = 'dark') {
  return `<iframe src="${SITE}/embed/captains${theme === 'light' ? '?theme=light' : ''}" title="FPL captain picks" width="100%" height="300" style="border:0;max-width:420px;border-radius:12px" loading="lazy"></iframe>\n<p><a href="${SITE}/fpl-captain-picks">FPL captain picks</a> by FPL Checker</p>`;
}

// The weekly predictions page from the latest saved predictions.
// players: [{ id, slug?, name, team, positionId, price, predicted }] for
// this gameweek; best: { xi: [same shape], captainId } or null. nav is
// extra HTML for the top (links to other gameweeks). The same page is
// served at /gw/<n> for the gameweek being planned, with /fpl-predictions
// as its canonical address.
export function predictionsPage({ gwName, deadline, players, best, updatedAt, nav = '', path = '/fpl-predictions', image }) {
  const fmt = n => (Math.round(n * 10) / 10).toFixed(1);
  const deadlineText = deadline ? new Date(deadline).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : null;
  const row = p => `<tr><td>${playerLink(p)}</td><td>${escapeHtml(p.team)}</td><td>£${p.price.toFixed(1)}m</td><td class="num">${fmt(p.predicted)}</td></tr>`;
  const table = (caption, rows) => `<table><caption>${escapeHtml(caption)}</caption><thead><tr><th scope="col">Player</th><th scope="col">Club</th><th scope="col">Price</th><th scope="col" class="num">Pts</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table>`;
  const sorted = [...players].sort((a, b) => b.predicted - a.predicted);
  const top = sorted.slice(0, 15);
  const byPos = [1, 2, 3, 4].map(pos => [pos, sorted.filter(p => p.positionId === pos).slice(0, 8)]);
  const captain = best && best.xi.find(p => p.id === best.captainId);
  const xiTotal = best ? best.xi.reduce((s, p) => s + p.predicted, 0) + (captain ? captain.predicted : 0) : 0;
  const body = (nav ? section('Gameweeks', nav) : '') + (best ? section(`Best XI for ${gwName}`, `<p>The highest-scoring starting XI £100m can buy this gameweek, predicted to score <b>${fmt(xiTotal)} points</b> with ${captain ? `<b>${escapeHtml(captain.name)}</b> as captain` : 'the captain doubled'}.</p><table><caption>Best XI</caption><thead><tr><th scope="col">Pos</th><th scope="col">Player</th><th scope="col">Club</th><th scope="col" class="num">Pts</th></tr></thead><tbody>${best.xi.map(p => `<tr><td>${POS_SHORT[p.positionId]}</td><td>${playerLink(p)}${p.id === best.captainId ? ' (C)' : ''}</td><td>${escapeHtml(p.team)}</td><td class="num">${fmt(p.predicted)}</td></tr>`).join('')}</tbody></table>`) : '')
    + section(`Top 15 predicted players for ${gwName}`, `${table('Highest predicted points', top)}${top[0] ? `<p>Captain pick on points alone: <b>${escapeHtml(top[0].name)}</b>. See <a href="/fpl-captain-picks">how captains are picked</a>.</p>` : ''}`)
    + byPos.map(([pos, list]) => section(`Best ${POSITIONS[pos].toLowerCase()} for ${gwName}`, table(POSITIONS[pos], list))).join('')
    + section('Players and clubs', '<p>Every player’s prediction, fixtures and form, and every club’s fixtures: <a href="/fpl-players">FPL player predictions</a>.</p>');
  return layout({
    path,
    canonical: '/fpl-predictions',
    ...(image ? { image } : {}),
    title: `FPL ${gwName.replace(/^Gameweek (\d+)$/, 'GW$1')} Predictions — best XI, captain and top players | FPL Checker`,
    description: `FPL predictions for ${gwName}: predicted points for every player, the best XI and captain, and the top goalkeepers, defenders, midfielders and forwards. Updated daily.`,
    h1: `FPL ${gwName} predictions`,
    intro: `Predicted Fantasy Premier League points for ${escapeHtml(gwName)}${deadlineText ? `, deadline ${escapeHtml(deadlineText)}` : ''}. Updated every day${updatedAt ? `; last on ${escapeHtml(new Date(updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/London' }))}` : ''}. Open FPL Checker to see your own squad predicted.`,
    body,
    faq: [
      ['How are these FPL predictions made?', 'From FPL’s expected points, form, minutes, fixture difficulty, betting odds and injury news for every player, updated daily and again before the deadline. See the FPL points predictor page for details.'],
      ['Can I see predictions for my own team?', 'Yes: open FPL Checker and enter your FPL Team ID to see every player in your squad predicted, your best XI and transfer suggestions.'],
    ],
    cta: { href: '/', label: 'Check my team' },
  });
}

// The pages in public/sitemap-pages.xml; the rest are in /sitemap-fpl.xml.
export const SEO_PATHS = ['/', ...GUIDES.map(g => g.path).filter(p => p !== '/fpl-players')];
