import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedCaptainsHtml, leaguePage, tipsData, tipsPage } from '../src/lib/seoExtra.js';
import { seoModel } from '../src/lib/seoDynamic.js';
import { bestXiData, bestXiPng } from '../src/lib/socialImage.js';

const el = (id, web, team, pos, cost, selected, extra = {}) => ({ id, first_name: web, second_name: 'X', web_name: web, team, element_type: pos, now_cost: cost, selected_by_percent: String(selected), status: 'a', news: '', ...extra });
const teams = [{ id: 1, name: 'Arsenal', short_name: 'ARS' }, { id: 2, name: 'Chelsea', short_name: 'CHE' }, { id: 3, name: 'Man City', short_name: 'MCI' }];
const elements = [
  el(1, 'Haaland', 3, 4, 150, 60), el(2, 'Saka', 1, 3, 100, 40), el(3, 'Palmer', 2, 3, 105, 35), el(4, 'Madueke', 2, 3, 65, 4.2),
  el(5, 'Hurt', 1, 4, 80, 30, { status: 'd', news: 'Knock - 50% chance of playing' }), el(6, 'Cheap', 1, 2, 40, 2), el(7, 'Keeper', 2, 1, 40, 3),
  el(8, 'Flop', 3, 3, 90, 25), ...Array.from({ length: 30 }, (_, i) => el(20 + i, `M${i}`, 1 + (i % 3), 3, 50, 1)),
];
const fixtures = [8, 9, 10, 11, 12].flatMap(gw => [
  { event: gw, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 4, finished: false },
  { event: gw, team_h: 3, team_a: 1, team_h_difficulty: 3, team_a_difficulty: 5, finished: false },
]);
const event = { id: 8, name: 'Gameweek 8', deadline_time: '2026-10-17T10:00:00Z' };
const pred = { 1: 8.1, 2: 6.8, 3: 7.2, 4: 5.9, 5: 6.0, 6: 4.1, 7: 3.9, 8: 1.0, ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [20 + i, 2 + i * 0.05])) };
const saved = { predictedById: pred, byGwById: Object.fromEntries(Object.entries(pred).map(([id, v]) => [id, [v, v, v, v, v]])) };
const model = seoModel({ bootstrap: { teams, elements }, fixtures, event, saved });

test('tips pick a captain, differentials, sells and budget picks from the predictions', () => {
  const t = tipsData(model);
  assert.deepEqual(t.captains.map(p => p.name), ['Haaland', 'Palmer', 'Saka'], 'a doubtful player isn’t a captain pick');
  assert.equal(t.differentialCaptain.name, 'Madueke');
  assert.equal(t.differentials[0].name, 'Madueke');
  assert.deepEqual(t.sells.map(s => s.player.name), ['Hurt', 'Flop'], 'popular and doubtful first, then popular and predicted poorly');
  assert.ok(t.budget.some(p => p.name === 'Cheap') && t.budget.some(p => p.name === 'Keeper'));
  assert.equal(t.easiest[0].team.name, 'Man City');
  const html = tipsPage(model, { image: '/images/best-xi.png' });
  assert.match(html, /<title>FPL Gameweek 8 Tips/);
  assert.match(html, /<link rel="canonical" href="https:\/\/fplchecker.co.uk\/fpl-tips">/);
  assert.match(html, /og:image" content="https:\/\/fplchecker.co.uk\/images\/best-xi.png"/);
  assert.match(html, /Knock - 50% chance of playing/);
  assert.match(html, /"@type":"Article"/);
  assert.match(html, /Who should I captain in FPL Gameweek 8\?/);
});

test('the widget is a small page of the top five captains, crediting the site', () => {
  const dark = embedCaptainsHtml(model);
  assert.equal((dark.match(/<li>/g) || []).length, 5);
  assert.match(dark, /href="https:\/\/fplchecker.co.uk\/player\/haaland-x" target="_blank"/);
  assert.match(dark, /Predictions by <b>FPL Checker<\/b>/);
  assert.match(dark, /noindex/);
  assert.notEqual(embedCaptainsHtml(model, { theme: 'light' }), dark);
});

test('a league page shows each team’s captain and predicted points, not indexed', () => {
  const standings = { league: { name: 'Office <League>' }, standings: { results: [
    { entry: 11, entry_name: 'Team A', player_name: 'Ann', rank: 1, total: 500, event_total: 60 },
    { entry: 12, entry_name: 'Team B', player_name: 'Bob', rank: 2, total: 480, event_total: 70 },
  ] } };
  const picks = { 11: [{ element: 1, position: 1, is_captain: true }, { element: 2, position: 2, is_captain: false }, { element: 3, position: 12, is_captain: false }] };
  const html = leaguePage(model, '123', standings, picks);
  assert.ok(html.includes('Office &lt;League&gt;') && !html.includes('<League>'));
  assert.match(html, /<td class="num">23\.0<\/td>/, '8.1 × 2 + 6.8, the bench left out');
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /Most popular captain: <a href="\/player\/haaland-x">Haaland<\/a> \(1 of 1 teams\)/);
});

test('the best XI picture is a 1200×675 PNG', async () => {
  const snap = { gwId: 8, startingIds: [7, 6, 20, 21, 2, 3, 4, 22, 23, 1, 5], captainId: 1 };
  const data = bestXiData(model, snap);
  assert.equal(data.xi.length, 11);
  assert.match(data.alt, /GW8 best XI, predicted .* Haaland \(captain\)/);
  assert.equal(bestXiData(model, { ...snap, gwId: 7 }), null, 'a squad saved for another gameweek');
  const png = await bestXiPng(data);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 675);
});
