import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import authHandler, { MAX_FAILED_LOGINS_PER_IP, MAX_FAILED_LOGINS_PER_USER, MAX_REGISTRATIONS_PER_IP } from '../api/auth.js';
import teamsHandler from '../api/teams.js';
import { fakeRedis } from './helpers/fakeRedis.js';

process.env.JWT_SECRET = 'test-secret';

let redis;
let sent;

function request(handler, { method = 'POST', body, ip = '203.0.113.1', cookie, contentType = 'application/json' } = {}) {
  return new Promise(resolve => {
    const res = {
      headers: {},
      statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); },
    };
    const headers = { 'x-forwarded-for': ip };
    if (contentType && method !== 'GET') headers['content-type'] = contentType;
    if (cookie) headers.cookie = cookie;
    handler({ method, body, headers }, res, redis, async msg => { sent.push(msg); });
  });
}

const auth = (body, opts = {}) => request(authHandler, { body, ...opts });
const cookieOf = r => r.headers['Set-Cookie'].split(';')[0];
const tokenFromLastEmail = () => new URL(sent.at(-1).text.match(/https:\S+/)[0]).searchParams.get('reset');

beforeEach(async () => {
  redis = fakeRedis();
  sent = [];
  const r = await auth({ action: 'register', username: 'clem', password: 'correct-horse', email: 'clem@example.com' }, { ip: '198.51.100.9' });
  assert.equal(r.status, 200);
});

test('parallel password guesses cannot get past the per-account limit', async () => {
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) =>
    auth({ action: 'login', username: 'clem', password: `guess-${i}` }, { ip: `192.0.2.${i}` })));
  const checked = results.filter(r => r.status === 401).length;
  assert.ok(checked <= MAX_FAILED_LOGINS_PER_USER, `${checked} guesses were checked`);
  assert.equal(results.filter(r => r.status === 429).length, 40 - checked);
});

test('parallel sign-ups from one network are capped too', async () => {
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    auth({ action: 'register', username: `burst${i}`, password: 'correct-horse' })));
  assert.equal(results.filter(r => r.status === 200).length, MAX_REGISTRATIONS_PER_IP);
});

test('two sign-ups for the same name: only one gets the account', async () => {
  const [a, b] = await Promise.all([
    auth({ action: 'register', username: 'twin', password: 'first-password' }, { ip: '192.0.2.1' }),
    auth({ action: 'register', username: 'twin', password: 'second-password' }, { ip: '192.0.2.2' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const winner = a.status === 200 ? 'first-password' : 'second-password';
  assert.equal((await auth({ action: 'login', username: 'twin', password: winner })).status, 200);
});

test('failed sign-ups do not use up the network allowance', async () => {
  for (let i = 0; i < MAX_REGISTRATIONS_PER_IP + 2; i++) {
    assert.equal((await auth({ action: 'register', username: 'clem', password: 'correct-horse' })).status, 409);
  }
  assert.equal((await auth({ action: 'register', username: 'newcomer', password: 'correct-horse' })).status, 200);
});

test('made-up usernames are refused without creating anything', async () => {
  const before = [...(await redis.keys())].length;
  const r = await auth({ action: 'login', username: 'x'.repeat(5000), password: 'whatever-it-is' });
  assert.equal(r.status, 401);
  const keys = [...(await redis.keys())];
  assert.ok(keys.every(k => k.length < 200), 'no giant keys');
  assert.equal(keys.length, before + 1, 'only the network counter');
});

test('a stray space around the username still signs in', async () => {
  assert.equal((await auth({ action: 'login', username: 'clem ', password: 'correct-horse' })).status, 200);
  assert.equal((await auth({ action: 'login', username: ' Clem', password: 'correct-horse' })).status, 200);
});

test("a blocked network can't lock other people out of their accounts", async () => {
  const attacker = '192.0.2.50';
  for (let i = 0; i < MAX_FAILED_LOGINS_PER_IP; i++) {
    await auth({ action: 'login', username: `ghost${i}`, password: 'wrong-password' }, { ip: attacker });
  }
  for (let i = 0; i < MAX_FAILED_LOGINS_PER_USER + 2; i++) {
    assert.equal((await auth({ action: 'login', username: 'clem', password: `guess-${i}` }, { ip: attacker })).status, 429);
  }
  assert.equal((await auth({ action: 'login', username: 'clem', password: 'correct-horse' }, { ip: '198.51.100.20' })).status, 200);
});

test('requests that are not JSON are refused', async () => {
  const r = await auth({ action: 'login', username: 'clem', password: 'correct-horse' }, { contentType: 'application/x-www-form-urlencoded' });
  assert.equal(r.status, 415);
});

test('signing in returns the saved teams, so no second request is needed', async () => {
  const login = await auth({ action: 'login', username: 'clem', password: 'correct-horse' });
  const cookie = cookieOf(login);
  assert.deepEqual(login.body.teams, []);
  await request(teamsHandler, { body: { type: 'teamId', teamId: 123, label: 'Mine' }, cookie });
  const me = await request(authHandler, { method: 'GET', cookie });
  assert.equal(me.body.teams.length, 1);
});

test('a password reset signs out sessions from before it', async () => {
  const oldCookie = cookieOf(await auth({ action: 'login', username: 'clem', password: 'correct-horse' }));
  assert.equal((await request(teamsHandler, { method: 'GET', cookie: oldCookie })).status, 200);

  await auth({ action: 'forgot_password', identifier: 'clem' });
  const reset = await auth({ action: 'reset_password', token: tokenFromLastEmail(), password: 'brand-new-password' });
  assert.equal(reset.status, 200);

  assert.equal((await request(teamsHandler, { method: 'GET', cookie: oldCookie })).status, 401);
  const me = await request(authHandler, { method: 'GET', cookie: oldCookie });
  assert.equal(me.status, 401);
  assert.match(me.headers['Set-Cookie'], /Max-Age=0/, 'the dead cookie is cleared');
  assert.equal((await request(teamsHandler, { method: 'GET', cookie: cookieOf(reset) })).status, 200, 'the new session works');
});

test('a reset link used twice at once only works once', async () => {
  await auth({ action: 'forgot_password', identifier: 'clem' });
  const token = tokenFromLastEmail();
  const results = await Promise.all([
    auth({ action: 'reset_password', token, password: 'first-new-password' }),
    auth({ action: 'reset_password', token, password: 'second-new-password' }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
});

test('saves made at the same moment are all kept', async () => {
  const cookie = cookieOf(await auth({ action: 'login', username: 'clem', password: 'correct-horse' }));
  const results = await Promise.all([1, 2, 3, 4].map(n =>
    request(teamsHandler, { body: { type: 'teamId', teamId: 1000 + n, label: `Team ${n}` }, cookie })));
  assert.ok(results.every(r => r.status === 200));
  const list = await request(teamsHandler, { method: 'GET', cookie });
  assert.equal(list.body.teams.length, 4);
});

test('a squad can be saved without a vice-captain, with its XI and bank', async () => {
  const cookie = cookieOf(await auth({ action: 'login', username: 'clem', password: 'correct-horse' }));
  const playerIds = Array.from({ length: 15 }, (_, i) => i + 1);
  const ok = await request(teamsHandler, { body: { type: 'custom', squad: { playerIds, captainId: 3, viceCaptainId: null, startingIds: playerIds.slice(0, 11), bankTenths: 15 } }, cookie });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.teams[0].squad.startingIds, playerIds.slice(0, 11));
  assert.equal(ok.body.teams[0].squad.bankTenths, 15);

  const dupes = await request(teamsHandler, { body: { type: 'custom', squad: { playerIds: [...playerIds.slice(0, 14), 1], captainId: 3 } }, cookie });
  assert.equal(dupes.status, 400);
  const badXi = await request(teamsHandler, { body: { type: 'custom', squad: { playerIds, captainId: 3, startingIds: [1, 2, 3] } }, cookie });
  assert.equal(badXi.status, 400);
});
