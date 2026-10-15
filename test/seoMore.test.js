import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seoModel } from '../src/lib/seoDynamic.js';
import { comparePage, comparePairs, comparePath, deadlinePage, differentialsPage, parseCompare, priceChangesPage, priceData, scheduleGwPage, scheduleWeeks } from '../src/lib/seoMore.js';
import { indexNowEnabled, indexNowKey, pingIndexNow } from '../src/lib/indexNow.js';

const ldBlocks = html => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(m => JSON.parse(m[1]));
const el = (id, web, team, pos, cost, extra = {}) => ({
  id, first_name: web, second_name: 'X', web_name: web, team, element_type: pos, now_cost: cost,
  selected_by_percent: '20.0', status: 'a', news: '', chance_of_playing_next_round: null, total_points: 40, form: '5.0', points_per_game: '5.5',
  minutes: 600, goals_scored: 3, assists: 2, clean_sheets: 1, bonus: 4, expected_goals: '2.80', expected_assists: '1.10',
  transfers_in_event: 0, transfers_out_event: 0, cost_change_event: 0, ...extra,
});
const bootstrap = {
  total_players: 10_000_000,
  events: [
    { id: 8, name: 'Gameweek 8', deadline_time: '2026-10-17T10:00:00Z' },
    { id: 9, name: 'Gameweek 9', deadline_time: '2026-10-24T10:00:00Z' },
    { id: 10, name: 'Gameweek 10', deadline_time: '2026-10-31T11:00:00Z' },
  ],
  teams: [{ id: 1, name: 'Arsenal', short_name: 'ARS' }, { id: 2, name: 'Chelsea', short_name: 'CHE' }, { id: 3, name: 'Man City', short_name: 'MCI' }],
  elements: [
    el(1, 'Saka', 1, 3, 100, { price_change_percent: 104, transfers_in_event: 300_000 }),
    el(2, 'Palmer', 2, 3, 105, { selected_by_percent: '4.0', price_change_percent: -97, cost_change_event: -1 }),
    el(3, 'Haaland', 3, 4, 150, { cost_change_event: 1 }),
    el(4, 'Madueke', 2, 3, 65, { selected_by_percent: '2.0' }),
    el(5, 'Raya', 1, 1, 55, { selected_by_percent: '9.0' }),
  ],
};
const fixtures = [
  { event: 8, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 4, kickoff_time: '2026-10-17T14:00:00Z', finished: false },
  { event: 9, team_h: 1, team_a: 3, team_h_difficulty: 4, team_a_difficulty: 3, kickoff_time: '2026-10-24T14:00:00Z', finished: false },
  { event: 9, team_h: 2, team_a: 1, team_h_difficulty: 3, team_a_difficulty: 3, kickoff_time: '2026-10-27T19:00:00Z', finished: false },
  { event: null, team_h: 3, team_a: 2, team_h_difficulty: 3, team_a_difficulty: 4, kickoff_time: null, finished: false },
];
const saved = {
  predictedById: { 1: 6.1, 2: 5.0, 3: 7.2, 4: 3.3, 5: 4.0 },
  byGwById: { 1: [6.1, 9, 5, 5, 5], 2: [5, 4, 4, 4, 4], 3: [7.2, 0, 6, 6, 6], 4: [3.3, 3, 3, 3, 3], 5: [4, 7, 4, 4, 4] },
};
const model = seoModel({ bootstrap, fixtures, event: bootstrap.events[0], saved });

test('price changes: FPL’s own progress, rises and falls, and moves so far', () => {
  const d = priceData(model);
  assert.deepEqual(d.rises.map(r => [r.player.name, r.change.confidence]), [['Saka', 'very likely']]);
  assert.deepEqual(d.falls.map(r => [r.player.name, r.change.confidence]), [['Palmer', 'likely']]);
  assert.deepEqual(d.changed.up.map(p => p.name), ['Haaland']);
  assert.deepEqual(d.changed.down.map(p => p.name), ['Palmer']);
  const html = priceChangesPage(model, new Date('2026-10-15T20:00:00Z'));
  assert.match(html, /<title>FPL Price Changes Tonight/);
  assert.match(html, /early on Friday 16 October/);
  assert.match(html, /very likely \(104%\)/);
  assert.match(html, /\+300,000/);
  assert.ok(ldBlocks(html).find(b => b['@type'] === 'FAQPage').mainEntity.some(q => q.acceptedAnswer.text === 'Most likely: Saka.'));
});

test('deadline page: this gameweek in UK time and the next ones', () => {
  const html = deadlinePage(model);
  assert.match(html, /<title>FPL Deadline GW8 — Gameweek 8 deadline time \(UK\)/);
  assert.match(html, /Saturday 17 October at 11:00/, 'BST');
  assert.match(html, /Saturday 31 October at 11:00/, 'GMT after the clocks change');
  assert.match(html, /href="\/gw\/9"/);
});

test('double and blank gameweeks, with matches still to be scheduled', () => {
  assert.deepEqual(scheduleWeeks(model, 'double').map(w => [w.event.id, w.teams.map(x => x.team.short)]), [[9, ['ARS']]]);
  assert.deepEqual(scheduleWeeks(model, 'blank').map(w => [w.event.id, w.teams.map(x => x.team.short)]), [[8, ['MCI']], [10, ['ARS', 'CHE', 'MCI']]]);
  const dgw = scheduleGwPage(model, 'double');
  assert.match(dgw, /Gameweek 9 double gameweek/);
  assert.match(dgw, /MCI \(H\), easy|MCI \(H\), hard|MCI \(H\), medium/);
  assert.match(dgw, /Saka/, 'best pick from the club playing twice');
  assert.match(dgw, /Man City<\/a> v <a href="\/team\/chelsea">Chelsea/);
  assert.match(scheduleGwPage(model, 'blank'), /<link rel="canonical" href="https:\/\/fplchecker.co.uk\/fpl-blank-gameweek">/);
});

test('differentials: owned by under 10%, best first', () => {
  const html = differentialsPage(model);
  assert.match(html, /<title>FPL Differentials GW8/);
  const table = html.split('Owned by under 10%')[1].split('</table>')[0];
  assert.ok(table.indexOf('Raya') < table.indexOf('Palmer') && table.indexOf('Palmer') < table.indexOf('Madueke'));
  assert.ok(!table.includes('Saka'), 'owned by 20%');
});

test('compare pages: one address per pair, either order', () => {
  const [a, b] = parseCompare(model, 'palmer-x-vs-saka-x');
  assert.deepEqual([a.name, b.name], ['Palmer', 'Saka']);
  assert.deepEqual(parseCompare(model, 'saka-x-vs-palmer-x').map(p => p.name), ['Saka', 'Palmer']);
  assert.equal(comparePath(b, a), '/compare/palmer-x-vs-saka-x');
  assert.equal(parseCompare(model, 'saka-x-vs-saka-x'), null);
  assert.equal(parseCompare(model, 'nobody-vs-saka-x'), null);
  const html = comparePage(model, b, a);
  assert.match(html, /<title>Palmer vs Saka FPL — who to pick for GW8/);
  assert.match(html, /<b><a href="\/player\/saka-x">Saka<\/a><\/b> is predicted 9\.1 more points than .*Palmer.* and costs £0\.5m less/);
  assert.ok(comparePairs(model).includes('/compare/madueke-x-vs-palmer-x'));
});

test('IndexNow: only with a key, only from production, and it never throws', async () => {
  assert.equal(indexNowKey({ INDEXNOW_KEY: 'short' }), null);
  assert.equal(indexNowKey({ INDEXNOW_KEY: ' abcdef0123456789 ' }), 'abcdef0123456789');
  assert.equal(indexNowEnabled({ INDEXNOW_KEY: 'abcdef0123456789', VERCEL_ENV: 'preview' }), false);
  assert.equal(indexNowEnabled({ INDEXNOW_KEY: 'abcdef0123456789', VERCEL_ENV: 'production' }), true);
  let body = null;
  const ok = await pingIndexNow(['https://fplchecker.co.uk/fpl-tips'], { env: { INDEXNOW_KEY: 'abcdef0123456789' }, fetchImpl: async (url, opts) => { body = JSON.parse(opts.body); return { ok: true }; } });
  assert.deepEqual(ok, { sent: 1 });
  assert.deepEqual(body, { host: 'fplchecker.co.uk', key: 'abcdef0123456789', keyLocation: 'https://fplchecker.co.uk/indexnow-key.txt', urlList: ['https://fplchecker.co.uk/fpl-tips'] });
  assert.deepEqual(await pingIndexNow(['x'], { env: {}, fetchImpl: () => assert.fail('no key, no call') }), { sent: 0 });
  assert.match((await pingIndexNow(['x'], { env: { INDEXNOW_KEY: 'abcdef0123456789' }, fetchImpl: async () => { throw new Error('down'); } })).error, /down/);
});
