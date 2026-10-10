// Alerts for your team: the deadline coming up, your players' prices about
// to move, injury or suspension news, and a prediction that has dropped
// since you first saw it this gameweek (usually late team news the model
// has picked up). Shown on Home, and as phone or
// desktop notifications when they're switched on (see notifyNewAlerts).

import { nextPriceChangeAt } from './transferTrends.js';

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

// staticData: today's data. playerIds: your squad. Returns
// [{ id, kind: 'deadline' | 'rise' | 'fall' | 'news' | 'drop', level: 'warn' | 'info',
// title, body }], most urgent first. Each id is stable for as long as the
// alert means the same thing, so a notification is only sent once. The
// deadline comes first, then warnings. baseline: each player's prediction
// when first seen this gameweek (see predictionBaseline).
export function buildAlerts(staticData, playerIds, now = Date.now(), { baseline = null } = {}) {
  if (!staticData) return [];
  const alerts = [];
  const target = staticData.targetEvent;
  if (target && target.deadline_time) {
    const left = new Date(target.deadline_time).getTime() - now;
    if (left > 0 && left < 24 * HOUR) {
      const hours = Math.floor(left / HOUR);
      const soon = left < 2 * HOUR;
      alerts.push({
        id: `deadline-${target.id}-${soon ? '2h' : '24h'}`,
        kind: 'deadline',
        level: soon ? 'warn' : 'info',
        title: `${target.name} deadline in ${hours ? `${hours}h ${Math.floor((left % HOUR) / 60000)}m` : `${Math.max(1, Math.round(left / 60000))} minutes`}`,
        body: 'Make your transfers and pick your captain before it passes.',
      });
    }
  }
  const day = new Date(now).toISOString().slice(0, 10);
  // Prices change at midnight UK time.
  const untilChange = nextPriceChangeAt(new Date(now)).getTime() - now;
  const changeIn = `${Math.floor(untilChange / HOUR)}h ${Math.floor((untilChange % HOUR) / 60000)}m`;
  (playerIds || []).forEach(id => {
    const p = staticData.playersById[id];
    if (!p) return;
    const pred = staticData.predictionsById[id] || {};
    if (p.status && p.status !== 'a' && pred.availNote) {
      alerts.push({
        id: `news-${id}-${hash(`${p.status}|${p.news || ''}`)}`,
        kind: 'news',
        level: ['i', 's', 'u', 'n'].includes(p.status) ? 'warn' : 'info',
        title: `${p.webName}: ${pred.availNote}`,
        body: p.news || 'Check the latest team news.',
      });
    }
    const seen = baseline && target && baseline.gwId === target.id ? baseline.byId[id] : undefined;
    const nowPred = pred.nextMatchPredicted;
    if (typeof seen === 'number' && typeof nowPred === 'number' && seen - nowPred >= DROP_POINTS && seen - nowPred >= seen * DROP_SHARE) {
      alerts.push({
        id: `drop-${id}-${target.id}-${Math.round(nowPred)}`,
        kind: 'drop',
        level: 'warn',
        title: `${p.webName}'s prediction is down to ${nowPred.toFixed(1)} pts`,
        body: `He was predicted ${seen.toFixed(1)} pts for ${target.name} when you first looked.${pred.availNote ? ` ${pred.availNote}.` : ''} Worth checking before the deadline.`,
      });
    }
    if (typeof p.priceChangePercent === 'number' && Math.abs(p.priceChangePercent) >= PRICE_ALERT_AT) {
      const rise = p.priceChangePercent > 0;
      alerts.push({
        id: `${rise ? 'rise' : 'fall'}-${id}-${day}`,
        kind: rise ? 'rise' : 'fall',
        level: rise ? 'info' : 'warn',
        title: `${p.webName} may ${rise ? 'rise' : 'fall'} in price tonight`,
        body: rise
          ? `Prices change at midnight UK time, in ${changeIn}. Good for your team value: you keep half of any rise when you sell.`
          : `Prices change at midnight UK time, in ${changeIn}.${typeof pred.predicted === 'number' ? ` He's predicted ${pred.predicted.toFixed(1)} pts a week over the next few gameweeks.` : ''} If you plan to sell him, doing it before the change keeps today's price.`,
      });
    }
  });
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
