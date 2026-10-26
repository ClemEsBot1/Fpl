import { test } from 'node:test';
import assert from 'node:assert/strict';
import { futureGwPage, notFoundPage, pastGwPage, playerPage, playersHubPage, seoModel, sitemapXml, slugify, teamPage } from '../src/lib/seoDynamic.js';

const ldBlocks = html => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(m => JSON.parse(m[1]));

const el = (id, first, second, web, team, pos, cost, extra = {}) => ({
  id, first_name: first, second_name: second, web_name: web, team, element_type: pos, now_cost: cost,
  selected_by_percent: '12.5', status: 'a', news: '', chance_of_playing_next_round: null, total_points: 40, form: '5.0', points_per_game: '5.5',
  minutes: 600, goals_scored: 3, assists: 2, clean_sheets: 1, bonus: 4, expected_goals: '2.80', expected_assists: '1.10', ...extra,
});
const bootstrap = {
  teams: [{ id: 1, name: 'Arsenal', short_name: 'ARS' }, { id: 2, name: "Nott'm Forest", short_name: 'NFO' }, { id: 3, name: 'Man City', short_name: 'MCI' }],
  elements: [
    el(1, 'Martin', 'Ødegaard', 'Ødegaard', 1, 3, 85),
    el(2, 'Erling', 'Haaland', 'Haaland', 3, 4, 150),
    el(3, 'Chris', 'Wood', 'Wood', 2, 4, 75, { status: 'd', news: 'Knock - 75% chance of playing', chance_of_playing_next_round: 75 }),
    el(4, 'Gabriel', 'Jesus', 'G.Jesus', 1, 4, 70),
    el(5, 'Gabriel', 'Jesus', 'Jesus', 3, 4, 45),
    el(6, 'Old', 'Player', 'Player', 1, 2, 40, { status: 'u' }),
    el(7, 'David', 'Raya', 'Raya', 1, 1, 55),
  ],
};
const fixtures = [
  { event: 8, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 4, kickoff_time: '2026-10-17T14:00:00Z', finished: false },
  { event: 9, team_h: 3, team_a: 1, team_h_difficulty: 4, team_a_difficulty: 5, kickoff_time: '2026-10-24T14:00:00Z', finished: false },
  { event: 9, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 4, kickoff_time: '2026-10-27T19:00:00Z', finished: false },
  { event: 7, team_h: 1, team_a: 3, team_h_difficulty: 4, team_a_difficulty: 4, kickoff_time: '2026-10-04T14:00:00Z', finished: true },
];
const event = { id: 8, name: 'Gameweek 8', deadline_time: '2026-10-17T10:00:00Z' };
const saved = {
  predictedById: { 1: 5.4, 2: 7.9, 3: 3.1, 4: 4.0, 5: 1.2, 7: 3.8 },
  byGwById: { 1: [5.4, 9.8, 4, 4, 4], 2: [7.9, 6, 6, 6, 6], 3: [3.1, 2, 2, 2, 2], 4: [4, 7, 3, 3, 3], 5: [1.2, 1, 1, 1, 1], 7: [3.8, 6.5, 3, 3, 3] },
};
const model = seoModel({ bootstrap, fixtures, event, saved });

test('slugs are plain ASCII and unique, with the id added where full names clash', () => {
  assert.equal(slugify('Martin Ødegaard'), 'martin-odegaard');
  assert.equal(slugify("Nott'm Forest"), 'nott-m-forest');
  assert.equal(slugify('José Sá'), 'jose-sa');
  const slugs = model.players.map(p => p.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.deepEqual(slugs.filter(s => s.startsWith('gabriel-jesus')).sort(), ['gabriel-jesus-4', 'gabriel-jesus-5']);
  assert.equal(model.playerBySlug['erling-haaland'].ahead, 31.9);
  assert.deepEqual(model.teamBySlug.arsenal.fixtures.map(f => f.event), [8, 9, 9], 'finished fixtures left out, double gameweek kept');
});

test('a player page has his predictions by gameweek, his season, fixtures and links', () => {
  const html = playerPage(model, model.playerBySlug['martin-odegaard'], [{ round: 7, total_points: 12, minutes: 90, opponent_team: 3, was_home: true }]);
  assert.match(html, /<title>Ødegaard FPL Prediction GW8/);
  assert.match(html, /<link rel="canonical" href="https:\/\/fplchecker.co.uk\/player\/martin-odegaard">/);
  assert.match(html, /predicted to score <b>5\.4 points<\/b> in Gameweek 8/);
  assert.ok(html.includes('MCI (A), NFO (H)'), 'both fixtures of the double gameweek');
  assert.ok(html.includes('href="/team/arsenal"'));
  assert.ok(html.includes('href="/gw/8"'));
  assert.match(html, /<td class="num">12<\/td>/, 'last gameweeks');
  const ld = ldBlocks(html);
  assert.deepEqual(ld.find(d => d['@type'] === 'BreadcrumbList').itemListElement.map(i => i.name), ['FPL Checker', 'Players', 'Arsenal', 'Ødegaard FPL prediction']);
  assert.ok(ld.find(d => d['@type'] === 'FAQPage').mainEntity.length >= 2);
  assert.ok(ld.find(d => d['@type'] === 'Person'));
});

test('a doubtful player’s page says so', () => {
  const html = playerPage(model, model.playerBySlug['chris-wood']);
  assert.match(html, /Knock - 75% chance of playing/);
  assert.match(html, /75% chance of playing next round/);
});

test('a club page lists its fixtures, players and the other clubs', () => {
  const html = teamPage(model, model.teamBySlug.arsenal);
  assert.match(html, /<title>Arsenal FPL Fixtures and Best Players/);
  assert.ok(html.includes('href="/player/martin-odegaard"'));
  assert.ok(!html.includes('href="/player/old-player"'), 'a player who has left isn’t listed');
  assert.ok(html.includes('href="/team/nott-m-forest"') && html.includes('href="/team/man-city"'));
  assert.match(html, /easiest run of 3 clubs/);
});

test('gameweek pages: ahead from the five-week figures, past with what was scored', () => {
  const ahead = futureGwPage(model, 9, 'Gameweek 9');
  assert.match(ahead, /Playing twice: Arsenal/);
  assert.ok(ahead.indexOf('martin-odegaard') < ahead.indexOf('erling-haaland'), 'ranked by GW9 points');
  const past = pastGwPage(model, 7, 'Gameweek 7', {
    saved: { predictedById: Object.fromEntries([1, 2, 3, 4, 5, 7].map(id => [id, 4])) },
    snap: { startingIds: [1, 2, 7], captainId: 2 },
    live: [{ id: 1, stats: { total_points: 12, minutes: 90 } }, { id: 2, stats: { total_points: 2, minutes: 90 } }, { id: 7, stats: { total_points: 6, minutes: 90 } }],
  });
  assert.match(past, /predicted <b>16\.0 points<\/b> and it scored <b>22<\/b>/);
  assert.match(past, /Top scorers in Gameweek 7/);
  assert.match(past, /<link rel="canonical" href="https:\/\/fplchecker.co.uk\/gw\/7">/);
});

test('the hub links every club, and the sitemap lists every page once', () => {
  const hub = playersHubPage(model);
  model.teams.forEach(t => assert.ok(hub.includes(`href="/team/${t.slug}"`)));
  const xml = sitemapXml(model, [6, 7, 8, 9]);
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
  assert.equal(new Set(locs).size, locs.length);
  assert.ok(locs.includes('https://fplchecker.co.uk/player/martin-odegaard'));
  assert.ok(locs.includes('https://fplchecker.co.uk/gw/9'));
  assert.ok(!locs.some(l => l.includes('old-player')));
  const missing = notFoundPage('/player/nobody', 'Player');
  assert.match(missing, /<meta name="robots" content="noindex">/);
  assert.ok(!missing.includes('rel="canonical"'));
});

test('player names are escaped', () => {
  const evil = seoModel({ bootstrap: { teams: bootstrap.teams, elements: [el(9, '<script>', 'x', '<b>x', 1, 3, 50)] }, fixtures, event, saved: { predictedById: { 9: 2 } } });
  const html = playerPage(evil, evil.players[0]);
  assert.ok(!html.includes('<script>x') && !html.includes('<b>x'));
});

test('short player addresses: a unique FPL name or surname points to the full page', () => {
  const a = model.playerAliases;
  assert.equal(a.haaland, 'erling-haaland');
  assert.equal(a.odegaard, 'martin-odegaard');
  assert.equal(a.raya, 'david-raya');
  assert.equal(a['g-jesus'], model.playerById[4].slug, 'his FPL name is unique even though his surname isn\'t');
  assert.equal(a.jesus, undefined, 'two Jesuses: no guess');
  assert.equal(a['erling-haaland'], undefined, 'full slugs are not aliases');
});

test("just after a deadline, last gameweek's saved predictions are moved on a week so the pages stay up", async () => {
  const { carriedForward } = await import('../src/lib/seoDynamic.js');
  const saved = { gwId: 8, season: '2026-27', predictedById: { 1: 5, 2: 3 }, byGwById: { 1: [5, 6, 7], 2: [3], 3: [] } };
  const on = carriedForward(saved, 1);
  assert.equal(on.gwId, 9);
  assert.equal(on.carriedFrom, 8);
  assert.deepEqual(on.predictedById, { 1: 6 });
  assert.deepEqual(on.byGwById, { 1: [6, 7] });
  assert.equal(carriedForward({ gwId: 8, predictedById: { 1: 5 } }, 1), null, 'no weeks ahead saved');
  assert.equal(carriedForward(null, 1), null);
});
