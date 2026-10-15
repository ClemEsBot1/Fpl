// The deadline email: about a day before each deadline, everyone who asked
// for it gets their own team's best captain and best transfer, worked out
// from the day's saved predictions. Opt-in only (set_digest in
// api/auth.js), sent once per gameweek, with a one-click unsubscribe link.
//
//   POST /api/auth?digest=send   sends what's due. Needs CRON_SECRET, like
//                                ?push=send; called every 20 minutes by
//                                .github/workflows/transfer-snapshots.yml.
//   GET  /api/auth?digest=off&u=<username>&t=<token>   unsubscribes.

import { createHmac, timingSafeEqual } from 'node:crypto';

const HOUR = 3600_000;
// Sent once the deadline is this close…
export const SEND_FROM_HOURS = 26;
// …and not this close, when it would be too late to be useful.
export const SEND_UNTIL_HOURS = 3;
const SENT_TTL_SECONDS = 14 * 24 * 3600;
const POS = { 1: 'goalkeeper', 2: 'defender', 3: 'midfielder', 4: 'forward' };

export const cleanTeamId = id => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 && n < 100_000_000 ? n : null;
};

// The unsubscribe link's token: proves the link came from us without a
// login.
export function unsubscribeToken(username, secret) {
  return createHmac('sha256', secret).update(`digest-off:${String(username).toLowerCase()}`).digest('base64url').slice(0, 32);
}

export function tokenMatches(username, token, secret) {
  const want = Buffer.from(unsubscribeToken(username, secret));
  const got = Buffer.from(String(token || ''));
  return got.length === want.length && timingSafeEqual(got, want);
}

// Whether the email for gameweek `event` is due at `now`.
export function digestDue(event, now = Date.now()) {
  if (!event || !event.deadline_time) return false;
  const left = Date.parse(event.deadline_time) - now;
  return left <= SEND_FROM_HOURS * HOUR && left > SEND_UNTIL_HOURS * HOUR;
}

// One team's picks for the email.
// picks: FPL's entry/<id>/event/<gw>/picks/ (picks + entry_history.bank).
// elements: bootstrap-static elements. predicted: { [id]: points this GW };
// ahead: { [id]: points over the next five } (or this GW alone).
// Returns { captain, transfer } where transfer is { out, in, gain } or null.
export function teamPicks({ picks, elements, predicted, ahead }) {
  const byId = Object.fromEntries(elements.map(e => [e.id, e]));
  const squad = (picks.picks || []).map(p => byId[p.element]).filter(Boolean);
  if (squad.length < 11) return null;
  const pts = e => (typeof predicted[e.id] === 'number' ? predicted[e.id] : 0);
  const five = e => (typeof ahead[e.id] === 'number' ? ahead[e.id] : pts(e));
  const playing = e => e.status === 'a';

  const captain = [...squad].filter(playing).sort((a, b) => pts(b) - pts(a))[0] || null;

  // The weakest over the next five, swapped for the best player in his
  // position he can afford who keeps the squad within three per club.
  const bank = ((picks.entry_history && picks.entry_history.bank) || 0) / 10;
  const owned = new Set(squad.map(e => e.id));
  const perClub = {};
  squad.forEach(e => { perClub[e.team] = (perClub[e.team] || 0) + 1; });
  const out = [...squad].sort((a, b) => five(a) - five(b))[0];
  const budget = out.now_cost / 10 + bank;
  const best = elements
    .filter(e => e.element_type === out.element_type && !owned.has(e.id) && playing(e) && e.now_cost / 10 <= budget + 1e-9
      && (e.team === out.team || (perClub[e.team] || 0) < 3))
    .sort((a, b) => five(b) - five(a))[0];
  const gain = best ? five(best) - five(out) : 0;
  return {
    captain: captain ? { name: captain.web_name, points: pts(captain) } : null,
    transfer: best && gain >= 1 ? { out: { name: out.web_name, points: five(out) }, in: { name: best.web_name, price: best.now_cost / 10, points: five(best), position: POS[best.element_type] }, gain } : null,
  };
}

// Sends each opted-in user their email for `event`, once. deps:
// { redis, users: [{ username, email, digest: { teamId } }], loadPicks(teamId),
//   elements, predicted, ahead, send({ to, subject, text, html }), email(data) }.
export async function sendDigests({ redis, users, event, season, loadPicks, elements, predicted, ahead, send, email }) {
  let sent = 0;
  let skipped = 0;
  for (const user of users) {
    const teamId = user.digest && cleanTeamId(user.digest.teamId);
    if (!teamId || !user.email) continue;
    const key = `digest:sent:${String(user.username).toLowerCase()}:${season}:gw${event.id}`;
    if ((await redis.set(key, '1', 'EX', SENT_TTL_SECONDS, 'NX')) !== 'OK') continue;
    try {
      const picks = await loadPicks(teamId);
      const result = picks ? teamPicks({ picks, elements, predicted, ahead }) : null;
      if (!result || !result.captain) { skipped++; continue; }
      await send({ to: user.email, ...email({ username: user.username, event, ...result }) });
      sent++;
    } catch {
      // Tried again on the next run.
      await redis.del(key);
      skipped++;
    }
  }
  return { sent, skipped };
}
