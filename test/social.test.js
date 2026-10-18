import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captainPost, customPost, differentialPost, duePosts, pastResults, previewPost, resultsPost, tweetLength, xIntentUrl } from '../src/lib/social.js';
import { blueskyConfigured, blueskyRecord, postBluesky } from '../src/lib/bluesky.js';
import { markSent, sentKey, sentTo, runSocial } from '../src/lib/socialSent.js';
import { socialDraftEmail } from '../src/lib/emails.js';
import { seoModel } from '../src/lib/seoDynamic.js';
import { fakeRedis } from './helpers/fakeRedis.js';

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
  for (const t of [diff, prev, cap]) assert.ok(tweetLength(t) <= 280 && blueskyRecord(t), t);
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
  assert.deepEqual(duePosts({ now: at(40), season: '2026-27', model, snap, lastFinished }).map(p => [p.key, p.label]), [['2026-27:results:gw7', 'GW7 result'], ['2026-27:differential:gw8', 'GW8 differential']]);
  assert.equal(duePosts({ now: at(-1), season: '2026-27', model, snap, all: true }).length, 3, 'preview shows them all');
});

test('Bluesky posts show links without https://, clickable, with tags, by UTF-8 byte offsets', () => {
  const text = '©️ GW8 £6.5m pick: https://fplchecker.co.uk/player/ødegaard-x\n\n#FPL #FPLCommunity';
  const rec = blueskyRecord(text, '2026-10-15T00:00:00Z');
  assert.equal(rec.text, '©️ GW8 £6.5m pick: fplchecker.co.uk/player/ødegaard-x\n\n#FPL #FPLCommunity');
  const bytes = new TextEncoder().encode(rec.text);
  const slice = f => new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd));
  const [link, tag1, tag2] = rec.facets;
  assert.equal(slice(link), 'fplchecker.co.uk/player/ødegaard-x');
  assert.equal(link.features[0].uri, 'https://fplchecker.co.uk/player/ødegaard-x');
  assert.deepEqual([slice(tag1), tag1.features[0].tag, slice(tag2), tag2.features[0].tag], ['#FPL', 'FPL', '#FPLCommunity', 'FPLCommunity']);
  assert.equal(blueskyRecord('x'.repeat(301)), null, 'over 300 characters');
});

test('posting to Bluesky signs in, attaches a link card, creates the post, then likes and reposts it', async () => {
  const env = { BLUESKY_HANDLE: 'fplchecker.bsky.social', BLUESKY_APP_PASSWORD: 'app-pass' };
  assert.ok(blueskyConfigured(env) && !blueskyConfigured({}));
  const calls = [];
  let failRepost = false;
  const fetchImpl = async (url, opts = {}) => {
    calls.push(url.split('/').pop());
    if (url.endsWith('og-image.png')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
    const reply = { 'com.atproto.server.createSession': { accessJwt: 'jwt', did: 'did:plc:bot' }, 'com.atproto.repo.uploadBlob': { blob: { ref: 'b' } }, 'com.atproto.repo.createRecord': { uri: 'at://post/1', cid: 'cid1' } }[url.split('/').pop()];
    if (url.endsWith('createRecord') && JSON.parse(opts.body).collection !== 'app.bsky.feed.post') {
      const body = JSON.parse(opts.body);
      calls[calls.length - 1] = body.collection;
      assert.deepEqual(body.record.subject, { uri: 'at://post/1', cid: 'cid1' });
      assert.equal(body.record.$type, body.collection);
      assert.equal(body.repo, 'did:plc:bot');
      if (body.collection === 'app.bsky.feed.repost' && failRepost) return { ok: false, status: 500, json: async () => ({ error: 'InternalServerError' }) };
    } else if (url.endsWith('createRecord')) {
      const body = JSON.parse(opts.body);
      assert.equal(opts.headers.Authorization, 'Bearer jwt');
      assert.equal(body.repo, 'did:plc:bot');
      assert.equal(body.record.embed.external.uri, 'https://fplchecker.co.uk/fpl-predictions');
      assert.deepEqual(body.record.embed.external.thumb, { ref: 'b' });
    }
    return { ok: true, json: async () => reply };
  };
  assert.equal(await postBluesky('Preview: https://fplchecker.co.uk/fpl-predictions #FPL', env, fetchImpl), 'at://post/1');
  assert.deepEqual(calls, ['com.atproto.server.createSession', 'og-image.png', 'com.atproto.repo.uploadBlob', 'com.atproto.repo.createRecord', 'app.bsky.feed.like', 'app.bsky.feed.repost']);
  failRepost = true;
  assert.equal(await postBluesky('Preview: https://fplchecker.co.uk/fpl-predictions #FPL', env, fetchImpl), 'at://post/1', 'a failed repost still counts as posted');
  const denied = async () => ({ ok: false, status: 401, json: async () => ({ error: 'AuthenticationRequired', message: 'Invalid identifier or password' }) });
  await assert.rejects(postBluesky('hi', env, denied), /Bluesky com\.atproto\.server\.createSession 401: AuthenticationRequired/);
});

test('an X draft opens X with the post filled in', () => {
  const text = 'GW8 preview & more: https://fplchecker.co.uk #FPL';
  assert.equal(xIntentUrl(text), `https://x.com/intent/post?text=${encodeURIComponent(text)}`);
  const mail = socialDraftEmail({ label: 'GW8 preview', text, intentUrl: xIntentUrl(text), appUrl: 'https://fplchecker.co.uk' });
  assert.equal(mail.subject, 'Post on X: GW8 preview');
  assert.ok(mail.html.includes('GW8 preview &amp; more') && mail.html.includes('href="https://x.com/intent/post?text='));
  assert.ok(mail.text.includes(xIntentUrl(text)));
});

test('each channel gets one due post per run, never the same one twice, and a failed send is tried again', async () => {
  const redis = fakeRedis();
  const sent = { bluesky: [], 'x-draft': [] };
  let failBluesky = true;
  const channels = [
    { name: 'bluesky', send: async post => { if (failBluesky) throw new Error('Bluesky 503'); sent.bluesky.push(post.text); return 'at://1'; } },
    { name: 'x-draft', send: async post => { sent['x-draft'].push(post.text); } },
  ];
  const posts = [{ key: 'a', type: 'results', text: 'one' }, { key: 'b', type: 'preview', text: 'two' }];
  const first = await runSocial({ redis, posts, channels });
  assert.match(first.bluesky.error, /503/);
  assert.deepEqual(first['x-draft'], { sent: 'results', id: null });
  failBluesky = false;
  const second = await runSocial({ redis, posts, channels });
  assert.deepEqual(second, { bluesky: { sent: 'results', id: 'at://1' }, 'x-draft': { sent: 'preview', id: null } });
  await runSocial({ redis, posts, channels });
  assert.deepEqual(await runSocial({ redis, posts, channels }), { bluesky: { sent: null }, 'x-draft': { sent: null } });
  assert.deepEqual(sent, { bluesky: ['one', 'two'], 'x-draft': ['one', 'two'] });
});

test('a one-off post is checked for length, and the same words get the same key', () => {
  const { post } = customPost('  Check out https://fplchecker.co.uk today for the best fpl tips!\r\n\n#FPL #FPLCommunity  ');
  assert.equal(post.text, 'Check out https://fplchecker.co.uk today for the best fpl tips!\n\n#FPL #FPLCommunity');
  assert.match(post.key, /^custom:[0-9a-f]{16}$/);
  assert.equal(customPost(post.text).post.key, post.key);
  assert.notEqual(customPost(`${post.text} #FantasyPL`).post.key, post.key);
  assert.deepEqual(customPost('   '), { error: 'empty' });
  assert.deepEqual(customPost(undefined), { error: 'empty' });
  assert.deepEqual(customPost('x'.repeat(281)), { error: 'too_long_for_x' });
  assert.deepEqual(customPost(`${'x'.repeat(250)} https://fplchecker.co.uk/a-long-path-that-bluesky-counts-in-full`), { error: 'too_long_for_bluesky' });
});

test('a post sent from the admin page counts as sent for the schedule too', async () => {
  const redis = fakeRedis();
  const post = { key: '2026-27:preview:gw8', type: 'preview', text: 'two' };
  const sent = [];
  const bluesky = { name: 'bluesky', send: async p => { sent.push(p.text); } };
  assert.deepEqual(await sentTo(redis, [post], ['bluesky', 'x-draft']), { [post.key]: [] });
  await runSocial({ redis, posts: [post], channels: [bluesky] });
  assert.equal(await redis.get(sentKey('bluesky', post)), '1');
  assert.deepEqual(await sentTo(redis, [post], ['bluesky', 'x-draft']), { [post.key]: ['bluesky'] });
  assert.deepEqual(await runSocial({ redis, posts: [post], channels: [bluesky] }), { bluesky: { sent: null } });
  assert.deepEqual(sent, ['two']);
});

test('a post with a picture attaches it instead of the link card', async () => {
  const env = { BLUESKY_HANDLE: 'h', BLUESKY_APP_PASSWORD: 'p' };
  const calls = [];
  let record = null;
  const fetchImpl = async (url, opts = {}) => {
    calls.push(url.split('/').pop());
    if (url.endsWith('uploadBlob')) assert.equal(opts.headers['Content-Type'], 'image/png');
    if (url.endsWith('createRecord') && JSON.parse(opts.body).collection === 'app.bsky.feed.post') record = JSON.parse(opts.body).record;
    const reply = { 'com.atproto.server.createSession': { accessJwt: 'jwt', did: 'did:plc:bot' }, 'com.atproto.repo.uploadBlob': { blob: { ref: 'img' } }, 'com.atproto.repo.createRecord': { uri: 'at://post/2', cid: 'c' } }[url.split('/').pop()];
    return { ok: true, json: async () => reply };
  };
  await postBluesky('GW8 preview https://fplchecker.co.uk/fpl-predictions', env, fetchImpl, { image: { png: Buffer.from('png'), alt: 'GW8 best XI' } });
  assert.ok(!calls.includes('og-image.png'));
  assert.deepEqual(record.embed, { $type: 'app.bsky.embed.images', images: [{ image: { ref: 'img' }, alt: 'GW8 best XI', aspectRatio: { width: 1200, height: 675 } }] });
  assert.ok(record.facets.some(f => f.features[0].uri === 'https://fplchecker.co.uk/fpl-predictions'), 'the link is still clickable');
});

test('the admin page ticks a post off as done on X, and back', async () => {
  const redis = fakeRedis();
  const key = '2026-27:captain:gw8';
  assert.equal(await markSent(redis, 'x', key, true), true);
  assert.deepEqual(await sentTo(redis, [{ key }], ['bluesky', 'x']), { [key]: ['x'] });
  assert.equal(await markSent(redis, 'x', key, false), true);
  assert.deepEqual(await sentTo(redis, [{ key }], ['bluesky', 'x']), { [key]: [] });
  assert.equal(await markSent(redis, 'x', 'anything:else', true), false, 'only this gameweek’s post keys');
});
