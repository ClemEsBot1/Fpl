// A manager's FPL career from FPL's entry/<id>/ and entry/<id>/history/
// answers, for the profile page: every past season, this season so far and
// the chips played.
import { t } from './i18n.js';

const CHIP_NAMES = { wildcard: t('Wildcard'), freehit: t('Free Hit'), bboost: t('Bench Boost'), '3xc': t('Triple Captain'), manager: t('Assistant Manager') };
export const chipName = chip => CHIP_NAMES[chip] || chip;

const num = v => (v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

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

  // Each played gameweek, for the rank chart. rankChange: places gained
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
