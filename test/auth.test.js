import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler, { MAX_FAILED_LOGINS_PER_USER, MAX_FAILED_LOGINS_PER_IP, MAX_REGISTRATIONS_PER_IP, MAX_RESET_EMAILS_PER_USER } from '../api/auth.js';
import { validatePassword } from '../src/lib/auth.js';
import { fakeRedis } from './helpers/fakeRedis.js';

process.env.JWT_SECRET = 'test-secret';

function call(redis, body, ip = '203.0.113.1', extraHeaders = {}, method = 'POST') {
  return new Promise(resolve => {
    const res = {
      headers: {},
      statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); },
    };
    const json = method === 'POST' ? { 'content-type': 'application/json' } : {};
    handler({ method, body, headers: { 'x-forwarded-for': ip, ...json, ...extraHeaders } }, res, redis, fakeMail);
  });
}

// Emails the handler "sends" during a test.
let sent = [];
const fakeMail = async msg => { sent.push(msg); };

let redis;
beforeEach(async () => {
  sent = [];
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

// The reset token from the link in the last email sent.
const tokenFromLastEmail = () => new URL(sent.at(-1).text.match(/https:\S+/)[0]).searchParams.get('reset');

test('forgot password by username or email sends a one-time link that sets a new password', async () => {
  await call(redis, { action: 'register', username: 'Resetter', password: 'old-password', email: 'reset@example.com' });

  const byName = await call(redis, { action: 'forgot_password', identifier: 'resetter' });
  assert.equal(byName.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'reset@example.com');
  assert.match(sent[0].text, /https:\/\/fplchecker\.vercel\.app\/\?reset=/);

  const byEmail = await call(redis, { action: 'forgot_password', identifier: 'RESET@example.com' });
  assert.equal(byEmail.status, 200);
  assert.equal(sent.length, 2);
  const token = tokenFromLastEmail();

  const tooShort = await call(redis, { action: 'reset_password', token, password: 'short' });
  assert.equal(tooShort.status, 400);

  const done = await call(redis, { action: 'reset_password', token, password: 'brand-new-password' });
  assert.equal(done.status, 200);
  assert.equal(done.body.username, 'Resetter');
  assert.match(done.headers['Set-Cookie'], /HttpOnly/, 'logs you straight in');

  assert.equal((await call(redis, { action: 'login', username: 'resetter', password: 'old-password' })).status, 401);
  assert.equal((await call(redis, { action: 'login', username: 'resetter', password: 'brand-new-password' })).status, 200);

  const reused = await call(redis, { action: 'reset_password', token, password: 'another-password' });
  assert.equal(reused.status, 400, 'a link only works once');
});

test('forgot password says when no account matches or it has no email', async () => {
  const unknown = await call(redis, { action: 'forgot_password', identifier: 'nobody' });
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /No account found/);

  const unknownEmail = await call(redis, { action: 'forgot_password', identifier: 'who@example.com' });
  assert.equal(unknownEmail.status, 404);

  const noEmail = await call(redis, { action: 'forgot_password', identifier: 'clem' });
  assert.equal(noEmail.status, 400);
  assert.match(noEmail.body.error, /doesn't have an email/);
  assert.equal(sent.length, 0);
});

test('the reset confirmation shows a masked address', async () => {
  await call(redis, { action: 'register', username: 'masked', password: 'correct-horse', email: 'masked@example.com' });
  const r = await call(redis, { action: 'forgot_password', identifier: 'masked' });
  assert.equal(r.status, 200);
  assert.match(r.body.message, /m\*\*\*@example\.com/);
  assert.ok(!r.body.message.includes('masked@example.com'));
});

test('reset links expire and made-up tokens are rejected', async () => {
  await call(redis, { action: 'register', username: 'expiry', password: 'old-password', email: 'expiry@example.com' });
  await call(redis, { action: 'forgot_password', identifier: 'expiry' });
  const token = tokenFromLastEmail();
  // Push the stored expiry into the past.
  const key = [...(await redis.keys())].find(k => k.startsWith('pwreset:'));
  const entry = JSON.parse(await redis.get(key));
  await redis.set(key, JSON.stringify({ ...entry, expiresAt: Date.now() - 1 }));
  assert.equal((await call(redis, { action: 'reset_password', token, password: 'brand-new-password' })).status, 400);
  assert.equal((await call(redis, { action: 'reset_password', token: 'made-up', password: 'brand-new-password' })).status, 400);
});

test('reset emails per account are capped', async () => {
  await call(redis, { action: 'register', username: 'spammed', password: 'old-password', email: 'spammed@example.com' });
  for (let i = 0; i < MAX_RESET_EMAILS_PER_USER + 2; i++) {
    const r = await call(redis, { action: 'forgot_password', identifier: 'spammed' }, `192.0.2.${i}`);
    assert.equal(r.status, i < MAX_RESET_EMAILS_PER_USER ? 200 : 429);
  }
  assert.equal(sent.length, MAX_RESET_EMAILS_PER_USER);
});

test('an email can only belong to one account, and is freed when changed', async () => {
  await call(redis, { action: 'register', username: 'first', password: 'correct-horse', email: 'shared@example.com' });
  const second = await call(redis, { action: 'register', username: 'second', password: 'correct-horse', email: 'Shared@example.com' });
  assert.equal(second.status, 409);

  const login = await call(redis, { action: 'login', username: 'first', password: 'correct-horse' });
  await call(redis, { action: 'set_email', email: 'moved@example.com' }, undefined, cookieFrom(login));
  const retry = await call(redis, { action: 'register', username: 'second', password: 'correct-horse', email: 'shared@example.com' });
  assert.equal(retry.status, 200);

  // The old address no longer resets the first account.
  await call(redis, { action: 'forgot_password', identifier: 'shared@example.com' });
  assert.equal(sent.at(-1).to, 'shared@example.com');
  assert.match(sent.at(-1).text, /Hi second/);
});
