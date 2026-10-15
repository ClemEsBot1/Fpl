import { get, list } from '@vercel/blob';
import { snapshotPathnameFor } from './refresh-optimal.js';
import { predictionsPathnameFor } from '../src/lib/accuracy.js';
import { getTargetEvent, seasonIdFor, snapshotIsForSeason } from '../src/lib/predictions.js';
import { SITE, predictionsPage } from '../src/lib/seoPage.js';
import { getRedis } from '../src/lib/redis.js';
import { blueskyConfigured, duePosts, pastResults, postBluesky, runSocial, xIntentUrl } from '../src/lib/social.js';
import { mailerConfigured, sendMail } from '../src/lib/mailer.js';
import { socialDraftEmail } from '../src/lib/emails.js';
import { AHEAD, futureGwPage, gwNav, notFoundPage, pastGwPage, playerPage, playersHubPage, seoModel, sitemapXml, teamPage } from '../src/lib/seoDynamic.js';

const FPL_BASE = 'https://fantasy.premierleague.com/api/';

async function readBlobJson(pathname) {
  const result = await get(pathname, { access: 'public', useCache: false });
  if (!result) return null;
  return JSON.parse(await new Response(result.stream).text());
}

async function fetchFpl(path, timeout = 15_000) {
  const r = await fetch(FPL_BASE + path, { signal: AbortSignal.timeout(timeout) });
  if (!r.ok) throw new Error(`FPL ${path}: ${r.status}`);
  return r.json();
}

// FPL's data and this gameweek's saved predictions, kept for 10 minutes by
// a warm function so a crawler going through player pages doesn't fetch
// them for each one.
let cached = null;
async function loadModel() {
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value;
  const [bootstrap, fixtures] = await Promise.all([fetchFpl('bootstrap-static/'), fetchFpl('fixtures/')]);
  const event = getTargetEvent(bootstrap.events);
  if (!event) throw new Error('no gameweek to plan');
  const season = seasonIdFor(bootstrap.events);
  const [saved, snap] = await Promise.all([
    readBlobJson(predictionsPathnameFor(event.id)).catch(() => null),
    readBlobJson(snapshotPathnameFor(event.id)).catch(() => null),
  ]);
  const fresh = saved && saved.predictedById && snapshotIsForSeason(saved, season, bootstrap.events) ? saved : null;
  const value = { bootstrap, season, saved: fresh, snap, model: seoModel({ bootstrap, fixtures, event, saved: fresh }) };
  // Not kept without predictions: they may just have failed to load.
  if (fresh) cached = { at: Date.now(), value };
  return value;
}

function sendHtml(res, status, html) {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8');
  if (status === 200) res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400');
  else res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600');
  res.send(html);
}

function unavailable(res) {
  res.status(503).setHeader('Content-Type', 'text/html; charset=utf-8').setHeader('Retry-After', '3600').setHeader('Cache-Control', 'no-store')
    .send('<!doctype html><meta charset="utf-8"><title>FPL predictions | FPL Checker</title><p>This page isn’t ready yet. <a href="/">Open FPL Checker</a></p>');
}

// The gameweek being planned (/fpl-predictions, and /gw/<n> for it), from
// the predictions and best squad the refresh job saved for it.
function plannedPage({ model, saved, snap }, path) {
  const event = model.event;
  const players = model.players.filter(p => p.predicted !== null);
  const byId = Object.fromEntries(players.map(p => [p.id, p]));
  const best = snap && Array.isArray(snap.startingIds) && snap.gwId === event.id
    ? { xi: snap.startingIds.map(id => byId[id]).filter(Boolean).sort((a, b) => a.positionId - b.positionId || b.predicted - a.predicted), captainId: snap.captainId }
    : null;
  const nav = gwNav(model, event.id);
  return predictionsPage({ gwName: event.name, deadline: event.deadline_time, players, best, updatedAt: saved.savedAt, nav, path });
}

// /gw/<n>: before the gameweek being planned, what was predicted (and
// scored); after it, an early look from the next five gameweeks' figures.
async function gwHtml(data, gwId) {
  const { model, bootstrap, season } = data;
  const target = model.event.id;
  const event = bootstrap.events.find(e => e.id === gwId);
  const path = `/gw/${gwId}`;
  if (!event) return [404, notFoundPage(path, `Gameweek ${gwId}`)];
  if (gwId === target) return data.saved ? [200, plannedPage(data, path)] : null;
  if (gwId > target) {
    return gwId < target + AHEAD && data.saved && data.saved.byGwById ? [200, futureGwPage(model, gwId, event.name)] : [404, notFoundPage(path, `${event.name} predictions`)];
  }
  const [saved, snap] = await Promise.all([
    readBlobJson(predictionsPathnameFor(gwId)).catch(() => null),
    readBlobJson(snapshotPathnameFor(gwId)).catch(() => null),
  ]);
  if (!saved || !saved.predictedById || !snapshotIsForSeason(saved, season, bootstrap.events)) return [404, notFoundPage(path, `${event.name} predictions`)];
  const live = event.finished || event.data_checked || event.is_current
    ? await fetchFpl(`event/${gwId}/live/`, 10_000).then(d => d.elements).catch(() => null)
    : null;
  return [200, pastGwPage(model, gwId, event.name, { saved, snap: snap && snapshotIsForSeason(snap, season, bootstrap.events) ? snap : null, live })];
}

// The gameweeks with saved predictions this season, plus those ahead.
async function gwIdsWithPages({ model, saved }) {
  const target = model.event.id;
  const ids = new Set();
  try {
    const { blobs } = await list({ prefix: 'predictions-gw', limit: 100 });
    blobs.forEach(b => {
      const m = /^predictions-gw(\d+)\.json$/.exec(b.pathname);
      if (m && Number(m[1]) < target) ids.add(Number(m[1]));
    });
  } catch { /* the past gameweeks are just left out */ }
  if (saved) {
    ids.add(target);
    if (saved.byGwById) for (let gw = target + 1; gw < target + AHEAD && gw <= 38; gw++) ids.add(gw);
  }
  return [...ids].sort((a, b) => a - b);
}

// The pages for search engines (see vercel.json for the addresses that
// are rewritten here): ?page=predictions|players|player|team|gw|sitemap.
async function seoHtml(req, res) {
  const { page, slug } = req.query;
  try {
    const data = await loadModel();
    const { model } = data;
    if (page === 'sitemap') {
      res.status(200).setHeader('Content-Type', 'application/xml; charset=utf-8')
        .setHeader('Cache-Control', 'public, max-age=3600, s-maxage=21600').send(sitemapXml(model, await gwIdsWithPages(data)));
      return;
    }
    if (!data.saved && page !== 'gw') return unavailable(res);
    if (page === 'player') {
      const p = model.playerBySlug[String(slug || '')];
      if (!p) return sendHtml(res, 404, notFoundPage(`/player/${encodeURIComponent(String(slug || ''))}`, 'Player'));
      const history = await fetchFpl(`element-summary/${p.id}/`, 8_000).then(d => d.history).catch(() => null);
      return sendHtml(res, 200, playerPage(model, p, history));
    }
    if (page === 'team') {
      const t = model.teamBySlug[String(slug || '')];
      if (!t) return sendHtml(res, 404, notFoundPage(`/team/${encodeURIComponent(String(slug || ''))}`, 'Club'));
      return sendHtml(res, 200, teamPage(model, t));
    }
    if (page === 'gw') {
      const gwId = Number(req.query.n);
      if (!Number.isInteger(gwId) || gwId < 1 || gwId > 38) return sendHtml(res, 404, notFoundPage(`/gw/${encodeURIComponent(String(req.query.n || ''))}`, 'Gameweek'));
      const out = await gwHtml(data, gwId);
      return out ? sendHtml(res, out[0], out[1]) : unavailable(res);
    }
    if (page === 'players') return sendHtml(res, 200, playersHubPage(model));
    return sendHtml(res, 200, plannedPage(data, '/fpl-predictions'));
  } catch {
    unavailable(res);
  }
}

// The social posts (src/lib/social.js): POST ?social=post sends what's
// due (Bluesky, and X drafts by email), GET ?social=preview shows every
// post as it would read now. Both need CRON_SECRET, like
// /api/refresh-optimal.
function socialChannels(env = process.env) {
  const channels = [];
  if (blueskyConfigured(env)) channels.push({ name: 'bluesky', send: post => postBluesky(post.text, env) });
  if (env.SOCIAL_DRAFTS_EMAIL && mailerConfigured()) {
    channels.push({ name: 'x-draft', send: post => sendMail({ to: env.SOCIAL_DRAFTS_EMAIL, ...socialDraftEmail({ label: post.label, text: post.text, intentUrl: xIntentUrl(post.text), appUrl: SITE }) }) });
  }
  return channels;
}

async function socialHandler(req, res) {
  const expected = process.env.CRON_SECRET;
  if (!expected || (req.headers.authorization || '') !== `Bearer ${expected}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const preview = req.query.social === 'preview';
  if (!preview && req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  try {
    const data = await loadModel();
    if (!data.saved) { res.status(200).json({ ok: true, sent: null, reason: 'no_predictions' }); return; }
    const { model, bootstrap, season } = data;
    // The gameweek before the one being planned, once FPL has checked
    // its points.
    const last = bootstrap.events.find(e => e.id === model.event.id - 1);
    let lastFinished = null;
    if (last && last.finished && last.data_checked) {
      const [saved, snap, live] = await Promise.all([
        readBlobJson(predictionsPathnameFor(last.id)).catch(() => null),
        readBlobJson(snapshotPathnameFor(last.id)).catch(() => null),
        fetchFpl(`event/${last.id}/live/`, 10_000).then(d => d.elements).catch(() => null),
      ]);
      const ok = x => x && snapshotIsForSeason(x, season, bootstrap.events);
      lastFinished = pastResults(last.id, { saved: ok(saved) ? saved : null, snap: ok(snap) ? snap : null, live, names: Object.fromEntries(model.players.map(p => [p.id, p.name])) });
    }
    const due = duePosts({ season, model, snap: data.snap, lastFinished });
    const channels = socialChannels();
    if (preview) {
      const dueKeys = new Set(due.map(p => p.key));
      const posts = duePosts({ season, model, snap: data.snap, lastFinished, all: true })
        .map(p => ({ ...p, due: dueKeys.has(p.key), xIntentUrl: xIntentUrl(p.text) }));
      res.status(200).json({ ok: true, channels: channels.map(c => c.name), posts });
      return;
    }
    if (!channels.length) { res.status(200).json({ ok: true, sent: null, reason: 'no_channels', due: due.map(p => p.type) }); return; }
    const results = await runSocial({ redis: getRedis(), posts: due, channels });
    const failed = Object.values(results).some(r => r.error);
    res.status(failed ? 502 : 200).json({ ok: !failed, results });
  } catch (e) {
    res.status(502).json({ error: 'social_failed', detail: String((e && e.message) || e) });
  }
}

export default async function handler(req, res) {
  if (req.query && req.query.social) return socialHandler(req, res);
  if (req.query && req.query.page) return seoHtml(req, res);
  const gwId = Number(req.query && req.query.gw);
  if (!gwId || !Number.isInteger(gwId) || gwId < 1) {
    res.status(400).json({ error: 'missing_or_invalid_gw' });
    return;
  }

  try {
    const result = await get(snapshotPathnameFor(gwId), { access: 'public', useCache: false });
    if (!result) {
      res.status(404).json({ error: 'not_built_yet' });
      return;
    }
    const text = await new Response(result.stream).text();
    res
      .status(200)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300')
      .send(text);
  } catch (e) {
    // Covers "never built yet" as well as any transient storage error — the
    // frontend treats a non-200 here the same way either way (fall back to
    // its own local cache/fresh build for the current gameweek, or show
    // "no saved data" for a past one).
    res.status(404).json({ error: 'not_built_yet', detail: String((e && e.message) || e) });
  }
}
