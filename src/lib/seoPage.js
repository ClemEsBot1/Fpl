// Plain HTML pages for search engines: each one answers a common FPL search
// ("FPL points predictor", "best FPL captain this week" …) in words Google
// can read without running the app, and links into the app. The fixed ones
// are written to public/ by scripts/make-seo-pages.mjs; the weekly
// predictions page (/fpl-predictions) is rendered on request by
// api/optimal-squad.js?page=predictions from the latest saved predictions.

import { TERMS_VERSION } from './terms.js';

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
  { path: '/fpl-chrome-extension', label: 'Chrome extension for the FPL site' },
  { path: '/fpl-best-goalkeepers', label: 'Best FPL goalkeepers' },
  { path: '/fpl-best-defenders', label: 'Best FPL defenders' },
  { path: '/fpl-best-midfielders', label: 'Best FPL midfielders' },
  { path: '/fpl-best-forwards', label: 'Best FPL forwards' },
  { path: '/fpl-budget-players', label: 'Best cheap FPL players' },
  { path: '/fpl-fixture-difficulty', label: 'FPL fixture difficulty' },
  { path: '/fpl-injuries', label: 'FPL injuries' },
  { path: '/fpl-most-owned', label: 'Most owned FPL players' },
  { path: '/fpl-in-form', label: 'In-form FPL players' },
  { path: '/fpl-team-id', label: 'Find your FPL Team ID' },
  { path: '/fpl-chips-guide', label: 'FPL chips guide' },
  { path: '/fpl-points-system', label: 'How FPL points work' },
  { path: '/terms', label: 'Terms and privacy' },
];

// The browser extension (extension/) on the Chrome Web Store: empty until
// the listing is approved, and the page says it's coming soon.
export const EXTENSION_STORE_URL = '';

// The guide pages rendered from live data on request (api/optimal-squad.js)
// rather than written to public/.
export const DYNAMIC_GUIDES = ['/fpl-predictions', '/fpl-players', '/fpl-tips', '/fpl-deadline', '/fpl-price-changes', '/fpl-differentials', '/fpl-double-gameweek', '/fpl-blank-gameweek', '/fpl-prediction-accuracy',
  '/fpl-best-goalkeepers', '/fpl-best-defenders', '/fpl-best-midfielders', '/fpl-best-forwards', '/fpl-budget-players', '/fpl-fixture-difficulty', '/fpl-injuries', '/fpl-most-owned', '/fpl-in-form'];

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
    {
      path: '/fpl-chrome-extension',
      html: layout({
        path: '/fpl-chrome-extension',
        title: 'FPL Chrome Extension — predicted points on the FPL site | FPL Checker',
        description: 'Free Chrome extension for Fantasy Premier League: predicted points next to every player on the official FPL site, your team’s predicted score and your best captain.',
        h1: 'FPL Checker Chrome extension',
        intro: 'See FPL Checker’s predicted points without leaving the official Fantasy Premier League site. Free, no account, and it never changes your team.',
        cta: EXTENSION_STORE_URL ? { href: EXTENSION_STORE_URL, label: 'Add to Chrome, free' } : undefined,
        body: section('What it adds to the FPL site', list([
          '<b>Predicted points next to player names</b> on Pick Team, Transfers, Points and the stats pages, for the coming gameweek.',
          '<b>A squad panel</b> with your XI’s predicted score, captain counted twice, and each player’s fixture.',
          '<b>Your best captain</b>, and how many points switching the armband would add.',
          '<b>Injury flags</b>: a doubtful player’s badge turns amber, with FPL’s news on hover.',
          '<b>A toolbar popup</b> with this gameweek’s top captains and a search for any player.',
        ]))
          + section('Get it', EXTENSION_STORE_URL
            ? `<p><a href="${EXTENSION_STORE_URL}" rel="noopener">Add FPL Checker to Chrome</a> from the Chrome Web Store. It works in Edge, Brave and other Chromium browsers too.</p>`
            : '<p>The extension is on its way to the Chrome Web Store. Until then, every prediction it shows is on <a href="/fpl-predictions">this gameweek’s predictions page</a>, or enter your Team ID on <a href="/">FPL Checker</a>.</p>')
          + `<section class="seo-card" id="privacy"><h2>Privacy</h2>${list([
            'The extension downloads FPL Checker’s predictions from fplchecker.co.uk. That request carries nothing about you or your team.',
            'To show your squad it reads your team from the FPL site, in your browser, the same way the page itself does. Your team, Team ID and FPL login are never sent to FPL Checker or anyone else.',
            'It stores only the predictions and your two settings, on your device. There are no analytics, ads or tracking, and nothing is sold or shared.',
            'It can’t make transfers or change anything in your FPL account.',
          ])}</section>`,
        faq: [
          ['Is the FPL Checker extension free?', 'Yes, free with no account. It shows the same predictions as fplchecker.co.uk.'],
          ['Does it need my FPL password?', 'No. It never asks for it and never sees it. If you are logged in to FPL, it reads your squad in your own browser to show its predicted points.'],
          ['Does it work on the FPL app?', 'No, browser extensions only run on the FPL website in a desktop browser. On your phone, use fplchecker.co.uk.'],
        ],
      }),
    },
    {
      path: '/fpl-team-id',
      html: layout({
        path: '/fpl-team-id',
        title: 'How to Find Your FPL Team ID — website and app | FPL Checker',
        description: 'Where to find your Fantasy Premier League Team ID on the FPL website and app in under a minute, and what you can do with it: rate your team, plan transfers and track mini-leagues.',
        h1: 'How to find your FPL Team ID',
        intro: 'Your FPL Team ID is the number FPL gives your team. It’s public and safe to share: it shows your team, but nobody can change anything with it.',
        cta: { href: '/', label: 'Check my team' },
        body: section('On the FPL website', steps([
          'Go to fantasy.premierleague.com and log in.',
          'Click <b>Points</b> in the menu.',
          'Look at the address bar: it reads <code>/entry/1234567/event/9</code>. The number after <code>/entry/</code> is your Team ID.',
        ]))
          + section('On the FPL app', steps([
            'Open the app and go to <b>Points</b>, or open your team from a league table.',
            'Tap <b>Share</b> (or the three dots) and copy the link.',
            'Paste it anywhere: the number after <code>/entry/</code> is your Team ID. If the app won’t show a link, log in on the website once instead.',
          ]))
          + section('What to do with it', list([
            '<a href="/rate-my-fpl-team">Rate your team</a> against the best possible squad.',
            'Get your <a href="/fpl-captain-picks">best captain</a> and <a href="/fpl-transfer-suggestions">transfer suggestions</a>.',
            'See where you’re likely to finish in your mini-leagues.',
          ])),
        faq: [
          ['Is it safe to share my FPL Team ID?', 'Yes. It only shows what anyone can already see on FPL: your team and points. It can’t be used to log in or make changes.'],
          ['Is my Team ID the same every season?', 'No. FPL gives you a new Team ID each season when you pick a new team.'],
          ['Can I find someone else’s Team ID?', 'Yes: open their team from a league table on the FPL website and read the number after /entry/ in the address.'],
        ],
      }),
    },
    {
      path: '/fpl-chips-guide',
      html: layout({
        path: '/fpl-chips-guide',
        title: 'FPL Chips Guide — when to play Wildcard, Free Hit, Bench Boost and Triple Captain | FPL Checker',
        description: 'When to use each FPL chip: Wildcard, Free Hit, Bench Boost and Triple Captain explained, the best gameweeks to play them, and how FPL Checker picks the week for your squad.',
        h1: 'FPL chips guide',
        intro: 'Chips are FPL’s one-off boosts. Played in the right week they are worth dozens of points. FPL Checker shows the best week for Bench Boost and Triple Captain with your own squad.',
        body: section('Wildcard', `<p>Unlimited free transfers for one gameweek, and the changes stay. Use it when your team needs four or more changes: after injuries pile up, or to set up for a run of good fixtures or a double gameweek.</p>`)
          + section('Free Hit', `<p>Unlimited free transfers for one gameweek only; your old team comes back the week after. Best in a blank gameweek, when many of your players don’t play, or a big double gameweek.</p>`)
          + section('Bench Boost', `<p>Your four substitutes score as well as your XI for one gameweek. Best in a double gameweek when all 15 of your players play twice. Plan it a few weeks ahead so your bench is strong.</p>`)
          + section('Triple Captain', `<p>Your captain scores three times instead of twice. Best on a premium player with a double gameweek, or a very easy home fixture.</p>`)
          + section('How many chips do I have?', `<p>FPL sets the chips for each season, and recently gave managers each chip twice, once in each half of the season. Check the rules in the FPL app for this season, and note the deadline for using the first set.</p><p>See <a href="/fpl-double-gameweek">double gameweeks</a> and <a href="/fpl-blank-gameweek">blank gameweeks</a> to plan them.</p>`),
        faq: [
          ['When should I use my FPL Wildcard?', 'When you need four or more transfers, or to set your team up for a good run of fixtures. Using it early to fix a bad start is fine.'],
          ['What is the best FPL chip strategy?', 'Save Bench Boost and Triple Captain for double gameweeks, Free Hit for a blank gameweek, and use a Wildcard before the doubles to get the right players in.'],
          ['Can I play two chips in one gameweek?', 'No. FPL allows one chip per gameweek.'],
        ],
      }),
    },
    {
      path: '/fpl-points-system',
      html: layout({
        path: '/fpl-points-system',
        title: 'How FPL Points Work — the Fantasy Premier League scoring system | FPL Checker',
        description: 'How Fantasy Premier League points are scored: appearances, goals and assists by position, clean sheets, saves, defensive contributions, bonus points and deductions, explained simply.',
        h1: 'How FPL points work',
        intro: 'Every FPL point explained. Knowing what scores is why defenders with attacking threat, nailed-on starters and goalkeepers who make saves are worth more than they look.',
        body: section('Points for every player', `<table><caption>All positions</caption><thead><tr><th scope="col">Action</th><th scope="col" class="num">Points</th></tr></thead><tbody>
<tr><td>Playing up to 60 minutes</td><td class="num">1</td></tr><tr><td>Playing 60 minutes or more</td><td class="num">2</td></tr>
<tr><td>Assist</td><td class="num">3</td></tr><tr><td>Bonus points (the best three players in a match)</td><td class="num">1–3</td></tr>
<tr><td>Yellow card</td><td class="num">−1</td></tr><tr><td>Red card</td><td class="num">−3</td></tr>
<tr><td>Own goal</td><td class="num">−2</td></tr><tr><td>Penalty missed</td><td class="num">−2</td></tr></tbody></table>`)
          + section('Points by position', `<table><caption>Goals and clean sheets</caption><thead><tr><th scope="col">Action</th><th scope="col" class="num">GKP</th><th scope="col" class="num">DEF</th><th scope="col" class="num">MID</th><th scope="col" class="num">FWD</th></tr></thead><tbody>
<tr><td>Goal</td><td class="num">10</td><td class="num">6</td><td class="num">5</td><td class="num">4</td></tr>
<tr><td>Clean sheet (60+ minutes)</td><td class="num">4</td><td class="num">4</td><td class="num">1</td><td class="num">0</td></tr>
<tr><td>Every 2 goals conceded</td><td class="num">−1</td><td class="num">−1</td><td class="num">0</td><td class="num">0</td></tr>
<tr><td>Every 3 saves</td><td class="num">1</td><td class="num">–</td><td class="num">–</td><td class="num">–</td></tr>
<tr><td>Penalty saved</td><td class="num">5</td><td class="num">–</td><td class="num">–</td><td class="num">–</td></tr></tbody></table>`)
          + section('Defensive contributions', `<p>Since 2025/26, outfield players also score 2 points for defensive work in a match: defenders for 10 clearances, blocks, interceptions and tackles combined, midfielders and forwards for 12 including ball recoveries. It makes busy defensive midfielders and centre-backs more valuable.</p>`)
          + section('Captain and vice-captain', `<p>Your captain’s points count twice (three times with Triple Captain). If he doesn’t play, your vice-captain is doubled instead. See <a href="/fpl-captain-picks">this week’s best captains</a>.</p>`)
          + `<p class="seo-intro" style="font-size:0.9rem">FPL can change the scoring between seasons: check the rules in the FPL app for the current figures.</p>`,
        faq: [
          ['How many points is a goal worth in FPL?', 'It depends on position: 10 for a goalkeeper, 6 for a defender, 5 for a midfielder and 4 for a forward.'],
          ['How do FPL bonus points work?', 'FPL scores every player’s match with the Bonus Points System (BPS). The top three get 3, 2 and 1 bonus points.'],
          ['Do substitutes score in FPL?', 'Only if one of your starters doesn’t play, then your bench comes on in order. With Bench Boost all four score.'],
        ],
      }),
    },
    {
      path: '/terms',
      html: layout({
        path: '/terms',
        title: 'Terms and Privacy | FPL Checker',
        description: 'The terms for using FPL Checker, the free Fantasy Premier League tool, and how it handles your data: what is stored, why, who it is shared with and how to delete it.',
        h1: 'Terms and privacy',
        intro: `Plain-English terms for using FPL Checker, and what happens to your data. Last updated ${new Date(TERMS_VERSION).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`,
        body: section('1. About FPL Checker', `<p>FPL Checker (fplchecker.co.uk) is a free, independent tool for Fantasy Premier League managers. It is not run by, endorsed by or linked to the Premier League, Fantasy Premier League or any football club. Player and fixture data comes from FPL’s public data.</p>`)
          + section('2. Using the site', list([
            'By using FPL Checker you agree to these terms. If you don’t agree, please don’t use it.',
            'Predictions, ratings and suggestions are estimates from statistical models. They can be wrong, and nothing on the site is a promise of points. Decisions about your FPL team are yours.',
            'The site is provided as it is, free of charge, and may change, pause or stop at any time. As far as the law allows, we aren’t liable for any loss from using it, including lost FPL points, rank or prizes.',
            'Don’t misuse the site: no attempts to break in, overload it, scrape it at scale, or use it to harass anyone.',
          ]))
          + section('3. Accounts', list([
            'An account is optional. You need one only to save teams across devices or get emails.',
            'Keep your password private. You’re responsible for what happens under your account.',
            'If you add an email address, we send a code to confirm it belongs to you. It is used for password reset codes and, only if you turn them on, deadline emails.',
            'We may suspend or delete accounts that break these terms.',
          ]))
          + `<section class="seo-card" id="privacy"><h2>4. Your data</h2>${list([
            '<b>What we store for an account</b>: your username, a scrambled (hashed) password that nobody can read, your email if you add one and whether it’s confirmed, your saved teams, your deadline email setting, when you joined and when you agreed to these terms.',
            '<b>Without an account</b>: nothing that identifies you. Your browser keeps a few settings on your device, such as the last Team ID you checked and that you agreed to these terms.',
            '<b>Cookies</b>: one cookie that keeps you logged in. No advertising or tracking cookies. We use privacy-friendly visit counts from our host that don’t identify you.',
            '<b>Screenshots</b>: a team screenshot you upload is read on your device. It is only sent to us if you choose to report a problem with it.',
            '<b>Who processes it</b>: our hosting, database and email providers, only to run the site. We never sell your data or share it for advertising.',
            '<b>Push notifications</b>, if you turn them on, use your browser’s push service, and you can turn them off any time.',
            '<b>Your rights</b>: you can change or remove your email from your account at any time, and ask for your account and its data to be deleted.',
          ])}<p>The browser extension’s privacy details are on the <a href="/fpl-chrome-extension#privacy">extension page</a>.</p></section>`
          + section('5. Changes', `<p>We may update these terms. When we do, the date above changes and you’ll be asked to agree again the next time you start the site or create an account.</p><p>These terms are governed by the law of England and Wales.</p>`),
        faq: [
          ['Is FPL Checker linked to the Premier League?', 'No. It is an independent fan-made tool and not affiliated with the Premier League or Fantasy Premier League.'],
          ['Does FPL Checker sell my data?', 'No. Account data is used only to run the site, never sold or shared for advertising.'],
          ['How do I delete my account?', 'Remove your email from your account to stop all emails, and ask for your account to be deleted to remove everything we hold.'],
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
