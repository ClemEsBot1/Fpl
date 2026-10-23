import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPlayerIds, cleanSubscription, pushHandler, subscriptionKey } from '../src/lib/push.js';
import { fakeRedis } from './helpers/fakeRedis.js';

const ENV = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', CRON_SECRET: 'cron' };
const SUB = { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'p', auth: 'a' } };
const NOW = Date.parse('2026-10-08T12:00:00Z');

function call(query, { method = 'POST', body = {}, headers = { 'content-type': 'application/json' }, ...deps } = {}) {
  const res = { statusCode: 0, body: null, headers: {} };
  res.status = code => { res.statusCode = code; return res; };
  res.json = value => { res.body = value; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  return pushHandler({ method, query, body, headers, socket: { remoteAddress: '1.2.3.4' } }, res, { env: ENV, ...deps }).then(() => res);
}

test('subscriptions and player ids are checked', () => {
  assert.deepEqual(cleanSubscription(SUB), SUB);
  assert.equal(cleanSubscription({ ...SUB, endpoint: 'http://push.example.com/abc' }), null, 'https only');
  assert.equal(cleanSubscription({ endpoint: SUB.endpoint }), null, 'keys needed');
  assert.deepEqual(cleanPlayerIds([3, '4', 3, -1, 'x', 2.5]), [3, 4]);
  assert.equal(cleanPlayerIds(Array.from({ length: 30 }, (_, i) => i + 1)).length, 15);
});

test('push is off until its keys are set', async () => {
  const res = await call({ push: 'key' }, { method: 'GET', env: {} });
  assert.equal(res.statusCode, 404);
  const on = await call({ push: 'key' }, { method: 'GET' });
  assert.deepEqual(on.body, { publicKey: 'pub' });
});

test('subscribe, send each alert once, drop a gone subscription', async () => {
  const redis = fakeRedis();
  assert.equal((await call({ push: 'subscribe' }, { redis, body: { subscription: SUB, playerIds: [7] } })).statusCode, 200);
  const staticData = {
    targetEvent: { id: 8, name: 'Gameweek 8', deadline_time: new Date(NOW + 5 * 3600e3).toISOString() },
    playersById: { 7: { id: 7, webName: 'Isak', status: 'i', news: 'Hamstring' } },
    predictionsById: { 7: { availNote: 'Injured' } },
  };
  const sent = [];
  const sender = { sendNotification: async (sub, payload) => { sent.push([sub.endpoint, JSON.parse(payload).tag]); } };
  assert.equal((await call({ push: 'send' }, { redis, sender, staticData, now: NOW })).statusCode, 401, 'needs the cron secret');
  const auth = { 'content-type': 'application/json', authorization: 'Bearer cron' };
  const first = await call({ push: 'send' }, { redis, sender, staticData, now: NOW, headers: auth });
  assert.deepEqual(first.body, { ok: true, sent: 2, removed: 0 });
  assert.equal(sent[0][1], 'deadline-8-24h');
  assert.match(sent[1][1], /^news-7-/);
  const again = await call({ push: 'send' }, { redis, sender, staticData, now: NOW, headers: auth });
  assert.deepEqual(again.body, { ok: true, sent: 0, removed: 0 }, 'each alert once');
  // Resubscribing (a new squad) keeps what was sent.
  await call({ push: 'subscribe' }, { redis, body: { subscription: SUB, playerIds: [7, 9] } });
  assert.equal(JSON.parse(await redis.get(subscriptionKey(SUB.endpoint))).sent.length, 2);
  const goneSender = { sendNotification: async () => { const e = new Error('gone'); e.statusCode = 410; throw e; } };
  const later = await call({ push: 'send' }, { redis, sender: goneSender, staticData, now: NOW + 4 * 3600e3, headers: auth });
  assert.deepEqual(later.body, { ok: true, sent: 0, removed: 1 });
  assert.equal(await redis.get(subscriptionKey(SUB.endpoint)), null);
});

test('unsubscribe removes it; requests must be JSON', async () => {
  const redis = fakeRedis();
  await call({ push: 'subscribe' }, { redis, body: { subscription: SUB, playerIds: [1] } });
  assert.equal((await call({ push: 'unsubscribe' }, { redis, body: { endpoint: SUB.endpoint }, headers: {} })).statusCode, 415);
  await call({ push: 'unsubscribe' }, { redis, body: { endpoint: SUB.endpoint } });
  assert.equal(await redis.get(subscriptionKey(SUB.endpoint)), null);
});

test('pushed alerts flag a prediction drop against the first figure the server saw', async () => {
  const redis = fakeRedis();
  await call({ push: 'subscribe' }, { redis, body: { subscription: SUB, playerIds: [7] } });
  const staticFor = pts => ({
    targetEvent: { id: 8, name: 'Gameweek 8', deadline_time: new Date(NOW + 48 * 3600e3).toISOString() },
    playersById: { 7: { id: 7, webName: 'Isak', status: 'a' } },
    predictionsById: { 7: { nextMatchPredicted: pts } },
  });
  const sent = [];
  const sender = { sendNotification: async (sub, payload) => { sent.push(JSON.parse(payload).tag); } };
  const auth = { 'content-type': 'application/json', authorization: 'Bearer cron' };
  await call({ push: 'send' }, { redis, sender, staticData: staticFor(6), now: NOW, headers: auth });
  assert.deepEqual(sent, []);
  await call({ push: 'send' }, { redis, sender, staticData: staticFor(2), now: NOW, headers: auth });
  assert.deepEqual(sent, ['drop-7-8-2']);
});

test('the 2h deadline push says when the team has made no transfer yet', async () => {
  const redis = fakeRedis();
  await call({ push: 'subscribe' }, { redis, body: { subscription: SUB, playerIds: [], teamId: 123 } });
  assert.equal(JSON.parse(await redis.get(subscriptionKey(SUB.endpoint))).teamId, 123);
  const staticData = { targetEvent: { id: 8, name: 'Gameweek 8', deadline_time: new Date(NOW + 3600e3).toISOString() }, playersById: {}, predictionsById: {} };
  const bodies = [];
  const sender = { sendNotification: async (sub, payload) => { bodies.push(JSON.parse(payload).body); } };
  const auth = { 'content-type': 'application/json', authorization: 'Bearer cron' };
  const asked = [];
  const fetchTransfers = async id => { asked.push(id); return [{ event: 7 }]; };
  await call({ push: 'send' }, { redis, sender, staticData, now: NOW, headers: auth, fetchTransfers });
  assert.deepEqual(asked, [123]);
  assert.match(bodies[0], /^You haven't made a transfer for Gameweek 8 yet\./);
  // Already transferred: the plain reminder.
  const redis2 = fakeRedis();
  await call({ push: 'subscribe' }, { redis: redis2, body: { subscription: SUB, playerIds: [], teamId: 123 } });
  await call({ push: 'send' }, { redis: redis2, sender, staticData, now: NOW, headers: auth, fetchTransfers: async () => [{ event: 8 }] });
  assert.doesNotMatch(bodies[1], /haven't made/);
});

test('a send run never undoes a subscribe or unsubscribe that lands while it sends', async () => {
  const staticData = {
    targetEvent: { id: 8, name: 'Gameweek 8', deadline_time: new Date(NOW + 5 * 3600e3).toISOString() },
    playersById: {}, predictionsById: {},
  };
  const auth = { 'content-type': 'application/json', authorization: 'Bearer cron' };
  const key = subscriptionKey(SUB.endpoint);

  // A new squad saved mid-send keeps its players.
  const redis = fakeRedis();
  await call({ push: 'subscribe' }, { redis, body: { subscription: SUB, playerIds: [1] } });
  const resubscribe = { sendNotification: async () => { await call({ push: 'subscribe' }, { redis, body: { subscription: SUB, playerIds: [2, 3] } }); } };
  await call({ push: 'send' }, { redis, sender: resubscribe, staticData, now: NOW, headers: auth });
  const after = JSON.parse(await redis.get(key));
  assert.deepEqual(after.playerIds, [2, 3]);
  assert.deepEqual(after.sent, ['deadline-8-24h']);

  // An unsubscribe mid-send stays unsubscribed.
  const redis2 = fakeRedis();
  await call({ push: 'subscribe' }, { redis: redis2, body: { subscription: SUB, playerIds: [1] } });
  const unsubscribe = { sendNotification: async () => { await call({ push: 'unsubscribe' }, { redis: redis2, body: { endpoint: SUB.endpoint } }); } };
  await call({ push: 'send' }, { redis: redis2, sender: unsubscribe, staticData, now: NOW, headers: auth });
  assert.equal(await redis2.get(key), null);
});

test('pushes go out in the language the subscriber chose', async () => {
  const redis = fakeRedis();
  await call({ push: 'subscribe' }, { redis, body: { subscription: SUB, playerIds: [], lang: 'fr' } });
  assert.equal(JSON.parse(await redis.get(subscriptionKey(SUB.endpoint))).lang, 'fr');
  const staticData = { targetEvent: { id: 8, name: 'Gameweek 8', deadline_time: new Date(NOW + 3600e3).toISOString() }, playersById: {}, predictionsById: {} };
  const titles = [];
  const sender = { sendNotification: async (sub, payload) => { titles.push(JSON.parse(payload).title); } };
  const auth = { 'content-type': 'application/json', authorization: 'Bearer cron' };
  await call({ push: 'send' }, { redis, sender, staticData, now: NOW, headers: auth });
  assert.ok(titles.length && titles.every(x => x.includes('Journée 8')), titles.join(' | '));
  const redis2 = fakeRedis();
  await call({ push: 'subscribe' }, { redis: redis2, body: { subscription: SUB, playerIds: [], lang: 'xx' } });
  assert.equal(JSON.parse(await redis2.get(subscriptionKey(SUB.endpoint))).lang, undefined);
});

test('watched players are stored with the subscription and pushed too', async () => {
  const redis = fakeRedis();
  await call({ push: 'subscribe' }, { redis, body: { subscription: SUB, playerIds: [], watchIds: [5, 'x', 5] } });
  assert.deepEqual(JSON.parse(await redis.get(subscriptionKey(SUB.endpoint))).watchIds, [5]);
  const staticData = {
    targetEvent: { id: 8, name: 'Gameweek 8', deadline_time: new Date(NOW + 72 * 3600e3).toISOString() },
    playersById: { 5: { id: 5, webName: 'Saka', status: 'a', priceChangePercent: 97 } },
    predictionsById: { 5: {} },
  };
  const sent = [];
  const sender = { sendNotification: async (sub, payload) => { sent.push(JSON.parse(payload).tag); } };
  await call({ push: 'send' }, { redis, sender, staticData, now: NOW, headers: { 'content-type': 'application/json', authorization: 'Bearer cron' } });
  assert.deepEqual(sent, ['watch-rise-5-2026-10-08']);
  await call({ push: 'subscribe' }, { redis, body: { subscription: SUB, playerIds: [] } });
  assert.equal(JSON.parse(await redis.get(subscriptionKey(SUB.endpoint))).watchIds, undefined, 'an emptied watchlist is cleared');
});
