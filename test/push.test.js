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
