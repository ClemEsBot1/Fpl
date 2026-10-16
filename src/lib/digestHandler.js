// The deadline email's two addresses on /api/auth (see src/lib/digest.js):
// ?digest=send for the scheduled run, ?digest=off for the unsubscribe link.
// Kept here so api/auth.js stays about accounts.

import { get } from '@vercel/blob';
import { getJSON, updateJSON } from './redis.js';
import { userKeyFor } from './auth.js';
import { mailerConfigured, sendMail } from './mailer.js';
import { deadlineDigestEmail } from './emails.js';
import { predictionsPathnameFor } from './accuracy.js';
import { getTargetEvent, seasonIdFor, snapshotIsForSeason } from './predictions.js';
import { digestDue, sendDigests, tokenMatches, unsubscribeToken } from './digest.js';

const FPL = 'https://fantasy.premierleague.com/api/';
const APP_URL = (process.env.APP_URL || 'https://fplchecker.co.uk').replace(/\/+$/, '');

async function fpl(path) {
  const r = await fetch(FPL + path, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`FPL ${path}: ${r.status}`);
  return r.json();
}

async function usersWithDigest(redis) {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', 'user:*', 'COUNT', 500);
    keys.push(...batch);
    cursor = String(next);
  } while (cursor !== '0');
  const records = await Promise.all([...new Set(keys)].map(k => getJSON(redis, k).catch(() => null)));
  // Only to confirmed addresses (see verify_email in api/auth.js).
  return records.filter(r => r && r.username && r.email && r.emailVerified && r.digest);
}

const page = (res, status, title, text) => res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8').setHeader('Cache-Control', 'no-store')
  .send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} | FPL Checker</title><body style="font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 16px"><h1 style="font-size:1.4rem">${title}</h1><p>${text}</p><p><a href="/">Open FPL Checker</a></p></body>`);

export async function digestHandler(req, res, { redis, secret, send = sendMail }) {
  if (req.query.digest === 'off') {
    const username = String(req.query.u || '');
    if (!username || !tokenMatches(username, req.query.t, secret)) return page(res, 400, 'Link not recognised', 'This unsubscribe link isn’t valid. You can turn deadline emails off in the app instead.');
    await updateJSON(redis, userKeyFor(username), record => {
      if (!record || !record.digest) return null;
      const next = { ...record };
      delete next.digest;
      return next;
    });
    return page(res, 200, 'Deadline emails off', 'You won’t get any more deadline emails. You can turn them back on from your team in the app.');
  }
  if (req.query.digest !== 'send') { res.status(404).json({ error: 'not_found' }); return; }
  const expected = process.env.CRON_SECRET;
  if (!expected || (req.headers.authorization || '') !== `Bearer ${expected}`) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'method_not_allowed' }); return; }
  if (!mailerConfigured()) { res.status(200).json({ ok: true, sent: 0, reason: 'mailer_not_configured' }); return; }
  try {
    const bootstrap = await fpl('bootstrap-static/');
    const event = getTargetEvent(bootstrap.events);
    if (!digestDue(event)) { res.status(200).json({ ok: true, sent: 0, reason: 'not_due' }); return; }
    const users = await usersWithDigest(redis);
    if (!users.length) { res.status(200).json({ ok: true, sent: 0, reason: 'no_subscribers' }); return; }
    const season = seasonIdFor(bootstrap.events);
    const file = await get(predictionsPathnameFor(event.id), { access: 'public', useCache: false });
    const saved = file ? JSON.parse(await new Response(file.stream).text()) : null;
    if (!saved || !saved.predictedById || !snapshotIsForSeason(saved, season, bootstrap.events)) { res.status(200).json({ ok: true, sent: 0, reason: 'no_predictions' }); return; }
    const ahead = Object.fromEntries(Object.entries(saved.byGwById || {}).map(([id, weeks]) => [id, (weeks || []).reduce((s, w) => s + w, 0)]));
    // A team's latest picks: from the gameweek in play, or the last one.
    const current = bootstrap.events.find(e => e.is_current) || bootstrap.events.filter(e => e.finished).pop();
    const result = await sendDigests({
      redis, users, event, season,
      loadPicks: teamId => (current ? fpl(`entry/${teamId}/event/${current.id}/picks/`) : Promise.resolve(null)),
      elements: bootstrap.elements, predicted: saved.predictedById, ahead, send,
      email: data => deadlineDigestEmail({
        ...data, appUrl: APP_URL,
        unsubscribeUrl: `${APP_URL}/api/auth?digest=off&u=${encodeURIComponent(data.username)}&t=${unsubscribeToken(data.username, secret)}`,
      }),
    });
    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    res.status(502).json({ error: 'digest_failed', detail: String((e && e.message) || e) });
  }
}
