import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extensionFeed, FEED_VERSION } from '../src/lib/extensionFeed.js';
import { seoModel } from '../src/lib/seoDynamic.js';
import '../extension/lib.js';

const { indexFeed, squadSummary, topPicks, searchPlayers, siteLink, playerLink, entryFromPath, fmt } = globalThis.fplc;
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

const el = (id, web, team, pos, cost, extra = {}) => ({ id, first_name: web, second_name: 'X', web_name: web, team, element_type: pos, now_cost: cost, selected_by_percent: '10.0', status: 'a', news: '', ...extra });
const teams = [{ id: 1, name: 'Arsenal', short_name: 'ARS' }, { id: 2, name: 'Chelsea', short_name: 'CHE' }];
const elements = [el(1, 'Saka', 1, 3, 100), el(2, 'Palmer', 2, 3, 105), el(3, 'Hurt', 1, 4, 80, { status: 'd', news: 'Knock - 50% chance of playing', chance_of_playing_next_round: 50 }), el(4, 'Nopred', 2, 2, 45)];
const fixtures = [8, 9, 10, 11, 12].map(gw => ({ event: gw, team_h: 1, team_a: 2, team_h_difficulty: 2, team_a_difficulty: 4, finished: false }));
const event = { id: 8, name: 'Gameweek 8', deadline_time: '2026-10-17T10:00:00Z' };
const saved = { predictedById: { 1: 6.84, 2: 7.2, 3: 5 }, byGwById: { 1: [6.84, 5, 5, 5, 5], 2: [7.2, 7, 7, 7, 7], 3: [5, 5, 5, 5, 5] } };
const model = seoModel({ bootstrap: { teams, elements }, fixtures, event, saved });

test('the extension feed has each predicted player’s next five gameweeks and this week’s fixture', () => {
  const feed = extensionFeed(model, { gwId: 8, startingIds: [1, 2], captainId: 2 }, '2026-10-15T06:00:00Z');
  assert.equal(feed.v, FEED_VERSION);
  assert.equal(feed.gw, 8);
  assert.equal(feed.gwName, 'Gameweek 8');
  assert.equal(feed.players.length, 3, 'a player without a prediction is left out');
  const saka = feed.players.find(p => p.id === 1);
  assert.deepEqual(saka.pts, [6.8, 5, 5, 5, 5]);
  assert.equal(saka.fx, 'CHE (H)');
  assert.equal(saka.slug, 'saka-x');
  assert.equal(saka.status, undefined, 'news only for a player who might not play');
  const hurt = feed.players.find(p => p.id === 3);
  assert.equal(hurt.status, 'd');
  assert.equal(hurt.chance, 50);
  assert.match(hurt.news, /Knock/);
  assert.deepEqual(feed.best, { xi: [1, 2], captainId: 2 });
  assert.equal(extensionFeed(model, { gwId: 7, startingIds: [1] }).best, null, 'an old best squad isn’t this week’s');
});

const feed = {
  gwName: 'Gameweek 8',
  players: [
    { id: 1, slug: 'saka', name: 'Saka', team: 'ARS', pos: 3, pts: [6, 5, 5, 5, 5], fx: 'CHE (H)' },
    { id: 2, slug: 'palmer', name: 'Palmer', team: 'CHE', pos: 3, pts: [7, 7, 7, 7, 7], fx: 'ARS (A)' },
    { id: 3, name: 'Hurt', team: 'ARS', pos: 4, pts: [9, 5, 5, 5, 5], fx: 'CHE (H)', status: 'd', chance: 50 },
    { id: 4, name: 'Gabriel', team: 'ARS', pos: 2, pts: [4, 4, 4, 4, 4], fx: 'CHE (H)' },
    { id: 5, name: 'Gabriel', team: 'ARS', pos: 3, pts: [3, 3, 3, 3, 3], fx: 'CHE (H)' },
    { id: 6, name: 'Bench', team: 'CHE', pos: 1, pts: [10, 1, 1, 1, 1], fx: 'ARS (A)' },
    { id: 7, name: 'Müller', team: 'CHE', pos: 3, pts: [2, 2, 2, 2, 2], fx: '' },
  ],
};
const index = indexFeed(feed);
const pick = (element, position, extra = {}) => ({ element, position, multiplier: position <= 11 ? 1 : 0, is_captain: false, ...extra });

test('a shared FPL name isn’t matched to either player', () => {
  assert.equal(index.byName.get('Saka').id, 1);
  assert.equal(index.byName.get('Gabriel'), null);
  assert.equal(index.byName.has('Nobody'), false);
});

test('a squad’s predicted XI counts the captain twice, leaves out the bench and finds a better captain', () => {
  const picks = [pick(1, 1, { is_captain: true, multiplier: 2 }), pick(2, 2), pick(3, 3), pick(6, 12)];
  const s = squadSummary(index, picks);
  assert.equal(s.xiTotal, 6 + 7 + 9 + 6, 'captain Saka doubled, bench keeper left out');
  assert.equal(s.captain.name, 'Saka');
  assert.equal(s.bestCaptain.name, 'Palmer', 'a doubtful player isn’t suggested, nor one on the bench');
  assert.equal(s.captainGain, 1);
  assert.equal(s.rows[3].starting, false);
  const tc = squadSummary(index, [pick(2, 1, { is_captain: true, multiplier: 3 }), pick(1, 2)]);
  assert.equal(tc.xiTotal, 7 * 3 + 6, 'Triple Captain counts three times');
  assert.equal(tc.captainGain, 0);
  assert.equal(squadSummary(index, [pick(99, 1)]).xiTotal, 0, 'a player missing from the feed counts nothing');
});

test('top picks skip doubtful and blank players; search ignores accents and matches a club', () => {
  assert.deepEqual(topPicks(feed, 2).map(p => p.name), ['Bench', 'Palmer']);
  assert.ok(!topPicks(feed, 10).some(p => p.name === 'Hurt' || p.name === 'Müller'));
  assert.deepEqual(searchPlayers(feed, 'muller').map(p => p.id), [7]);
  assert.deepEqual(searchPlayers(feed, 'che').map(p => p.id), [6, 2, 7]);
  assert.deepEqual(searchPlayers(feed, '  '), []);
});

test('links and team ids are checked before use', () => {
  assert.equal(siteLink('123'), 'https://fplchecker.co.uk/?team=123&utm_source=fpl-extension');
  assert.equal(siteLink('12"><x'), 'https://fplchecker.co.uk/?utm_source=fpl-extension');
  assert.equal(siteLink(null), 'https://fplchecker.co.uk/?utm_source=fpl-extension');
  assert.equal(playerLink({ slug: 'saka' }), 'https://fplchecker.co.uk/player/saka?utm_source=fpl-extension');
  assert.equal(playerLink({ slug: '../x' }), 'https://fplchecker.co.uk/fpl-players?utm_source=fpl-extension');
  assert.equal(entryFromPath('/entry/4567/event/8'), '4567');
  assert.equal(entryFromPath('/entry/4567'), '4567');
  assert.equal(entryFromPath('/my-team'), null);
  assert.equal(fmt(6.84), '6.8');
});

test('the manifest asks for as little as it needs, and every file it names exists', () => {
  const m = JSON.parse(read('extension/manifest.json'));
  assert.equal(m.manifest_version, 3);
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
  assert.ok(m.description.length <= 132, 'the Chrome Web Store limit');
  assert.ok(m.name.length <= 75);
  assert.deepEqual(m.permissions, ['storage']);
  assert.deepEqual(m.host_permissions, ['https://fplchecker.co.uk/*', 'https://www.fplchecker.co.uk/*']);
  assert.deepEqual(m.content_scripts.map(c => c.matches), [['https://fantasy.premierleague.com/*']]);
  const files = [...Object.values(m.icons), m.action.default_popup, ...Object.values(m.action.default_icon), m.background.service_worker,
    ...m.content_scripts.flatMap(c => [...c.js, ...c.css]), ...m.web_accessible_resources.flatMap(w => w.resources)];
  for (const f of files) assert.ok(fs.existsSync(new URL(`../extension/${f}`, import.meta.url)), f);
  for (const f of ['lib.js', 'popup.js', 'popup.css', 'icons/icon-32.png']) assert.ok(read('extension/popup.html').includes(f), f);
});

test('the extension never parses data as HTML and only fetches its own feed and FPL', () => {
  for (const f of ['content.js', 'popup.js', 'background.js', 'lib.js']) {
    const src = read(`extension/${f}`);
    assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/, f);
  }
  assert.match(read('extension/background.js'), /https:\/\/fplchecker\.co\.uk\/ext\/predictions\.json/);
  const rewrites = JSON.parse(read('vercel.json')).rewrites;
  assert.ok(rewrites.some(r => r.source === '/ext/predictions.json' && r.destination === '/api/optimal-squad?page=ext'));
});
