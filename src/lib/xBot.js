// Posts to X (Twitter) from FPL Checker's own account: up to four posts a
// gameweek, each useful on its own and linking to a page on the site.
//
//   results       after a gameweek: the best XI's predicted v actual score
//   differential  ~2 days before the deadline: a low-owned player predicted well
//   preview       the day before: the best XI and the top picks
//   captain       hours before: the top three captain options
//
// Run by POST /api/optimal-squad?social=post (CRON_SECRET), which
// .github/workflows/transfer-snapshots.yml calls every 20 minutes: each run
// posts at most one post that is due and hasn't been posted (Redis keeps
// which). GET ?social=preview shows every post as it would read now,
// without posting. Off until the X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN and
// X_ACCESS_TOKEN_SECRET env vars are set (an X developer app with read and
// write access, keys for the bot's own account).
//
// It only ever posts: no replies, mentions, likes or follows, which X's
// automation rules treat as spam.

import { createHmac, randomBytes } from 'node:crypto';
import { SITE } from './seoPage.js';

export const X_TWEETS_URL = 'https://api.x.com/2/tweets';
const HOUR = 3600_000;
const POSTED_TTL_SECONDS = 60 * 24 * 3600;
const TAGS = '#FPL #FPLCommunity';

export function xConfigured(env = process.env) {
  return !!(env.X_API_KEY && env.X_API_SECRET && env.X_ACCESS_TOKEN && env.X_ACCESS_TOKEN_SECRET);
}

// RFC 3986 percent-encoding, as OAuth 1.0a wants it.
const enc = s => encodeURIComponent(String(s)).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// The OAuth 1.0a Authorization header for a request made as the account
// the access token belongs to. params: any query or form parameters (a
// JSON body isn't signed).
export function oauthHeader({ method, url, params = {}, consumerKey, consumerSecret, token, tokenSecret, nonce = randomBytes(16).toString('hex'), timestamp = Math.floor(Date.now() / 1000) }) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp),
    oauth_token: token,
    oauth_version: '1.0',
  };
  const all = { ...params, ...oauth };
  const paramString = Object.keys(all).map(k => [enc(k), enc(all[k])]).sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const base = [method.toUpperCase(), enc(url), enc(paramString)].join('&');
  const signature = createHmac('sha1', `${enc(consumerSecret)}&${enc(tokenSecret)}`).update(base).digest('base64');
  return 'OAuth ' + Object.entries({ ...oauth, oauth_signature: signature }).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(', ');
}

// Length as X counts it: every link is 23 characters.
export function tweetLength(text) {
  return [...text.replace(/https?:\/\/\S+/g, 'x'.repeat(23))].length;
}

export async function postTweet(text, env = process.env, fetchImpl = fetch) {
  const r = await fetchImpl(X_TWEETS_URL, {
    method: 'POST',
    headers: {
      Authorization: oauthHeader({ method: 'POST', url: X_TWEETS_URL, consumerKey: env.X_API_KEY, consumerSecret: env.X_API_SECRET, token: env.X_ACCESS_TOKEN, tokenSecret: env.X_ACCESS_TOKEN_SECRET }),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`X ${r.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body.data && body.data.id;
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

// The posts due now, in the order they'd go out, as { key, text }:
// windows are measured back from the deadline of the gameweek being
// planned. lastFinished: the gameweek before it, when FPL has checked its
// points (pastResults() of it).
export function duePosts({ now = Date.now(), season, model, snap, lastFinished = null, all = false }) {
  const gw = model.event;
  const deadline = Date.parse(gw.deadline_time);
  const until = deadline - now;
  if (!all && !(until > 0)) return [];
  const slot = (type, from, to, make) => ((all || (until <= from * HOUR && until > to * HOUR)) ? [{ key: `x:posted:${season}:${type}:gw${type === 'results' && lastFinished ? lastFinished.gwId : gw.id}`, type, text: make() }] : []);
  return [
    ...(lastFinished ? slot('results', 24 * 7, 30, () => resultsPost(lastFinished)) : []),
    ...slot('differential', 54, 30, () => differentialPost(model)),
    ...slot('preview', 30, 6, () => previewPost(model, snap)),
    ...slot('captain', 6, 0.5, () => captainPost(model)),
  ].filter(p => p.text && tweetLength(p.text) <= 280);
}

// Posts the first due post not posted before. The Redis key is taken
// first so two overlapping runs can't both post it; a failed post gives
// it back for the next run.
export async function runSocial({ redis, posts, env = process.env, fetchImpl = fetch }) {
  for (const post of posts) {
    if ((await redis.set(post.key, '1', 'EX', POSTED_TTL_SECONDS, 'NX')) !== 'OK') continue;
    try {
      const id = await postTweet(post.text, env, fetchImpl);
      return { posted: post.type, id };
    } catch (e) {
      await redis.del(post.key);
      return { error: String((e && e.message) || e), type: post.type };
    }
  }
  return { posted: null };
}
