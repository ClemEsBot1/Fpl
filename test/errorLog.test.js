import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { recordError, recentErrors, clearErrors } from '../src/lib/errorLog.js';
import { fakeRedis } from './helpers/fakeRedis.js';

let redis;
beforeEach(() => { redis = fakeRedis(); });

test('errors are stored newest first and read back', async () => {
  await recordError(redis, 'auth', new Error('first'));
  await recordError(redis, 'teams', new Error('second'));
  const list = await recentErrors(redis);
  assert.equal(list.length, 2);
  assert.equal(list[0].where, 'teams');
  assert.equal(list[0].message, 'second');
  assert.ok(list[0].at);
});

test('the log is capped at 50 entries', async () => {
  for (let i = 0; i < 60; i++) await recordError(redis, 'auth', new Error(`e${i}`));
  const list = await recentErrors(redis, 100);
  assert.equal(list.length, 50);
  assert.equal(list[0].message, 'e59', 'the newest survives');
});

test('where and message are bounded', async () => {
  await recordError(redis, 'x'.repeat(200), new Error('y'.repeat(500)));
  const [e] = await recentErrors(redis);
  assert.equal(e.where.length, 60);
  assert.equal(e.message.length, 300);
});

test('recording never throws when the store is missing or broken', async () => {
  await recordError(null, 'auth', new Error('x')); // no redis
  const broken = { async lpush() { throw new Error('down'); } };
  await recordError(broken, 'auth', new Error('x'));
  assert.deepEqual(await recentErrors(null), []);
});

test('clear empties the log', async () => {
  await recordError(redis, 'auth', new Error('x'));
  await clearErrors(redis);
  assert.deepEqual(await recentErrors(redis), []);
});
