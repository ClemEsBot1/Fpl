// Alerts for your team: the deadline coming up, your players' prices about
// to move, injury or suspension news, and a prediction that has dropped
// since you first saw it this gameweek (usually late team news the model
// has picked up). Shown on Home, and as phone or
// desktop notifications when they're switched on (see notifyNewAlerts).

import { nextPriceChangeAt } from './transferTrends.js';
import { availabilityNote } from './predictions.js';
import { t } from './i18n.js';

const HOUR = 3600 * 1000;
// FPL's progress towards a price change: 100 means expected at the next
// change (overnight UK time), so from here a move tonight is likely.
const PRICE_ALERT_AT = 90;

// A drop worth flagging: at least this many points, and this share of what
// he was predicted.
const DROP_POINTS = 1.5;
const DROP_SHARE = 0.3;

// A short stable hash, so changed news makes a new alert.
function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// The deadline alert's line: your best captain when we know your squad.
function deadlineBody(staticData, playerIds, tr) {
  const best = (playerIds || [])
    .map(id => ({ p: staticData.playersById[id], pred: staticData.predictionsById[id] }))
    .filter(x => x.p && x.pred && (!x.p.status || x.p.status === 'a') && typeof x.pred.nextMatchPredicted === 'number')
    .sort((a, b) => b.pred.nextMatchPredicted - a.pred.nextMatchPredicted)[0];
  return best
    ? tr('Captain pick: {name} ({pts} pts). Make your transfers before it passes.', { name: best.p.webName, pts: best.pred.nextMatchPredicted.toFixed(1) })
    : tr('Make your transfers and pick your captain before it passes.');
}

// A replacement for a player you'd want out: the best-predicted fit,
// available, not already yours, the same position, no dearer than him (we
// don't know your bank) and without a fourth player from one club. The
// sentence for the alert's body, or ''.
function swapIdea(staticData, out, playerIds, tr) {
  const owned = new Set(playerIds);
  const clubs = {};
  playerIds.forEach(id => {
    const p = staticData.playersById[id];
    if (p && id !== out.id) clubs[p.team] = (clubs[p.team] || 0) + 1;
  });
  const pool = staticData.allPlayers || Object.values(staticData.playersById);
  let best = null;
  let bestPts = -Infinity;
  pool.forEach(p => {
    const pred = staticData.predictionsById[p.id];
    if (!pred || typeof pred.predicted !== 'number' || owned.has(p.id)) return;
    if (p.positionId !== out.positionId || p.price > out.price || (p.status && p.status !== 'a')) return;
    if ((clubs[p.team] || 0) >= 3) return;
    if (pred.predicted > bestPts) { best = p; bestPts = pred.predicted; }
  });
  return best ? ` ${tr('Swap idea: {name} (£{price}m, {pts} pts a week).', { name: best.webName, price: best.price.toFixed(1), pts: bestPts.toFixed(1) })}` : '';
}

// staticData: today's data. playerIds: your squad. Returns
// [{ id, kind: 'deadline' | 'rise' | 'fall' | 'news' | 'drop', level: 'warn' | 'info',
// title, body }], most urgent first. Each id is stable for as long as the
// alert means the same thing, so a notification is only sent once. The
// deadline comes first, then warnings. baseline: each player's prediction
// when first seen this gameweek (see predictionBaseline). noTransferYet:
// the team has made no transfer this gameweek, said in the last two hours.
// tr: the translator (the push sender passes each subscriber's language).
// watchIds: players on your watchlist (src/lib/watchlist.js), whose news and
// price moves come too, as info (they aren't yours yet), marked watched.
// rival: the mini-league rival just above you (or below, if you lead),
// from pickRival, for a heads-up before the deadline (rivalAlert).
export function buildAlerts(staticData, playerIds, now = Date.now(), { baseline = null, noTransferYet = false, tr = t, watchIds = [], rival = null } = {}) {
  if (!staticData) return [];
  const alerts = [];
  const target = staticData.targetEvent;
  const gwName = target ? tr('Gameweek {n}', { n: target.id }) : '';
  if (target && target.deadline_time) {
    const left = new Date(target.deadline_time).getTime() - now;
    if (left > 0 && left < 24 * HOUR) {
      const hours = Math.floor(left / HOUR);
      const soon = left < 2 * HOUR;
      alerts.push({
        id: `deadline-${target.id}-${soon ? '2h' : '24h'}`,
        kind: 'deadline',
        level: soon ? 'warn' : 'info',
        title: hours
          ? tr('{gw} deadline in {h}h {m}m', { gw: gwName, h: hours, m: Math.floor((left % HOUR) / 60000) })
          : tr('{gw} deadline in {m} minutes', { gw: gwName, m: Math.max(1, Math.round(left / 60000)) }),
        body: `${soon && noTransferYet ? `${tr("You haven't made a transfer for {gw} yet.", { gw: gwName })} ` : ''}${deadlineBody(staticData, playerIds, tr)}`,
      });
    }
  }
  const day = new Date(now).toISOString().slice(0, 10);
  // Prices change at midnight UK time.
  const untilChange = nextPriceChangeAt(new Date(now)).getTime() - now;
  const changeIn = tr('{h}h {m}m', { h: Math.floor(untilChange / HOUR), m: Math.floor((untilChange % HOUR) / 60000) });
  (playerIds || []).forEach(id => {
    const p = staticData.playersById[id];
    if (!p) return;
    const pred = staticData.predictionsById[id] || {};
    // The note in this alert's language (the prediction's own is in the app's).
    const note = pred.availNote && (tr === t ? pred.availNote : availabilityNote(p, tr) || pred.availNote);
    if (p.status && p.status !== 'a' && note) {
      const out = ['i', 's', 'u', 'n'].includes(p.status);
      alerts.push({
        id: `news-${id}-${hash(`${p.status}|${p.news || ''}`)}`,
        kind: 'news',
        level: out ? 'warn' : 'info',
        title: `${p.webName}: ${note}`,
        body: (p.news || tr('Check the latest team news.')) + (out ? swapIdea(staticData, p, playerIds, tr) : ''),
      });
    }
    const seen = baseline && target && baseline.gwId === target.id ? baseline.byId[id] : undefined;
    const nowPred = pred.nextMatchPredicted;
    if (typeof seen === 'number' && typeof nowPred === 'number' && seen - nowPred >= DROP_POINTS && seen - nowPred >= seen * DROP_SHARE) {
      alerts.push({
        id: `drop-${id}-${target.id}-${Math.round(nowPred)}`,
        kind: 'drop',
        level: 'warn',
        title: tr("{name}'s prediction is down to {pts} pts", { name: p.webName, pts: nowPred.toFixed(1) }),
        body: `${tr('He was predicted {pts} pts for {gw} when you first looked.', { pts: seen.toFixed(1), gw: gwName })}${note ? ` ${note}.` : ''} ${tr('Worth checking before the deadline.')}${swapIdea(staticData, p, playerIds, tr)}`,
      });
    }
    if (typeof p.priceChangePercent === 'number' && Math.abs(p.priceChangePercent) >= PRICE_ALERT_AT) {
      const rise = p.priceChangePercent > 0;
      alerts.push({
        id: `${rise ? 'rise' : 'fall'}-${id}-${day}`,
        kind: rise ? 'rise' : 'fall',
        level: rise ? 'info' : 'warn',
        title: rise ? tr('{name} may rise in price tonight', { name: p.webName }) : tr('{name} may fall in price tonight', { name: p.webName }),
        body: rise
          ? `${tr('Prices change at midnight UK time, in {time}.', { time: changeIn })} ${tr('Good for your team value: you keep half of any rise when you sell.')}`
          : `${tr('Prices change at midnight UK time, in {time}.', { time: changeIn })}${typeof pred.predicted === 'number' ? ` ${tr("He's predicted {pts} pts a week over the next few gameweeks.", { pts: pred.predicted.toFixed(1) })}` : ''} ${tr("If you plan to sell him, doing it before the change keeps today's price.")}`,
      });
    }
  });
  const owned = new Set(playerIds || []);
  (watchIds || []).filter(id => !owned.has(id)).forEach(id => {
    const p = staticData.playersById[id];
    if (!p) return;
    const pred = staticData.predictionsById[id] || {};
    const note = pred.availNote && (tr === t ? pred.availNote : availabilityNote(p, tr) || pred.availNote);
    if (p.status && p.status !== 'a' && note) {
      alerts.push({
        id: `watch-news-${id}-${hash(`${p.status}|${p.news || ''}`)}`,
        kind: 'news',
        level: 'info',
        watched: true,
        title: `${p.webName}: ${note}`,
        body: `${p.news || tr('Check the latest team news.')} ${tr("He's on your watchlist.")}`,
      });
    }
    if (typeof p.priceChangePercent === 'number' && Math.abs(p.priceChangePercent) >= PRICE_ALERT_AT) {
      const rise = p.priceChangePercent > 0;
      alerts.push({
        id: `watch-${rise ? 'rise' : 'fall'}-${id}-${day}`,
        kind: rise ? 'rise' : 'fall',
        level: 'info',
        watched: true,
        title: rise ? tr('{name} may rise in price tonight', { name: p.webName }) : tr('{name} may fall in price tonight', { name: p.webName }),
        body: `${tr('Prices change at midnight UK time, in {time}.', { time: changeIn })} ${rise
          ? tr("He's on your watchlist: buying before the change gets today's price.")
          : tr("He's on your watchlist: waiting until after the change gets him cheaper.")}`,
      });
    }
  });
  const rivalLine = rivalAlert(staticData, playerIds, rival, tr);
  if (rivalLine) alerts.push(rivalLine);
  const order = { warn: 0, info: 1 };
  return alerts.sort((a, b) => (b.kind === 'deadline') - (a.kind === 'deadline') || order[a.level] - order[b.level]);
}

// Each player's prediction for the gameweek being planned when first seen,
// kept on this device so a later drop can be flagged. A new gameweek starts
// afresh; players already in it keep their first figure. Returns the
// updated { gwId, byId }.
export function predictionBaseline(previous, staticData, playerIds) {
  const target = staticData && staticData.targetEvent;
  if (!target) return previous || null;
  const base = previous && previous.gwId === target.id ? previous : { gwId: target.id, byId: {} };
  const byId = { ...base.byId };
  (playerIds || []).forEach(id => {
    const pred = staticData.predictionsById[id];
    if (!(id in byId) && pred && typeof pred.nextMatchPredicted === 'number') byId[id] = pred.nextMatchPredicted;
  });
  return { gwId: target.id, byId };
}

// The member of your mini-league just above you, or just below if you
// lead: { entry, teamName, ahead }, or null. members from parseStandings.
export function pickRival(members, youEntry) {
  const order = [...(members || [])].sort((a, b) => a.rank - b.rank);
  const at = order.findIndex(m => m.entry === Number(youEntry));
  if (at < 0 || order.length < 2) return null;
  const other = at > 0 ? order[at - 1] : order[1];
  return { entry: other.entry, teamName: other.teamName, ahead: at > 0 };
}

// Before the deadline: your rival's likely captain and the players they
// have that you don't, best predicted first. Their picks for this
// gameweek stay hidden until the deadline, so it reads their last ones
// (rival.picks: FPL's picks list, rival.fromGw). null when there's nothing
// to say or it's not the day before the deadline.
export function rivalAlert(staticData, playerIds, rival, tr = t) {
  const target = staticData && staticData.targetEvent;
  if (!rival || !target || !Array.isArray(rival.picks) || !rival.picks.length) return null;
  const left = new Date(target.deadline_time).getTime() - (rival.now ?? Date.now());
  if (!(left > 0 && left < 48 * HOUR)) return null;
  const mine = new Set(playerIds || []);
  const pts = id => ((staticData.predictionsById[id] || {}).nextMatchPredicted) || 0;
  const captainPick = rival.picks.find(pk => pk.is_captain);
  const captain = captainPick ? staticData.playersById[captainPick.element] : null;
  const theirs = rival.picks
    .filter(pk => pk.position <= 11 && !mine.has(pk.element) && staticData.playersById[pk.element])
    .map(pk => staticData.playersById[pk.element])
    .sort((a, b) => pts(b.id) - pts(a.id))
    .slice(0, 2);
  if (!captain && !theirs.length) return null;
  const parts = [];
  if (theirs.length) {
    parts.push(tr("They have {names}, who you don't: {pts} predicted points between them.", {
      names: theirs.map(p => p.webName).join(tr(' and ')),
      pts: theirs.reduce((s, p) => s + pts(p.id), 0).toFixed(1),
    }));
  }
  if (captain && !mine.has(captain.id)) parts.push(tr("You don't own their captain."));
  parts.push(tr('From their Gameweek {n} team: this week’s stays hidden until the deadline.', { n: rival.fromGw }));
  return {
    id: `rival-${target.id}-${rival.entry}`,
    kind: 'rival',
    level: 'info',
    title: captain
      ? tr('{team} ({where}) will likely captain {name}', { team: rival.teamName, where: rival.ahead ? tr('just above you') : tr('just below you'), name: captain.webName })
      : tr('{team} ({where}) has players you don’t', { team: rival.teamName, where: rival.ahead ? tr('just above you') : tr('just below you') }),
    body: parts.join(' '),
  };
}
