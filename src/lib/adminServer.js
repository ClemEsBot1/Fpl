// Server-only: what the admin page (src/screens/AdminScreen.jsx) can see
// and do. Every call is made from api/auth.js after it has checked the
// session belongs to an admin (isAdmin), never from the browser directly.
//
// Admins are the usernames in ADMIN_USERNAMES (comma separated), "clem"
// when it isn't set.
import { del as blobDel, head as blobHead, list as blobList } from '@vercel/blob';
import { getJSON, setJSON, updateJSON } from './redis.js';
import { emailKeyFor, normalizeUsername, userKeyFor } from './auth.js';

const FPL = 'https://fantasy.premierleague.com/api/';
const REPORTS_PREFIX = 'screenshot-reports/';
const REPORTS_DONE_KEY = 'admin:screenshot-reports-done';
const DAY = 864e5;

export function adminUsernames() {
  return (process.env.ADMIN_USERNAMES || 'clem').split(',').map(normalizeUsername).filter(Boolean);
}

export function isAdmin(username) {
  return !!username && adminUsernames().includes(normalizeUsername(username));
}

/* ------------------------------ users ------------------------------ */

async function scanKeys(redis, pattern) {
  const out = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    out.push(...keys);
    cursor = String(next);
  } while (cursor !== '0');
  return out;
}

async function allUsers(redis) {
  const keys = await scanKeys(redis, 'user:*');
  const records = await Promise.all(keys.map(k => getJSON(redis, k)));
  return records.filter(r => r && r.username);
}

// What the admin page shows of an account: never the password hash.
function summary(record) {
  return {
    username: record.username,
    email: record.email || '',
    savedTeams: Array.isArray(record.teams) ? record.teams.length : 0,
    createdAt: record.createdAt || null,
    sessionVersion: record.sessionVersion || 0,
    admin: isAdmin(record.username),
  };
}

// Totals, and sign-ups for each of the last `weeks` weeks (newest last).
// Accounts made before sign-up dates were recorded count as undated.
export async function userStats(redis, now = Date.now(), weeks = 8) {
  const users = await allUsers(redis);
  const byWeek = Array.from({ length: weeks }, (_, k) => ({ weeksAgo: weeks - 1 - k, count: 0 }));
  let undated = 0;
  users.forEach(u => {
    const at = Date.parse(u.createdAt || '');
    if (!Number.isFinite(at)) { undated++; return; }
    const ago = Math.floor((now - at) / (7 * DAY));
    const slot = byWeek.find(w => w.weeksAgo === ago);
    if (slot) slot.count++;
  });
  return {
    total: users.length,
    withSavedTeam: users.filter(u => Array.isArray(u.teams) && u.teams.length).length,
    withEmail: users.filter(u => u.email).length,
    signupsByWeek: byWeek,
    undated,
  };
}

// An account by username or email, or null.
export async function findUser(redis, query) {
  const q = String(query || '').trim();
  if (!q) return null;
  let record = await getJSON(redis, userKeyFor(q));
  if (!record && q.includes('@')) {
    const owner = await redis.get(emailKeyFor(q));
    if (owner) record = await getJSON(redis, userKeyFor(owner));
  }
  return record ? summary(record) : null;
}

// Ends every session the account has open: they all carry the old version.
export async function signOutEverywhere(redis, username) {
  const updated = await updateJSON(redis, userKeyFor(username), r => ({ ...r, sessionVersion: (r.sessionVersion || 0) + 1 }));
  return updated ? summary(updated) : null;
}

// Deletes an account and frees its email address.
export async function deleteUser(redis, username) {
  const key = userKeyFor(username);
  const record = await getJSON(redis, key);
  if (!record) return false;
  await redis.del(key);
  if (record.email && (await redis.get(emailKeyFor(record.email))) === normalizeUsername(record.username)) {
    await redis.del(emailKeyFor(record.email));
  }
  return true;
}

/* ------------------------ screenshot reports ------------------------ */

// "screenshot-reports/2026-10-08T21-00-00-000Z-ab12cd-<suffix>.jpg" ->
// "2026-10-08T21-00-00-000Z-ab12cd": the image and its JSON share it
// (Blob adds a random suffix to each).
export function reportIdOf(pathname) {
  const name = pathname.slice(pathname.lastIndexOf('/') + 1).replace(/\.(jpg|json)$/, '');
  return name.replace(/-[A-Za-z0-9]+$/, '');
}

async function doneIds(redis) {
  const list = await getJSON(redis, REPORTS_DONE_KEY);
  return new Set(Array.isArray(list) ? list : []);
}

// The newest `limit` reports: { id, receivedAt, imageUrl, jsonUrl, report, done }.
export async function listReports(redis, { blob = { list: blobList }, fetchImpl = fetch, limit = 40 } = {}) {
  const blobs = [];
  let cursor;
  do {
    const page = await blob.list({ prefix: REPORTS_PREFIX, cursor });
    blobs.push(...page.blobs);
    cursor = page.cursor;
  } while (cursor);
  const byId = new Map();
  blobs.forEach(b => {
    const id = reportIdOf(b.pathname);
    const r = byId.get(id) || { id, uploadedAt: b.uploadedAt };
    if (b.pathname.endsWith('.jpg')) r.imageUrl = b.url;
    if (b.pathname.endsWith('.json')) r.jsonUrl = b.url;
    byId.set(id, r);
  });
  const done = await doneIds(redis);
  const newest = [...byId.values()].sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, limit);
  return Promise.all(newest.map(async r => {
    let report = null;
    if (r.jsonUrl) {
      try { report = await (await fetchImpl(r.jsonUrl)).json(); } catch { report = null; }
    }
    return { id: r.id, receivedAt: (report && report.receivedAt) || r.uploadedAt || null, imageUrl: r.imageUrl || null, jsonUrl: r.jsonUrl || null, report, done: done.has(r.id) };
  }));
}

export async function setReportDone(redis, id, done) {
  const set = await doneIds(redis);
  if (done) set.add(id); else set.delete(id);
  await setJSON(redis, REPORTS_DONE_KEY, [...set]);
}

export async function deleteReport(redis, urls, { blob = { del: blobDel } } = {}) {
  const ok = (urls || []).filter(u => typeof u === 'string' && /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/screenshot-reports\//.test(u));
  if (ok.length) await blob.del(ok);
  return ok.length;
}

/* -------------------------- model and data -------------------------- */

const GITHUB_REPO = () => process.env.GITHUB_REPO || 'ClemEsBot1/Fpl';
const ML_WORKFLOW = 'ml-retrain.yml';

async function jsonFrom(fetchImpl, url, opts) {
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(10_000), ...opts });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function blobAge(blob, pathname) {
  try {
    const h = await blob.head(pathname);
    return h ? { uploadedAt: new Date(h.uploadedAt).toISOString(), size: h.size } : null;
  } catch { return null; }
}

// The ML model's last run and record, when the data the app reads was last
// refreshed, and the last runs of the retraining workflow (with a GitHub
// token set).
export async function healthReport(redis, { host, fetchImpl = fetch, blob = { head: blobHead } } = {}) {
  const base = host ? `${host.startsWith('localhost') ? 'http' : 'https'}://${host}` : null;
  const [pred, history, bootstrap] = await Promise.all([
    base ? jsonFrom(fetchImpl, `${base}/ml/predictions.json`) : null,
    base ? jsonFrom(fetchImpl, `${base}/ml/history.json`) : null,
    jsonFrom(fetchImpl, `${FPL}bootstrap-static/`),
  ]);
  const target = bootstrap && (bootstrap.events || []).find(e => e.is_next);
  const gw = target ? target.id : null;
  const [odds, playerHistory, squad, saved] = await Promise.all([
    blobAge(blob, 'odds-latest.json'),
    blobAge(blob, 'player-history.json'),
    gw ? blobAge(blob, `optimal-squad-gw${gw}.json`) : null,
    gw ? blobAge(blob, `predictions-gw${gw}.json`) : null,
  ]);
  let snapshots = null;
  try {
    const list = await getJSON(redis, 'transfer-snapshots');
    if (Array.isArray(list) && list.length) snapshots = { count: list.length, latestAt: new Date(list[list.length - 1].at).toISOString(), gw: list[list.length - 1].gw };
  } catch { snapshots = null; }

  let runs = null;
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (token) {
    const data = await jsonFrom(fetchImpl, `https://api.github.com/repos/${GITHUB_REPO()}/actions/workflows/${ML_WORKFLOW}/runs?per_page=5`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'fpl-squad-check' },
    });
    runs = data && Array.isArray(data.workflow_runs)
      ? data.workflow_runs.map(r => ({ status: r.status, conclusion: r.conclusion, createdAt: r.created_at, url: r.html_url, event: r.event }))
      : null;
  }
  const weeks = history && Array.isArray(history.weeks) ? history.weeks : [];
  return {
    gameweek: gw,
    ml: pred ? { gwId: pred.gwId, season: pred.season, builtAt: pred.builtAt, trainedRows: pred.trainedRows, players: Object.keys(pred.byId || {}).length } : null,
    mlWeeks: weeks.slice(-10),
    retrain: { canTrigger: !!token, runs, actionsUrl: `https://github.com/${GITHUB_REPO()}/actions/workflows/${ML_WORKFLOW}` },
    data: { odds, playerHistory, bestSquad: squad, savedPredictions: saved, transferSnapshots: snapshots },
    canRefresh: !!process.env.CRON_SECRET,
  };
}

// Starts the ML retraining workflow now (needs GITHUB_DISPATCH_TOKEN: a
// fine-grained token with Actions read and write on the repository).
export async function triggerRetrain({ fetchImpl = fetch } = {}) {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) return { ok: false, error: 'not_configured' };
  const r = await fetchImpl(`https://api.github.com/repos/${GITHUB_REPO()}/actions/workflows/${ML_WORKFLOW}/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'fpl-squad-check', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main' }),
    signal: AbortSignal.timeout(10_000),
  });
  return r.status === 204 ? { ok: true } : { ok: false, error: `github_${r.status}` };
}

// Rebuilds the best squad and saved predictions now, as the daily cron does.
export async function refreshBestSquad(host, { fetchImpl = fetch } = {}) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !host) return { ok: false, error: 'not_configured' };
  const r = await fetchImpl(`${host.startsWith('localhost') ? 'http' : 'https'}://${host}/api/refresh-optimal`, {
    method: 'POST', headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(60_000),
  });
  let body = null;
  try { body = await r.json(); } catch { body = null; }
  return r.ok ? { ok: true, result: body } : { ok: false, error: `refresh_${r.status}`, result: body };
}
