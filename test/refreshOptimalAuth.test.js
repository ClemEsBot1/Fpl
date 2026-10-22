import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/refresh-optimal.js';

// Drives only the auth gate: a wrong or missing bearer is rejected before
// the handler touches the network or storage, so no FPL fetch runs here.
function call(authorization) {
  return new Promise(resolve => {
    const res = {
      statusCode: 200,
      setHeader() { return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); },
      end() { resolve({ status: this.statusCode }); },
    };
    const headers = authorization == null ? {} : { authorization };
    handler({ headers, query: {} }, res);
  });
}

test('the cron endpoint rejects a wrong or missing bearer token', async () => {
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'correct-horse-battery-staple';
  try {
    assert.equal((await call(undefined)).status, 401, 'no header');
    assert.equal((await call('Bearer wrong')).status, 401, 'wrong secret');
    assert.equal((await call('Bearer correct-horse-battery-stapl')).status, 401, 'off by one char');
    assert.equal((await call('correct-horse-battery-staple')).status, 401, 'no Bearer prefix');
  } finally {
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  }
});

test('the cron endpoint rejects when no secret is configured', async () => {
  const prev = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    assert.equal((await call('Bearer anything')).status, 401);
  } finally {
    if (prev !== undefined) process.env.CRON_SECRET = prev;
  }
});
