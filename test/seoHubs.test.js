import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { seoModel } from '../src/lib/seoDynamic.js';
import { DYNAMIC_GUIDES, GUIDES } from '../src/lib/seoPage.js';
import { BUDGET, POSITION_PAGES, budgetPage, fixtureDifficultyPage, fixtureRows, inFormPage, injuriesPage, mostOwnedPage, positionPage } from '../src/lib/seoHubs.js';

const el = (id, web, team, pos, cost, selected, extra = {}) => ({ id, first_name: web, second_name: 'X', web_name: web, team, element_type: pos, now_cost: cost, selected_by_percent: String(selected), status: 'a', news: '', form: '3.0', ...extra });
const teams = [{ id: 1, name: 'Arsenal', short_name: 'ARS' }, { id: 2, name: 'Chelsea', short_name: 'CHE' }, { id: 3, name: 'Man City', short_name: 'MCI' }];
const elements = [
  el(1, 'Haaland', 3, 4, 150, 60, { form: '9.5' }), el(2, 'Saka', 1, 3, 100, 40), el(3, 'Palmer', 2, 3, 105, 35, { form: '7.0' }),
  el(4, 'Cheapkeeper', 2, 1, 40, 3), el(5, 'Raya', 1, 1, 55, 30), el(6, 'Cheapdef', 1, 2, 40, 2), el(7, 'Gabriel', 1, 2, 60, 25),
  el(8, 'Hurt', 1, 4, 80, 30, { status: 'i', news: 'Hamstring injury - Expected back 01 Nov' }),
  el(9, 'Doubt', 2, 3, 70, 12, { status: 'd', news: 'Knock - 50% chance of playing', chance_of_playing_next_round: 50 }),
  el(10, 'Banned', 3, 2, 50, 8, { status: 's', news: 'Suspended until 25 Oct' }),
  el(11, 'Hyped', 2, 4, 75, 45),
  ...Array.from({ length: 70 }, (_, i) => el(20 + i, `M${i}`, 1 + (i % 3), 3, 50, 0.5)),
];
// Arsenal easy, Chelsea hard, City blank in GW9.
const fixtures = [8, 9, 10, 11, 12].flatMap(gw => [
  { event: gw, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 5, finished: false },
  ...(gw === 9 ? [] : [{ event: gw, team_h: 3, team_a: 1, team_h_difficulty: 3, team_a_difficulty: 2, finished: false }]),
]);
const event = { id: 8, name: 'Gameweek 8', deadline_time: '2026-10-17T10:00:00Z' };
const pred = { 1: 8.1, 2: 6.8, 3: 7.2, 4: 3.5, 5: 4.4, 6: 3.9, 7: 4.6, 8: 0, 9: 3.0, 10: 0, 11: 1.0, ...Object.fromEntries(Array.from({ length: 70 }, (_, i) => [20 + i, 2 + i * 0.05])) };
const saved = { predictedById: pred, byGwById: Object.fromEntries(Object.entries(pred).map(([id, v]) => [id, [v, v, v, v, v]])) };
const model = seoModel({ bootstrap: { teams, elements }, fixtures, event, saved });

const ld = html => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(m => JSON.parse(m[1]));
function wellFormed(html, path) {
  assert.match(html, new RegExp(`<link rel="canonical" href="https://fplchecker.co.uk${path}">`));
  assert.equal((html.match(/<h1>/g) || []).length, 1, path);
  assert.match(html, /<meta name="description" content="[^"]{80,}">/, path);
  const faq = ld(html).find(d => d['@type'] === 'FAQPage');
  assert.ok(faq && faq.mainEntity.length >= 2, path);
  assert.doesNotMatch(html, /undefined|NaN/, path);
}

test('each position page ranks only that position, with budget picks under the cap', () => {
  for (const [key, pos] of Object.entries(POSITION_PAGES)) {
    const html = positionPage(model, key);
    wellFormed(html, `/fpl-best-${key}`);
    assert.match(html, new RegExp(`<title>Best FPL ${pos.title} GW8`));
  }
  const gk = positionPage(model, 'goalkeepers');
  assert.ok(gk.indexOf('Raya') < gk.indexOf('Cheapkeeper'), 'better prediction first');
  assert.doesNotMatch(gk, /Haaland/);
  assert.match(gk, /Who is the best cheap FPL goalkeeper\?","acceptedAnswer":\{"@type":"Answer","text":"Cheapkeeper at £4\.0m/);
  const fwd = positionPage(model, 'forwards');
  assert.doesNotMatch(fwd, /\/player\/hurt-x/, 'an injured player isn’t recommended');
});

test('budget picks stay under each position’s cap and value is points per £1m', () => {
  const html = budgetPage(model);
  wellFormed(html, '/fpl-budget-players');
  assert.match(html, /Budget defenders \(£4\.5m or less\)/);
  assert.match(html, /Cheapdef/);
  assert.equal(BUDGET[3], 5.5);
});

test('the fixture ticker sorts the easiest run first and shows a blank', () => {
  const rows = fixtureRows(model);
  assert.deepEqual(rows.map(r => r.team.short), ['ARS', 'MCI', 'CHE']);
  const html = fixtureDifficultyPage(model);
  wellFormed(html, '/fpl-fixture-difficulty');
  assert.match(html, /seo-fdr-blank">Blank/);
  assert.match(html, /<title>FPL Fixture Difficulty GW8–GW12/);
});

test('injuries are grouped by status, most owned first', () => {
  const html = injuriesPage(model);
  wellFormed(html, '/fpl-injuries');
  assert.ok(html.indexOf('Doubtful (1)') < html.indexOf('Injured (1)') && html.indexOf('Injured (1)') < html.indexOf('Suspended (1)'));
  assert.match(html, /Hamstring injury - Expected back 01 Nov/);
  assert.doesNotMatch(html, /\/player\/saka-x/);
});

test('most owned shows the template and flags popular players predicted poorly', () => {
  const html = mostOwnedPage(model);
  wellFormed(html, '/fpl-most-owned');
  assert.ok(html.indexOf('Haaland') < html.indexOf('Saka'));
  assert.match(html, /Popular, but predicted to disappoint[\s\S]*Hyped/);
});

test('in-form players come by form, next to their predictions', () => {
  const html = inFormPage(model);
  wellFormed(html, '/fpl-in-form');
  assert.ok(html.indexOf('Haaland') < html.indexOf('Palmer'), 'form 9.5 before 7.0');
  assert.match(html, /Who is the most in-form FPL player\?","acceptedAnswer":\{"@type":"Answer","text":"Haaland \(form 9\.5\)/);
});

test('every new page has an address, a nav link and a sitemap entry', () => {
  const rewrites = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).rewrites;
  const sitemap = fs.readFileSync(new URL('../public/sitemap-pages.xml', import.meta.url), 'utf8');
  const paths = ['/fpl-best-goalkeepers', '/fpl-best-defenders', '/fpl-best-midfielders', '/fpl-best-forwards', '/fpl-budget-players', '/fpl-fixture-difficulty', '/fpl-injuries', '/fpl-most-owned', '/fpl-in-form'];
  for (const path of paths) {
    assert.ok(rewrites.some(r => r.source === path && r.destination.startsWith('/api/optimal-squad?page=')), path);
    assert.ok(DYNAMIC_GUIDES.includes(path), path);
  }
  for (const path of [...paths, '/fpl-team-id', '/fpl-chips-guide', '/fpl-points-system']) {
    assert.ok(GUIDES.some(g => g.path === path), path);
    assert.ok(sitemap.includes(`<loc>https://fplchecker.co.uk${path}</loc>`), `${path} in sitemap (run scripts/make-seo-pages.mjs)`);
  }
});
