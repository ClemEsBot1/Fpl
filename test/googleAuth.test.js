import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/auth.js';
import { claimsFromIdToken, newState, parseState, suggestUsername } from '../src/lib/googleAuth.js';
import { fakeRedis } from './helpers/fakeRedis.js';

process.env.JWT_SECRET = 'test-secret';
const CONFIG = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'x' };

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = claims => `${b64({ alg: 'RS256' })}.${b64({ iss: 'https://accounts.google.com', aud: CONFIG.clientId, exp: Math.floor(Date.now() / 1000) + 600, ...claims })}.sig`;

// A token endpoint that answers with an ID token for `claims`.
const googleSays = claims => async () => ({ ok: true, json: async () => ({ id_token: idToken(claims) }) });

function call(redis, { method = 'POST', body, query = {}, cookie = '', ip = '203.0.113.7' }, google = { config: CONFIG }) {
  return new Promise(resolve => {
    const res = {
      headers: {}, statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); },
      end() { resolve({ status: this.statusCode, headers: this.headers }); },
    };
    const headers = { 'x-forwarded-for': ip, cookie, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) };
    handler({ method, body, query, headers }, res, redis, async () => {}, undefined, google);
  });
}

const cookiesOf = r => [].concat(r.headers['Set-Cookie'] || []);
const sessionOf = r => cookiesOf(r).find(c => c.startsWith('fpl_session=') && !c.includes('Max-Age=0'))?.split(';')[0];

// Starts at /auth/google and comes back from Google signed in as `claims`.
async function viaGoogle(redis, claims, { terms = true, link = false, cookie = '' } = {}) {
  const start = await call(redis, { method: 'GET', query: { google: 'start', ...(terms ? { terms: '1' } : {}), ...(link ? { link: '1' } : {}) }, cookie });
  assert.equal(start.status, 302);
  const state = new URL(start.headers.Location).searchParams.get('state');
  const stateCookie = cookiesOf(start)[0].split(';')[0];
  return call(redis, { method: 'GET', query: { google: 'callback', code: 'abc', state }, cookie: [stateCookie, cookie].filter(Boolean).join('; ') }, { config: CONFIG, fetchImpl: googleSays(claims) });
}

let redis;
beforeEach(() => { redis = fakeRedis(); });

test('ID token claims: right audience, issuer and expiry only', () => {
  assert.equal(claimsFromIdToken(idToken({ sub: '1', email: 'A@B.com', email_verified: true }), CONFIG.clientId).email, 'a@b.com');
  assert.equal(claimsFromIdToken(idToken({ sub: '1', aud: 'someone-else' }), CONFIG.clientId), null);
  assert.equal(claimsFromIdToken(idToken({ sub: '1', iss: 'evil.com' }), CONFIG.clientId), null);
  assert.equal(claimsFromIdToken(idToken({ sub: '1', exp: 1 }), CONFIG.clientId), null);
  const st = parseState(newState({ link: true }));
  assert.equal(st.link, true);
  assert.equal(st.terms, false);
  assert.ok(st.nonce.length >= 20);
});

test('suggested usernames are 6+ characters and free', async () => {
  assert.equal(await suggestUsername({ name: "Jamie O'Neil" }, async () => false), 'jamieoneil');
  assert.equal(await suggestUsername({ name: 'Al', email: 'al@x.com' }, async () => false), 'al_fpl');
  const taken = new Set(['jamieoneil']);
  assert.match(await suggestUsername({ name: 'Jamie ONeil' }, async n => taken.has(n), () => 0.5), /^jamieoneil\d{4}$/);
});

test('Google creates an account with a confirmed email, then a backup username and password can be set', async () => {
  const r = await viaGoogle(redis, { sub: 'g1', email: 'sam@example.com', email_verified: true, name: 'Sam Smith' });
  assert.equal(r.headers.Location, '/?google=new');
  const cookie = sessionOf(r);
  assert.ok(cookie);
  const me = await call(redis, { method: 'GET', cookie });
  assert.equal(me.body.username, 'samsmith');
  assert.equal(me.body.emailVerified, true);
  assert.equal(me.body.hasPassword, false);
  assert.equal(me.body.google, true);

  const set = await call(redis, { body: { action: 'set_credentials', username: 'SamTheMan', password: 'secret12' }, cookie });
  assert.equal(set.status, 200);
  assert.equal(set.body.username, 'SamTheMan');
  assert.equal(await redis.get('user:samsmith'), null, 'moved to the new name');
  assert.equal(await redis.get('google:g1'), 'samtheman');
  assert.equal(await redis.get('email:sam@example.com'), 'samtheman');
  assert.equal((await call(redis, { body: { action: 'login', username: 'samtheman', password: 'secret12' } })).status, 200);
  // And Google still signs in to it.
  const again = await viaGoogle(redis, { sub: 'g1', email: 'sam@example.com', email_verified: true });
  assert.equal(again.headers.Location, '/?google=signed_in');
  // Only once: after that it's change_password.
  assert.equal((await call(redis, { body: { action: 'set_credentials', password: 'other123' }, cookie: sessionOf(set) })).status, 400);
});

test('a new account needs the Terms agreed first', async () => {
  const r = await viaGoogle(redis, { sub: 'g2', email: 'x@example.com', email_verified: true }, { terms: false });
  assert.equal(r.headers.Location, '/?google=terms');
  assert.equal(sessionOf(r), undefined);
});

test('Google signs in to the account with the same confirmed email, never an unconfirmed one', async () => {
  await redis.set('user:clemmy', JSON.stringify({ username: 'clemmy', passwordHash: 'h', email: 'c@example.com', emailVerified: true, teams: [] }));
  await redis.set('email:c@example.com', 'clemmy');
  const r = await viaGoogle(redis, { sub: 'g3', email: 'c@example.com', email_verified: true });
  assert.equal(r.headers.Location, '/?google=signed_in');
  assert.equal(JSON.parse(await redis.get('user:clemmy')).googleSub, 'g3');

  await redis.set('user:squatter', JSON.stringify({ username: 'squatter', passwordHash: 'h', email: 'v@example.com', emailVerified: false, teams: [] }));
  await redis.set('email:v@example.com', 'squatter');
  const v = await viaGoogle(redis, { sub: 'g4', email: 'v@example.com', email_verified: true, name: 'Victim Person' });
  assert.equal(v.headers.Location, '/?google=new', 'a new account, not the squatter’s');
  assert.equal(JSON.parse(await redis.get('user:squatter')).email, undefined, 'the unconfirmed claim is dropped');
  assert.equal(await redis.get('email:v@example.com'), 'victimperson');
});

test('a forged or replayed callback is refused', async () => {
  const r = await call(redis, { method: 'GET', query: { google: 'callback', code: 'abc', state: newState({ terms: true }) }, cookie: 'fpl_gstate=other' }, { config: CONFIG, fetchImpl: googleSays({ sub: 'g5' }) });
  assert.equal(r.headers.Location, '/?google=error');
  assert.equal(sessionOf(r), undefined);
});

test('linking Google to the signed-in account, and not to a second one', async () => {
  const reg = await call(redis, { body: { action: 'register', acceptTerms: true, username: 'linker1', password: 'secret12' } });
  const cookie = sessionOf(reg);
  const l = await viaGoogle(redis, { sub: 'g6', email: 'l@example.com', email_verified: true }, { link: true, cookie });
  assert.equal(l.headers.Location, '/?google=linked');
  assert.equal(await redis.get('google:g6'), 'linker1');
  const reg2 = await call(redis, { body: { action: 'register', acceptTerms: true, username: 'linker2', password: 'secret12' } });
  const l2 = await viaGoogle(redis, { sub: 'g6' }, { link: true, cookie: sessionOf(reg2) });
  assert.equal(l2.headers.Location, '/?google=in_use');
});

test('without Google set up, the button reports it and start goes back', async () => {
  assert.deepEqual((await call(redis, { method: 'GET', query: { google: 'config' } }, { config: null })).body, { enabled: false });
  assert.equal((await call(redis, { method: 'GET', query: { google: 'start' } }, { config: null })).headers.Location, '/?google=unavailable');
});

test('deleting needs DELETE typed and the password; a Google-only account just the word', async () => {
  const reg = await call(redis, { body: { action: 'register', acceptTerms: true, username: 'deleter', password: 'secret12' } });
  const cookie = sessionOf(reg);
  assert.equal((await call(redis, { body: { action: 'delete_account', password: 'secret12' }, cookie })).status, 400, 'no word');
  assert.equal((await call(redis, { body: { action: 'delete_account', password: 'secret12', confirm: 'nope' }, cookie })).status, 400);
  assert.equal((await call(redis, { body: { action: 'delete_account', confirm: 'DELETE' }, cookie })).status, 400, 'no password');
  assert.equal((await call(redis, { body: { action: 'delete_account', password: 'wrong123', confirm: 'DELETE' }, cookie })).status, 401);
  assert.equal((await call(redis, { body: { action: 'delete_account', password: 'secret12', confirm: 'delete' }, cookie })).status, 200);
  assert.equal(await redis.get('user:deleter'), null);

  const g = await viaGoogle(redis, { sub: 'g7', email: 'g7@example.com', email_verified: true, name: 'Google Only' });
  const d = await call(redis, { body: { action: 'delete_account', confirm: 'Delete' }, cookie: sessionOf(g) });
  assert.equal(d.status, 200);
  assert.equal(await redis.get('google:g7'), null);
  assert.equal(await redis.get('email:g7@example.com'), null);
});

test('changing the password needs the current one and signs other sessions out', async () => {
  const reg = await call(redis, { body: { action: 'register', acceptTerms: true, username: 'changer', password: 'secret12' } });
  const old = sessionOf(reg);
  assert.equal((await call(redis, { body: { action: 'change_password', currentPassword: 'wrong123', password: 'newpass1' }, cookie: old })).status, 401);
  const ok = await call(redis, { body: { action: 'change_password', currentPassword: 'secret12', password: 'newpass1' }, cookie: old });
  assert.equal(ok.status, 200);
  assert.equal((await call(redis, { method: 'GET', cookie: old })).status, 401, 'old session ended');
  assert.equal((await call(redis, { method: 'GET', cookie: sessionOf(ok) })).status, 200, 'this one carries on');
});
