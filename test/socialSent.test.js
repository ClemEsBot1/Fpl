import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markSent, sentKey, sentTo, runSocial } from '../src/lib/socialSent.js';
import { fakeRedis } from './helpers/fakeRedis.js';

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

test('the admin page ticks a post off as done on X, and back', async () => {
  const redis = fakeRedis();
  const key = '2026-27:captain:gw8';
  assert.equal(await markSent(redis, 'x', key, true), true);
  assert.deepEqual(await sentTo(redis, [{ key }], ['bluesky', 'x']), { [key]: ['x'] });
  assert.equal(await markSent(redis, 'x', key, false), true);
  assert.deepEqual(await sentTo(redis, [{ key }], ['bluesky', 'x']), { [key]: [] });
  assert.equal(await markSent(redis, 'x', 'anything:else', true), false, 'only this gameweek’s post keys');
});
