// A manager's FPL career from FPL's entry/<id>/ and entry/<id>/history/
// answers, for the profile page: every past season, this season so far and
// the chips played.

const CHIP_NAMES = { wildcard: 'Wildcard', freehit: 'Free Hit', bboost: 'Bench Boost', '3xc': 'Triple Captain', manager: 'Assistant Manager' };
export const chipName = chip => CHIP_NAMES[chip] || chip;

const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);

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
    chips,
  };
}
