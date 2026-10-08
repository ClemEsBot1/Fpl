// Walk-forward backtest of the prediction formula and the optimal squad
// against real past seasons (vaastav/Fantasy-Premier-League archive). For
// each target gameweek only what was known before it is used: earlier
// gameweeks of that season, and prior seasons from player-history.json.
// Gameweeks the archive has no FPL expected points (xP) for are skipped:
// ep_next would read 0 for everyone. That's most of 2025-26.
//
// Reports, over every player who had played that season:
//   nextMAE/nextCorr  nextMatchPredicted against that gameweek's points
//   winMAE/winCorr    predicted (pts/wk) against the average of the next 4
// and for the optimal squad built each gameweek:
//   xiPerGw           its XI's points that gameweek, captain doubled
//   squad4PerGw       the same 15 over the next 4 gameweeks, XI and
//                     captain re-picked each week (no transfers)
//
// Usage:
//   node scripts/backtest.mjs
//   SEASONS=2024-25 START=6 END=34 node scripts/backtest.mjs
//   node scripts/backtest.mjs '[{"name":"no xG","weights":{"xgRegression":0}},{"name":"2-week window","weights":{"fixtureWindowGws":2}}]'
//
// Downloads are cached in .backtest-cache/. A one-off analysis tool, not
// part of the deployed app.

import fs from 'node:fs';
import path from 'node:path';
import { buildStaticDataFromRaw, buildOptimalTeam, hydrateSquadSnapshot, RECENT_MINUTES_GWS, SQUAD_BUDGET } from '../src/lib/predictions.js';

const ARCHIVE = 'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data';
const CACHE = path.resolve(import.meta.dirname, '..', '.backtest-cache');
const ROOT = path.resolve(import.meta.dirname, '..');
const SEASONS = (process.env.SEASONS || '2022-23,2023-24,2024-25,2025-26').split(',');
const START = Number(process.env.START || 6);
const END = Number(process.env.END || 34);

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows[0];
  return rows.slice(1).filter(r => r.length === header.length).map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function csv(file) {
  const local = path.join(CACHE, file);
  if (!fs.existsSync(local)) {
    const res = await fetch(`${ARCHIVE}/${file}`);
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${file}`);
    fs.mkdirSync(path.dirname(local), { recursive: true });
    fs.writeFileSync(local, await res.text());
  }
  return parseCsv(fs.readFileSync(local, 'utf8'));
}

async function loadSeason(season) {
  const players = (await csv(`${season}/players_raw.csv`)).filter(p => Number(p.element_type) <= 4); // 5 = managers
  const teams = (await csv(`${season}/teams.csv`)).map(t => ({ id: Number(t.id), short_name: t.short_name }));
  const fixtures = (await csv(`${season}/fixtures.csv`)).map(f => ({
    id: Number(f.id), event: f.event === '' ? null : Number(f.event), team_h: Number(f.team_h), team_a: Number(f.team_a),
    team_h_difficulty: Number(f.team_h_difficulty), team_a_difficulty: Number(f.team_a_difficulty), kickoff_time: f.kickoff_time,
  }));
  // gameweek -> player id -> that gameweek's totals. A double gameweek has
  // one row per match; xP (FPL's ep for the gameweek) repeats on each.
  const gws = {};
  for (let gw = 1; gw <= 38; gw++) {
    const byId = {};
    for (const r of await csv(`${season}/gws/gw${gw}.csv`)) {
      const a = byId[r.element] ||= { pts: 0, minutes: 0, goals: 0, assists: 0, xg: 0, xa: 0, xP: Number(r.xP) || 0, value: Number(r.value) };
      a.pts += Number(r.total_points) || 0;
      a.minutes += Number(r.minutes) || 0;
      a.goals += Number(r.goals_scored) || 0;
      a.assists += Number(r.assists) || 0;
      a.xg += Number(r.expected_goals) || 0;
      a.xa += Number(r.expected_assists) || 0;
    }
    gws[gw] = byId;
  }
  return { players, teams, fixtures, gws };
}

// bootstrap-static as it would have looked before gameweek G. Fitness flags
// aren't archived, so everyone is available.
function bootstrapBefore(S, G) {
  const events = Array.from({ length: 38 }, (_, i) => ({
    id: i + 1, deadline_time: new Date(Date.UTC(2030, 7, 1) + i * 7 * 864e5).toISOString(), finished: i + 1 < G,
  }));
  const elements = S.players.map(p => {
    const id = Number(p.id);
    let pts = 0, minutes = 0, apps = 0, goals = 0, assists = 0, xg = 0, xa = 0, formPts = 0;
    for (let g = 1; g < G; g++) {
      const r = S.gws[g][id];
      if (!r) continue;
      pts += r.pts; minutes += r.minutes; goals += r.goals; assists += r.assists; xg += r.xg; xa += r.xa;
      if (r.minutes > 0) apps++;
      if (g >= G - 4) formPts += r.pts;
    }
    const now = S.gws[G][id];
    return {
      id, code: Number(p.code), web_name: p.web_name, team: Number(p.team), element_type: Number(p.element_type),
      now_cost: now ? now.value : Number(p.now_cost), form: String(formPts / Math.min(4, G - 1)),
      points_per_game: String(apps ? pts / apps : 0), total_points: pts, ep_next: String(now ? now.xP : 0),
      status: 'a', chance_of_playing_next_round: null, selected_by_percent: '0',
      minutes, goals_scored: goals, assists, expected_goals: xg, expected_assists: xa,
    };
  });
  return { teams: S.teams, events, elements, total_players: 0 };
}

// Minutes in the RECENT_MINUTES_GWS gameweeks before G.
function recentMinutesBefore(S, G) {
  const out = {};
  for (let g = Math.max(1, G - RECENT_MINUTES_GWS); g < G; g++) {
    for (const [id, r] of Object.entries(S.gws[g] || {})) out[id] = (out[id] || 0) + r.minutes;
  }
  return out;
}

// player-history.json without the tested season or anything after it.
function historyBefore(history, season) {
  const players = {};
  for (const [code, v] of Object.entries(history.players)) {
    const seasons = Object.fromEntries(Object.entries(v.seasons).filter(([k]) => k < season));
    if (Object.keys(seasons).length) players[code] = { ...v, seasons };
  }
  return { seasons: history.seasons.filter(k => k < season), players };
}

function hasExpectedPoints(S, G) {
  const played = Object.values(S.gws[G] || {}).filter(r => r.minutes > 0);
  return played.length > 0 && played.filter(r => r.xP > 0).length / played.length > 0.5;
}

function pearson(x, y) {
  const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  return num / Math.sqrt(dx2 * dy2);
}
const mae = (x, y) => x.reduce((a, v, i) => a + Math.abs(v - y[i]), 0) / x.length;

function run(variant, seasons) {
  const nx = [], ny = [], wx = [], wy = [];
  const byPos = {};
  let xiPts = 0, squad4 = 0, n = 0;
  for (const { S, hist } of seasons) {
    const staticAt = {};
    const sd = G => (staticAt[G] ||= buildStaticDataFromRaw(bootstrapBefore(S, G), S.fixtures, { forceGwId: G, playerHistoryData: hist, weights: variant.weights || {}, recentMinutesById: recentMinutesBefore(S, G) }));
    for (let G = START; G <= END; G++) {
      if (!hasExpectedPoints(S, G)) continue;
      const data = sd(G);
      for (const p of data.allPlayers) {
        if (!(p.minutes > 0)) continue; // everyone predicts ~0 for players yet to play
        const pred = data.predictionsById[p.id];
        nx.push(pred.nextMatchPredicted); ny.push(S.gws[G][p.id]?.pts || 0);
        let later = 0;
        for (let g = G; g < G + 4; g++) later += S.gws[g]?.[p.id]?.pts || 0;
        wx.push(pred.predicted); wy.push(later / 4);
        const b = (byPos[p.positionId] ||= { nx: [], ny: [], wx: [], wy: [] });
        b.nx.push(pred.nextMatchPredicted); b.ny.push(S.gws[G][p.id]?.pts || 0); b.wx.push(pred.predicted); b.wy.push(later / 4);
      }
      const team = buildOptimalTeam(data, SQUAD_BUDGET);
      team.squad.forEach(s => { if (s.isStarting) xiPts += (S.gws[G][s.player.id]?.pts || 0) * s.multiplier; });
      const playerIds = team.squad.map(s => s.player.id);
      for (let g = G; g < Math.min(G + 4, 39); g++) {
        const h = hydrateSquadSnapshot({ playerIds, captainId: null, viceCaptainId: null }, sd(g));
        if (h) h.squad.forEach(s => { if (s.isStarting) squad4 += (S.gws[g][s.player.id]?.pts || 0) * s.multiplier; });
      }
      n++;
    }
  }
  if (process.env.BY_POS) {
    return [1, 2, 3, 4].map(pos => {
      const b = byPos[pos];
      return { name: `${variant.name} ${['GKP', 'DEF', 'MID', 'FWD'][pos - 1]}`, n: b.nx.length, nextMAE: mae(b.nx, b.ny).toFixed(3), nextCorr: pearson(b.nx, b.ny).toFixed(4), winMAE: mae(b.wx, b.wy).toFixed(3), winCorr: pearson(b.wx, b.wy).toFixed(4) };
    });
  }
  return {
    name: variant.name,
    nextMAE: mae(nx, ny).toFixed(3), nextCorr: pearson(nx, ny).toFixed(4),
    winMAE: mae(wx, wy).toFixed(3), winCorr: pearson(wx, wy).toFixed(4),
    xiPerGw: (xiPts / n).toFixed(2), squad4PerGw: (squad4 / n / 4).toFixed(2),
  };
}

// HAUL_TABLE=1: how often a player scored 10+ in a gameweek, by position
// group and how many points he was predicted for it (nextMatchPredicted),
// for HAUL_RATES in src/lib/captaincy.js.
function haulTable(seasons) {
  const groups = { def: [1, 2], mid: [3], fwd: [4] };
  const edges = [1, 2, 3, 4, 5, 6, 7, 8, 10];
  const counts = {};
  for (const { S, hist } of seasons) {
    for (let G = START; G <= END; G++) {
      if (!hasExpectedPoints(S, G)) continue;
      const data = buildStaticDataFromRaw(bootstrapBefore(S, G), S.fixtures, { forceGwId: G, playerHistoryData: hist, recentMinutesById: recentMinutesBefore(S, G) });
      for (const p of data.allPlayers) {
        const x = data.predictionsById[p.id].nextMatchPredicted;
        if (!(x >= 1)) continue;
        const g = Object.keys(groups).find(k => groups[k].includes(p.positionId));
        const b = edges.filter(e => x >= e).pop();
        const c = (counts[`${g} ${b}`] ||= { n: 0, hauls: 0 });
        c.n++;
        if ((S.gws[G][p.id]?.pts || 0) >= 10) c.hauls++;
      }
    }
  }
  console.table(Object.fromEntries(Object.entries(counts).sort().map(([k, c]) => [k, { n: c.n, rate: (c.hauls / c.n).toFixed(3) }])));
}

const variants = process.argv[2] ? JSON.parse(process.argv[2]) : [{ name: 'current' }];
const history = JSON.parse(fs.readFileSync(path.join(ROOT, 'player-history.json'), 'utf8'));
const seasons = [];
for (const s of SEASONS) {
  console.log(`Loading ${s}...`);
  seasons.push({ S: await loadSeason(s), hist: historyBefore(history, s) });
}
if (process.env.HAUL_TABLE) haulTable(seasons);
else console.table(variants.flatMap(v => run(v, seasons)));
