// Grid-searches the prediction formula's tunable weights (see
// DEFAULT_PREDICTION_WEIGHTS in src/lib/predictions.js) against real past
// results, instead of going on judgment alone for what the "right" weights
// are. Two separate questions, evaluated separately because they need
// different metrics:
//
//   1. Which {epNext, ppg, form, xgRegression} combo produces the most
//      ACCURATE individual player predictions? Measured pool-wide (every
//      player, every target gameweek) via mean absolute error and
//      correlation against what actually happened — the same metrics
//      scripts/backtest.mjs reported.
//   2. Which selectionShrinkage value best closes the "winner's curse" gap
//      between a squad's PREDICTED total and what it actually scored?
//      Pool-wide accuracy doesn't touch this — it's purely a
//      selection-time effect — so it needs the actual squad-building
//      simulation, not just per-player error.
//
// Same walk-forward discipline as scripts/backtest.mjs: for each target
// gameweek, only data genuinely available beforehand (prior seasons' career
// history + this season's earlier gameweeks) is used — no lookahead.
//
// Usage:
//   node scripts/calibrate-weights.mjs                  (season 2025-26, GW10-20, default grid)
//   SEASON=2024-25 START_GW=8 END_GW=18 node scripts/calibrate-weights.mjs
//
// This is a one-off analysis tool, not part of the deployed app — it has no
// effect on production until you actually change DEFAULT_PREDICTION_WEIGHTS
// based on what it finds.

import {
  buildStaticDataFromRaw, buildOptimalTeam, SQUAD_BUDGET, DEFAULT_PREDICTION_WEIGHTS,
} from '../src/lib/predictions.js';
import { buildCareerBaselineByCode } from '../src/lib/playerHistory.js'; // eslint-disable-line no-unused-vars -- used indirectly via buildStaticDataFromRaw

const SEASON = process.env.SEASON || '2025-26';
const START_GW = Number(process.env.START_GW || 10);
const END_GW = Number(process.env.END_GW || 20);
const ARCHIVE_BASE = `https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data`;
const ALL_SEASONS = ['2016-17', '2017-18', '2018-19', '2019-20', '2020-21', '2021-22', '2022-23', '2023-24', '2024-25', '2025-26'];

/* ---------------------------------------------------------------------- */
/* CSV plumbing — same quote-aware parser as the other scripts.            */
/* ---------------------------------------------------------------------- */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function parseCsvObjects(text) {
  const rows = parseCsv(text);
  const header = rows[0];
  return rows.slice(1).filter(r => r.length === header.length).map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}
async function fetchCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return parseCsvObjects(await res.text());
}

/* ---------------------------------------------------------------------- */
/* Load season data                                                        */
/* ---------------------------------------------------------------------- */
async function loadSeasonData(season, endGw) {
  console.log(`Fetching ${season} season data (players, fixtures, GW1-${endGw})...`);
  const base = `${ARCHIVE_BASE}/${season}`;
  const playersRaw = await fetchCsv(`${base}/players_raw.csv`);
  const fixturesRawCsv = await fetchCsv(`${base}/fixtures.csv`);
  const fixturesRaw = fixturesRawCsv.map(f => ({
    event: f.event === '' ? null : Number(f.event),
    team_h: Number(f.team_h), team_a: Number(f.team_a),
    team_h_difficulty: Number(f.team_h_difficulty), team_a_difficulty: Number(f.team_a_difficulty),
    kickoff_time: f.kickoff_time,
  }));
  const gwRows = {};
  for (let gw = 1; gw <= endGw; gw++) {
    const rows = await fetchCsv(`${base}/gws/gw${gw}.csv`);
    const byElement = {};
    rows.forEach(r => { byElement[r.element] = r; });
    gwRows[gw] = byElement;
  }
  const playerMetaById = {};
  playersRaw.forEach(p => { playerMetaById[p.id] = { code: p.code, elementType: Number(p.element_type), team: Number(p.team), webName: p.web_name }; });
  const teamIds = [...new Set(playersRaw.map(p => Number(p.team)))];
  return { playersRaw, fixturesRaw, gwRows, playerMetaById, teamIds };
}

// Career history from every season BEFORE the one being tested — never the
// test season itself, to avoid leaking its own results into its "prior
// history" baseline.
async function loadPlayerHistoryData(excludeSeason) {
  const seasons = ALL_SEASONS.filter(s => s < excludeSeason);
  console.log(`Fetching career history from ${seasons.length} prior seasons for the baseline...`);
  const byCode = {};
  for (const season of seasons) {
    let rows;
    try { rows = await fetchCsv(`${ARCHIVE_BASE}/${season}/players_raw.csv`); }
    catch { continue; }
    for (const row of rows) {
      const code = row.code;
      if (!code) continue;
      if (!byCode[code]) byCode[code] = { webName: row.web_name || '', seasons: {} };
      const stats = {};
      if (row.total_points !== undefined && row.total_points !== '') stats.total_points = Number(row.total_points);
      if (row.minutes !== undefined && row.minutes !== '') stats.minutes = Number(row.minutes);
      byCode[code].seasons[season] = stats;
    }
  }
  return { seasons, players: byCode };
}

/* ---------------------------------------------------------------------- */
/* Build a synthetic bootstrap for gameweek `targetGw`, using only rows     */
/* strictly before it — same walk-forward reconstruction as backtest.mjs,  */
/* now also carrying forward cumulative goals/assists/xG/xA (for the xG    */
/* regression nudge) and each team's rest-day gap (for the congestion      */
/* discount).                                                               */
/* ---------------------------------------------------------------------- */
function buildSyntheticBootstrap(seasonData, targetGw) {
  const { playersRaw, gwRows, playerMetaById } = seasonData;
  const elements = playersRaw.map(p => {
    const id = p.id;
    const meta = playerMetaById[id];
    const priorRows = [];
    for (let gw = 1; gw < targetGw; gw++) {
      const row = gwRows[gw][id];
      if (row && Number(row.minutes) > 0) priorRows.push(row);
    }
    const totalMinutes = priorRows.reduce((s, r) => s + Number(r.minutes), 0);
    const ppg = priorRows.length ? priorRows.reduce((s, r) => s + Number(r.total_points), 0) / priorRows.length : 0;
    const recentRows = priorRows.slice(-4);
    const form = recentRows.length ? recentRows.reduce((s, r) => s + Number(r.total_points), 0) / recentRows.length : 0;
    const thisWeekRow = gwRows[targetGw][id];
    const epNext = thisWeekRow ? Number(thisWeekRow.xP) || 0 : 0;
    const price = thisWeekRow ? Number(thisWeekRow.value) / 10 : Number(p.now_cost) / 10;
    const goalsScored = priorRows.reduce((s, r) => s + (Number(r.goals_scored) || 0), 0);
    const assists = priorRows.reduce((s, r) => s + (Number(r.assists) || 0), 0);
    const expectedGoals = priorRows.reduce((s, r) => s + (Number(r.expected_goals) || 0), 0);
    const expectedAssists = priorRows.reduce((s, r) => s + (Number(r.expected_assists) || 0), 0);

    return {
      id: Number(id), code: meta.code, web_name: meta.webName, first_name: p.first_name, second_name: p.second_name,
      team: meta.team, element_type: meta.elementType, now_cost: Math.round(price * 10),
      form: String(form), points_per_game: String(ppg), total_points: Math.round(ppg * priorRows.length),
      ep_next: String(epNext), status: 'a', chance_of_playing_next_round: null, news: '', selected_by_percent: '0',
      minutes: totalMinutes, goals_scored: goalsScored, assists, expected_goals: expectedGoals, expected_assists: expectedAssists,
    };
  });
  const events = [];
  for (let gw = 1; gw <= 38; gw++) events.push({ id: gw, deadline_time: `2025-${String(8 + Math.floor((gw - 1) / 4)).padStart(2, '0')}-${String(1 + ((gw - 1) % 4) * 7).padStart(2, '0')}T11:00:00Z` });
  return { teams: seasonData.teamIds.map(id => ({ id })), events, elements };
}

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  return num / Math.sqrt(dx2 * dy2);
}

/* ---------------------------------------------------------------------- */
/* Grid A: {epNext, ppg, form, xgRegression} vs pool-wide prediction error */
/* ---------------------------------------------------------------------- */
const FORMULA_GRID = [
  { epNext: 0.45, ppg: 0.35, form: 0.20 }, // current default
  { epNext: 0.55, ppg: 0.30, form: 0.15 },
  { epNext: 0.35, ppg: 0.40, form: 0.25 },
  { epNext: 0.60, ppg: 0.25, form: 0.15 },
  { epNext: 0.45, ppg: 0.45, form: 0.10 },
];
const XG_GRID = [0, 0.10, 0.15, 0.25];

function evaluateFormula(seasonData, fixturesRaw, playerHistoryData, weights) {
  let sumMae = 0, sumBias = 0, count = 0;
  const allPred = [], allActual = [];
  for (let gw = START_GW; gw <= END_GW; gw++) {
    const bootstrap = buildSyntheticBootstrap(seasonData, gw);
    const staticData = buildStaticDataFromRaw(bootstrap, fixturesRaw, { forceGwId: gw, playerHistoryData, weights });
    const rows = seasonData.gwRows[gw];
    staticData.allPlayers.forEach(p => {
      const row = rows[p.id];
      if (!row) return;
      const actual = Number(row.total_points);
      const predicted = staticData.predictionsById[p.id].predicted;
      allPred.push(predicted); allActual.push(actual);
      sumMae += Math.abs(predicted - actual);
      sumBias += (predicted - actual);
      count++;
    });
  }
  return { mae: sumMae / count, bias: sumBias / count, correlation: pearson(allPred, allActual), n: count };
}

/* ---------------------------------------------------------------------- */
/* Grid B: selectionShrinkage vs squad-level winner's-curse gap             */
/* ---------------------------------------------------------------------- */
const SHRINKAGE_GRID = [1.0, 0.9, 0.85, 0.75, 0.6];

function evaluateShrinkage(seasonData, fixturesRaw, playerHistoryData, selectionShrinkage) {
  let sumPredicted = 0, sumActual = 0;
  for (let gw = START_GW; gw <= END_GW; gw++) {
    const bootstrap = buildSyntheticBootstrap(seasonData, gw);
    const staticData = buildStaticDataFromRaw(bootstrap, fixturesRaw, {
      forceGwId: gw, playerHistoryData, weights: { ...DEFAULT_PREDICTION_WEIGHTS, selectionShrinkage },
    });
    const built = buildOptimalTeam(staticData, SQUAD_BUDGET);
    const rows = seasonData.gwRows[gw];
    built.squad.filter(s => s.isStarting).forEach(s => {
      const row = rows[s.player.id];
      const actual = row ? Number(row.total_points) : 0;
      const mult = s.multiplier || 1;
      sumPredicted += s.predicted * mult;
      sumActual += actual * mult;
    });
  }
  return { predicted: sumPredicted, actual: sumActual, gapPct: (sumActual / sumPredicted - 1) * 100 };
}

/* ---------------------------------------------------------------------- */
async function main() {
  const seasonData = await loadSeasonData(SEASON, END_GW);
  const fixturesRaw = seasonData.fixturesRaw;
  const playerHistoryData = await loadPlayerHistoryData(SEASON);

  console.log(`\n=== GRID A: formula weights vs pool-wide prediction accuracy (GW${START_GW}-${END_GW}) ===`);
  console.log('epNext | ppg  | form | xgReg | MAE   | bias   | correlation');
  const gridAResults = [];
  for (const formula of FORMULA_GRID) {
    for (const xgRegression of XG_GRID) {
      const weights = { ...formula, xgRegression };
      const result = evaluateFormula(seasonData, fixturesRaw, playerHistoryData, weights);
      gridAResults.push({ weights, ...result });
      console.log(`${formula.epNext.toFixed(2)}  | ${formula.ppg.toFixed(2)} | ${formula.form.toFixed(2)} | ${xgRegression.toFixed(2)}  | ${result.mae.toFixed(3)} | ${result.bias.toFixed(3)} | ${result.correlation.toFixed(3)}`);
    }
  }
  gridAResults.sort((a, b) => a.mae - b.mae);
  console.log(`\nBest by MAE: epNext=${gridAResults[0].weights.epNext} ppg=${gridAResults[0].weights.ppg} form=${gridAResults[0].weights.form} xgRegression=${gridAResults[0].weights.xgRegression} (MAE=${gridAResults[0].mae.toFixed(3)}, correlation=${gridAResults[0].correlation.toFixed(3)})`);
  const currentDefault = gridAResults.find(r => r.weights.epNext === 0.45 && r.weights.ppg === 0.35 && r.weights.form === 0.20 && r.weights.xgRegression === 0.15);
  if (currentDefault) console.log(`Current default:  epNext=0.45 ppg=0.35 form=0.20 xgRegression=0.15 (MAE=${currentDefault.mae.toFixed(3)}, correlation=${currentDefault.correlation.toFixed(3)})`);

  console.log(`\n=== GRID B: selectionShrinkage vs squad-level "winner's curse" gap (GW${START_GW}-${END_GW}) ===`);
  console.log('shrinkage | predicted | actual | gap%');
  const gridBResults = [];
  for (const shrinkage of SHRINKAGE_GRID) {
    const result = evaluateShrinkage(seasonData, fixturesRaw, playerHistoryData, shrinkage);
    gridBResults.push({ shrinkage, ...result });
    console.log(`${shrinkage.toFixed(2)}      | ${result.predicted.toFixed(1).padStart(9)} | ${result.actual.toFixed(1).padStart(6)} | ${result.gapPct.toFixed(1)}%`);
  }
  gridBResults.sort((a, b) => Math.abs(a.gapPct) - Math.abs(b.gapPct));
  console.log(`\nSmallest gap: selectionShrinkage=${gridBResults[0].shrinkage} (gap=${gridBResults[0].gapPct.toFixed(1)}%)`);
  console.log('Note: shrinkage=1.0 means "no correction at all" (today\'s displayed predicted value used directly for selection) — compare its gap% to lower values to see how much the correction actually helps.');

  console.log('\nTo apply a result, edit DEFAULT_PREDICTION_WEIGHTS in src/lib/predictions.js.');
}

main().catch(e => { console.error('Calibration failed:', e); process.exit(1); });
