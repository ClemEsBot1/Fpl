import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler, { MAX_FAILED_LOGINS_PER_USER, MAX_FAILED_LOGINS_PER_IP, MAX_REGISTRATIONS_PER_IP, MAX_RESET_EMAILS_PER_USER } from '../api/auth.js';
import { validatePassword, validateNewUsername, hashPassword } from '../src/lib/auth.js';
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
  const r = await call(redis, { action: 'register', acceptTerms: true, username: 'clem', password: 'correct-horse1' }, '198.51.100.9');
  assert.equal(r.status, 200);
});

test('new passwords need 6 characters and a number; new usernames 6 characters; clem is exempt', async () => {
  assert.equal(validatePassword('abc12').ok, false, 'too short');
  assert.equal(validatePassword('abcdefgh').ok, false, 'no number');
  assert.equal(validatePassword('abcde1').ok, true);
  assert.equal(validatePassword('short', 'Clem').ok, true, 'clem skips the password rules');
  assert.equal(validateNewUsername('sammy').ok, false);
  assert.equal(validateNewUsername('sammy1').ok, true);
  assert.equal(validateNewUsername('clem').ok, true);
  assert.equal((await call(redis, { action: 'register', acceptTerms: true, username: 'shortpass', password: 'abc12' })).status, 400);
  assert.equal((await call(redis, { action: 'register', acceptTerms: true, username: 'nonumber', password: 'abcdefgh' })).status, 400);
  const r = await call(redis, { action: 'register', acceptTerms: true, username: 'sammy', password: 'abcde1' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /6-20 characters/);
  assert.equal((await call(redis, { action: 'register', acceptTerms: true, username: 'sammy1', password: 'abcde1' })).status, 200);
});

test('accounts from before the username minimum still sign in', async () => {
  await redis.set('user:sam', JSON.stringify({ username: 'sam', passwordHash: await hashPassword('old') }));
  assert.equal((await call(redis, { action: 'login', username: 'sam', password: 'old' })).status, 200);
});

test('correct password logs in and sets a session cookie', async () => {
  const r = await call(redis, { action: 'login', username: 'clem', password: 'correct-horse1' });
  assert.equal(r.status, 200);
  assert.match(r.headers['Set-Cookie'], /HttpOnly/);
});

test('an account locks after too many wrong passwords, even with the right one', async () => {
  for (let i = 0; i < MAX_FAILED_LOGINS_PER_USER; i++) {
    const r = await call(redis, { action: 'login', username: 'clem', password: 'wrong' }, `192.0.2.${i}`);
    assert.equal(r.status, 401);
  }
  const blocked = await call(redis, { action: 'login', username: 'CLEM', password: 'correct-horse1' });
  assert.equal(blocked.status, 429, 'usernames are case-insensitive, so the limit is too');
});

test('logging in works with the account email as well as the username', async () => {
  await call(redis, { action: 'register', acceptTerms: true, username: 'mailer', password: 'correct-horse1', email: 'Mailer@Example.com' }, '198.51.100.10');
  const r = await call(redis, { action: 'login', username: ' mailer@example.COM ', password: 'correct-horse1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.username, 'mailer');
  assert.equal((await call(redis, { action: 'login', username: 'mailer@example.com', password: 'wrong' })).status, 401);
  assert.equal((await call(redis, { action: 'login', username: 'nobody@example.com', password: 'correct-horse1' })).status, 401);
});

test('a successful login clears earlier failures', async () => {
  for (let i = 0; i < MAX_FAILED_LOGINS_PER_USER - 1; i++) await call(redis, { action: 'login', username: 'clem', password: 'wrong' });
  assert.equal((await call(redis, { action: 'login', username: 'clem', password: 'correct-horse1' })).status, 200);
  assert.equal((await call(redis, { action: 'login', username: 'clem', password: 'wrong' })).status, 401);
  assert.equal((await call(redis, { action: 'login', username: 'clem', password: 'correct-horse1' })).status, 200);
});

test('one IP guessing across many accounts gets blocked', async () => {
  for (let i = 0; i < MAX_FAILED_LOGINS_PER_IP; i++) {
    await call(redis, { action: 'login', username: `user${i}`, password: 'wrong' }, '203.0.113.50');
  }
  const r = await call(redis, { action: 'login', username: 'clem', password: 'correct-horse1' }, '203.0.113.50');
  assert.equal(r.status, 429);
  const elsewhere = await call(redis, { action: 'login', username: 'clem', password: 'correct-horse1' }, '203.0.113.51');
  assert.equal(elsewhere.status, 200);
});

test('sign-ups per IP are capped', async () => {
  for (let i = 0; i < MAX_REGISTRATIONS_PER_IP; i++) {
    assert.equal((await call(redis, { action: 'register', acceptTerms: true, username: `newbie${i}`, password: 'password123' }, '203.0.113.77')).status, 200);
  }
  assert.equal((await call(redis, { action: 'register', acceptTerms: true, username: 'onemore', password: 'password123' }, '203.0.113.77')).status, 429);
});

// The session cookie from a Set-Cookie header, ready to send back.
const cookieFrom = r => ({ cookie: r.headers['Set-Cookie'].split(';')[0] });

test('email is optional at sign-up, and stored trimmed and lower-cased', async () => {
  const withEmail = await call(redis, { action: 'register', acceptTerms: true, username: 'mailer', password: 'correct-horse1', email: '  Mailer@Example.COM ' });
  assert.equal(withEmail.status, 200);
  assert.equal(withEmail.body.email, 'mailer@example.com');
  const me = await call(redis, undefined, undefined, cookieFrom(withEmail), 'GET');
  assert.equal(me.body.email, 'mailer@example.com');

  const login = await call(redis, { action: 'login', username: 'clem', password: 'correct-horse1' });
  assert.equal(login.body.email, '', 'accounts without one still work');
});

test('a malformed email is rejected at sign-up', async () => {
  const r = await call(redis, { action: 'register', acceptTerms: true, username: 'badmail', password: 'correct-horse1', email: 'not-an-email' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /valid email/);
});

test('a logged-in user can add, change and remove their email', async () => {
  const login = await call(redis, { action: 'login', username: 'clem', password: 'correct-horse1' });
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
  assert.equal((await call(redis, { action: 'login', username: 'clem', password: 'correct-horse1' })).status, 200);
});

test('setting an email needs a session', async () => {
  const r = await call(redis, { action: 'set_email', email: 'x@example.com' });
  assert.equal(r.status, 401);
});

// The 6-digit code in the last email sent.
const codeFromLastEmail = () => sent.at(-1).text.match(/\b(\d{6})\b/)[1];
const resetEmails = () => sent.filter(m => /password reset code/.test(m.subject));

test('forgot password by username or email emails a one-time code that sets a new password', async () => {
  await call(redis, { action: 'register', acceptTerms: true, username: 'Resetter', password: 'old-password1', email: 'reset@example.com' });
  sent = [];

  const byName = await call(redis, { action: 'forgot_password', identifier: 'resetter' });
  assert.equal(byName.status, 200);
  assert.match(byName.body.message, /6-digit code to r\*\*\*@example\.com/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'reset@example.com');
  assert.match(sent[0].subject, /^\d{6} is your FPL Checker password reset code$/);
  assert.doesNotMatch(sent[0].text, /\?reset=/, 'no link any more');
  const oldCode = codeFromLastEmail();

  const byEmail = await call(redis, { action: 'forgot_password', identifier: 'RESET@example.com' });
  assert.equal(byEmail.status, 200);
  const code = codeFromLastEmail();
  if (code !== oldCode) {
    assert.equal((await call(redis, { action: 'reset_password', identifier: 'resetter', code: oldCode, password: 'brand-new-password1' })).status, 400, 'a newer code replaces the old one');
  }

  const tooShort = await call(redis, { action: 'reset_password', identifier: 'resetter', code, password: 'short' });
  assert.equal(tooShort.status, 400);
  assert.doesNotMatch(tooShort.body.error, /code/, 'the password rules, not the code');

  const done = await call(redis, { action: 'reset_password', identifier: 'reset@example.com', code, password: 'brand-new-password1' });
  assert.equal(done.status, 200);
  assert.equal(done.body.username, 'Resetter');
  assert.equal(done.body.emailVerified, true, 'getting the code proves the email');
  assert.match(done.headers['Set-Cookie'], /HttpOnly/, 'logs you straight in');

  assert.equal((await call(redis, { action: 'login', username: 'resetter', password: 'old-password1' })).status, 401);
  assert.equal((await call(redis, { action: 'login', username: 'resetter', password: 'brand-new-password1' })).status, 200);

  const reused = await call(redis, { action: 'reset_password', identifier: 'resetter', code, password: 'another-password1' });
  assert.equal(reused.status, 400, 'a code only works once');
});

test('a reset code allows five guesses, then it is thrown away', async () => {
  await call(redis, { action: 'register', acceptTerms: true, username: 'guessed', password: 'old-password1', email: 'guessed@example.com' });
  await call(redis, { action: 'forgot_password', identifier: 'guessed' });
  const code = codeFromLastEmail();
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  for (let i = 0; i < 5; i++) {
    const r = await call(redis, { action: 'reset_password', identifier: 'guessed', code: wrong, password: 'brand-new-password1' });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /code is wrong or has expired/);
  }
  assert.equal((await call(redis, { action: 'reset_password', identifier: 'guessed', code, password: 'brand-new-password1' })).status, 400, 'the right code is no good after five wrong ones');
  assert.equal((await call(redis, { action: 'reset_password', identifier: 'nobody', code, password: 'brand-new-password1' })).status, 400);
  assert.equal((await call(redis, { action: 'reset_password', identifier: 'guessed', code: 'abc', password: 'brand-new-password1' })).status, 400);
});

test('new emails need confirming with a code before deadline emails can start', async () => {
  const reg = await call(redis, { action: 'register', acceptTerms: true, username: 'verifier', password: 'correct-horse1', email: 'verify@example.com' });
  assert.equal(reg.status, 200);
  assert.equal(reg.body.emailVerified, false);
  assert.equal(reg.body.codeSent, true);
  assert.equal(sent.at(-1).to, 'verify@example.com');
  assert.match(sent.at(-1).subject, /verification code/);
  const cookie = cookieFrom(reg);
  assert.equal((await call(redis, { action: 'set_digest', teamId: 1234 }, undefined, cookie)).status, 400, 'not until confirmed');

  const code = codeFromLastEmail();
  assert.equal((await call(redis, { action: 'verify_email', code: '000000' === code ? '111111' : '000000' }, undefined, cookie)).status, 400);
  const ok = await call(redis, { action: 'verify_email', code }, undefined, cookie);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.emailVerified, true);
  assert.equal((await call(redis, { action: 'set_digest', teamId: 1234 }, undefined, cookie)).status, 200);

  // A new address needs confirming again, and an old code doesn't do it.
  const changed = await call(redis, { action: 'set_email', email: 'other@example.com' }, undefined, cookie);
  assert.equal(changed.body.emailVerified, false);
  assert.equal(changed.body.codeSent, true);
  assert.equal(sent.at(-1).to, 'other@example.com');
  assert.equal((await call(redis, { action: 'verify_email', code }, undefined, cookie)).status, 400);
  const resend = await call(redis, { action: 'send_verify' }, undefined, cookie);
  assert.equal(resend.status, 200);
  assert.match(resend.body.message, /o\*\*\*@example\.com/);
  assert.equal((await call(redis, { action: 'verify_email', code: codeFromLastEmail() }, undefined, cookie)).body.emailVerified, true);
  assert.equal((await call(redis, { action: 'verify_email', code: '123456' })).status, 401, 'needs a session');
});

test('a sign-up must agree to the Terms, and the version is recorded', async () => {
  const no = await call(redis, { action: 'register', username: 'noterms', password: 'correct-horse1' });
  assert.equal(no.status, 400);
  assert.match(no.body.error, /agree to the Terms/);
  await call(redis, { action: 'register', acceptTerms: true, username: 'withterms', password: 'correct-horse1' });
  const { TERMS_VERSION } = await import('../src/lib/terms.js');
  const record = JSON.parse(await redis.get('user:withterms'));
  assert.equal(record.termsVersion, TERMS_VERSION);
  assert.ok(Date.parse(record.termsAcceptedAt));
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
  await call(redis, { action: 'register', acceptTerms: true, username: 'masked', password: 'correct-horse1', email: 'masked@example.com' });
  const r = await call(redis, { action: 'forgot_password', identifier: 'masked' });
  assert.equal(r.status, 200);
  assert.match(r.body.message, /m\*\*\*@example\.com/);
  assert.ok(!r.body.message.includes('masked@example.com'));
});

test('reset codes expire', async () => {
  await call(redis, { action: 'register', acceptTerms: true, username: 'expiry', password: 'old-password1', email: 'expiry@example.com' });
  await call(redis, { action: 'forgot_password', identifier: 'expiry' });
  const code = codeFromLastEmail();
  // Push the stored expiry into the past.
  const entry = JSON.parse(await redis.get('code:reset:expiry'));
  await redis.set('code:reset:expiry', JSON.stringify({ ...entry, expiresAt: Date.now() - 1 }));
  assert.equal((await call(redis, { action: 'reset_password', identifier: 'expiry', code, password: 'brand-new-password1' })).status, 400);
  assert.ok(!(await redis.get('code:reset:expiry')).includes(code), 'only a keyed hash of the code is stored');
});

test('reset emails per account are capped', async () => {
  await call(redis, { action: 'register', acceptTerms: true, username: 'spammed', password: 'old-password1', email: 'spammed@example.com' });
  for (let i = 0; i < MAX_RESET_EMAILS_PER_USER + 2; i++) {
    const r = await call(redis, { action: 'forgot_password', identifier: 'spammed' }, `192.0.2.${i}`);
    assert.equal(r.status, i < MAX_RESET_EMAILS_PER_USER ? 200 : 429);
  }
  assert.equal(resetEmails().length, MAX_RESET_EMAILS_PER_USER);
});

test('an email can only belong to one account, and is freed when changed', async () => {
  await call(redis, { action: 'register', acceptTerms: true, username: 'firstuser', password: 'correct-horse1', email: 'shared@example.com' });
  const second = await call(redis, { action: 'register', acceptTerms: true, username: 'second', password: 'correct-horse1', email: 'Shared@example.com' });
  assert.equal(second.status, 409);

  const login = await call(redis, { action: 'login', username: 'firstuser', password: 'correct-horse1' });
  await call(redis, { action: 'set_email', email: 'moved@example.com' }, undefined, cookieFrom(login));
  const retry = await call(redis, { action: 'register', acceptTerms: true, username: 'second', password: 'correct-horse1', email: 'shared@example.com' });
  assert.equal(retry.status, 200);

  // The old address no longer resets the first account.
  await call(redis, { action: 'forgot_password', identifier: 'shared@example.com' });
  assert.equal(sent.at(-1).to, 'shared@example.com');
  assert.match(sent.at(-1).text, /Hi second/);
});

test('deadline emails: on only with an email, off from the app or the unsubscribe link', async () => {
  const { unsubscribeToken } = await import('../src/lib/digest.js');
  const cookie = cookieFrom(await call(redis, { action: 'login', username: 'clem', password: 'correct-horse1' }));
  const noEmail = await call(redis, { action: 'set_digest', teamId: 1234 }, undefined, cookie);
  assert.equal(noEmail.status, 400);
  assert.match(noEmail.body.error, /email address/);
  await call(redis, { action: 'set_email', email: 'clem@example.com' }, undefined, cookie);
  await call(redis, { action: 'verify_email', code: codeFromLastEmail() }, undefined, cookie);
  assert.equal((await call(redis, { action: 'set_digest', teamId: 'abc' }, undefined, cookie)).status, 400);
  const on = await call(redis, { action: 'set_digest', teamId: 1234 }, undefined, cookie);
  assert.equal(on.status, 200);
  assert.equal(on.body.digestTeamId, 1234);
  const off = await call(redis, { action: 'set_digest', teamId: null }, undefined, cookie);
  assert.equal(off.body.digestTeamId, null);
  assert.equal((await call(redis, { action: 'set_digest', teamId: 1234 }, undefined, cookie)).body.digestTeamId, 1234);

  const visit = query => new Promise(resolve => {
    const res = { statusCode: 200, setHeader() { return this; }, status(c) { this.statusCode = c; return this; }, send(b) { resolve({ status: this.statusCode, body: b }); }, json(b) { resolve({ status: this.statusCode, body: b }); } };
    handler({ method: 'GET', query, headers: {} }, res, redis, fakeMail);
  });
  assert.equal((await visit({ digest: 'off', u: 'clem', t: 'wrong' })).status, 400);
  const done = await visit({ digest: 'off', u: 'clem', t: unsubscribeToken('clem', 'test-secret') });
  assert.equal(done.status, 200);
  assert.match(done.body, /Deadline emails off/);
  const me = await call(redis, undefined, undefined, cookie, 'GET');
  assert.equal(me.body.digestTeamId, null);
});

test('a user can delete their own account with their password, and everything goes', async () => {
  const reg = await call(redis, { action: 'register', acceptTerms: true, username: 'leaving', password: 'correct-horse1', email: 'leaving@example.com' });
  const cookie = cookieFrom(reg);
  assert.equal((await call(redis, { action: 'delete_account', password: 'correct-horse1' })).status, 401, 'needs a session');
  const wrong = await call(redis, { action: 'delete_account', password: 'wrong-password1', confirm: 'DELETE' }, undefined, cookie);
  assert.equal(wrong.status, 401);
  assert.ok(await redis.get('user:leaving'), 'not deleted on a wrong password');
  const done = await call(redis, { action: 'delete_account', password: 'correct-horse1', confirm: 'DELETE' }, undefined, cookie);
  assert.equal(done.status, 200);
  assert.equal(done.body.deleted, true);
  assert.match(done.headers['Set-Cookie'], /Max-Age=0/, 'logged out');
  assert.equal(await redis.get('user:leaving'), null);
  assert.equal(await redis.get('email:leaving@example.com'), null, 'the email is freed');
  assert.equal(await redis.get('code:verify:leaving'), null, 'pending codes go too');
  assert.equal((await call(redis, { action: 'login', username: 'leaving', password: 'correct-horse1' })).status, 401);
  assert.equal((await call(redis, { action: 'register', acceptTerms: true, username: 'newowner', password: 'correct-horse1', email: 'leaving@example.com' })).status, 200);
});

test('?region tells the app the visitor\'s country from Vercel\'s header, storing nothing', async () => {
  const ask = async headers => {
    const res = { headers: {}, statusCode: 0, body: null };
    res.status = c => { res.statusCode = c; return res; };
    res.json = b => { res.body = b; return res; };
    res.setHeader = (k, v) => { res.headers[k] = v; return res; };
    await handler({ method: 'GET', query: { region: '1' }, headers, socket: { remoteAddress: '203.0.113.1' } }, res, fakeRedis());
    return res;
  };
  const de = await ask({ 'x-vercel-ip-country': 'DE' });
  assert.equal(de.statusCode, 200);
  assert.deepEqual(de.body, { country: 'DE' });
  assert.equal(de.headers['Cache-Control'], 'no-store');
  assert.deepEqual((await ask({})).body, { country: '' });
});
