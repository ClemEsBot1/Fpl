import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import authHandler from '../api/auth.js';
import { isAdmin, reportIdOf } from '../src/lib/adminServer.js';
import { fakeRedis } from './helpers/fakeRedis.js';

process.env.JWT_SECRET = 'test-secret';

let redis;
// Stand-ins for Vercel Blob and the network, passed through to the admin calls.
const blobs = [
  { pathname: 'screenshot-reports/2026-10-01T10-00-00-000Z-aa11bb-Xy12.jpg', url: 'https://abc.public.blob.vercel-storage.com/screenshot-reports/r1.jpg', uploadedAt: '2026-10-01T10:00:00Z' },
  { pathname: 'screenshot-reports/2026-10-01T10-00-00-000Z-aa11bb-Pq34.json', url: 'https://abc.public.blob.vercel-storage.com/screenshot-reports/r1.json', uploadedAt: '2026-10-01T10:00:00Z' },
  { pathname: 'screenshot-reports/2026-10-03T09-00-00-000Z-cc22dd-Zz99.jpg', url: 'https://abc.public.blob.vercel-storage.com/screenshot-reports/r2.jpg', uploadedAt: '2026-10-03T09:00:00Z' },
];
let deleted;
const admin = () => ({
  blob: { list: async () => ({ blobs, cursor: undefined }), del: async urls => { deleted.push(...urls); }, head: async () => null },
  fetchImpl: async url => ({ ok: true, json: async () => (url.endsWith('r1.json') ? { receivedAt: '2026-10-01T10:00:00Z', note: 'Saka read as Salah', slots: [] } : null) }),
});

function request({ body, cookie, method = 'POST' }) {
  return new Promise(resolve => {
    const res = {
      headers: {}, statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b, headers: this.headers }); },
    };
    const headers = { 'x-forwarded-for': '203.0.113.7', 'content-type': 'application/json', host: 'localhost:3000' };
    if (cookie) headers.cookie = cookie;
    authHandler({ method, body, headers }, res, redis, async () => {}, admin());
  });
}
const cookieOf = r => r.headers['Set-Cookie'].split(';')[0];
let clemCookie;
let samCookie;

beforeEach(async () => {
  redis = fakeRedis();
  deleted = [];
  delete process.env.ADMIN_USERNAMES;
  const clem = await request({ body: { action: 'register', username: 'clem', password: 'correct-horse', email: 'clem@example.com' } });
  clemCookie = cookieOf(clem);
  const sam = await request({ body: { action: 'register', username: 'Sam_1', password: 'correct-horse', email: 'sam@example.com' } });
  samCookie = cookieOf(sam);
});

test('clem is an admin by default; ADMIN_USERNAMES replaces the list', () => {
  assert.equal(isAdmin('Clem'), true);
  assert.equal(isAdmin('sam_1'), false);
  process.env.ADMIN_USERNAMES = 'sam_1, other';
  assert.equal(isAdmin('sam_1'), true);
  assert.equal(isAdmin('clem'), false);
  delete process.env.ADMIN_USERNAMES;
});

test('the account says who is an admin', async () => {
  assert.equal((await request({ method: 'GET', cookie: clemCookie })).body.admin, true);
  assert.equal((await request({ method: 'GET', cookie: samCookie })).body.admin, undefined);
});

test('only a signed-in admin gets in', async () => {
  assert.equal((await request({ body: { action: 'admin', op: 'users' } })).status, 401);
  assert.equal((await request({ body: { action: 'admin', op: 'users' }, cookie: samCookie })).status, 403);
  const ok = await request({ body: { action: 'admin', op: 'users' }, cookie: clemCookie });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.total, 2);
  assert.equal(ok.body.withEmail, 2);
  assert.equal(ok.body.signupsByWeek.at(-1).count, 2, 'both signed up this week');
});

test('find an account by name or email, never its password', async () => {
  const byEmail = await request({ body: { action: 'admin', op: 'find_user', query: 'SAM@example.com' }, cookie: clemCookie });
  assert.equal(byEmail.body.user.username, 'Sam_1');
  assert.equal(byEmail.body.user.passwordHash, undefined);
  assert.equal((await request({ body: { action: 'admin', op: 'find_user', query: 'nobody' }, cookie: clemCookie })).body.user, null);
});

test('signing someone out everywhere ends their sessions', async () => {
  const r = await request({ body: { action: 'admin', op: 'sign_out_user', username: 'sam_1' }, cookie: clemCookie });
  assert.equal(r.body.user.sessionVersion, 1);
  assert.equal((await request({ method: 'GET', cookie: samCookie })).status, 401);
});

test('deleting an account frees its email; your own account is refused', async () => {
  assert.equal((await request({ body: { action: 'admin', op: 'delete_user', username: 'clem' }, cookie: clemCookie })).status, 400);
  assert.equal((await request({ body: { action: 'admin', op: 'delete_user', username: 'sam_1' }, cookie: clemCookie })).body.ok, true);
  assert.equal(await redis.get('user:sam_1'), null);
  assert.equal(await redis.get('email:sam@example.com'), null);
  const again = await request({ body: { action: 'register', username: 'newsam', password: 'correct-horse', email: 'sam@example.com' } });
  assert.equal(again.status, 200);
});

test('screenshot reports pair each image with its details, newest first, and can be marked done or deleted', async () => {
  assert.equal(reportIdOf('screenshot-reports/2026-10-01T10-00-00-000Z-aa11bb-Pq34.json'), '2026-10-01T10-00-00-000Z-aa11bb');
  const list = await request({ body: { action: 'admin', op: 'reports' }, cookie: clemCookie });
  assert.deepEqual(list.body.reports.map(r => r.id), ['2026-10-03T09-00-00-000Z-cc22dd', '2026-10-01T10-00-00-000Z-aa11bb']);
  assert.equal(list.body.reports[1].report.note, 'Saka read as Salah');
  await request({ body: { action: 'admin', op: 'report_done', id: '2026-10-01T10-00-00-000Z-aa11bb', done: true }, cookie: clemCookie });
  assert.equal((await request({ body: { action: 'admin', op: 'reports' }, cookie: clemCookie })).body.reports[1].done, true);
  const del = await request({ body: { action: 'admin', op: 'report_delete', urls: [blobs[0].url, 'https://evil.example.com/x.jpg'] }, cookie: clemCookie });
  assert.equal(del.body.deleted, 1, 'only screenshot-report files can be deleted');
  assert.deepEqual(deleted, [blobs[0].url]);
});

test('retraining needs a GitHub token; without one it says so', async () => {
  delete process.env.GITHUB_DISPATCH_TOKEN;
  const r = await request({ body: { action: 'admin', op: 'retrain' }, cookie: clemCookie });
  assert.deepEqual(r.body, { ok: false, error: 'not_configured' });
});
