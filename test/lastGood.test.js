import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler, { MAX_ENTRY_FETCHES_PER_IP } from '../api/fpl.js';
import { MAX_AGE_MS, SAVE_EVERY_MS, readLastGood, saveLastGood } from '../src/lib/lastGood.js';
import { fakeRedis } from './helpers/fakeRedis.js';

// The fake Redis ignores SET's EX option; that's fine here.
function call(path, fetchImpl, redis) {
  return new Promise(resolve => {
    const res = {
      headers: {}, statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      send(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); },
      json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); },
    };
    handler({ query: { path } }, res, fetchImpl, redis);
  });
}
const ok = text => async () => ({ ok: true, status: 200, text: async () => text });
const down = status => async () => ({ ok: false, status, text: async () => '<html>The game is being updated</html>' });

test('saves at most every 10 minutes and reads back what was saved', async () => {
  const redis = fakeRedis();
  assert.equal(await saveLastGood(redis, 'x', '{"a":1}', 1000), true);
  assert.equal(await saveLastGood(redis, 'x', '{"a":2}', 1000 + SAVE_EVERY_MS - 1), false, 'too soon');
  assert.deepEqual(await readLastGood(redis, 'x', 2000), { text: '{"a":1}', at: 1000 });
  assert.equal(await saveLastGood(redis, 'x', '{"a":3}', 1000 + SAVE_EVERY_MS), true);
  assert.equal((await readLastGood(redis, 'x', 1000 + SAVE_EVERY_MS)).text, '{"a":3}');
  assert.equal(await readLastGood(redis, 'x', 1000 + SAVE_EVERY_MS + MAX_AGE_MS + 1), null, 'too old to show');
});

test('when FPL is down, the proxy serves the last good bootstrap with its time', async () => {
  const redis = fakeRedis();
  const fresh = await call('bootstrap-static/', ok('{"events":[1]}'), redis);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.headers['X-Fpl-Stale-At'], undefined);

  const stale = await call('bootstrap-static/', down(503), redis);
  assert.equal(stale.status, 200);
  assert.equal(stale.body, '{"events":[1]}');
  assert.match(stale.headers['X-Fpl-Stale-At'], /^\d{4}-\d\d-\d\dT/);
  assert.match(stale.headers['Cache-Control'], /s-maxage=60/, 'only cached briefly');

  const thrown = await call('bootstrap-static/', async () => { throw new Error('timeout'); }, redis);
  assert.equal(thrown.status, 200, 'a timeout falls back too');
});

test('no saved copy, or a team-specific path: the error goes through', async () => {
  const redis = fakeRedis();
  assert.equal((await call('fixtures/', down(503), redis)).status, 503);
  await call('entry/123/', ok('{"id":123}'), redis);
  assert.equal((await call('entry/123/', down(503), redis)).status, 503, 'team data isn’t kept');
  assert.equal((await call('entry/123/', ok('{}'), null)).status, 200, 'works without storage');
  assert.equal((await call('entry/999/', async () => ({ ok: false, status: 404, text: async () => '"not found"' }), redis)).status, 404);
});

test('caps per-entry fetches per IP, but never the shared hot path', async () => {
  const redis = fakeRedis();
  // Up to the cap, per-entry requests go through.
  for (let i = 0; i < MAX_ENTRY_FETCHES_PER_IP; i++) {
    assert.equal((await call('entry/1234567/', ok('{"id":1}'), redis)).status, 200, `request ${i}`);
  }
  // The next one from the same IP is refused.
  const limited = await call('entry/1234567/', ok('{"id":1}'), redis);
  assert.equal(limited.status, 429, 'enumeration is capped');
  assert.equal(limited.body.error, 'rate_limited');
  // The shared, edge-cached hot path is never limited, even past the cap.
  assert.equal((await call('bootstrap-static/', ok('{"events":[]}'), redis)).status, 200);
});
