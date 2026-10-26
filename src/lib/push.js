// Web Push: alerts for your team (src/lib/alerts.js) as phone or desktop
// notifications even with the app closed. Served from /api/auth?push=…
// (see api/auth.js), so it doesn't need a function of its own:
//
//   GET  ?push=key          the server's public key, for subscribing
//   POST ?push=subscribe    { subscription, playerIds, watchIds?, teamId?, lang? }: save or update one
//   POST ?push=unsubscribe  { endpoint }
//   POST ?push=send         sends each subscriber the alerts not sent to
//                           them before. Needs CRON_SECRET, like
//                           /api/refresh-optimal; called every 20 minutes
//                           by .github/workflows/transfer-snapshots.yml.
//
// Off until the VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars are set
// (generate a pair with `npx web-push generate-vapid-keys`). Until then
// ?push=key answers 404 and the app keeps to notifications while it's open.

import { createHash } from 'node:crypto';
import webpush from 'web-push';
import { getRedis, getJSON, setJSON } from './redis.js';
import { bump, clientIp } from './rateLimit.js';
import { buildAlerts, predictionBaseline } from './alerts.js';
import { RECENT_MS, liveAlerts } from './liveAlerts.js';
import { cleanTeamId } from './digest.js';
import { buildStaticDataFromRaw } from './predictions.js';
import { isJsonRequest } from './auth.js';
import { LANGUAGES, makeT, t } from './i18n.js';

const PREFIX = 'push:sub:';
const MAX_SENT = 200;
const MAX_PLAYERS = 15;
export const SUBSCRIBE_WINDOW_SECONDS = 60 * 60;
export const MAX_SUBSCRIBES_PER_IP = 30;
const FPL_BASE = 'https://fantasy.premierleague.com/api/';
const APP_URL = (process.env.APP_URL || 'https://fplchecker.co.uk').replace(/\/+$/, '');

// The app's language code, if it's one of ours other than English.
export function cleanLang(code) {
  return typeof code === 'string' && code !== 'en' && LANGUAGES.some(l => l.code === code) ? code : null;
}

// The translations, loaded only when alerts go out; without them every
// subscriber gets English.
async function dictionaries() {
  try {
    return (await import('./serverLocales.js')).DICTIONARIES;
  } catch {
    return {};
  }
}

export function pushConfigured(env = process.env) {
  return !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
}

// A browser's subscription as sent by PushManager.subscribe(), checked:
// { endpoint, keys: { p256dh, auth } }, or null when it isn't one.
export function cleanSubscription(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const { endpoint, keys } = sub;
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return null;
  let url;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  if (keys.p256dh.length > 200 || keys.auth.length > 100) return null;
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

export function cleanPlayerIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0 && n < 10000))].slice(0, MAX_PLAYERS);
}

export function subscriptionKey(endpoint) {
  return PREFIX + createHash('sha256').update(endpoint).digest('hex').slice(0, 32);
}

async function allKeys(redis) {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${PREFIX}*`, 'COUNT', 200);
    keys.push(...batch);
    cursor = String(next);
  } while (cursor !== '0');
  return [...new Set(keys)];
}

async function fetchFpl(path) {
  const r = await fetch(FPL_BASE + path, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`FPL ${path}: ${r.status}`);
  return r.json();
}

// Writes `fields` onto the subscription as it is now, re-read just before
// writing, so a send run doesn't put back a squad the browser has since
// replaced, or a subscription it has since removed.
async function patchRecord(redis, key, fields) {
  const current = await getJSON(redis, key);
  if (!current) return;
  await setJSON(redis, key, { ...current, ...fields });
}

// Whether a team has made no transfer in gameweek `event`, from FPL's
// entry/{id}/transfers/ list; null when that couldn't be read.
async function noTransferYet(fetchTransfers, teamId, event) {
  try {
    const list = await fetchTransfers(teamId);
    return Array.isArray(list) ? !list.some(t => t && t.event === event) : null;
  } catch { return null; }
}

// Sends every subscriber the alerts they haven't had yet. Each record
// keeps the ids it was sent, so an alert goes once; a subscription the
// push service says is gone (404, 410) is deleted. Each record also keeps
// its squad's predictions as first seen this gameweek, so a later drop is
// pushed too. With a team id, the two-hour deadline alert checks FPL for
// a transfer this gameweek (one request per team, only then).
// The gameweek with a match under way or just played (within RECENT_MS of
// kickoff): its live scores and fixtures, for the match alerts. null when
// no match is, or FPL's live data can't be had.
async function liveWeek(bootstrap, fixtures, now) {
  const recent = (fixtures || []).filter(f => f.event && f.started && f.kickoff_time && now - new Date(f.kickoff_time).getTime() < RECENT_MS);
  if (!recent.length) return null;
  const gwId = Math.max(...recent.map(f => f.event));
  try {
    const data = await fetchFpl(`event/${gwId}/live/`);
    return { gwId, elements: data.elements || [], fixtures: fixtures.filter(f => f.event === gwId) };
  } catch {
    return null;
  }
}

// live: the gameweek being played ({ gwId, elements, fixtures }), for the
// match alerts (src/lib/liveAlerts.js); null between gameweeks.
export async function sendPushAlerts({ redis, sender, staticData, live = null, now = Date.now(), fetchTransfers = id => fetchFpl(`entry/${id}/transfers/`) }) {
  let sent = 0;
  let removed = 0;
  const dicts = await dictionaries();
  for (const key of await allKeys(redis)) {
    let record = await getJSON(redis, key);
    if (!record || !record.subscription) continue;
    const playerIds = record.playerIds || [];
    const watchIds = record.watchIds || [];
    const previous = record.baseline || null;
    const baseline = predictionBaseline(previous, staticData, playerIds);
    if (baseline && JSON.stringify(baseline) !== JSON.stringify(previous)) {
      record = { ...record, baseline };
      await patchRecord(redis, key, { baseline });
    }
    const seen = previous && baseline && previous.gwId === baseline.gwId ? previous : null;
    const isNew = a => !(record.sent || []).includes(a.id);
    const tr = record.lang && dicts[record.lang] ? makeT(dicts[record.lang]) : t;
    let fresh = buildAlerts(staticData, playerIds, now, { baseline: seen, tr, watchIds }).filter(isNew);
    const target = staticData.targetEvent;
    if (record.teamId && target && fresh.some(a => a.id === `deadline-${target.id}-2h`)
      && await noTransferYet(fetchTransfers, record.teamId, target.id)) {
      fresh = buildAlerts(staticData, playerIds, now, { baseline: seen, noTransferYet: true, tr, watchIds }).filter(isNew);
    }
    fresh = [...fresh, ...liveAlerts(live, playerIds, { playersById: staticData.playersById, teamsById: staticData.teamsById, now, tr }).filter(isNew)];
    if (!fresh.length) continue;
    let gone = false;
    const delivered = [];
    for (const a of fresh) {
      try {
        await sender.sendNotification(record.subscription, JSON.stringify({ title: a.title, body: a.body, tag: a.id }), { TTL: 6 * 3600 });
        delivered.push(a.id);
        sent++;
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) { gone = true; break; }
      }
    }
    if (gone) {
      await redis.del(key);
      removed++;
    } else if (delivered.length) {
      await patchRecord(redis, key, { sent: [...(record.sent || []), ...delivered].slice(-MAX_SENT) });
    }
  }
  return { sent, removed };
}

// `deps` exist for tests: an in-memory Redis, a fake sender, the FPL data.
export async function pushHandler(req, res, deps = {}) {
  const action = req.query && req.query.push;
  const env = deps.env || process.env;

  if (action === 'key') {
    if (!pushConfigured(env)) { res.status(404).json({ error: 'push_not_configured' }); return; }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).json({ publicKey: env.VAPID_PUBLIC_KEY });
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (!pushConfigured(env)) { res.status(404).json({ error: 'push_not_configured' }); return; }
  const redis = deps.redis || getRedis();
  const body = req.body || {};
  if ((action === 'subscribe' || action === 'unsubscribe') && !isJsonRequest(req)) {
    res.status(415).json({ error: 'Send this request as JSON.' });
    return;
  }

  if (action === 'subscribe') {
    const subscription = cleanSubscription(body.subscription);
    if (!subscription) { res.status(400).json({ error: 'bad_subscription' }); return; }
    if (await bump(redis, `rl:push:${clientIp(req)}`, SUBSCRIBE_WINDOW_SECONDS) > MAX_SUBSCRIBES_PER_IP) {
      res.status(429).json({ error: 'too_many_requests' });
      return;
    }
    const key = subscriptionKey(subscription.endpoint);
    const existing = await getJSON(redis, key);
    const teamId = cleanTeamId(body.teamId);
    const lang = cleanLang(body.lang);
    await setJSON(redis, key, {
      subscription, playerIds: cleanPlayerIds(body.playerIds), sent: (existing && existing.sent) || [], at: Date.now(),
      ...(cleanPlayerIds(body.watchIds).length ? { watchIds: cleanPlayerIds(body.watchIds) } : {}),
      ...(teamId ? { teamId } : {}),
      ...(lang ? { lang } : {}),
      ...(existing && existing.baseline ? { baseline: existing.baseline } : {}),
    });
    res.status(200).json({ ok: true });
    return;
  }

  if (action === 'unsubscribe') {
    if (typeof body.endpoint !== 'string') { res.status(400).json({ error: 'bad_endpoint' }); return; }
    await redis.del(subscriptionKey(body.endpoint));
    res.status(200).json({ ok: true });
    return;
  }

  if (action === 'send') {
    const expected = env.CRON_SECRET;
    if (!expected || (req.headers.authorization || '') !== `Bearer ${expected}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    let sender = deps.sender;
    if (!sender) {
      webpush.setVapidDetails(env.VAPID_SUBJECT || APP_URL, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
      sender = webpush;
    }
    try {
      let staticData = deps.staticData;
      let live = deps.live || null;
      if (!staticData) {
        const [bootstrap, fixtures] = [await fetchFpl('bootstrap-static/'), await fetchFpl('fixtures/')];
        staticData = buildStaticDataFromRaw(bootstrap, fixtures);
        live = await liveWeek(bootstrap, fixtures, deps.now || Date.now());
      }
      res.status(200).json({ ok: true, ...(await sendPushAlerts({ redis, sender, staticData, live, now: deps.now || Date.now(), ...(deps.fetchTransfers ? { fetchTransfers: deps.fetchTransfers } : {}) })) });
    } catch (e) {
      res.status(502).json({ error: 'send_failed', detail: String((e && e.message) || e) });
    }
    return;
  }

  res.status(400).json({ error: 'unknown_push_action' });
}
