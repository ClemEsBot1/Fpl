// FPL Checker's posts for social media: up to four a gameweek, each useful
// on its own and linking to a page on the site.
//
//   results       after a gameweek: the best XI's predicted v actual score
//   differential  ~2 days before the deadline: a low-owned player predicted well
//   preview       the day before: the best XI and the top picks
//   captain       hours before: the top three captain options
//   prices        every evening: the players likely to rise or fall in
//                 price overnight (src/lib/seoMore.js priceData)
//
// Where they go (both free):
//   Bluesky   posted by the bot, when BLUESKY_HANDLE and BLUESKY_APP_PASSWORD
//             (an app password from Bluesky's settings) are set.
//   X         emailed as a draft to SOCIAL_DRAFTS_EMAIL (needs the SMTP_*
//             settings, see mailer.js) with a button that opens X with the
//             post filled in: X's API charges for every post, its share
//             link doesn't. Also listed on the admin page's Social tab.
//
// Run by POST /api/optimal-squad?social=post (CRON_SECRET), which
// .github/workflows/transfer-snapshots.yml calls every 20 minutes: each run
// sends each channel at most one post that is due and it hasn't had (Redis
// keeps which). GET ?social=preview shows every post as it would read now;
// POST ?social=custom { text } sends a one-off post the same way.
//
// The bot only posts: no replies, mentions, likes or follows.

import { createHash } from 'node:crypto';
import { SITE } from './seoPage.js';
import { priceData } from './seoMore.js';

const HOUR = 3600_000;
const SENT_TTL_SECONDS = 60 * 24 * 3600;
const TAGS = '#FPL #FPLCommunity';
export const LABELS = { results: 'result', differential: 'differential', preview: 'preview', captain: 'captain picks', prices: 'price changes' };

// Length as X counts it: every link is 23 characters.
export function tweetLength(text) {
  return [...text.replace(/https?:\/\/\S+/g, 'x'.repeat(23))].length;
}

// Opens X's composer with `text` filled in.
export function xIntentUrl(text) {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

/* --------------------------------------------------------------- Bluesky */

export function blueskyConfigured(env = process.env) {
  return !!(env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD);
}

const graphemes = text => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length;
const bytes = text => new TextEncoder().encode(text).length;

// A Bluesky post record: links shown without https:// (Bluesky counts
// their full length), made clickable, and hashtags made into tags, both
// by facets with UTF-8 byte offsets. null when it's over Bluesky's 300.
export function blueskyRecord(text, createdAt = new Date().toISOString()) {
  let out = '';
  const facets = [];
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/\S+/g)) {
    out += text.slice(last, m.index);
    const shown = m[0].replace(/^https?:\/\//, '');
    facets.push({ index: { byteStart: bytes(out), byteEnd: bytes(out) + bytes(shown) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }] });
    out += shown;
    last = m.index + m[0].length;
  }
  out += text.slice(last);
  for (const m of out.matchAll(/(^|\s)#(\w+)/g)) {
    const start = bytes(out.slice(0, m.index + m[1].length));
    facets.push({ index: { byteStart: start, byteEnd: start + bytes(`#${m[2]}`) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[2] }] });
  }
  if (graphemes(out) > 300) return null;
  return { $type: 'app.bsky.feed.post', text: out, facets, langs: ['en-GB'], createdAt };
}

async function xrpc(service, method, { token, body, contentType = 'application/json', fetchImpl }) {
  const r = await fetchImpl(`${service}/xrpc/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: contentType === 'application/json' ? JSON.stringify(body) : body,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Bluesky ${method} ${r.status}: ${data.error || ''} ${data.message || ''}`.trim());
  return data;
}

// Posts `text` as the bot account, with a link card for its first link
// (the site's preview image as the picture, when it can be fetched), or
// the picture given ({ png, alt }), then likes and reposts it.
export async function postBluesky(text, env = process.env, fetchImpl = fetch, { image = null } = {}) {
  const record = blueskyRecord(text);
  if (!record) throw new Error('too long for Bluesky');
  const service = (env.BLUESKY_SERVICE || 'https://bsky.social').replace(/\/+$/, '');
  const session = await xrpc(service, 'com.atproto.server.createSession', { body: { identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD }, fetchImpl });
  const link = record.facets.find(f => f.features[0].uri);
  if (image && image.png) {
    // A picture ({ png, alt }) instead of a link card: the link in the
    // text stays clickable.
    const blob = (await xrpc(service, 'com.atproto.repo.uploadBlob', { token: session.accessJwt, body: image.png, contentType: 'image/png', fetchImpl })).blob;
    record.embed = { $type: 'app.bsky.embed.images', images: [{ image: blob, alt: image.alt || '', aspectRatio: { width: 1200, height: 675 } }] };
  } else if (link) {
    const external = { uri: link.features[0].uri, title: 'FPL Checker', description: 'Free FPL points predictor: predicted points for every player, your best XI, captain and transfers.' };
    try {
      const img = await fetchImpl(`${SITE}/og-image.png`, { signal: AbortSignal.timeout(10_000) });
      if (img.ok) external.thumb = (await xrpc(service, 'com.atproto.repo.uploadBlob', { token: session.accessJwt, body: Buffer.from(await img.arrayBuffer()), contentType: 'image/png', fetchImpl })).blob;
    } catch { /* the card just has no picture */ }
    record.embed = { $type: 'app.bsky.embed.external', external };
  }
  const out = await xrpc(service, 'com.atproto.repo.createRecord', { token: session.accessJwt, body: { repo: session.did, collection: 'app.bsky.feed.post', record }, fetchImpl });
  // The bot's own like and repost of it. Best-effort: the post is out
  // either way, so a failure here doesn't count it as unsent.
  const subject = { uri: out.uri, cid: out.cid };
  for (const collection of ['app.bsky.feed.like', 'app.bsky.feed.repost']) {
    try {
      await xrpc(service, 'com.atproto.repo.createRecord', { token: session.accessJwt, body: { repo: session.did, collection, record: { $type: collection, subject, createdAt: new Date().toISOString() } }, fetchImpl });
    } catch { /* still posted */ }
  }
  return out.uri;
}

/* ------------------------------------------------------------- the posts */

const fmt = n => (Math.round(n * 10) / 10).toFixed(1);
const money = p => `£${p.toFixed(1)}m`;
const ukTime = iso => new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
const available = p => p.predicted !== null && p.status === 'a';
const nextFixture = (p, gwId) => {
  const f = p.teamRef && p.teamRef.fixtures.find(x => x.event === gwId);
  return f ? `${f.home ? 'v' : '@'} ${f.opponent.short}` : '';
};

// model: seoModel() (src/lib/seoDynamic.js) for the gameweek being
// planned. snap: the best squad saved for it.
export function differentialPost(model) {
  const gw = model.event;
  const pick = model.players.filter(p => available(p) && p.selectedBy < 10).sort((a, b) => b.predicted - a.predicted)[0];
  if (!pick) return null;
  const samePos = model.players.filter(p => p.positionId === pick.positionId && p.predicted !== null).sort((a, b) => b.predicted - a.predicted);
  const rank = samePos.indexOf(pick) + 1;
  const position = { 1: 'goalkeepers', 2: 'defenders', 3: 'midfielders', 4: 'forwards' }[pick.positionId];
  return `🔍 GW${gw.id} differential: ${pick.name} (${pick.team}, ${money(pick.price)}) is in only ${pick.selectedBy}% of teams but is predicted ${fmt(pick.predicted)} pts ${nextFixture(pick, gw.id)}, ${ordinal(rank)} of all ${position}.\n\nFixtures, form and xG: ${SITE}/player/${pick.slug}\n\n${TAGS}`;
}

export function previewPost(model, snap) {
  const gw = model.event;
  const top = model.players.filter(available).sort((a, b) => b.predicted - a.predicted).slice(0, 3);
  if (!top.length) return null;
  let best = '';
  if (snap && snap.gwId === gw.id && Array.isArray(snap.startingIds)) {
    const xi = snap.startingIds.map(id => model.playerById[id]).filter(p => p && p.predicted !== null);
    const captain = model.playerById[snap.captainId];
    const total = xi.reduce((s, p) => s + p.predicted, 0) + (captain && captain.predicted !== null ? captain.predicted : 0);
    if (xi.length === 11) best = `Best £100m XI: ${fmt(total)} pts${captain ? `, captain ${captain.name}` : ''}.\n`;
  }
  return `📊 GW${gw.id} predictions are in.\n\n${best}Top picks: ${top.map(p => `${p.name} ${fmt(p.predicted)}`).join(', ')}.\n\nEvery player, by position: ${SITE}/fpl-predictions\n\n${TAGS}`;
}

export function captainPost(model) {
  const gw = model.event;
  const top = model.players.filter(available).sort((a, b) => b.predicted - a.predicted).slice(0, 3);
  if (top.length < 3) return null;
  return `©️ GW${gw.id} captain picks, by predicted points:\n\n${top.map((p, i) => `${i + 1}. ${p.name} ${fmt(p.predicted)} (${nextFixture(p, gw.id)})`).join('\n')}\n\nDeadline ${ukTime(gw.deadline_time)}. Your own team’s best captain: ${SITE}\n\n${TAGS}`;
}

// Tonight's likely price moves, or null when nobody is likely to move.
// Only FPL's 'very likely' and 'likely' count, never the 'possible' guesses.
export function pricesPost(model) {
  const d = priceData(model);
  const sure = rows => rows.filter(r => r.change.confidence !== 'possible').slice(0, 4).map(r => `${r.player.name} ${money(r.player.price)}`);
  const up = sure(d.rises);
  const down = sure(d.falls);
  if (!up.length && !down.length) return null;
  return `💷 Likely FPL price changes tonight:

${up.length ? `📈 Rises: ${up.join(', ')}
` : ''}${down.length ? `📉 Falls: ${down.join(', ')}
` : ''}
Full list: ${SITE}/fpl-price-changes

${TAGS}`;
}

// The date in London, "2026-10-15", and its hour.
function londonNow(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(now)).map(x => [x.type, x.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

// past: { gwId, xiPredicted, xiScored, top: { name, actual, predicted } }
export function resultsPost(past) {
  if (!past || past.xiScored === null) return null;
  const top = past.top ? `\nTop scorer: ${past.top.name} ${past.top.actual} (predicted ${fmt(past.top.predicted)}).` : '';
  return `✅ GW${past.gwId} done. Our best XI was predicted ${fmt(past.xiPredicted)} pts and scored ${past.xiScored}.${top}\n\nEvery player, predicted v scored: ${SITE}/gw/${past.gwId}\n\n${TAGS}`;
}

// What a finished gameweek's saved best XI did: saved is that gameweek's
// predictions file, snap its best squad, live FPL's event/<n>/live elements.
export function pastResults(gwId, { saved, snap, live, names }) {
  if (!saved || !saved.predictedById || !snap || !Array.isArray(snap.startingIds) || !Array.isArray(live)) return null;
  const scored = Object.fromEntries(live.map(el => [el.id, (el.stats && el.stats.total_points) || 0]));
  const mult = id => (id === snap.captainId ? 2 : 1);
  const xiPredicted = snap.startingIds.reduce((s, id) => s + mult(id) * (saved.predictedById[id] || 0), 0);
  const xiScored = snap.startingIds.reduce((s, id) => s + mult(id) * (scored[id] || 0), 0);
  const best = live.filter(el => typeof saved.predictedById[el.id] === 'number').sort((a, b) => (b.stats?.total_points || 0) - (a.stats?.total_points || 0))[0];
  const top = best && names[best.id] ? { name: names[best.id], actual: best.stats.total_points, predicted: saved.predictedById[best.id] } : null;
  return { gwId, xiPredicted, xiScored, top };
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// The posts due now, in the order they'd go out, as { key, type, label,
// text }:
// windows are measured back from the deadline of the gameweek being
// planned. lastFinished: the gameweek before it, when FPL has checked its
// points (pastResults() of it).
export function duePosts({ now = Date.now(), season, model, snap, lastFinished = null, all = false }) {
  const gw = model.event;
  const deadline = Date.parse(gw.deadline_time);
  const until = deadline - now;
  // The price post goes out between 18:00 and 23:00 UK time, once a day.
  const london = londonNow(now);
  const prices = all || (london.hour >= 18 && london.hour < 23)
    ? [{ key: `${season}:prices:${london.date}`, type: 'prices', label: `${london.date} ${LABELS.prices}`, text: pricesPost(model) }]
    : [];
  const ok = p => p.text && tweetLength(p.text) <= 280 && blueskyRecord(p.text);
  if (!all && !(until > 0)) return prices.filter(ok);
  const slot = (type, from, to, make) => {
    if (!all && !(until <= from * HOUR && until > to * HOUR)) return [];
    const gwId = type === 'results' ? lastFinished.gwId : gw.id;
    return [{ key: `${season}:${type}:gw${gwId}`, type, label: `GW${gwId} ${LABELS[type]}`, text: make() }];
  };
  return [
    ...(lastFinished ? slot('results', 24 * 7, 30, () => resultsPost(lastFinished)) : []),
    ...slot('differential', 54, 30, () => differentialPost(model)),
    ...slot('preview', 30, 6, () => previewPost(model, snap)),
    ...slot('captain', 6, 0.5, () => captainPost(model)),
    ...prices,
  ].filter(ok);
}

// A one-off post written by hand (the admin page's Social tab, or the
// social-post workflow): { post } ready for runSocial, or { error }. Keyed
// by its text, so the same words never go out twice.
export function customPost(text) {
  if (typeof text !== 'string' || !text.trim()) return { error: 'empty' };
  const clean = text.trim().replace(/\r\n/g, '\n');
  if (tweetLength(clean) > 280) return { error: 'too_long_for_x' };
  if (!blueskyRecord(clean)) return { error: 'too_long_for_bluesky' };
  const id = createHash('sha256').update(clean).digest('hex').slice(0, 16);
  return { post: { key: `custom:${id}`, type: 'custom', label: 'Custom post', text: clean } };
}

// The Redis key that marks `post` as sent to `channel`, shared by the
// scheduled run and the admin page's buttons so neither repeats the other.
export const sentKey = (channel, post) => `social:${channel}:${post.key}`;

// Which channels each post has gone to: { [post.key]: ['bluesky', …] }.
export async function sentTo(redis, posts, channels) {
  const out = {};
  for (const post of posts) {
    out[post.key] = [];
    for (const name of channels) if (await redis.get(sentKey(name, post))) out[post.key].push(name);
  }
  return out;
}

// X posts go out by hand from the admin page (the API is paid), so the
// page ticks them off itself: the 'x' channel's key, set or cleared.
export const POST_KEY = /^\d{4}-\d{2}:((results|differential|preview|captain):gw\d{1,2}|prices:\d{4}-\d{2}-\d{2})$/;
export async function markSent(redis, channel, key, done) {
  if (!POST_KEY.test(key)) return false;
  if (done) await redis.set(sentKey(channel, { key }), '1', 'EX', SENT_TTL_SECONDS);
  else await redis.del(sentKey(channel, { key }));
  return true;
}

// Sends each channel ({ name, send(post) }) the first due post it hasn't
// had. The Redis key is taken first so two overlapping runs can't both
// send it; a failed send gives it back for the next run.
export async function runSocial({ redis, posts, channels }) {
  const results = {};
  for (const channel of channels) {
    results[channel.name] = { sent: null };
    for (const post of posts) {
      const key = sentKey(channel.name, post);
      if ((await redis.set(key, '1', 'EX', SENT_TTL_SECONDS, 'NX')) !== 'OK') continue;
      try {
        results[channel.name] = { sent: post.type, id: (await channel.send(post)) || null };
      } catch (e) {
        await redis.del(key);
        results[channel.name] = { error: String((e && e.message) || e), type: post.type };
      }
      break;
    }
  }
  return results;
}
