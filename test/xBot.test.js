import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captainPost, differentialPost, duePosts, oauthHeader, pastResults, previewPost, resultsPost, runSocial, tweetLength, xConfigured } from '../src/lib/xBot.js';
import { seoModel } from '../src/lib/seoDynamic.js';
import { fakeRedis } from './helpers/fakeRedis.js';

test('OAuth 1.0a signature matches X’s documented example', () => {
  const header = oauthHeader({
    method: 'POST', url: 'https://api.twitter.com/1.1/statuses/update.json',
    params: { include_entities: 'true', status: 'Hello Ladies + Gentlemen, a signed OAuth request!' },
    consumerKey: 'xvz1evFS4wEEPTGEFPHBog', consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
    nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg', timestamp: 1318622958,
  });
  assert.match(header, /oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"/);
  assert.ok(header.startsWith('OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"'));
});

test('links count as 23 characters', () => {
  assert.equal(tweetLength('see https://fplchecker.co.uk/player/a-very-long-player-name-here'), 4 + 23);
  assert.equal(tweetLength('©️ ✅'), 4);
});

const el = (id, web, team, pos, cost, selected, extra = {}) => ({ id, first_name: web, second_name: 'X', web_name: web, team, element_type: pos, now_cost: cost, selected_by_percent: String(selected), status: 'a', ...extra });
const bootstrap = {
  teams: [{ id: 1, name: 'Arsenal', short_name: 'ARS' }, { id: 2, name: 'Chelsea', short_name: 'CHE' }],
  elements: [
    el(1, 'Saka', 1, 3, 100, 40), el(2, 'Palmer', 2, 3, 105, 55), el(3, 'Madueke', 2, 3, 65, 4.2),
    el(4, 'Hurt', 1, 4, 80, 2, { status: 'i' }), ...Array.from({ length: 11 }, (_, i) => el(10 + i, `P${i}`, 1 + (i % 2), 2, 45, 20)),
  ],
};
const fixtures = [{ event: 8, team_h: 1, team_a: 2, team_h_difficulty: 3, team_a_difficulty: 4, finished: false }];
const event = { id: 8, name: 'Gameweek 8', deadline_time: '2026-10-17T10:00:00Z' };
const predictedById = { 1: 6.8, 2: 7.2, 3: 5.9, 4: 9.9, ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => [10 + i, 3])) };
const model = seoModel({ bootstrap, fixtures, event, saved: { predictedById } });
const snap = { gwId: 8, startingIds: [1, 2, 3, 10, 11, 12, 13, 14, 15, 16, 17], captainId: 2 };

test('each post reads right, links to the site and fits', () => {
  const diff = differentialPost(model);
  assert.match(diff, /GW8 differential: Madueke \(CHE, £6\.5m\) is in only 4\.2% of teams but is predicted 5\.9 pts @ ARS, 3rd of all midfielders/);
  assert.match(diff, /https:\/\/fplchecker\.co\.uk\/player\/madueke-x/);
  const prev = previewPost(model, snap);
  assert.match(prev, /Best £100m XI: 51\.1 pts, captain Palmer/, '7.2+6.8+5.9+8×3 = 43.9, captain doubled');
  assert.match(prev, /Top picks: Palmer 7\.2, Saka 6\.8, Madueke 5\.9/, 'an injured player isn’t a pick');
  const cap = captainPost(model);
  assert.match(cap, /1\. Palmer 7\.2 \(@ ARS\)\n2\. Saka 6\.8 \(v CHE\)/);
  assert.match(cap, /Deadline Sat 11:00/);
  for (const t of [diff, prev, cap]) assert.ok(tweetLength(t) <= 280, t);
});

test('results compare the best XI’s prediction with its score, captain doubled', () => {
  const past = pastResults(7, {
    saved: { predictedById: { 1: 5, 2: 6 } }, snap: { startingIds: [1, 2], captainId: 2 },
    live: [{ id: 1, stats: { total_points: 12 } }, { id: 2, stats: { total_points: 2 } }], names: { 1: 'Saka', 2: 'Palmer' },
  });
  assert.deepEqual(past, { gwId: 7, xiPredicted: 17, xiScored: 16, top: { name: 'Saka', actual: 12, predicted: 5 } });
  assert.match(resultsPost(past), /GW7 done\. Our best XI was predicted 17\.0 pts and scored 16\.\nTop scorer: Saka 12 \(predicted 5\.0\)/);
  assert.equal(pastResults(7, { saved: null, snap: null, live: [], names: {} }), null);
});

test('posts are due in their windows before the deadline, and none after it', () => {
  const at = h => Date.parse(event.deadline_time) - h * 3600_000;
  const types = h => duePosts({ now: at(h), season: '2026-27', model, snap }).map(p => p.type);
  assert.deepEqual(types(60), []);
  assert.deepEqual(types(40), ['differential']);
  assert.deepEqual(types(20), ['preview']);
  assert.deepEqual(types(3), ['captain']);
  assert.deepEqual(types(-1), []);
  const lastFinished = { gwId: 7, xiPredicted: 50, xiScored: 60, top: null };
  assert.deepEqual(duePosts({ now: at(40), season: '2026-27', model, snap, lastFinished }).map(p => p.key), ['x:posted:2026-27:results:gw7', 'x:posted:2026-27:differential:gw8']);
  assert.equal(duePosts({ now: at(-1), season: '2026-27', model, snap, all: true }).length, 3, 'preview shows them all');
});

test('one post per run, never the same one twice, and a failed post is tried again', async () => {
  const redis = fakeRedis();
  const env = { X_API_KEY: 'k', X_API_SECRET: 's', X_ACCESS_TOKEN: 't', X_ACCESS_TOKEN_SECRET: 'ts' };
  assert.ok(xConfigured(env) && !xConfigured({}));
  const sent = [];
  let fail = true;
  const fetchImpl = async (url, opts) => {
    assert.match(opts.headers.Authorization, /^OAuth .*oauth_signature="/);
    if (fail) return { ok: false, status: 503, json: async () => ({ title: 'Service Unavailable' }) };
    sent.push(JSON.parse(opts.body).text);
    return { ok: true, status: 201, json: async () => ({ data: { id: String(sent.length) } }) };
  };
  const posts = [{ key: 'a', type: 'results', text: 'one' }, { key: 'b', type: 'preview', text: 'two' }];
  assert.match((await runSocial({ redis, posts, env, fetchImpl })).error, /X 503/);
  fail = false;
  assert.deepEqual(await runSocial({ redis, posts, env, fetchImpl }), { posted: 'results', id: '1' });
  assert.deepEqual(await runSocial({ redis, posts, env, fetchImpl }), { posted: 'preview', id: '2' });
  assert.deepEqual(await runSocial({ redis, posts, env, fetchImpl }), { posted: null });
  assert.deepEqual(sent, ['one', 'two']);
});
