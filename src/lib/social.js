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
// Bluesky posting is in src/lib/bluesky.js, and which posts have been sent
// (in Redis) in src/lib/socialSent.js.
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
import { blueskyRecord } from './bluesky.js';

const HOUR = 3600_000;
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
