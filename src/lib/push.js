// Web Push: alerts for your team (src/lib/alerts.js) as phone or desktop
// notifications even with the app closed. Served from /api/auth?push=…
// (see api/auth.js), so it doesn't need a function of its own:
//
//   GET  ?push=key          the server's public key, for subscribing
//   POST ?push=subscribe    { subscription, playerIds }: save or update one
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
import { buildAlerts } from './alerts.js';
import { buildStaticDataFromRaw } from './predictions.js';
import { isJsonRequest } from './auth.js';

const PREFIX = 'push:sub:';
const MAX_SENT = 100;
const MAX_PLAYERS = 15;
export const SUBSCRIBE_WINDOW_SECONDS = 60 * 60;
export const MAX_SUBSCRIBES_PER_IP = 30;
const FPL_BASE = 'https://fantasy.premierleague.com/api/';
const APP_URL = (process.env.APP_URL || 'https://fplchecker.vercel.app').replace(/\/+$/, '');

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

// Sends every subscriber the alerts they haven't had yet. Each record
// keeps the ids it was sent, so an alert goes once; a subscription the
// push service says is gone (404, 410) is deleted.
export async function sendPushAlerts({ redis, sender, staticData, now = Date.now() }) {
  let sent = 0;
  let removed = 0;
  for (const key of await allKeys(redis)) {
    const record = await getJSON(redis, key);
    if (!record || !record.subscription) continue;
    const fresh = buildAlerts(staticData, record.playerIds || [], now).filter(a => !(record.sent || []).includes(a.id));
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
      await setJSON(redis, key, { ...record, sent: [...(record.sent || []), ...delivered].slice(-MAX_SENT) });
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
    await setJSON(redis, key, { subscription, playerIds: cleanPlayerIds(body.playerIds), sent: (existing && existing.sent) || [], at: Date.now() });
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
      const staticData = deps.staticData || buildStaticDataFromRaw(await fetchFpl('bootstrap-static/'), await fetchFpl('fixtures/'));
      res.status(200).json({ ok: true, ...(await sendPushAlerts({ redis, sender, staticData, now: deps.now || Date.now() })) });
    } catch (e) {
      res.status(502).json({ error: 'send_failed', detail: String((e && e.message) || e) });
    }
    return;
  }

  res.status(400).json({ error: 'unknown_push_action' });
}
