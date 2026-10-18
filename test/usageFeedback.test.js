import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/auth.js';
import { recordEvent, usageReport } from '../src/lib/usage.js';
import { cleanFeedback } from '../src/lib/feedback.js';
import { fakeRedis } from './helpers/fakeRedis.js';

process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_USERNAMES = 'boss01';

function call(redis, body, { cookie = '', ip = '203.0.113.9' } = {}) {
  return new Promise(resolve => {
    const res = {
      headers: {}, statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); },
    };
    handler({ method: 'POST', body, headers: { 'x-forwarded-for': ip, 'content-type': 'application/json', cookie } }, res, redis, async () => {});
  });
}
const cookieOf = r => String(r.headers['Set-Cookie']).split(';')[0];

let redis;
beforeEach(() => { redis = fakeRedis(); });

test('usage: only known names count, per day, busiest first', async () => {
  const day1 = Date.parse('2026-10-17T12:00:00Z');
  const day2 = Date.parse('2026-10-18T12:00:00Z');
  assert.equal(await recordEvent(redis, 'team_check', day1), true);
  await recordEvent(redis, 'team_check', day2);
  await recordEvent(redis, 'team_check', day2);
  await recordEvent(redis, 'share', day2);
  assert.equal(await recordEvent(redis, 'hack', day2), false);
  assert.equal(await recordEvent(redis, 'constructor', day2), false);
  const r = await usageReport(redis, 3, day2);
  assert.deepEqual(r.days, ['2026-10-18', '2026-10-17', '2026-10-16']);
  assert.deepEqual(r.rows[0], { name: 'team_check', label: 'Checked a Team ID', counts: [2, 1, 0], total: 3 });
  assert.equal(r.rows[1].name, 'share');
});

test('the event endpoint counts, and sign-ups and logins count themselves', async () => {
  assert.deepEqual((await call(redis, { action: 'event', name: 'league' })).body, { ok: true });
  assert.deepEqual((await call(redis, { action: 'event', name: 'nope' })).body, { ok: false });
  await call(redis, { action: 'register', acceptTerms: true, username: 'boss01', password: 'secret12' });
  await call(redis, { action: 'login', username: 'boss01', password: 'secret12' });
  const admin = cookieOf(await call(redis, { action: 'login', username: 'boss01', password: 'secret12' }));
  const usage = await call(redis, { action: 'admin', op: 'usage' }, { cookie: admin });
  const total = name => usage.body.rows.find(r => r.name === name).total;
  assert.equal(total('league'), 1);
  assert.equal(total('signup'), 1);
  assert.equal(total('login'), 2);
});

test('feedback: anyone can send, admins read and clear it', async () => {
  assert.equal(cleanFeedback({ text: '   ' }), null);
  assert.deepEqual(cleanFeedback({ text: ' Hi ', email: 'bad', page: 'home' }), { text: 'Hi', email: '', page: 'home' });
  assert.equal((await call(redis, { action: 'feedback', text: '' })).status, 400);
  assert.equal((await call(redis, { action: 'feedback', text: 'Captain pick is wrong', email: 'a@b.co', page: 'results' })).status, 200);
  for (let i = 0; i < 4; i++) await call(redis, { action: 'feedback', text: `n${i}` });
  assert.equal((await call(redis, { action: 'feedback', text: 'spam' })).status, 429, '5 an hour per network');

  await call(redis, { action: 'register', acceptTerms: true, username: 'boss01', password: 'secret12' }, { ip: '198.51.100.1' });
  const admin = cookieOf(await call(redis, { action: 'login', username: 'boss01', password: 'secret12' }, { ip: '198.51.100.1' }));
  const list = await call(redis, { action: 'admin', op: 'feedback' }, { cookie: admin });
  assert.equal(list.body.feedback.length, 5);
  assert.equal(list.body.feedback[4].text, 'Captain pick is wrong', 'newest first');
  assert.equal(list.body.feedback[4].email, 'a@b.co');
  await call(redis, { action: 'admin', op: 'feedback_clear' }, { cookie: admin });
  assert.equal((await call(redis, { action: 'admin', op: 'feedback' }, { cookie: admin })).body.feedback.length, 0);
  // Not for everyone.
  const reg = await call(redis, { action: 'register', acceptTerms: true, username: 'nobody1', password: 'secret12' }, { ip: '198.51.100.2' });
  assert.equal((await call(redis, { action: 'admin', op: 'feedback' }, { cookie: cookieOf(reg) })).status, 403);
});
