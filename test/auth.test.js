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

function call(redis, body, ip = '203.0.113.1', extraHeaders = {}, method = 'POST') {
  return new Promise(resolve => {
    const res = {
      headers: {},
      statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); },
    };
    handler({ method, body, headers: { 'x-forwarded-for': ip, ...extraHeaders } }, res, redis);
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

// The session cookie from a Set-Cookie header, ready to send back.
const cookieFrom = r => ({ cookie: r.headers['Set-Cookie'].split(';')[0] });

test('email is optional at sign-up, and stored trimmed and lower-cased', async () => {
  const withEmail = await call(redis, { action: 'register', username: 'mailer', password: 'correct-horse', email: '  Mailer@Example.COM ' });
  assert.equal(withEmail.status, 200);
  assert.equal(withEmail.body.email, 'mailer@example.com');
  const me = await call(redis, undefined, undefined, cookieFrom(withEmail), 'GET');
  assert.equal(me.body.email, 'mailer@example.com');

  const login = await call(redis, { action: 'login', username: 'clem', password: 'correct-horse' });
  assert.equal(login.body.email, '', 'accounts without one still work');
});

test('a malformed email is rejected at sign-up', async () => {
  const r = await call(redis, { action: 'register', username: 'badmail', password: 'correct-horse', email: 'not-an-email' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /valid email/);
});

test('a logged-in user can add, change and remove their email', async () => {
  const login = await call(redis, { action: 'login', username: 'clem', password: 'correct-horse' });
  const cookie = cookieFrom(login);
  const added = await call(redis, { action: 'set_email', email: 'clem@example.com' }, undefined, cookie);
  assert.equal(added.status, 200);
  assert.equal((await call(redis, undefined, undefined, cookie, 'GET')).body.email, 'clem@example.com');

  const bad = await call(redis, { action: 'set_email', email: 'clem@' }, undefined, cookie);
  assert.equal(bad.status, 400);

  const removed = await call(redis, { action: 'set_email', email: '' }, undefined, cookie);
  assert.equal(removed.status, 200);
  assert.equal((await call(redis, undefined, undefined, cookie, 'GET')).body.email, '');

  // Changing the email never touches the password.
  assert.equal((await call(redis, { action: 'login', username: 'clem', password: 'correct-horse' })).status, 200);
});

test('setting an email needs a session', async () => {
  const r = await call(redis, { action: 'set_email', email: 'x@example.com' });
  assert.equal(r.status, 401);
});
