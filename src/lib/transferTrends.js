// Transfer trends for the home screen: the players managers are buying
// and selling most this gameweek, and whose price is about to move.
//
// FPL's own Price Change Predictor (2026/27 on) puts each player's progress
// towards a price change in bootstrap-static as price_change_percent:
// towards a rise when positive, a drop when negative, and 100% or more means
// FPL expects the change at the next update, 00:00 UK time. When that field
// isn't there, the status is estimated instead: a price moves once enough of
// a player's owners have bought (or sold) them since the last change, and
// falls trigger more easily than rises, so this gameweek's net transfers are
// compared with how many managers own the player.

// Progress (FPL's percentage) where each of FPL's statuses starts. 100% is
// its own "expected tonight" line.
export const VERY_LIKELY_PCT = 100;
export const LIKELY_PCT = 95;

// Estimate: net transfers as a share of owners needed for a move.
export const RISE_LIKELY = 0.1;
export const RISE_POSSIBLE = 0.05;
export const FALL_LIKELY = -0.05;
export const FALL_POSSIBLE = -0.025;
// Below this many net transfers nothing is estimated, however few owners.
const MIN_NET = 5000;

// { dir: 'rise' | 'fall', confidence, percent? } or null. From FPL's own
// progress when it's published (confidence 'very likely' | 'likely'),
// otherwise estimated (confidence 'likely' | 'possible').
export function predictPriceChange(player, totalPlayers) {
  if (typeof player.priceChangePercent === 'number') {
    const pct = player.priceChangePercent;
    const dir = pct > 0 ? 'rise' : 'fall';
    if (Math.abs(pct) >= VERY_LIKELY_PCT) return { dir, confidence: 'very likely', percent: pct };
    if (Math.abs(pct) >= LIKELY_PCT) return { dir, confidence: 'likely', percent: pct };
    return null;
  }
  const net = player.transfersInEvent - player.transfersOutEvent;
  if (Math.abs(net) < MIN_NET) return null;
  const owners = Math.max((player.selectedBy / 100) * (totalPlayers || 0), 10000);
  const pressure = net / owners;
  if (pressure >= RISE_LIKELY) return { dir: 'rise', confidence: 'likely' };
  if (pressure >= RISE_POSSIBLE) return { dir: 'rise', confidence: 'possible' };
  if (pressure <= FALL_LIKELY) return { dir: 'fall', confidence: 'likely' };
  if (pressure <= FALL_POSSIBLE) return { dir: 'fall', confidence: 'possible' };
  return null;
}

// Whether FPL published its own price progress for these players.
export function hasOfficialPriceData(allPlayers) {
  return allPlayers.some(p => typeof p.priceChangePercent === 'number' && p.priceChangePercent !== 0);
}

function rowFor(player, totalPlayers) {
  return {
    player,
    net: player.transfersInEvent - player.transfersOutEvent,
    change: predictPriceChange(player, totalPlayers),
  };
}

// The most bought and sold players, each list up to `limit` long. Empty
// lists are kept so the panel can say so.
export function buildTransferTrends(allPlayers, totalPlayers, limit = 6) {
  const rows = allPlayers.map(p => rowFor(p, totalPlayers));
  const top = (list, key) => [...list].sort(key).slice(0, limit);
  return [
    { id: 'in', title: 'Most transferred in', rows: top(rows.filter(r => r.player.transfersInEvent > 0), (a, b) => b.player.transfersInEvent - a.player.transfersInEvent), stat: 'in' },
    { id: 'out', title: 'Most transferred out', rows: top(rows.filter(r => r.player.transfersOutEvent > 0), (a, b) => b.player.transfersOutEvent - a.player.transfersOutEvent), stat: 'out' },
  ];
}

// The players closest to a rise and to a drop by FPL's own progress, or no
// panels when FPL hasn't published it.
export function buildPriceWatch(allPlayers, totalPlayers, limit = 6) {
  if (!hasOfficialPriceData(allPlayers)) return [];
  const rows = allPlayers.filter(p => typeof p.priceChangePercent === 'number').map(p => rowFor(p, totalPlayers));
  return [
    { id: 'rises', title: 'Closest to a price rise', rows: rows.filter(r => r.player.priceChangePercent > 0).sort((a, b) => b.player.priceChangePercent - a.player.priceChangePercent).slice(0, limit), stat: 'pct' },
    { id: 'drops', title: 'Closest to a price drop', rows: rows.filter(r => r.player.priceChangePercent < 0).sort((a, b) => a.player.priceChangePercent - b.player.priceChangePercent).slice(0, limit), stat: 'pct' },
  ];
}

// When FPL next changes prices: 00:00 UK time (GMT or BST), as a Date.
export function nextPriceChangeAt(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(now).filter(x => x.type !== 'literal').map(x => [x.type, Number(x.value)]));
  // Tomorrow's date in London, at midnight there: try UTC midnight and an
  // hour earlier (BST), and take the one London reads as 00:00.
  const utcMidnight = Date.UTC(parts.year, parts.month - 1, parts.day + 1);
  const londonHour = t => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23' }).format(t));
  for (const t of [utcMidnight - 3600e3, utcMidnight]) {
    if (londonHour(t) === 0) return new Date(t);
  }
  return new Date(utcMidnight);
}

// The `limit` highest of `entries` ([{ player, points }]) by points, for
// the predicted (or, for a past gameweek, actual) points panels.
export function topByPoints(entries, limit = 6) {
  return entries.filter(e => e.player && e.points > 0).sort((a, b) => b.points - a.points).slice(0, limit);
}

// Transfers in the last hour. The server (api/transfer-trend.js) keeps a
// snapshot of every player's transfers in and out this gameweek every
// SNAPSHOT_EVERY_MS or so; the change since the one about an hour old is
// each player's transfers in the last hour.
export const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;
export const KEEP_SNAPSHOTS = 24; // about four hours at that rate

// A compact snapshot of bootstrap-static: { at, gw, ids, tin, tout }.
export function transferSnapshot(bootstrap, at = Date.now()) {
  const next = (bootstrap.events || []).find(e => e.is_next) || null;
  const els = (bootstrap.elements || []).filter(e => e.transfers_in_event || e.transfers_out_event);
  return {
    at, gw: next ? next.id : null,
    ids: els.map(e => e.id),
    tin: els.map(e => Number(e.transfers_in_event) || 0),
    tout: els.map(e => Number(e.transfers_out_event) || 0),
  };
}

// The snapshot to compare with: for the same gameweek, the newest one at
// least `minAgeMs` old (an hour), else the oldest there is.
export function pickBaseline(snapshots, current, { minAgeMs = 60 * 60 * 1000 } = {}) {
  const same = snapshots.filter(s => s.gw === current.gw && s.at < current.at);
  if (!same.length) return null;
  const oldEnough = same.filter(s => current.at - s.at >= minAgeMs).sort((a, b) => b.at - a.at)[0];
  return oldEnough || same.sort((a, b) => a.at - b.at)[0];
}

// { minutes, byId: { [id]: [in, out] } }: transfers between `base` and
// `current`, or null without a baseline.
export function transferDeltas(current, base) {
  if (!base) return null;
  const before = new Map(base.ids.map((id, k) => [id, [base.tin[k], base.tout[k]]]));
  const byId = {};
  current.ids.forEach((id, k) => {
    const [i0, o0] = before.get(id) || [0, 0];
    const din = current.tin[k] - i0;
    const dout = current.tout[k] - o0;
    if (din || dout) byId[id] = [din, dout];
  });
  return { minutes: Math.round((current.at - base.at) / 60000), byId };
}
