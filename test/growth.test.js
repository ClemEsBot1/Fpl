import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareLinks, shareMessage } from '../src/lib/shareLinks.js';
import { seoModel } from '../src/lib/seoDynamic.js';
import { duePosts, pricesPost, POST_KEY } from '../src/lib/social.js';
import { accuracyPage } from '../src/lib/seoMore.js';

test('share message and links carry the rating, points and the site', () => {
  const msg = shareMessage({ gwName: 'Gameweek 9', total: 54.34, score: 77.6 });
  assert.equal(msg, 'My FPL team\'s rated 78/100 and predicted 54.3 pts for GW9 👀 What\'s yours?');
  const links = shareLinks(msg);
  assert.match(links.whatsapp, /^https:\/\/wa\.me\/\?text=My%20FPL/);
  assert.ok(decodeURIComponent(links.x).endsWith('https://fplchecker.co.uk/'));
  assert.match(links.reddit, /url=https%3A%2F%2Ffplchecker\.co\.uk%2F&title=My%20FPL/);
  assert.equal(shareMessage({ gwName: '', total: null, score: null }), 'My FPL team\'s checked 👀 What\'s yours?');
});

const bootstrap = {
  total_players: 10_000_000,
  events: [{ id: 8, name: 'Gameweek 8', deadline_time: '2026-10-17T10:00:00Z', finished: false }],
  teams: [{ id: 1, name: 'Arsenal', short_name: 'ARS' }],
  elements: [
    { id: 1, first_name: 'Bukayo', second_name: 'Saka', web_name: 'Saka', team: 1, element_type: 3, now_cost: 100, selected_by_percent: '30', status: 'a', price_change_percent: 101 },
    { id: 2, first_name: 'Kai', second_name: 'Havertz', web_name: 'Havertz', team: 1, element_type: 4, now_cost: 80, selected_by_percent: '5', status: 'a', price_change_percent: -60 },
  ],
};
const model = seoModel({ bootstrap, fixtures: [], event: bootstrap.events[0], saved: { predictedById: { 1: 6, 2: 4 } } });

test('the nightly price post lists likely movers only, in the evening', () => {
  assert.match(pricesPost(model), /📈 Rises: Saka £10\.0m\n/);
  assert.doesNotMatch(pricesPost(model), /Havertz/, '60% is not likely');
  assert.match(pricesPost(model), /fplchecker\.co\.uk\/fpl-price-changes/);
  const evening = Date.parse('2026-10-15T19:30:00Z'); // 20:30 in London
  const morning = Date.parse('2026-10-15T08:00:00Z');
  const due = duePosts({ now: evening, season: '2026-27', model, snap: null }).filter(p => p.type === 'prices');
  assert.deepEqual(due.map(p => p.key), ['2026-27:prices:2026-10-15']);
  assert.ok(POST_KEY.test(due[0].key), 'the admin page can tick it off');
  assert.ok(!duePosts({ now: morning, season: '2026-27', model, snap: null }).some(p => p.type === 'prices'));
  assert.deepEqual(duePosts({ now: Date.parse('2026-10-20T19:30:00Z'), season: '2026-27', model, snap: null }).map(p => p.type), ['prices'], 'after the deadline too');
});

test('the accuracy page sums up the season and lists every gameweek', () => {
  const s = (miss, top, all) => ({ meanAbsError: miss, correlation: 0.5, topTenAverageActual: top, averageActual: all });
  const html = accuracyPage(model, [
    { gwId: 6, summary: s(2.0, 7, 3), xi: { predicted: 60, scored: 70 } },
    { gwId: 7, summary: s(3.0, 9, 3), xi: { predicted: 62.4, scored: 55 } },
    { gwId: 5, summary: null, xi: null },
  ]);
  assert.match(html, /missed by <b>2\.5 points<\/b>/);
  assert.match(html, /scored <b>8\.0<\/b> on average, against <b>3\.0<\/b>/);
  assert.match(html, /predicted <b>122<\/b> points over 2 gameweeks and scored <b>125<\/b>/);
  assert.ok(html.indexOf('/gw/7') < html.indexOf('/gw/6'), 'newest first');
  assert.match(accuracyPage(model, []), /No gameweek has been scored yet/);
});
