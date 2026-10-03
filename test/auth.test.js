import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler, { MAX_FAILED_LOGINS_PER_USER, MAX_FAILED_LOGINS_PER_IP, MAX_REGISTRATIONS_PER_IP } from '../api/auth.js';
import { validatePassword } from '../src/lib/auth.js';

process.env.JWT_SECRET = 'test-secret';

// In-memory stand-in for the ioredis calls the handlers use.
function fakeRedis() {
  const data = new Map();
  return {
    async get(k) { return data.has(k) ? data.get(k) : null; },
    async set(k, v) { data.set(k, String(v)); },
    async incr(k) { const n = Number(data.get(k) || 0) + 1; data.set(k, String(n)); return n; },
    async expire() { return 1; },
    async del(k) { data.delete(k); },
  };
}

function call(redis, body, ip = '203.0.113.1') {
  return new Promise(resolve => {
    const res = {
      headers: {},
      statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); },
    };
    handler({ method: 'POST', body, headers: { 'x-forwarded-for': ip } }, res, redis);
  });
}

let redis;
beforeEach(async () => {
  redis = fakeRedis();
  const r = await call(redis, { action: 'register', username: 'clem', password: 'correct-horse' }, '198.51.100.9');
  assert.equal(r.status, 200);
});

test('new passwords need at least 8 characters', async () => {
  assert.equal(validatePassword('1234567').ok, false);
  assert.equal(validatePassword('12345678').ok, true);
  const r = await call(redis, { action: 'register', username: 'shorty', password: 'abc123' });
  assert.equal(r.status, 400);
});

test('correct password logs in and sets a session cookie', async () => {
  const r = await call(redis, { action: 'login', username: 'clem', password: 'correct-horse' });
  assert.equal(r.status, 200);
  assert.match(r.headers['Set-Cookie'], /HttpOnly/);
});

test('an account locks after too many wrong passwords, even with the right one', async () => {
  for (let i = 0; i < MAX_FAILED_LOGINS_PER_USER; i++) {
    const r = await call(redis, { action: 'login', username: 'clem', password: 'wrong' }, `192.0.2.${i}`);
    assert.equal(r.status, 401);
  }
  const blocked = await call(redis, { action: 'login', username: 'CLEM', password: 'correct-horse' });
  assert.equal(blocked.status, 429, 'usernames are case-insensitive, so the limit is too');
});

test('a successful login clears earlier failures', async () => {
  for (let i = 0; i < MAX_FAILED_LOGINS_PER_USER - 1; i++) await call(redis, { action: 'login', username: 'clem', password: 'wrong' });
  assert.equal((await call(redis, { action: 'login', username: 'clem', password: 'correct-horse' })).status, 200);
  assert.equal((await call(redis, { action: 'login', username: 'clem', password: 'wrong' })).status, 401);
  assert.equal((await call(redis, { action: 'login', username: 'clem', password: 'correct-horse' })).status, 200);
});

test('one IP guessing across many accounts gets blocked', async () => {
  for (let i = 0; i < MAX_FAILED_LOGINS_PER_IP; i++) {
    await call(redis, { action: 'login', username: `user${i}`, password: 'wrong' }, '203.0.113.50');
  }
  const r = await call(redis, { action: 'login', username: 'clem', password: 'correct-horse' }, '203.0.113.50');
  assert.equal(r.status, 429);
  const elsewhere = await call(redis, { action: 'login', username: 'clem', password: 'correct-horse' }, '203.0.113.51');
  assert.equal(elsewhere.status, 200);
});

test('sign-ups per IP are capped', async () => {
  for (let i = 0; i < MAX_REGISTRATIONS_PER_IP; i++) {
    assert.equal((await call(redis, { action: 'register', username: `new${i}`, password: 'password123' }, '203.0.113.77')).status, 200);
  }
  assert.equal((await call(redis, { action: 'register', username: 'onemore', password: 'password123' }, '203.0.113.77')).status, 429);
});
