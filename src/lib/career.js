// A manager's FPL career from FPL's entry/<id>/ and entry/<id>/history/
// answers, for the profile page: every past season, this season so far and
// the chips played.
import { t } from './i18n.js';

const CHIP_NAMES = { wildcard: t('Wildcard'), freehit: t('Free Hit'), bboost: t('Bench Boost'), '3xc': t('Triple Captain'), manager: t('Assistant Manager') };
export const chipName = chip => CHIP_NAMES[chip] || chip;

const num = v => (v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// FPL's chips: one of each in each half of the season, as bootstrap-static's
// chips list has them (the Wildcard and Free Hit can't go in Gameweek 1).
export const CHIP_WINDOWS = [
  { name: 'wildcard', from: 2, to: 19 }, { name: 'freehit', from: 2, to: 19 },
  { name: 'bboost', from: 1, to: 19 }, { name: '3xc', from: 1, to: 19 },
  { name: 'wildcard', from: 20, to: 38 }, { name: 'freehit', from: 20, to: 38 },
  { name: 'bboost', from: 20, to: 38 }, { name: '3xc', from: 20, to: 38 },
];
const CHIP_ORDER = ['wildcard', 'freehit', 'bboost', '3xc'];
const CHIP_SHORT = { wildcard: t('WC'), freehit: t('FH'), bboost: t('BB'), '3xc': t('TC') };

// The chips a manager still has for gameweek `gw` and the rest of its half
// of the season, from FPL's entry/<id>/history/ answer: [{ name, label,
// short }] in FPL's order. A chip counts as played when history.chips has
// it in that window, including one played in a gameweek still going on.
export function chipsLeft(history, gw, windows = CHIP_WINDOWS) {
  const played = Array.isArray(history && history.chips) ? history.chips : [];
  const left = [];
  CHIP_ORDER.forEach(name => {
    const window = windows.find(w => w.name === name && gw <= w.to);
    if (!window) return;
    const used = played.some(c => c.name === name && num(c.event) >= window.from && num(c.event) <= window.to);
    if (!used) left.push({ name, label: chipName(name), short: CHIP_SHORT[name] || name });
  });
  return left;
}

export function careerStats(history, entry = {}) {
  const current = Array.isArray(history && history.current) ? history.current : [];
  const past = (Array.isArray(history && history.past) ? history.past : [])
    .map(s => ({ season: String(s.season_name || ''), points: num(s.total_points), rank: num(s.rank) }))
    .filter(s => s.season && s.points !== null)
    .sort((a, b) => b.season.localeCompare(a.season));

  const played = current.filter(gw => num(gw.points) !== null);
  const latest = played[played.length - 1] || null;
  const byPoints = [...played].sort((a, b) => b.points - a.points);
  const sum = key => played.reduce((t, gw) => t + (num(gw[key]) || 0), 0);
  const thisSeason = latest ? {
    points: num(latest.total_points),
    overallRank: num(latest.overall_rank),
    gameweeks: played.length,
    averageGw: Math.round((sum('points') / played.length) * 10) / 10,
    bestGw: { gw: byPoints[0].event, points: byPoints[0].points },
    worstGw: { gw: byPoints[byPoints.length - 1].event, points: byPoints[byPoints.length - 1].points },
    transfers: sum('event_transfers'),
    hitPoints: sum('event_transfers_cost'),
    benchPoints: sum('points_on_bench'),
    value: num(latest.value) !== null ? latest.value / 10 : null,
    bank: num(latest.bank) !== null ? latest.bank / 10 : null,
  } : null;

  // Each played gameweek, for the rank and value charts. value and bank are
  // in £m (value is FPL's team value, which includes the bank). rankChange: places gained
  // (+) or lost (−) overall since the gameweek before.
  const chipByGw = {};
  (Array.isArray(history && history.chips) ? history.chips : []).forEach(c => { if (num(c.event)) chipByGw[c.event] = chipName(c.name); });
  const gwHistory = played.map((gw, i) => {
    const overallRank = num(gw.overall_rank);
    const before = i ? num(played[i - 1].overall_rank) : null;
    return {
      gw: num(gw.event),
      points: num(gw.points),
      total: num(gw.total_points),
      overallRank,
      gwRank: num(gw.rank),
      hit: num(gw.event_transfers_cost) || 0,
      chip: chipByGw[gw.event] || null,
      rankChange: before && overallRank ? before - overallRank : null,
      value: num(gw.value) !== null ? gw.value / 10 : null,
      bank: num(gw.bank) !== null ? gw.bank / 10 : null,
    };
  });

  const ranks = past.map(s => s.rank).filter(r => r && r > 0);
  const best = past.reduce((b, s) => (!b || s.points > b.points ? s : b), null);
  const chips = (Array.isArray(history && history.chips) ? history.chips : [])
    .map(c => ({ name: chipName(c.name), gw: num(c.event) }))
    .sort((a, b) => (a.gw || 0) - (b.gw || 0));

  return {
    teamName: entry.name || '',
    managerName: [entry.player_first_name, entry.player_last_name].filter(Boolean).join(' '),
    seasons: past.length + (thisSeason ? 1 : 0),
    bestRank: ranks.length ? Math.min(...ranks) : null,
    bestSeason: best,
    averageSeasonPoints: past.length ? Math.round(past.reduce((t, s) => t + s.points, 0) / past.length) : null,
    top10kFinishes: ranks.filter(r => r <= 10_000).length,
    past,
    thisSeason,
    gwHistory,
    chips,
  };
}

// Where each gameweek sits on the rank chart: { ...gw, x, y }, gameweeks
// spread evenly across, overall rank on a log scale with the best rank of
// the season at the top (ranks run from 1 to over 10 million, so a linear
// scale would flatten everything that matters).
export function rankChartPoints(list, { width, height, pad = 8 }) {
  const rows = (list || []).filter(r => r.overallRank > 0);
  if (!rows.length) return [];
  const logs = rows.map(r => Math.log10(r.overallRank));
  const lo = Math.min(...logs);
  const hi = Math.max(...logs);
  const span = hi - lo || 1;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  return rows.map((r, i) => ({
    ...r,
    x: pad + (rows.length === 1 ? innerW / 2 : (innerW * i) / (rows.length - 1)),
    y: pad + (hi === lo ? innerH / 2 : (innerH * (Math.log10(r.overallRank) - lo)) / span),
  }));
}

// Where each gameweek sits on the team value chart: { ...gw, x, y }, on a
// linear scale with the season's highest value at the top.
export function valueChartPoints(list, { width, height, pad = 8 }) {
  const rows = (list || []).filter(r => r.value > 0);
  if (!rows.length) return [];
  const lo = Math.min(...rows.map(r => r.value));
  const hi = Math.max(...rows.map(r => r.value));
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  return rows.map((r, i) => ({
    ...r,
    x: pad + (rows.length === 1 ? innerW / 2 : (innerW * i) / (rows.length - 1)),
    y: pad + (hi === lo ? innerH / 2 : (innerH * (hi - r.value)) / (hi - lo)),
  }));
}
