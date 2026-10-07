import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchFplJson } from '../src/lib/fplClient.js';

// Answers each call with the next response in `replies` (a status, or an
// Error to throw), recording the URLs asked for.
function fakeFetch(replies) {
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    return { ok: reply === 200, status: reply, json: async () => ({ ok: true }) };
  };
  return calls;
}
const fast = { retryDelays: [1, 1] };

test('FPL calls that are turned away or time out are tried again', async () => {
  const calls = fakeFetch([429, 502, 200]);
  assert.deepEqual(await fetchFplJson('entry/1/', fast), { ok: true });
  assert.equal(calls.length, 3);
  assert.equal(calls[0], '/api/fpl?path=entry%2F1%2F');
});

test('a dropped connection is tried again too', async () => {
  const calls = fakeFetch([new TypeError('Failed to fetch'), 200]);
  assert.deepEqual(await fetchFplJson('entry/1/', fast), { ok: true });
  assert.equal(calls.length, 2);
});

test('a 404 is an answer, not retried', async () => {
  const calls = fakeFetch([404, 200]);
  await assert.rejects(fetchFplJson('entry/1/', fast), { message: 'status 404' });
  assert.equal(calls.length, 1);
});

test('it gives up after the last retry with the last status', async () => {
  const calls = fakeFetch([503]);
  await assert.rejects(fetchFplJson('entry/1/', fast), { message: 'status 503' });
  assert.equal(calls.length, 3);
});
