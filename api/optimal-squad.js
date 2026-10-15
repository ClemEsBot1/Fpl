import { get, list } from '@vercel/blob';
import { snapshotPathnameFor } from './refresh-optimal.js';
import { predictionsPathnameFor } from '../src/lib/accuracy.js';
import { getTargetEvent, seasonIdFor, snapshotIsForSeason } from '../src/lib/predictions.js';
import { SITE, predictionsPage } from '../src/lib/seoPage.js';
import { summariseAccuracy } from '../src/lib/accuracy.js';
import { getRedis } from '../src/lib/redis.js';
import { blueskyConfigured, customPost, duePosts, pastResults, postBluesky, runSocial, sentTo, xIntentUrl } from '../src/lib/social.js';
import { mailerConfigured, sendMail } from '../src/lib/mailer.js';
import { socialDraftEmail } from '../src/lib/emails.js';
import { embedCaptainsHtml, leaguePage, tipsPage } from '../src/lib/seoExtra.js';
import { accuracyPage, comparePage, comparePairs, comparePath, deadlinePage, differentialsPage, parseCompare, priceChangesPage, scheduleGwPage } from '../src/lib/seoMore.js';
import { indexNowKey } from '../src/lib/indexNow.js';
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

const BEST_XI_IMAGE = '/images/best-xi.png';

// The best XI picture (src/lib/socialImage.js), loaded only when asked for:
// it brings satori and resvg.
async function bestXiImage({ model, snap }) {
  const { bestXiData, bestXiPng } = await import('../src/lib/socialImage.js');
  const data = bestXiData(model, snap);
  return data ? { png: await bestXiPng(data), alt: data.alt } : null;
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
  return predictionsPage({ gwName: event.name, deadline: event.deadline_time, players, best, updatedAt: saved.savedAt, nav, path, ...(best ? { image: BEST_XI_IMAGE } : {}) });
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

// Every finished gameweek this season with saved predictions: how they
// did (/fpl-prediction-accuracy). Kept for an hour by a warm function; the
// page itself is cached for six.
let accuracyCache = null;
async function accuracyRows(data) {
  if (accuracyCache && Date.now() - accuracyCache.at < 3600_000) return accuracyCache.rows;
  const { model, bootstrap, season } = data;
  const ids = (await gwIdsWithPages(data)).filter(id => {
    const e = bootstrap.events.find(ev => ev.id === id);
    return e && e.finished && e.data_checked;
  });
  const positionById = Object.fromEntries(model.players.map(p => [p.id, p.positionId]));
  const names = Object.fromEntries(model.players.map(p => [p.id, p.name]));
  const rows = [];
  // A few at a time: each is two files and FPL's live points.
  for (let i = 0; i < ids.length; i += 6) {
    rows.push(...await Promise.all(ids.slice(i, i + 6).map(async gwId => {
      const [saved, snap, live] = await Promise.all([
        readBlobJson(predictionsPathnameFor(gwId)).catch(() => null),
        readBlobJson(snapshotPathnameFor(gwId)).catch(() => null),
        fetchFpl(`event/${gwId}/live/`, 10_000).then(d => d.elements).catch(() => null),
      ]);
      const ok = x => x && snapshotIsForSeason(x, season, bootstrap.events);
      if (!ok(saved) || !saved.predictedById || !live) return { gwId, summary: null, xi: null };
      const past = pastResults(gwId, { saved, snap: ok(snap) ? snap : null, live, names });
      return { gwId, summary: summariseAccuracy(saved.predictedById, live, positionById), xi: past ? { predicted: past.xiPredicted, scored: past.xiScored } : null };
    })));
  }
  accuracyCache = { at: Date.now(), rows };
  return rows;
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
// are rewritten here): ?page=predictions|players|player|team|gw|sitemap|
// tips|embed|league|xi-image|deadline|price-changes|double|blank|
// differentials|compare|accuracy|indexnow-key.
async function seoHtml(req, res) {
  const { page, slug } = req.query;
  if (page === 'indexnow-key') {
    const key = indexNowKey();
    res.status(key ? 200 : 404).setHeader('Content-Type', 'text/plain; charset=utf-8').setHeader('Cache-Control', 'public, max-age=3600').send(key || 'not set');
    return;
  }
  try {
    const data = await loadModel();
    const { model } = data;
    if (page === 'sitemap') {
      res.status(200).setHeader('Content-Type', 'application/xml; charset=utf-8')
        .setHeader('Cache-Control', 'public, max-age=3600, s-maxage=21600').send(sitemapXml(model, await gwIdsWithPages(data), data.saved ? comparePairs(model) : []));
      return;
    }
    // Made from FPL's data alone, so there with or without predictions.
    if (page === 'deadline') return sendHtml(res, 200, deadlinePage(model));
    if (page === 'price-changes') return sendHtml(res, 200, priceChangesPage(model));
    if (page === 'double' || page === 'blank') return sendHtml(res, 200, scheduleGwPage(model, page));
    if (!data.saved && page !== 'gw') return unavailable(res);
    if (page === 'differentials') return sendHtml(res, 200, differentialsPage(model));
    if (page === 'accuracy') {
      res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=21600, stale-while-revalidate=86400');
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(accuracyPage(model, await accuracyRows(data)));
      return;
    }
    if (page === 'compare') {
      const pair = parseCompare(model, req.query.pair);
      if (!pair) return sendHtml(res, 404, notFoundPage(`/compare/${encodeURIComponent(String(req.query.pair || ''))}`, 'Comparison'));
      const path = comparePath(pair[0], pair[1]);
      // One address per pair: b-vs-a goes to a-vs-b.
      if (`/compare/${req.query.pair}` !== path) {
        res.status(301).setHeader('Location', path).setHeader('Cache-Control', 'public, max-age=86400').end();
        return;
      }
      return sendHtml(res, 200, comparePage(model, pair[0], pair[1]));
    }
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
    if (page === 'tips') return sendHtml(res, 200, tipsPage(model, data.snap && data.snap.gwId === model.event.id ? { image: BEST_XI_IMAGE } : {}));
    if (page === 'embed') {
      // Framed by other sites: its own CSP, without the site's
      // frame-ancestors 'none' (see vercel.json).
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8')
        .setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *; base-uri 'none'; form-action 'none'")
        .setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400')
        .send(embedCaptainsHtml(model, { theme: req.query.theme === 'light' ? 'light' : 'dark' }));
      return;
    }
    if (page === 'league') {
      const id = String(req.query.id || '');
      if (!/^\d{1,9}$/.test(id)) return sendHtml(res, 404, notFoundPage(`/league/${encodeURIComponent(id)}`, 'League'));
      const standings = await fetchFpl(`leagues-classic/${id}/standings/`, 10_000).catch(() => null);
      if (!standings || !standings.standings) return sendHtml(res, 404, notFoundPage(`/league/${id}`, 'League'));
      // Each of the top 20 teams' latest picks, for their captain and
      // predicted points.
      const current = data.bootstrap.events.find(e => e.is_current) || data.bootstrap.events.filter(e => e.finished).pop();
      const entries = (standings.standings.results || []).slice(0, 20).map(r => r.entry);
      const picks = {};
      if (current) {
        await Promise.all(entries.map(entry => fetchFpl(`entry/${entry}/event/${current.id}/picks/`, 8_000)
          .then(d => { picks[entry] = d.picks; }).catch(() => {})));
      }
      standings.standings.results = (standings.standings.results || []).slice(0, 20);
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400');
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').send(leaguePage(model, id, standings, picks));
      return;
    }
    if (page === 'xi-image') {
      const image = await bestXiImage(data);
      if (!image) { res.status(404).setHeader('Cache-Control', 'public, max-age=300').json({ error: 'no_best_xi' }); return; }
      res.status(200).setHeader('Content-Type', 'image/png')
        .setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400').send(image.png);
      return;
    }
    return sendHtml(res, 200, plannedPage(data, '/fpl-predictions'));
  } catch {
    unavailable(res);
  }
}

// The social posts (src/lib/social.js): POST ?social=post sends what's
// due (Bluesky, and X drafts by email), GET ?social=preview shows every
// post as it would read now, POST ?social=custom { text } sends a one-off
// and POST ?social=send { key } one of this gameweek's now. Both take an
// optional channels list. Both need CRON_SECRET, like
// /api/refresh-optimal.
// imageFor(post): a picture to attach on Bluesky, or null.
function socialChannels(env = process.env, imageFor = null) {
  const channels = [];
  if (blueskyConfigured(env)) {
    channels.push({ name: 'bluesky', send: async post => postBluesky(post.text, env, fetch, { image: imageFor ? await imageFor(post).catch(() => null) : null }) });
  }
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
  // The admin page's buttons send to the channels they name (Bluesky; X
  // is opened in the browser), the workflow to every channel.
  const only = req.body && Array.isArray(req.body.channels) ? req.body.channels : null;
  const pick = channels => (only ? channels.filter(c => only.includes(c.name)) : channels);
  if (req.query.social === 'custom') {
    const { post, error } = customPost(req.body && req.body.text);
    if (error) { res.status(400).json({ error }); return; }
    const channels = pick(socialChannels());
    const results = channels.length ? await runSocial({ redis: getRedis(), posts: [post], channels }) : {};
    const failed = Object.values(results).some(r => r.error);
    res.status(failed ? 502 : 200).json({ ok: !failed, channels: channels.map(c => c.name), results, xIntentUrl: xIntentUrl(post.text) });
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
    // The preview post goes out with the best XI as a picture.
    const channels = socialChannels(process.env, async post => (post.type === 'preview' ? bestXiImage(data) : null));
    const all = duePosts({ season, model, snap: data.snap, lastFinished, all: true });
    if (preview) {
      const dueKeys = new Set(due.map(p => p.key));
      let sent = {};
      try { sent = await sentTo(getRedis(), all, [...channels.map(c => c.name), 'x']); } catch { /* shown as not sent */ }
      const posts = all.map(p => ({ ...p, due: dueKeys.has(p.key), sent: sent[p.key] || [], xIntentUrl: xIntentUrl(p.text) }));
      res.status(200).json({ ok: true, channels: channels.map(c => c.name), posts });
      return;
    }
    // One of this gameweek's posts, now, from the admin page: marked sent
    // like a scheduled one, so the schedule won't send it again.
    if (req.query.social === 'send') {
      const post = all.find(p => p.key === (req.body && req.body.key));
      if (!post) { res.status(404).json({ error: 'no_such_post' }); return; }
      const picked = pick(channels);
      const results = picked.length ? await runSocial({ redis: getRedis(), posts: [post], channels: picked }) : {};
      const failed = Object.values(results).some(r => r.error);
      res.status(failed ? 502 : 200).json({ ok: !failed, channels: picked.map(c => c.name), results, xIntentUrl: xIntentUrl(post.text) });
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
