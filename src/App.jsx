import React, { useState, useEffect, useRef } from 'react';
import { Hash, Camera, Loader2, AlertTriangle, CheckCircle2, Crown, ArrowRight, Search, ChevronLeft, ChevronDown, Info, ShieldAlert, RotateCcw, Trophy, Edit3, Plus, X, Zap, Layers, RefreshCw, Wand2 } from 'lucide-react';
import {
  POSITION_ORDER, SQUAD_SLOTS, MAX_PER_REAL_TEAM, SQUAD_BUDGET,
  buildStaticDataFromRaw, buildOptimalTeam, hydrateSquadSnapshot,
} from './lib/predictions.js';

/* ============================================================================
   CONSTANTS
============================================================================ */

const FPL_BASE = 'https://fantasy.premierleague.com/api/';
const POSITION_LABELS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const BAD_AVAIL_NOTES = ['Injured', 'Suspended', 'Unavailable'];

const DIFF_COLORS = {
  1: { bg: '#1F9D55', text: '#06210F' },
  2: { bg: '#6FCB90', text: '#06210F' },
  3: { bg: '#E8C547', text: '#241D02' },
  4: { bg: '#E08A3C', text: '#2B1400' },
  5: { bg: '#E14545', text: '#2B0505' },
};

/* ============================================================================
   PURE UTILITY FUNCTIONS
============================================================================ */

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = [];
  for (let i = 0; i <= m; i++) dp.push(new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na.length || !nb.length) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const dist = levenshtein(na, nb);
  return Math.max(0, 1 - dist / Math.max(na.length, nb.length));
}

function findTopMatches(extractedName, candidates, topN = 3) {
  const scored = candidates.map(p => {
    const s1 = similarity(extractedName, p.webName);
    const s2 = similarity(extractedName, p.secondName);
    const s3 = similarity(extractedName, `${p.firstName} ${p.secondName}`);
    return { player: p, score: Math.max(s1, s2, s3) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

function fmtPts(n) { return (Math.round(n * 10) / 10).toFixed(1); }
function fmtPrice(n) { return `£${n.toFixed(1)}m`; }

function formatCountdown(deadlineISO) {
  if (!deadlineISO) return '';
  const diff = new Date(deadlineISO).getTime() - Date.now();
  if (diff <= 0) return 'Deadline passed';
  const totalMins = Math.floor(diff / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${hours}h to deadline`;
  return `${hours}h ${mins}m to deadline`;
}

/* ============================================================================
   NETWORK: multi-proxy fetch (FPL API has no CORS headers for browser fetch,
   so we try direct first, then fall back to public CORS proxies)
============================================================================ */

async function fetchFplJson(path) {
  // Calls our own /api/fpl serverless function (added via Vercel), which
  // fetches FPL server-side — no CORS issue, no dependence on third-party
  // proxy services, and no dynamic-route filename to trip over.
  const r = await fetch(`/api/fpl?path=${encodeURIComponent(path)}`);
  if (!r.ok) throw new Error('status ' + r.status);
  return r.json();
}

/* ============================================================================
   PREDICTION ENGINE
   (computePlayerPrediction now lives in ./lib/predictions.js — imported above
   so the browser and the server-side refresh job can never disagree)
============================================================================ */

function suggestCaptain(starters) {
  if (!starters.length) return null;
  return [...starters].sort((a, b) => b.nextMatchPredicted - a.nextMatchPredicted)[0];
}

/* ============================================================================
   OPTIMAL SQUAD BUILDER
   Builds the strongest possible 15-man squad within budget: 2 GKP, 5 DEF,
   5 MID, 3 FWD, max 3 players from any one real club. This is a heuristic
   (start with the best XV regardless of price, then repeatedly downgrade
   whichever swap sheds the fewest predicted points per pound saved, until
   under budget) rather than a provably-optimal solver — in practice it lands
   very close to optimal and runs instantly in the browser.
   (buildOptimalSquad and pickBestFormation now live in ./lib/predictions.js)
============================================================================ */

// All legal FPL starting formations: 1 GKP fixed + DEF/MID/FWD split summing
// to 10 outfield players, within the same bounds used by pickBestFormation
// (3-5 DEF, 2-5 MID, 1-3 FWD).
function getValidFormations() {
  const list = [];
  for (let d = 3; d <= 5; d++) {
    for (let m = 2; m <= 5; m++) {
      const f = 10 - d - m;
      if (f < 1 || f > 3) continue;
      list.push({ key: `${d}-${m}-${f}`, d, m, f });
    }
  }
  return list;
}

// Given a 15-man squad and an explicit formation shape, picks the highest-
// predicted players at each position to fill it (used by the manual squad
// builder, where the formation is chosen by the person rather than solved
// for). Returns a Set of starting player ids.
function pickFormationStarters(squad15, formation, predictionsById) {
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  squad15.forEach(p => byPos[p.positionId].push(p));
  POSITION_ORDER.forEach(pos => byPos[pos].sort((a, b) => predictionsById[b.id].predicted - predictionsById[a.id].predicted));
  const gk = byPos[1][0];
  const defs = byPos[2].slice(0, formation.d);
  const mids = byPos[3].slice(0, formation.m);
  const fwds = byPos[4].slice(0, formation.f);
  return new Set([gk, ...defs, ...mids, ...fwds].filter(Boolean).map(p => p.id));
}

// Swaps a single player out of an existing squad-slot array for a new one,
// carrying over the slot's starting/bench status but clearing captaincy on
// the replaced slot (a brand-new player shouldn't inherit an old armband).
function swapPlayerInSquad(squad, outPlayerId, inPlayer, predictionsById) {
  const pred = predictionsById[inPlayer.id];
  return squad.map(s => {
    if (s.player.id !== outPlayerId) return s;
    return {
      ...s,
      player: inPlayer,
      predicted: pred.predicted,
      nextMatchPredicted: pred.nextMatchPredicted,
      availNote: pred.availNote,
      isCaptain: false,
      isViceCaptain: false,
      multiplier: 1,
    };
  });
}

// If a swap removed the captain, promote the vice-captain (or, failing
// that, the highest-predicted starter) so the squad is never captain-less.
function ensureCaptaincy(squad) {
  if (squad.some(s => s.isCaptain)) return squad;
  const vice = squad.find(s => s.isViceCaptain);
  const starters = squad.filter(s => s.isStarting);
  const promote = vice || suggestCaptain(starters);
  if (!promote) return squad;
  return squad.map(s => s.player.id === promote.player.id ? { ...s, isCaptain: true, multiplier: 2 } : s);
}

// buildOptimalTeam now lives in ./lib/predictions.js (imported above)

const MAX_TRANSFER_SUGGESTIONS = 5;

function suggestTransfers(squad, allPlayers, predictionsById, bankTenths) {
  const starters = squad.filter(s => s.isStarting);
  const isBad = (s) => s.availNote && BAD_AVAIL_NOTES.includes(s.availNote);
  const flagged = starters.filter(isBad);
  const sortedByPred = [...starters].sort((a, b) => a.predicted - b.predicted);
  const lowPerformers = sortedByPred.filter(s => !isBad(s)).slice(0, MAX_TRANSFER_SUGGESTIONS);

  const seen = new Set();
  const candidates = [];
  [...flagged, ...lowPerformers].forEach(s => {
    if (!seen.has(s.player.id)) { seen.add(s.player.id); candidates.push(s); }
  });

  const squadIds = new Set(squad.map(s => s.player.id));
  const teamCounts = {};
  squad.forEach(s => { teamCounts[s.player.team] = (teamCounts[s.player.team] || 0) + 1; });

  const suggestions = [];
  for (const out of candidates) {
    if (suggestions.length >= MAX_TRANSFER_SUGGESTIONS) break;
    const budget = out.player.price + bankTenths / 10;
    const pool = allPlayers.filter(p =>
      p.positionId === out.player.positionId &&
      !squadIds.has(p.id) &&
      p.price <= budget + 0.05 &&
      p.status === 'a' &&
      (teamCounts[p.team] || 0) < 3
    );
    pool.sort((a, b) => predictionsById[b.id].predicted - predictionsById[a.id].predicted);
    const top = pool[0];
    if (top) {
      const gain = predictionsById[top.id].predicted - out.predicted;
      if (gain > 0.3) {
        suggestions.push({
          out,
          inPlayer: top,
          inPredicted: predictionsById[top.id].predicted,
          gain: Math.round(gain * 10) / 10,
          costDelta: Math.round((top.price - out.player.price) * 10) / 10,
          reason: out.availNote || 'Below-average returns for the position',
        });
      }
    }
  }
  suggestions.sort((a, b) => b.gain - a.gain);
  return suggestions;
}

/* ============================================================================
   SCREENSHOT MATCHING
============================================================================ */

function matchExtractedSquad(extracted, playersByPosition, allPlayers) {
  const slots = [];
  const posMap = { goalkeepers: 1, defenders: 2, midfielders: 3, forwards: 4 };
  Object.entries(posMap).forEach(([key, posId]) => {
    (extracted.starting_xi && extracted.starting_xi[key] || []).forEach(name => {
      const top = findTopMatches(name, playersByPosition[posId] || [], 3);
      slots.push({
        extractedName: name, posId, isStarting: true,
        top, matched: (top[0] && top[0].score > 0.72) ? top[0].player : null,
        isCaptain: false, isViceCaptain: false,
      });
    });
  });
  (extracted.bench || []).forEach(name => {
    const top = findTopMatches(name, allPlayers, 3);
    slots.push({
      extractedName: name, posId: null, isStarting: false,
      top, matched: (top[0] && top[0].score > 0.72) ? top[0].player : null,
      isCaptain: false, isViceCaptain: false,
    });
  });

  function markByName(name, field) {
    if (!name) return;
    let best = null, bestScore = 0;
    slots.forEach(s => {
      const score = similarity(name, s.extractedName);
      if (score > bestScore) { bestScore = score; best = s; }
    });
    if (best && bestScore > 0.5) best[field] = true;
  }
  markByName(extracted.captain, 'isCaptain');
  markByName(extracted.vice_captain, 'isViceCaptain');

  return slots;
}

/* ============================================================================
   STATIC DATA LOADER
============================================================================ */

async function loadStaticData() {
  const [bootstrap, fixturesRaw] = await Promise.all([
    fetchFplJson('bootstrap-static/'),
    fetchFplJson('fixtures/'),
  ]);
  return buildStaticDataFromRaw(bootstrap, fixturesRaw);
}

/* ============================================================================
   PRESENTATIONAL PRIMITIVES
============================================================================ */

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap');

      .fpl-root { --bg:linear-gradient(135deg, #04F9FC 0%, #7573F7 55%, #BF1CF0 100%);
        --panel:rgba(10,8,30,0.60); --panel-alt:rgba(10,8,30,0.42); --line:rgba(255,255,255,0.20);
        --ink:#FBFAFF; --ink-dim:rgba(251,250,255,0.72); --blue:#04F9FC; --green:#36FE48;
        --mint:#04F9A5; --lime:#CEFF10; --red:#FF5A5A; --sky:#7573F7; --amber:#FF9A45; }
      .fpl-root { font-family:'Inter',sans-serif; background:var(--bg) fixed; color:var(--ink); min-height:100vh; }

      .fpl-display { font-family:'Space Grotesk',sans-serif; }
      .fpl-mono { font-family:'IBM Plex Mono',monospace; }

      .fpl-block { background:var(--panel); border:1px solid var(--line); border-radius:6px; overflow:hidden;
        backdrop-filter:blur(14px); -webkit-backdrop-filter:blur(14px); }
      .fpl-btn { font-family:'Space Grotesk',sans-serif; font-weight:600; letter-spacing:0.02em;
        border:2px solid var(--blue); background:transparent; color:var(--blue); border-radius:6px;
        padding:14px 18px; cursor:pointer; transition:background .15s,color .15s; text-align:left; }
      .fpl-btn:hover, .fpl-btn:focus-visible { background:var(--blue); color:#03132B; }
      .fpl-btn:focus-visible { outline:3px solid var(--sky); outline-offset:2px; }
      .fpl-btn-solid { background:var(--blue); color:#03132B; }
      .fpl-btn-solid:hover { background:var(--lime); }
      .fpl-btn:disabled { opacity:0.5; cursor:not-allowed; }

      .fpl-input { font-family:'IBM Plex Mono',monospace; font-size:1.1rem; letter-spacing:0.04em;
        background:var(--panel-alt); border:2px solid var(--line); color:var(--ink); border-radius:5px;
        padding:12px 14px; width:100%; }
      .fpl-input:focus { outline:none; border-color:var(--blue); }
      .fpl-input::placeholder { color:var(--ink-dim); }

      .fpl-tag { display:inline-block; font-family:'IBM Plex Mono',monospace; font-size:0.68rem;
        font-weight:600; padding:2px 6px; letter-spacing:0.03em; border-radius:3px; }

      .fpl-armband { display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px;
        font-size:0.62rem; font-weight:700; margin-left:5px; background:var(--blue); color:#03132B; border-radius:3px;
        font-family:'IBM Plex Mono',monospace; }
      .fpl-armband-vc { background:var(--sky); }

      .fpl-fixchip { font-family:'IBM Plex Mono',monospace; font-size:0.66rem; font-weight:600;
        padding:3px 5px; display:inline-block; min-width:38px; text-align:center; border-radius:3px; }

      .fpl-row { display:flex; align-items:center; gap:10px; padding:10px 10px; border-bottom:1px solid var(--line); }
      .fpl-row-editable { cursor:pointer; transition:background .12s; }
      .fpl-row-editable:hover { background:var(--panel-alt); }
      .fpl-row-editable.fpl-row-open { background:var(--panel-alt); }
      .fpl-row:last-child { border-bottom:none; }
      .fpl-row-bench { opacity:0.72; }
      .fpl-row-pos { font-family:'IBM Plex Mono',monospace; font-size:0.62rem; font-weight:700;
        color:var(--ink-dim); background:var(--panel-alt); padding:4px 5px; min-width:34px; text-align:center; border-radius:3px; }
      .fpl-row-main { flex:1; min-width:0; }
      .fpl-row-name { font-family:'Space Grotesk',sans-serif; font-weight:600; font-size:0.95rem;
        display:flex; align-items:center; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .fpl-row-sub { font-family:'IBM Plex Mono',monospace; font-size:0.72rem; color:var(--ink-dim); margin-top:2px; }
      .fpl-availnote { font-family:'IBM Plex Mono',monospace; font-size:0.68rem; color:var(--red); margin-top:2px; font-weight:600; }
      .fpl-row-fixtures { display:flex; gap:3px; flex-shrink:0; }
      .fpl-row-pred { text-align:right; flex-shrink:0; min-width:52px; }
      .fpl-row-pred-num { font-family:'IBM Plex Mono',monospace; font-weight:700; font-size:1.15rem; line-height:1; }
      .fpl-row-pred-label { font-family:'IBM Plex Mono',monospace; font-size:0.55rem; color:var(--ink-dim); letter-spacing:0.04em; }

      .fpl-section-title { font-family:'Space Grotesk',sans-serif; font-weight:700; font-size:0.85rem;
        letter-spacing:0.06em; text-transform:uppercase; color:var(--blue); padding:10px 12px;
        background:var(--panel-alt); border-bottom:1px solid var(--line); border-radius:6px 6px 0 0; }

      .fpl-pulse-wrap { display:flex; gap:6px; }
      .fpl-pulse { width:10px; height:10px; background:var(--blue); animation:fplPulse 1.1s ease-in-out infinite; }
      @keyframes fplPulse { 0%,100%{opacity:0.25;} 50%{opacity:1;} }
      @media (prefers-reduced-motion: reduce) {
        .fpl-pulse { animation:none; opacity:0.7; }
        .fpl-spin { animation:none !important; }
      }

      .fpl-details summary { cursor:pointer; font-family:'Space Grotesk',sans-serif; font-weight:600;
        font-size:0.85rem; color:var(--ink-dim); padding:10px 0; list-style:none; }
      .fpl-details summary::-webkit-details-marker { display:none; }
      .fpl-details[open] summary { color:var(--ink); }

      .fpl-search-item { padding:8px 10px; cursor:pointer; border-bottom:1px solid var(--line); font-size:0.85rem; }
      .fpl-search-item:hover { background:var(--panel-alt); }
      .fpl-search-item:last-child { border-bottom:none; }

      .fpl-chip-btn { font-family:'IBM Plex Mono',monospace; font-size:0.72rem; padding:6px 8px;
        border:1px solid var(--line); background:var(--panel-alt); color:var(--ink); cursor:pointer; border-radius:4px; }
      .fpl-chip-btn.active { border-color:var(--green); color:var(--green); }
    `}</style>
  );
}

function DifficultyChips({ fixtures, teamsById, max = 3 }) {
  const list = (fixtures || []).slice(0, max);
  if (!list.length) return <span className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)' }}>TBC</span>;
  return (
    <>
      {list.map((f, i) => {
        const team = teamsById[f.opponent];
        const c = DIFF_COLORS[f.difficulty] || DIFF_COLORS[3];
        return (
          <span key={i} className="fpl-fixchip" style={{ background: c.bg, color: c.text }}>
            {team ? team.short_name : '?'} {f.isHome ? 'H' : 'A'}
          </span>
        );
      })}
    </>
  );
}

function Header({ summary, gwOptions, selectedGw, onSelectGw, onGoHome }) {
  return (
    <header style={{ borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, zIndex: 100, background: 'var(--panel)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 10, height: 10, background: 'var(--lime)', borderRadius: 2, flexShrink: 0 }} />
        <button
          onClick={onGoHome}
          className="fpl-display"
          style={{ fontWeight: 700, fontSize: '1.05rem', letterSpacing: '0.02em', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', fontFamily: 'inherit' }}
        >
          SQUAD CHECK <span style={{ color: 'var(--ink-dim)', fontWeight: 500 }}>· FPL</span>
        </button>
        {gwOptions && gwOptions.length > 0 && (
          <select
            className="fpl-mono"
            value={selectedGw || ''}
            onChange={e => onSelectGw(Number(e.target.value))}
            style={{ marginLeft: 'auto', background: 'var(--panel-alt)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 4, padding: '4px 6px', fontSize: '0.72rem' }}
          >
            {gwOptions.map(e => (
              <option key={e.id} value={e.id}>{e.name}{e.is_current ? ' (current)' : ''}</option>
            ))}
          </select>
        )}
      </div>
      {summary && (
        <div style={{ background: 'var(--panel-alt)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div className="fpl-mono" style={{ fontSize: '0.72rem', color: 'var(--ink-dim)' }}>
            {summary.gwLabel}{summary.countdown ? ` · ${summary.countdown}` : ''}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="fpl-mono" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--blue)' }}>{fmtPts(summary.xiTotal)}</span>
            <span className="fpl-mono" style={{ fontSize: '0.62rem', color: 'var(--ink-dim)', letterSpacing: '0.04em' }}>PREDICTED XI PTS</span>
          </div>
        </div>
      )}
    </header>
  );
}

/* ============================================================================
   SCREENS
============================================================================ */

function IntroScreen({ onChoose }) {
  return (
    <div style={{ padding: '20px 16px 40px' }}>
      <h1 className="fpl-display" style={{ fontSize: '1.6rem', fontWeight: 700, lineHeight: 1.2, marginBottom: 10 }}>
        Check your squad.<br />Predict your points.
      </h1>
      <p style={{ color: 'var(--ink-dim)', fontSize: '0.92rem', marginBottom: 24, lineHeight: 1.5 }}>
        Live player data, predicted points per player, and transfer suggestions — pulled straight from the FPL servers.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button className="fpl-btn fpl-btn-solid" onClick={() => onChoose('id')} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Hash size={22} />
          <span>
            <span style={{ display: 'block', fontSize: '1rem' }}>Enter Team ID</span>
            <span className="fpl-mono" style={{ display: 'block', fontSize: '0.7rem', fontWeight: 400, marginTop: 2, opacity: 0.75 }}>Exact data, straight from the FPL API</span>
          </span>
        </button>
        <button className="fpl-btn" onClick={() => onChoose('paste')} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Info size={22} />
          <span>
            <span style={{ display: 'block', fontSize: '1rem' }}>Paste from Claude chat</span>
            <span className="fpl-mono" style={{ display: 'block', fontSize: '0.7rem', fontWeight: 400, marginTop: 2, opacity: 0.75 }}>Free — read your screenshot in a normal chat</span>
          </span>
        </button>
        <button className="fpl-btn" onClick={() => onChoose('build')} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Trophy size={22} />
          <span>
            <span style={{ display: 'block', fontSize: '1rem' }}>Build the best squad</span>
            <span className="fpl-mono" style={{ display: 'block', fontSize: '0.7rem', fontWeight: 400, marginTop: 2, opacity: 0.75 }}>Optimal 15 within £{SQUAD_BUDGET.toFixed(1)}m, not your team</span>
          </span>
        </button>
      </div>

      <div className="fpl-section-title" style={{ background: 'transparent', border: 'none', padding: '28px 0 10px', color: 'var(--ink-dim)' }}>Or build it yourself</div>
      <button className="fpl-btn" onClick={() => onChoose('custom')} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
        <Wand2 size={22} />
        <span>
          <span style={{ display: 'block', fontSize: '1rem' }}>Pick your own squad</span>
          <span className="fpl-mono" style={{ display: 'block', fontSize: '0.7rem', fontWeight: 400, marginTop: 2, opacity: 0.75 }}>Choose every player, formation & captain, preview chips</span>
        </span>
      </button>
    </div>
  );
}

function TeamIdForm({ value, onChange, onSubmit, onBack }) {
  return (
    <div style={{ padding: '20px 16px 40px' }}>
      <button onClick={onBack} className="fpl-mono" style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', marginBottom: 18, cursor: 'pointer', padding: 0 }}>
        <ChevronLeft size={14} /> BACK
      </button>
      <h2 className="fpl-display" style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 6 }}>Your FPL Team ID</h2>
      <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: 16, lineHeight: 1.5 }}>
        Open <span className="fpl-mono">fantasy.premierleague.com</span>, go to Points or My Team, and take the number after <span className="fpl-mono">/entry/</span> in the URL.
      </p>
      <input
        className="fpl-input"
        inputMode="numeric"
        placeholder="e.g. 1234567"
        value={value}
        onChange={e => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        onKeyDown={e => { if (e.key === 'Enter' && value) onSubmit(); }}
      />
      <button
        className="fpl-btn fpl-btn-solid"
        style={{ width: '100%', marginTop: 14, textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
        disabled={!value}
        onClick={onSubmit}
      >
        Check my squad <ArrowRight size={16} />
      </button>
    </div>
  );
}

const CLAUDE_CHAT_PROMPT = `You are looking at a screenshot of a Fantasy Premier League (FPL) squad screen (the "Pitch View" of a manager's 15-player team).

Read the player names as displayed under each shirt icon, and the captain (C badge) and vice-captain (V badge) armbands.

Respond with ONLY a raw JSON object — no markdown code fences, no explanation, no preamble. Use exactly this shape:

{
  "starting_xi": {
    "goalkeepers": ["surname as shown"],
    "defenders": ["surname as shown", "..."],
    "midfielders": ["surname as shown", "..."],
    "forwards": ["surname as shown", "..."]
  },
  "bench": ["surname as shown", "surname as shown", "surname as shown", "surname as shown"],
  "captain": "surname of the player with the C badge, or null",
  "vice_captain": "surname of the player with the V badge, or null",
  "bank_millions": 0.0,
  "not_fpl_screenshot": false
}

Rules:
- Group starting XI players by the row/position they appear in on the pitch (goalkeeper row, defender row, midfielder row, forward row).
- "bench" holds the 4 substitute players shown below or separate from the pitch, in the order shown.
- Use the exact short surname/display name printed under the shirt. If you cannot read a name confidently, omit that player rather than guessing.
- "bank_millions" is the money in the bank / ITB figure if visible anywhere on screen (e.g. "£0.3"), otherwise null.
- If this image does not look like an FPL squad/pitch view at all, respond with exactly {"not_fpl_screenshot": true} and nothing else.`;

function PasteJsonForm({ onSubmit, onBack }) {
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef(null);

  function copyPrompt() {
    navigator.clipboard.writeText(CLAUDE_CHAT_PROMPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  function handleFilePick(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.readAsText(file);
    e.target.value = ''; // allow picking the same file again later
  }

  return (
    <div style={{ padding: '20px 16px 40px' }}>
      <button onClick={onBack} className="fpl-mono" style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', marginBottom: 18, cursor: 'pointer', padding: 0 }}>
        <ChevronLeft size={14} /> BACK
      </button>
      <h2 className="fpl-display" style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 6 }}>Paste from a Claude chat</h2>
      <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: 14, lineHeight: 1.5 }}>
        Free — no API key needed. Open a normal chat at <span className="fpl-mono">claude.ai</span>, attach your Pitch View screenshot, paste the prompt below, then paste (or upload) Claude's JSON reply.
      </p>

      <button
        className="fpl-btn fpl-btn-solid"
        style={{ width: '100%', marginBottom: 14, textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
        disabled={!text.trim()}
        onClick={() => onSubmit(text)}
      >
        Check my squad <ArrowRight size={16} />
      </button>

      <div className="fpl-block" style={{ padding: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)' }}>PROMPT TO SEND CLAUDE (not your squad — copy this into a separate Claude chat)</span>
          <button className="fpl-chip-btn" onClick={copyPrompt}>{copied ? 'Copied!' : 'Copy prompt'}</button>
        </div>
        <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', maxHeight: 80, overflow: 'hidden', lineHeight: 1.5 }}>
          {CLAUDE_CHAT_PROMPT.slice(0, 160)}…
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)' }}>YOUR SQUAD JSON</span>
        <button className="fpl-chip-btn" onClick={() => fileInputRef.current && fileInputRef.current.click()}>Upload .json file</button>
      </div>
      <input ref={fileInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleFilePick} />

      <textarea
        className="fpl-input"
        style={{ minHeight: 160, resize: 'vertical', fontSize: '0.78rem' }}
        placeholder={'Paste Claude\'s JSON reply here, or upload it as a file above, e.g. { "starting_xi": { ... }, "bench": [...] }'}
        value={text}
        onChange={e => setText(e.target.value)}
      />
    </div>
  );
}

/* ============================================================================
   CUSTOM SQUAD BUILDER (homepage: pick every player yourself)
============================================================================ */

// Only chips that actually change a gameweek's score are previewable here —
// Wildcard and Free Hit affect your transfers, not how this squad scores.
const CHIP_INFO = {
  bboost: { label: 'Bench Boost', desc: 'All 15 squad players score this gameweek, not just your starting XI.' },
  '3xc': { label: 'Triple Captain', desc: "Your captain's points count 3x instead of 2x this gameweek." },
};

function SquadSlotRow({ posLabel, player, predictionsById, teamsById, isOpen, onOpenPicker, onRemove }) {
  if (!player) {
    return (
      <button className="fpl-btn" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', marginBottom: 6, borderStyle: 'dashed' }} onClick={onOpenPicker}>
        <Plus size={16} /> <span className="fpl-mono" style={{ fontSize: '0.78rem' }}>Add {posLabel}</span>
      </button>
    );
  }
  const team = teamsById[player.team];
  const pred = predictionsById[player.id];
  return (
    <div className="fpl-block" style={{ marginBottom: 6, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, borderColor: isOpen ? 'var(--blue)' : undefined }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="fpl-display" style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.webName}</div>
        <div className="fpl-mono" style={{ fontSize: '0.65rem', color: 'var(--ink-dim)' }}>
          {team ? team.short_name : '—'} · {fmtPrice(player.price)} · {fmtPts(pred.predicted)}pts/wk
        </div>
      </div>
      <button className="fpl-chip-btn" onClick={onOpenPicker}>Change</button>
      <button className="fpl-chip-btn" onClick={onRemove} title="Remove" style={{ color: 'var(--red)' }}><X size={12} /></button>
    </div>
  );
}

function CustomSquadBuilder({ staticData, onSubmit, onBack }) {
  const { allPlayers, teamsById, predictionsById } = staticData;
  const [picks, setPicks] = useState({ 1: [null, null], 2: [null, null, null, null, null], 3: [null, null, null, null, null], 4: [null, null, null] });
  const [activeSlot, setActiveSlot] = useState(null); // { posId, idx }
  const [query, setQuery] = useState('');
  const formations = getValidFormations();
  const [formationKey, setFormationKey] = useState('4-4-2');
  const [captainId, setCaptainId] = useState(null);
  const [viceCaptainId, setViceCaptainId] = useState(null);
  const [chipPreview, setChipPreview] = useState(null);

  const squad15 = POSITION_ORDER.flatMap(pos => picks[pos].filter(Boolean));
  const filledCount = squad15.length;
  const allSelected = filledCount === 15;
  const totalCost = squad15.reduce((s, p) => s + p.price, 0);
  const remaining = SQUAD_BUDGET - totalCost;
  const teamCounts = {};
  squad15.forEach(p => { teamCounts[p.team] = (teamCounts[p.team] || 0) + 1; });
  const overCapTeam = Object.entries(teamCounts).find(([, c]) => c > MAX_PER_REAL_TEAM);

  const formation = formations.find(f => f.key === formationKey) || formations[0];
  const startersSet = allSelected ? pickFormationStarters(squad15, formation, predictionsById) : new Set();
  const starters = squad15.filter(p => startersSet.has(p.id));
  const bench = squad15.filter(p => !startersSet.has(p.id));

  // Keep captain/vice pointed at valid starters as the formation/selection changes.
  useEffect(() => {
    if (captainId && !starters.some(p => p.id === captainId)) setCaptainId(null);
    if (viceCaptainId && !starters.some(p => p.id === viceCaptainId)) setViceCaptainId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formationKey, filledCount]);

  useEffect(() => {
    if (allSelected && !captainId && starters.length) {
      const top = suggestCaptain(starters.map(p => ({ player: p, nextMatchPredicted: predictionsById[p.id].nextMatchPredicted })));
      if (top) setCaptainId(top.player.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSelected, formationKey]);

  const xiTotal = starters.reduce((s, p) => s + predictionsById[p.id].predicted * (p.id === captainId ? 2 : 1), 0);
  const benchTotal = bench.reduce((s, p) => s + predictionsById[p.id].predicted, 0);
  const captainPred = captainId ? predictionsById[captainId].predicted : 0;
  let previewTotal = xiTotal;
  if (chipPreview === 'bboost') previewTotal = xiTotal + benchTotal;
  if (chipPreview === '3xc') previewTotal = xiTotal + captainPred;

  const squadIds = new Set(squad15.map(p => p.id));
  const nq = normalize(query);
  const candidates = activeSlot ? allPlayers
    .filter(p => p.positionId === activeSlot.posId && !squadIds.has(p.id))
    .filter(p => nq.length < 2 || normalize(p.webName).includes(nq) || normalize(p.secondName).includes(nq))
    .sort((a, b) => predictionsById[b.id].predicted - predictionsById[a.id].predicted)
    .slice(0, 8) : [];

  function pickPlayer(player) {
    if (!activeSlot) return;
    setPicks(prev => {
      const arr = [...prev[activeSlot.posId]];
      arr[activeSlot.idx] = player;
      return { ...prev, [activeSlot.posId]: arr };
    });
    setActiveSlot(null);
    setQuery('');
  }

  function removePlayer(posId, idx) {
    setPicks(prev => {
      const arr = [...prev[posId]];
      const removed = arr[idx];
      arr[idx] = null;
      if (removed) {
        if (removed.id === captainId) setCaptainId(null);
        if (removed.id === viceCaptainId) setViceCaptainId(null);
      }
      return { ...prev, [posId]: arr };
    });
  }

  function handleContinue() {
    const squad = squad15.map(p => {
      const pred = predictionsById[p.id];
      const isCaptain = p.id === captainId;
      return {
        player: p, predicted: pred.predicted, nextMatchPredicted: pred.nextMatchPredicted, availNote: pred.availNote,
        isStarting: startersSet.has(p.id), isCaptain, isViceCaptain: p.id === viceCaptainId,
        multiplier: isCaptain ? 2 : 1,
      };
    });
    const bankTenths = Math.round(remaining * 10);
    onSubmit(squad, bankTenths);
  }

  const canContinue = allSelected && !overCapTeam && remaining >= -1e-9 && captainId;

  return (
    <div style={{ padding: '20px 16px 100px' }}>
      <button onClick={onBack} className="fpl-mono" style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', marginBottom: 18, cursor: 'pointer', padding: 0 }}>
        <ChevronLeft size={14} /> BACK
      </button>
      <h2 className="fpl-display" style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 6 }}>Pick your own squad</h2>
      <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: 14, lineHeight: 1.5 }}>
        Choose all 15 players, set your formation and captain, then preview what each chip would do.
      </p>

      <div className="fpl-block" style={{ padding: 10, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span className="fpl-mono" style={{ fontSize: '0.78rem' }}>{filledCount}/15 selected</span>
        <span className="fpl-mono" style={{ fontSize: '0.78rem', color: remaining < 0 ? 'var(--red)' : 'var(--ink-dim)' }}>
          {remaining < 0 ? `Over budget by ${fmtPrice(-remaining)}` : `${fmtPrice(remaining)} left of £${SQUAD_BUDGET.toFixed(1)}m`}
        </span>
      </div>
      {overCapTeam && (
        <div className="fpl-block" style={{ padding: 10, marginBottom: 16, borderLeft: '3px solid var(--red)', fontSize: '0.8rem', color: 'var(--red)' }}>
          Max {MAX_PER_REAL_TEAM} players per real club — you have {overCapTeam[1]} from {teamsById[overCapTeam[0]] ? teamsById[overCapTeam[0]].short_name : 'one club'}.
        </div>
      )}

      {POSITION_ORDER.map(posId => (
        <div key={posId} style={{ marginBottom: 14 }}>
          <div className="fpl-section-title">{POSITION_LABELS[posId]} ({picks[posId].filter(Boolean).length}/{SQUAD_SLOTS[posId]})</div>
          <div style={{ marginTop: 8 }}>
            {picks[posId].map((player, idx) => {
              const isOpen = activeSlot && activeSlot.posId === posId && activeSlot.idx === idx;
              return (
                <div key={idx}>
                  <SquadSlotRow
                    posLabel={POSITION_LABELS[posId]}
                    player={player}
                    predictionsById={predictionsById}
                    teamsById={teamsById}
                    isOpen={isOpen}
                    onOpenPicker={() => { setActiveSlot(isOpen ? null : { posId, idx }); setQuery(''); }}
                    onRemove={() => removePlayer(posId, idx)}
                  />
                  {isOpen && (
                    <div className="fpl-block" style={{ padding: 10, marginBottom: 10 }}>
                      <div style={{ position: 'relative', marginBottom: 8 }}>
                        <Search size={14} style={{ position: 'absolute', left: 9, top: 11, color: 'var(--ink-dim)' }} />
                        <input
                          className="fpl-input"
                          style={{ paddingLeft: 30, fontSize: '0.85rem' }}
                          placeholder={`Search ${POSITION_LABELS[posId]}…`}
                          value={query}
                          onChange={e => setQuery(e.target.value)}
                          autoFocus
                        />
                      </div>
                      {candidates.length === 0 && <div style={{ fontSize: '0.78rem', color: 'var(--ink-dim)' }}>No matching players.</div>}
                      {candidates.map(p => {
                        const team = teamsById[p.team];
                        return (
                          <div key={p.id} className="fpl-search-item" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }} onClick={() => pickPlayer(p)}>
                            <span><strong>{p.webName}</strong> <span style={{ color: 'var(--ink-dim)' }}>· {team ? team.short_name : '—'}</span></span>
                            <span className="fpl-mono" style={{ fontSize: '0.72rem', display: 'flex', gap: 8 }}>
                              <span style={{ color: 'var(--green)' }}>{fmtPts(predictionsById[p.id].predicted)}pts</span>
                              <span style={{ color: 'var(--ink-dim)' }}>{fmtPrice(p.price)}</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {allSelected && (
        <>
          <div className="fpl-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Layers size={14} /> Formation</div>
          <div className="fpl-block" style={{ padding: 12, marginBottom: 14 }}>
            <select className="fpl-input" style={{ fontSize: '0.85rem', marginBottom: 12 }} value={formationKey} onChange={e => setFormationKey(e.target.value)}>
              {formations.map(f => <option key={f.key} value={f.key}>{f.key}</option>)}
            </select>
            <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', marginBottom: 6 }}>STARTING XI (auto-picked by predicted points for this formation)</div>
            {starters.map(p => (
              <div key={p.id} className="fpl-row" style={{ padding: '6px 0' }}>
                <div className="fpl-row-pos">{POSITION_LABELS[p.positionId]}</div>
                <div className="fpl-row-main fpl-row-name">
                  {p.webName}
                  {p.id === captainId && <span className="fpl-armband" title="Captain">C</span>}
                  {p.id === viceCaptainId && <span className="fpl-armband fpl-armband-vc" title="Vice-captain">V</span>}
                </div>
                <div className="fpl-mono" style={{ fontSize: '0.72rem', color: 'var(--ink-dim)' }}>{fmtPts(predictionsById[p.id].predicted)}pts</div>
              </div>
            ))}
            <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', margin: '10px 0 6px' }}>BENCH</div>
            {bench.map(p => (
              <div key={p.id} className="fpl-row fpl-row-bench" style={{ padding: '6px 0' }}>
                <div className="fpl-row-pos">{POSITION_LABELS[p.positionId]}</div>
                <div className="fpl-row-main fpl-row-name">{p.webName}</div>
                <div className="fpl-mono" style={{ fontSize: '0.72rem', color: 'var(--ink-dim)' }}>{fmtPts(predictionsById[p.id].predicted)}pts</div>
              </div>
            ))}
          </div>

          <div className="fpl-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Crown size={14} /> Captaincy</div>
          <div className="fpl-block" style={{ padding: 12, marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 140 }}>
              <div className="fpl-mono" style={{ fontSize: '0.65rem', color: 'var(--ink-dim)', marginBottom: 4 }}>CAPTAIN</div>
              <select className="fpl-input" style={{ fontSize: '0.82rem' }} value={captainId || ''} onChange={e => setCaptainId(Number(e.target.value) || null)}>
                <option value="">— none —</option>
                {starters.map(p => <option key={p.id} value={p.id} disabled={p.id === viceCaptainId}>{p.webName}</option>)}
              </select>
            </label>
            <label style={{ flex: 1, minWidth: 140 }}>
              <div className="fpl-mono" style={{ fontSize: '0.65rem', color: 'var(--ink-dim)', marginBottom: 4 }}>VICE-CAPTAIN</div>
              <select className="fpl-input" style={{ fontSize: '0.82rem' }} value={viceCaptainId || ''} onChange={e => setViceCaptainId(Number(e.target.value) || null)}>
                <option value="">— none —</option>
                {starters.map(p => <option key={p.id} value={p.id} disabled={p.id === captainId}>{p.webName}</option>)}
              </select>
            </label>
          </div>

          <div className="fpl-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Zap size={14} /> Preview a chip</div>
          <div className="fpl-block" style={{ padding: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <button className={`fpl-chip-btn ${chipPreview === null ? 'active' : ''}`} onClick={() => setChipPreview(null)}>No chip</button>
              {Object.entries(CHIP_INFO).map(([key, info]) => (
                <button key={key} className={`fpl-chip-btn ${chipPreview === key ? 'active' : ''}`} onClick={() => setChipPreview(key)}>{info.label}</button>
              ))}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', lineHeight: 1.5, marginBottom: 10 }}>
              {chipPreview ? CHIP_INFO[chipPreview].desc : 'No chip active — normal scoring (starting XI only, captain at 2x).'}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="fpl-mono" style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--blue)' }}>{fmtPts(previewTotal)}</span>
              <span className="fpl-mono" style={{ fontSize: '0.62rem', color: 'var(--ink-dim)' }}>PREDICTED PTS WITH THIS CHIP</span>
            </div>
            {(chipPreview === 'bboost' || chipPreview === '3xc') && (
              <div className="fpl-mono" style={{ fontSize: '0.65rem', color: 'var(--ink-dim)', marginTop: 4 }}>vs {fmtPts(xiTotal)}pts with no chip</div>
            )}
          </div>
        </>
      )}

      <button
        className="fpl-btn fpl-btn-solid"
        style={{ width: '100%', textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
        disabled={!canContinue}
        onClick={handleContinue}
      >
        {!allSelected ? `Pick ${15 - filledCount} more player${15 - filledCount === 1 ? '' : 's'}`
          : overCapTeam ? 'Fix club limit to continue'
          : remaining < 0 ? 'Over budget — swap a player'
          : !captainId ? 'Pick a captain to continue'
          : 'See full results'} <ArrowRight size={16} />
      </button>
    </div>
  );
}

function LoadingScreen({ message }) {
  return (
    <div style={{ padding: '60px 16px', textAlign: 'center' }}>
      <div className="fpl-pulse-wrap" style={{ justifyContent: 'center', marginBottom: 20 }}>
        <div className="fpl-pulse" style={{ animationDelay: '0s' }} />
        <div className="fpl-pulse" style={{ animationDelay: '0.15s' }} />
        <div className="fpl-pulse" style={{ animationDelay: '0.3s' }} />
        <div className="fpl-pulse" style={{ animationDelay: '0.45s' }} />
      </div>
      <div className="fpl-mono" style={{ fontSize: '0.85rem', color: 'var(--ink-dim)' }}>{message || 'Working…'}</div>
    </div>
  );
}

function ErrorScreen({ message, onRetry }) {
  return (
    <div style={{ padding: '40px 16px', textAlign: 'center' }}>
      <AlertTriangle size={32} style={{ color: 'var(--red)', margin: '0 auto 14px' }} />
      <p style={{ fontSize: '0.92rem', lineHeight: 1.5, marginBottom: 22, color: 'var(--ink)' }}>{message}</p>
      <button className="fpl-btn fpl-btn-solid" onClick={onRetry} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <RotateCcw size={16} /> Start over
      </button>
    </div>
  );
}

function PlayerSearchPicker({ allPlayers, onPick }) {
  const [q, setQ] = useState('');
  const nq = normalize(q);
  const results = nq.length < 2 ? [] : allPlayers.filter(p =>
    normalize(p.webName).includes(nq) || normalize(p.secondName).includes(nq)
  ).slice(0, 8);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 9, top: 11, color: 'var(--ink-dim)' }} />
        <input
          className="fpl-input"
          style={{ paddingLeft: 30, fontSize: '0.85rem' }}
          placeholder="Search player name…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>
      {results.length > 0 && (
        <div className="fpl-block" style={{ marginTop: 4 }}>
          {results.map(p => (
            <div key={p.id} className="fpl-search-item" onClick={() => onPick(p)}>
              <strong>{p.webName}</strong> <span style={{ color: 'var(--ink-dim)' }}>· {POSITION_LABELS[p.positionId]} · {fmtPrice(p.price)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewSlot({ slot, index, onFix, allPlayers }) {
  const [showSearch, setShowSearch] = useState(false);
  const confident = slot.matched && slot.top[0] && slot.top[0].score > 0.72 && !slot.manuallyFixed === false ? true : (slot.matched && slot.top[0] && slot.top[0].score > 0.72);
  const needsReview = !slot.matched || (slot.top[0] && slot.top[0].score <= 0.72);

  return (
    <div className="fpl-block" style={{ padding: 12, marginBottom: 8, borderLeft: needsReview ? '3px solid var(--amber)' : '3px solid var(--green)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', fontFamily: "'IBM Plex Mono',monospace" }}>
            READ AS "{slot.extractedName}" {slot.isCaptain ? '· CAPTAIN' : slot.isViceCaptain ? '· VICE' : ''}
          </div>
          <div className="fpl-display" style={{ fontWeight: 600, fontSize: '0.95rem' }}>
            {slot.matched ? slot.matched.webName : <span style={{ color: 'var(--amber)' }}>Not matched</span>}
          </div>
        </div>
        {needsReview
          ? <ShieldAlert size={18} style={{ color: 'var(--amber)', flexShrink: 0 }} />
          : <CheckCircle2 size={18} style={{ color: 'var(--green)', flexShrink: 0 }} />}
      </div>

      {slot.top && slot.top.length > 0 && needsReview && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {slot.top.filter(t => t.score > 0.15).map((t, i) => (
            <button key={i} className={`fpl-chip-btn ${slot.matched && slot.matched.id === t.player.id ? 'active' : ''}`} onClick={() => onFix(index, t.player)}>
              {t.player.webName}
            </button>
          ))}
          <button className="fpl-chip-btn" onClick={() => setShowSearch(s => !s)}>Search…</button>
        </div>
      )}
      {!needsReview && (
        <button className="fpl-chip-btn" style={{ marginTop: 8 }} onClick={() => setShowSearch(s => !s)}>Not right? Fix it</button>
      )}
      {showSearch && <PlayerSearchPicker allPlayers={allPlayers} onPick={p => { onFix(index, p); setShowSearch(false); }} />}
    </div>
  );
}

function ReviewScreen({ slots, allPlayers, onFix, onConfirm, onBack }) {
  const unresolved = slots.filter(s => !s.matched).length;
  return (
    <div style={{ padding: '20px 16px 100px' }}>
      <button onClick={onBack} className="fpl-mono" style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', marginBottom: 18, cursor: 'pointer', padding: 0 }}>
        <ChevronLeft size={14} /> BACK
      </button>
      <h2 className="fpl-display" style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 6 }}>Confirm your squad</h2>
      <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: 18, lineHeight: 1.5 }}>
        We read these names from your screenshot. Fix anything that's wrong before we crunch the numbers.
      </p>

      {slots.map((slot, i) => (
        <ReviewSlot key={i} slot={slot} index={i} onFix={onFix} allPlayers={allPlayers} />
      ))}

      <button
        className="fpl-btn fpl-btn-solid"
        style={{ width: '100%', marginTop: 8, textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
        disabled={unresolved > 0}
        onClick={onConfirm}
      >
        {unresolved > 0 ? `Fix ${unresolved} more to continue` : 'Looks good — show my results'} <ArrowRight size={16} />
      </button>
    </div>
  );
}

function PlayerRow({ slot, teamsById, fixturesByTeam, editable, isOpen, onToggle }) {
  const { player, predicted, availNote, isCaptain, isViceCaptain } = slot;
  const team = teamsById[player.team];
  const fixtures = fixturesByTeam[player.team];
  const rowClass = `fpl-row ${!slot.isStarting ? 'fpl-row-bench' : ''} ${editable ? 'fpl-row-editable' : ''} ${isOpen ? 'fpl-row-open' : ''}`;
  return (
    <div className={rowClass} onClick={editable ? onToggle : undefined}>
      <div className="fpl-row-pos">{POSITION_LABELS[player.positionId]}</div>
      <div className="fpl-row-main">
        <div className="fpl-row-name">
          {player.webName}
          {isCaptain && <span className="fpl-armband" title="Captain">C</span>}
          {isViceCaptain && <span className="fpl-armband fpl-armband-vc" title="Vice-captain">V</span>}
        </div>
        <div className="fpl-row-sub">{team ? team.short_name : '—'} · {fmtPrice(player.price)}</div>
        {availNote && <div className="fpl-availnote">{availNote}</div>}
      </div>
      <div className="fpl-row-fixtures">
        <DifficultyChips fixtures={fixtures} teamsById={teamsById} max={2} />
      </div>
      <div className="fpl-row-pred">
        <div className="fpl-row-pred-num" style={{ color: predicted < 2 ? 'var(--red)' : predicted >= 5 ? 'var(--lime)' : 'var(--ink)' }}>{fmtPts(predicted)}</div>
        <div className="fpl-row-pred-label">PTS/WK</div>
      </div>
      {editable && (
        <ChevronDown size={14} style={{ color: 'var(--ink-dim)', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .12s' }} />
      )}
    </div>
  );
}

// Inline replacement search, opened by clicking directly on a player's row in
// edit mode — the same click-the-box-to-change pattern used by the squad
// builder, rather than only being reachable via a form at the top.
function InlineSwapSearch({ outSlot, squad, allPlayers, predictionsById, teamsById, bankTenths, query, setQuery, onSwap }) {
  const posId = outSlot.player.positionId;
  const squadIds = new Set(squad.map(s => s.player.id));
  const nq = normalize(query);
  const candidates = allPlayers
    .filter(p => p.positionId === posId && !squadIds.has(p.id))
    .filter(p => nq.length < 2 || normalize(p.webName).includes(nq) || normalize(p.secondName).includes(nq))
    .sort((a, b) => predictionsById[b.id].predicted - predictionsById[a.id].predicted)
    .slice(0, 8);
  const remaining = (bankTenths || 0) / 10 + outSlot.player.price;

  return (
    <div style={{ padding: 10, borderBottom: '1px solid var(--line)' }} onClick={e => e.stopPropagation()}>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <Search size={14} style={{ position: 'absolute', left: 9, top: 11, color: 'var(--ink-dim)' }} />
        <input
          className="fpl-input"
          style={{ paddingLeft: 30, fontSize: '0.85rem' }}
          placeholder={`Search a replacement ${POSITION_LABELS[posId]}…`}
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      <div className="fpl-mono" style={{ fontSize: '0.62rem', color: 'var(--ink-dim)', marginBottom: 8 }}>
        Budget for this slot: {fmtPrice(remaining)}{query ? ' · matching your search' : ''}
      </div>
      {candidates.length === 0 && (
        <div style={{ padding: '6px 2px', fontSize: '0.8rem', color: 'var(--ink-dim)' }}>No matching players.</div>
      )}
      {candidates.map(p => {
        const team = teamsById[p.team];
        const priceDelta = Math.round((p.price - outSlot.player.price) * 10) / 10;
        return (
          <div
            key={p.id}
            className="fpl-search-item"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}
            onClick={() => onSwap(outSlot.player.id, p)}
          >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <strong>{p.webName}</strong>{' '}
              <span style={{ color: 'var(--ink-dim)' }}>· {team ? team.short_name : '—'} · {fmtPrice(p.price)}</span>
            </span>
            <span className="fpl-mono" style={{ flexShrink: 0, fontSize: '0.72rem', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: 'var(--green)' }}>{fmtPts(predictionsById[p.id].predicted)}pts</span>
              <span style={{ color: priceDelta > 0 ? 'var(--amber)' : 'var(--ink-dim)' }}>{priceDelta >= 0 ? '+' : ''}{priceDelta.toFixed(1)}m</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TransferCard({ suggestion, teamsById, fixturesByTeam, onApply }) {
  const { out, inPlayer, inPredicted, gain, costDelta, reason } = suggestion;
  return (
    <div className="fpl-block" style={{ padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <div className="fpl-mono" style={{ fontSize: '0.6rem', color: 'var(--red)', fontWeight: 700, letterSpacing: '0.04em' }}>OUT</div>
          <div className="fpl-display" style={{ fontWeight: 600 }}>{out.player.webName}</div>
          <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)' }}>{fmtPts(out.predicted)} pts/wk</div>
        </div>
        <ArrowRight size={16} style={{ color: 'var(--ink-dim)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 120 }}>
          <div className="fpl-mono" style={{ fontSize: '0.6rem', color: 'var(--green)', fontWeight: 700, letterSpacing: '0.04em' }}>IN</div>
          <div className="fpl-display" style={{ fontWeight: 600 }}>{inPlayer.webName}</div>
          <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)' }}>{fmtPts(inPredicted)} pts/wk</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)', flexWrap: 'wrap', gap: 6 }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--ink-dim)' }}>{reason}</span>
        <span className="fpl-mono" style={{ fontSize: '0.75rem', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ color: 'var(--mint)', fontWeight: 700 }}>+{fmtPts(gain)} pts</span>
          <span style={{ color: costDelta > 0 ? 'var(--amber)' : 'var(--ink-dim)' }}>{costDelta >= 0 ? '+' : ''}{costDelta.toFixed(1)}m</span>
        </span>
      </div>
      {onApply && (
        <button
          className="fpl-chip-btn"
          style={{ width: '100%', marginTop: 10, textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}
          onClick={() => onApply(out.player.id, inPlayer)}
        >
          <RefreshCw size={12} /> Accept this swap
        </button>
      )}
    </div>
  );
}

// Squad Score: the optimal squad (best possible XI within budget) is defined
// as 100. Every other squad is scored relative to it — its predicted points
// as a percentage of the optimal squad's predicted points, capped at 100.
// Squads below optimal are penalised a bit more steeply than a straight
// percentage would: the shortfall below 100 is scaled up by PUNISH_FACTOR
// before being subtracted, so falling short of the optimal squad costs
// slightly more Squad Score than 1-for-1.
const PUNISH_FACTOR = 1.15;
function computeSquadScore(xiTotal, optimalXiTotal) {
  if (!optimalXiTotal || optimalXiTotal <= 0) return 0;
  const pct = (xiTotal / optimalXiTotal) * 100;
  const score = pct >= 100 ? pct : 100 - (100 - pct) * PUNISH_FACTOR;
  return Math.round(Math.max(0, Math.min(100, score)));
}

// Predicted points of the best possible squad within budget, used as the
// 100-point reference for every score. Computed once per session and cached.
function computeOptimalXiTotal(staticData) {
  const { squad } = buildOptimalTeam(staticData, SQUAD_BUDGET);
  return squad.reduce((total, s) => total + (s.isStarting ? s.predicted * (s.multiplier || 1) : 0), 0);
}

// Scans upcoming fixtures (already loaded per-team, several gameweeks out) to
// estimate which future gameweek would be strongest for Triple Captain and
// for Bench Boost. For each candidate week we compute the *whole squad's*
// expected total for that week, not just a single player's points, so the
// numbers shown are directly comparable to a normal no-chip gameweek score:
//   - normalXi: starting XI only, best-available captain doubled (2x) —
//     this is what the week would score with no chip played.
//   - tripleXi: same, but the captain is tripled (3x) instead of doubled —
//     this is the expected total if Triple Captain were played that week.
//   - benchBoostXi: all 15 squad players score, captain still doubled —
//     this is the expected total if Bench Boost were played that week.
// This is an estimate based on currently scheduled fixtures — blank/double
// gameweeks not yet announced by FPL obviously can't be accounted for.
function fixtureMultFor(diff) {
  return Math.max(0.8, Math.min(1.18, 1 + (3 - diff) * 0.075));
}

function analyzeChipTiming(squad, fixturesByTeam, allEvents, predictionsById) {
  const gwSet = new Set();
  Object.values(fixturesByTeam).forEach(list => list.forEach(f => gwSet.add(f.event)));
  // Consider every scheduled gameweek for the rest of the season (FPL runs 38),
  // not just an early window — blank/double gameweeks can land anywhere.
  const gwIds = Array.from(gwSet).sort((a, b) => a - b).slice(0, 38);
  const eventsById = {};
  (allEvents || []).forEach(e => { eventsById[e.id] = e; });

  const weekStats = gwIds.map(gw => {
    let totalAll = 0;
    let startersTotal = 0;
    let bestCaptain = null;
    squad.forEach(s => {
      const fixtures = (fixturesByTeam[s.player.team] || []).filter(f => f.event === gw);
      if (!fixtures.length) return;
      // Use the fixture-difficulty-free base here, then apply this specific
      // gameweek's own fixture multiplier once. Using `s.predicted` instead
      // would double-apply fixture difficulty, since predicted already bakes
      // in a 4-fixture rolling average multiplier of its own.
      const baseAvail = predictionsById[s.player.id].baseAvail;
      let playerTotal = 0;
      fixtures.forEach(f => { playerTotal += baseAvail * fixtureMultFor(f.difficulty); });
      totalAll += playerTotal;
      if (s.isStarting) {
        startersTotal += playerTotal;
        if (!bestCaptain || playerTotal > bestCaptain.pts) {
          bestCaptain = { player: s.player, pts: playerTotal, fixtureCount: fixtures.length };
        }
      }
    });
    const capPts = bestCaptain ? bestCaptain.pts : 0;
    return {
      gw, gwName: eventsById[gw] ? eventsById[gw].name : `GW${gw}`,
      bestCaptain,
      normalXi: startersTotal + capPts,       // captain at 2x
      tripleXi: startersTotal + capPts * 2,   // captain at 3x
      benchBoostXi: totalAll + capPts,        // all 15 play, captain still at 2x
      hasFixtures: totalAll > 0,
    };
  }).filter(w => w.hasFixtures);

  if (weekStats.length === 0) return null;

  const bestBenchBoost = weekStats.reduce((best, w) => (!best || w.benchBoostXi > best.benchBoostXi) ? w : best, null);
  const bestTripleCaptain = weekStats.reduce((best, w) => (w.bestCaptain && (!best || w.tripleXi > best.tripleXi)) ? w : best, null);

  return { bestBenchBoost, bestTripleCaptain };
}

function ScoreRing({ score, size = 92, strokeWidth = 9 }) {
  const clamped = Math.max(0, Math.min(100, score));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const hue = (clamped / 100) * 120; // 0 = red, 60 = yellow, 120 = green
  const color = `hsl(${hue}, 72%, 50%)`;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(255,255,255,0.14)" strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={radius} stroke={color} strokeWidth={strokeWidth} fill="none"
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="fpl-display" style={{ fontSize: size * 0.32, fontWeight: 800, color }}>{clamped}</span>
      </div>
    </div>
  );
}

function ResultsScreen({ data, onStartOver, onSquadUpdate }) {
  const { squad, starters, bench, xiTotal, captain, captainSuggestion, suggestions, entryMeta, bankTenths, squadScore, isOptimalBuild, onRebuildOptimal, targetEvent, teamsById, fixturesByTeam, allEvents, allPlayers, predictionsById } = data;
  const [editMode, setEditMode] = useState(false);
  const [editSlotId, setEditSlotId] = useState(null);
  const [editQuery, setEditQuery] = useState('');
  const [chipPreview, setChipPreview] = useState(null);

  const chipTiming = isOptimalBuild ? null : analyzeChipTiming(squad, fixturesByTeam, allEvents, predictionsById);

  // "How would a chip affect this squad right now" preview — captain
  // doubled as normal, then Bench Boost adds the bench on top and Triple
  // Captain adds one more captain multiple on top.
  const benchTotal = bench.reduce((s, sl) => s + sl.predicted, 0);
  const captainPred = captain ? captain.predicted : 0;
  const normalTotal = starters.reduce((s, sl) => s + sl.predicted, 0) + captainPred;
  let chipPreviewTotal = normalTotal;
  if (chipPreview === 'bboost') chipPreviewTotal = normalTotal + benchTotal;
  if (chipPreview === '3xc') chipPreviewTotal = normalTotal + captainPred;

  function applySwap(outId, inPlayer) {
    const swapped = ensureCaptaincy(swapPlayerInSquad(squad, outId, inPlayer, predictionsById));
    const outPlayer = squad.find(s => s.player.id === outId);
    const priceDelta = outPlayer ? inPlayer.price - outPlayer.player.price : 0;
    const newBankTenths = Math.round((bankTenths || 0) - priceDelta * 10);
    onSquadUpdate(swapped, newBankTenths);
    setEditSlotId(null);
    setEditQuery('');
  }

  function toggleRowEdit(playerId) {
    setEditSlotId(current => (current === playerId ? null : playerId));
    setEditQuery('');
  }

  const grouped = POSITION_ORDER.map(posId => ({
    posId,
    label: POSITION_LABELS[posId],
    players: starters.filter(s => s.player.positionId === posId),
  })).filter(g => g.players.length > 0);

  const showCaptainSuggestion = captainSuggestion && (!captain || captain.player.id !== captainSuggestion.player.id) && captainSuggestion.nextMatchPredicted > (captain ? captain.nextMatchPredicted : 0) + 0.3;

  return (
    <div style={{ padding: '16px 16px 60px' }}>
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
        <div>
          <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', letterSpacing: '0.04em' }}>
            {entryMeta ? entryMeta.teamName.toUpperCase() : 'YOUR SQUAD'} · {targetEvent ? targetEvent.name.toUpperCase() : ''}
          </div>
          {bankTenths !== null && bankTenths !== undefined && (
            <div className="fpl-mono" style={{ fontSize: '0.72rem', color: 'var(--ink-dim)', marginTop: 2 }}>In the bank: {fmtPrice(bankTenths / 10)}</div>
          )}
          {isOptimalBuild && (
            <button className="fpl-mono" onClick={onRebuildOptimal} style={{ background: 'none', border: 'none', color: 'var(--lime)', fontSize: '0.68rem', padding: 0, marginTop: 4, cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}>
              Saved build — rebuild with latest data
            </button>
          )}
          <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', marginTop: 6 }}>Squad Score</div>
        </div>
        <ScoreRing score={squadScore} />
      </div>

      <div className="fpl-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Zap size={14} /> How would a chip affect this squad?</div>
      <div className="fpl-block" style={{ padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          <button className={`fpl-chip-btn ${chipPreview === null ? 'active' : ''}`} onClick={() => setChipPreview(null)}>No chip</button>
          {Object.entries(CHIP_INFO).map(([key, info]) => (
            <button key={key} className={`fpl-chip-btn ${chipPreview === key ? 'active' : ''}`} onClick={() => setChipPreview(key)}>{info.label}</button>
          ))}
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', lineHeight: 1.5, marginBottom: 10 }}>
          {chipPreview ? CHIP_INFO[chipPreview].desc : 'No chip active — normal scoring (starting XI only, captain at 2x).'}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span className="fpl-mono" style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--lime)' }}>{fmtPts(chipPreviewTotal)}</span>
          <span className="fpl-mono" style={{ fontSize: '0.62rem', color: 'var(--ink-dim)' }}>PREDICTED PTS THIS GAMEWEEK{chipPreview ? ' WITH THIS CHIP' : ''}</span>
        </div>
        {chipPreview && (
          <div className="fpl-mono" style={{ fontSize: '0.65rem', color: 'var(--ink-dim)', marginTop: 4 }}>vs {fmtPts(normalTotal)}pts with no chip</div>
        )}
      </div>

      {!isOptimalBuild && (
        <button
          className={`fpl-btn ${editMode ? 'fpl-btn-solid' : ''}`}
          style={{ width: '100%', marginBottom: 16, textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
          onClick={() => { setEditMode(m => !m); setEditSlotId(null); setEditQuery(''); }}
        >
          <Edit3 size={16} /> {editMode ? 'Done editing' : 'Edit squad'}
        </button>
      )}

      {!isOptimalBuild && editMode && (
        <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', marginBottom: 10, lineHeight: 1.5 }}>
          Tap any player below to swap them.
        </div>
      )}

      {captainSuggestion && !isOptimalBuild && (
        <div className="fpl-block" style={{ padding: 12, marginBottom: 16, borderLeft: `3px solid ${showCaptainSuggestion ? 'var(--sky)' : 'var(--green)'}`, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Crown size={18} style={{ color: showCaptainSuggestion ? 'var(--sky)' : 'var(--green)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
            {showCaptainSuggestion ? (
              <>Consider captaining <strong>{captainSuggestion.player.webName}</strong> ({fmtPts(captainSuggestion.nextMatchPredicted)} pts predicted this gameweek){captain ? <> instead of {captain.player.webName} ({fmtPts(captain.nextMatchPredicted)} pts)</> : null}.</>
            ) : (
              <><strong>{captainSuggestion.player.webName}</strong> is our top pick for the armband this week ({fmtPts(captainSuggestion.nextMatchPredicted)} pts predicted this gameweek){captain && captain.player.id === captainSuggestion.player.id ? <> — nice, that's already who you've got captained.</> : null}.</>
            )}
          </div>
        </div>
      )}

      {grouped.map(g => (
        <div key={g.posId} style={{ marginBottom: 14 }}>
          <div className="fpl-section-title">{g.label}</div>
          <div className="fpl-block" style={{ borderTop: 'none' }}>
            {g.players.map(slot => (
              <React.Fragment key={slot.player.id}>
                <PlayerRow
                  slot={slot}
                  teamsById={teamsById}
                  fixturesByTeam={fixturesByTeam}
                  editable={editMode}
                  isOpen={editSlotId === slot.player.id}
                  onToggle={() => toggleRowEdit(slot.player.id)}
                />
                {editMode && editSlotId === slot.player.id && (
                  <InlineSwapSearch
                    outSlot={slot}
                    squad={squad}
                    allPlayers={allPlayers}
                    predictionsById={predictionsById}
                    teamsById={teamsById}
                    bankTenths={bankTenths}
                    query={editQuery}
                    setQuery={setEditQuery}
                    onSwap={applySwap}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      ))}

      {bench.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="fpl-section-title">Bench</div>
          <div className="fpl-block" style={{ borderTop: 'none' }}>
            {bench.map(slot => (
              <React.Fragment key={slot.player.id}>
                <PlayerRow
                  slot={slot}
                  teamsById={teamsById}
                  fixturesByTeam={fixturesByTeam}
                  editable={editMode}
                  isOpen={editSlotId === slot.player.id}
                  onToggle={() => toggleRowEdit(slot.player.id)}
                />
                {editMode && editSlotId === slot.player.id && (
                  <InlineSwapSearch
                    outSlot={slot}
                    squad={squad}
                    allPlayers={allPlayers}
                    predictionsById={predictionsById}
                    teamsById={teamsById}
                    bankTenths={bankTenths}
                    query={editQuery}
                    setQuery={setEditQuery}
                    onSwap={applySwap}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {chipTiming && (
        <div style={{ marginBottom: 16 }}>
          <div className="fpl-section-title" style={{ background: 'transparent', border: 'none', padding: '0 0 10px' }}>Chip timing</div>
          {chipTiming.bestTripleCaptain && (
            <div className="fpl-block" style={{ padding: 12, marginBottom: 8, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <Trophy size={18} style={{ color: 'var(--blue)', flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
                Best upcoming week for <strong>Triple Captain</strong>: <strong>{chipTiming.bestTripleCaptain.gwName}</strong> — captaining {chipTiming.bestTripleCaptain.bestCaptain.player.webName}{chipTiming.bestTripleCaptain.bestCaptain.fixtureCount > 1 ? ' (double gameweek)' : ''}.
                <div className="fpl-mono" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                  <span style={{ color: 'var(--lime)', fontWeight: 700 }}>~{fmtPts(chipTiming.bestTripleCaptain.tripleXi)} pts</span>
                  <span style={{ color: 'var(--ink-dim)' }}> expected total with the chip — vs ~{fmtPts(chipTiming.bestTripleCaptain.normalXi)} pts that week with no chip.</span>
                </div>
              </div>
            </div>
          )}
          {chipTiming.bestBenchBoost && (
            <div className="fpl-block" style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <ShieldAlert size={18} style={{ color: 'var(--sky)', flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
                Best upcoming week for <strong>Bench Boost</strong>: <strong>{chipTiming.bestBenchBoost.gwName}</strong> — full 15-man squad in action.
                <div className="fpl-mono" style={{ fontSize: '0.75rem', marginTop: 4 }}>
                  <span style={{ color: 'var(--lime)', fontWeight: 700 }}>~{fmtPts(chipTiming.bestBenchBoost.benchBoostXi)} pts</span>
                  <span style={{ color: 'var(--ink-dim)' }}> expected total with the chip — vs ~{fmtPts(chipTiming.bestBenchBoost.normalXi)} pts that week with no chip.</span>
                </div>
              </div>
            </div>
          )}
          <p className="fpl-mono" style={{ fontSize: '0.62rem', color: 'var(--ink-dim)', marginTop: 6, lineHeight: 1.5 }}>
            Estimated from currently scheduled fixtures for your squad as it stands now — this will shift as gameweeks pass, your squad changes, and FPL confirms any blank/double gameweeks.
          </p>
        </div>
      )}

      {!isOptimalBuild && (
        <div style={{ marginBottom: 8 }}>
          <div className="fpl-section-title" style={{ background: 'transparent', border: 'none', padding: '0 0 10px' }}>Transfer suggestions</div>
          {suggestions.length === 0 && (
            <div className="fpl-block" style={{ padding: 14, fontSize: '0.85rem', color: 'var(--ink-dim)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <CheckCircle2 size={18} style={{ color: 'var(--green)', flexShrink: 0 }} />
              Your squad's in good shape — no changes look necessary this week.
            </div>
          )}
          {suggestions.map((s, i) => (
            <TransferCard key={i} suggestion={s} teamsById={teamsById} fixturesByTeam={fixturesByTeam} onApply={editMode ? applySwap : null} />
          ))}
          {suggestions.length > 0 && !editMode && (
            <button className="fpl-mono" onClick={() => setEditMode(true)} style={{ background: 'var(--panel)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: '1px solid var(--line)', borderRadius: 4, color: 'var(--lime)', fontSize: '0.72rem', padding: '8px 10px', marginTop: 2, cursor: 'pointer', textDecoration: 'underline', fontWeight: 600 }}>
              Switch to edit mode to accept a suggestion
            </button>
          )}
        </div>
      )}

      <details className="fpl-details">
        <summary style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Info size={14} /> How these predictions work</summary>
        <div style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', lineHeight: 1.6, paddingBottom: 10 }}>
          Predicted points blend FPL's own expected-points model, season scoring averages, recent form, and upcoming fixture difficulty. Transfer suggestions assume your sell price is close to the player's current price — FPL's 50% profit rule means your real sell value could be slightly lower if that player has risen in price since you bought them. These are estimates to guide your thinking, not guarantees — always check the latest injury news before your deadline.
        </div>
      </details>

      <button className="fpl-btn" style={{ width: '100%', marginTop: 16, textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }} onClick={onStartOver}>
        <RotateCcw size={16} /> Check another squad
      </button>
    </div>
  );
}

/* ============================================================================
   APP
============================================================================ */

export default function FPLSquadChecker() {
  const [stage, setStage] = useState('intro');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [teamIdInput, setTeamIdInput] = useState('');
  const [reviewSlots, setReviewSlots] = useState([]);
  const [reviewBank, setReviewBank] = useState(null);
  const [pendingStaticData, setPendingStaticData] = useState(null);
  const [resultsData, setResultsData] = useState(null);
  const [selectedGw, setSelectedGw] = useState(null); // null = use current/next gameweek
  const [gwOptions, setGwOptions] = useState([]);
  const [customStaticData, setCustomStaticData] = useState(null);

  const staticPromiseRef = useRef(null);
  const optimalXiTotalRef = useRef(null);
  const currentStaticDataRef = useRef(null);

  // Every screen is a fresh "page" — reset scroll position whenever we
  // navigate to a new stage, so scrolling down on one screen (e.g. the
  // intro) doesn't carry over and leave the next screen scrolled past its
  // own top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stage]);

  function ensureStaticData() {
    if (!staticPromiseRef.current) {
      staticPromiseRef.current = loadStaticData();
    }
    return staticPromiseRef.current;
  }

  function getOptimalXiTotal(staticData) {
    if (optimalXiTotalRef.current === null) {
      optimalXiTotalRef.current = computeOptimalXiTotal(staticData);
    }
    return optimalXiTotalRef.current;
  }

  useEffect(() => {
    ensureStaticData().then(data => {
      // Only past/current gameweeks are selectable — future ones have no
      // picks published yet, and there's nothing to check for them.
      const selectable = data.allEvents.filter(e => e.finished || e.is_current);
      setGwOptions(selectable);
      if (selectedGw === null && data.targetEvent) setSelectedGw(data.targetEvent.id);
    }).catch(() => {});
  }, []);

  function buildResultsData(squad, staticData, bankTenths, entryMeta, activeChip, isOptimalBuild, onRebuildOptimal) {
    const starters = squad.filter(s => s.isStarting);
    const bench = squad.filter(s => !s.isStarting);

    let xiTotal = 0;
    squad.forEach(s => {
      const mult = activeChip === 'bboost' ? 1 : (s.isStarting ? (s.multiplier || 1) : 0);
      xiTotal += s.predicted * mult;
    });

    const captain = squad.find(s => s.isCaptain) || null;
    const captainSuggestion = suggestCaptain(starters);
    const suggestions = suggestTransfers(squad, staticData.allPlayers, staticData.predictionsById, bankTenths || 0);

    return {
      squad, starters, bench, xiTotal, captain, captainSuggestion, suggestions,
      entryMeta, bankTenths, activeChip, isOptimalBuild, onRebuildOptimal,
      squadScore: isOptimalBuild ? 100 : computeSquadScore(xiTotal, getOptimalXiTotal(staticData)),
      targetEvent: staticData.targetEvent, teamsById: staticData.teamsById, fixturesByTeam: staticData.fixturesByTeam, allEvents: staticData.allEvents,
      allPlayers: staticData.allPlayers, predictionsById: staticData.predictionsById,
    };
  }

  function finalizeResults(squad, staticData, bankTenths, entryMeta, activeChip, isOptimalBuild, onRebuildOptimal) {
    currentStaticDataRef.current = staticData;
    setResultsData(buildResultsData(squad, staticData, bankTenths, entryMeta, activeChip, isOptimalBuild, onRebuildOptimal));
    setStage('results');
  }

  // Called after an in-place squad edit (manual swap, or accepting a
  // transfer suggestion) — recomputes everything derived (predicted total,
  // squad score, fresh transfer suggestions) against the edited squad.
  function handleSquadUpdate(newSquad, newBankTenths) {
    setResultsData(prev => {
      if (!prev || !currentStaticDataRef.current) return prev;
      return buildResultsData(newSquad, currentStaticDataRef.current, newBankTenths, prev.entryMeta, prev.activeChip, prev.isOptimalBuild, prev.onRebuildOptimal);
    });
  }

  async function handleStartCustomBuild() {
    setStage('loading');
    setLoadingMessage('Loading live player data…');
    try {
      const staticData = await ensureStaticData();
      setCustomStaticData(staticData);
      setStage('customBuild');
    } catch (e) {
      setErrorMessage("Couldn't load live FPL player data right now. Please try again in a moment.");
      setStage('error');
    }
  }

  function handleCustomSquadSubmit(squad, bankTenths) {
    if (!customStaticData) { setStage('error'); setErrorMessage('Something went wrong. Please start over. [ERR_NO_STATIC_DATA]'); return; }
    finalizeResults(squad, customStaticData, bankTenths, { teamName: 'My Squad' }, null, false);
  }

  async function handleBuildOptimalTeam(forceRebuild) {
    setStage('loading');
    setLoadingMessage(`Testing lineups within £${SQUAD_BUDGET.toFixed(1)}m…`);
    try {
      const staticData = await ensureStaticData();
      const gwId = selectedGw || (staticData.targetEvent ? staticData.targetEvent.id : 1);
      const cacheKey = `fpl_optimal_squad_gw${gwId}`;

      let squad = null, bankTenths = null;

      // 1) Prefer the shared snapshot our server refreshes automatically (see
      // api/refresh-optimal.js) — computed once and reused by every visitor,
      // rather than every browser solving the same optimisation on its own.
      if (!forceRebuild) {
        try {
          const res = await fetch('/api/optimal-squad');
          if (res.ok) {
            const snap = await res.json();
            if (snap && snap.gwId === gwId) {
              const hydrated = hydrateSquadSnapshot(snap, staticData);
              if (hydrated) { squad = hydrated.squad; bankTenths = hydrated.bankTenths; }
            }
          }
        } catch (e) { /* server snapshot unavailable — fall through to local cache */ }
      }

      // 2) Fall back to this browser's own cache for the gameweek, so a
      // person isn't forced to wait on a full rebuild every single visit
      // even before the server has a snapshot for this gameweek yet.
      if (!squad && !forceRebuild) {
        try {
          const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
          const hydrated = hydrateSquadSnapshot(cached, staticData);
          if (hydrated) { squad = hydrated.squad; bankTenths = hydrated.bankTenths; }
        } catch (e) { /* corrupt/unavailable cache — fall through to a fresh build */ }
      }

      // 3) Nothing cached anywhere yet — build it fresh right here, and
      // save it locally so at least this device doesn't repeat the work.
      if (!squad) {
        const built = buildOptimalTeam(staticData, SQUAD_BUDGET);
        squad = built.squad;
        bankTenths = built.bankTenths;
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            playerIds: squad.map(s => s.player.id),
            captainId: built.captainId,
            viceCaptainId: built.viceCaptainId,
            gwId,
            builtAt: new Date().toISOString(),
          }));
        } catch (e) { /* storage unavailable — non-critical, just won't persist */ }
      }

      finalizeResults(squad, staticData, bankTenths, { teamName: 'Optimal Squad' }, null, true, () => handleBuildOptimalTeam(true));
    } catch (e) {
      setErrorMessage("Couldn't build a squad right now — FPL's data might be temporarily unavailable. Please try again.");
      setStage('error');
    }
  }

  async function handleTeamIdSubmit(rawId) {
    const teamId = (rawId || '').trim();
    if (!/^\d+$/.test(teamId)) {
      setErrorMessage('Enter a numeric Team ID — just the number from your FPL URL.');
      setStage('error');
      return;
    }
    setStage('loading');
    setLoadingMessage('Pulling live player data…');
    try {
      let staticData;
      try {
        staticData = await ensureStaticData();
      } catch (e) {
        throw { code: 'ERR_STATIC_DATA' };
      }
      setLoadingMessage('Fetching your team…');
      const gwId = selectedGw || (staticData.targetEvent ? staticData.targetEvent.id : 1);

      let picks;
      try {
        picks = await fetchFplJson(`entry/${teamId}/event/${gwId}/picks/`);
      } catch (e) {
        const notReady = e && e.message === 'status 404';
        throw { code: notReady ? 'ERR_GW_LOCKED' : 'ERR_PICKS_FETCH' };
      }
      if (!picks || picks.detail === 'Not found.' || !Array.isArray(picks.picks) || picks.picks.length === 0) {
        throw { code: 'ERR_TEAM_NOT_FOUND' };
      }

      let entryMeta = null;
      try {
        const entry = await fetchFplJson(`entry/${teamId}/`);
        if (entry && !entry.detail) {
          entryMeta = { teamName: entry.name || 'Your Squad' };
        }
      } catch (e) { /* non-critical */ }

      setLoadingMessage('Checking fixtures and working out predictions…');
      const squad = picks.picks.map(pk => {
        const player = staticData.playersById[pk.element];
        if (!player) return null;
        const pred = staticData.predictionsById[pk.element];
        return {
          player, predicted: pred.predicted, nextMatchPredicted: pred.nextMatchPredicted, availNote: pred.availNote,
          isStarting: pk.position <= 11, isCaptain: !!pk.is_captain, isViceCaptain: !!pk.is_vice_captain,
          multiplier: pk.multiplier,
        };
      }).filter(Boolean);

      const bankTenths = picks.entry_history ? picks.entry_history.bank : 0;
      const activeChip = picks.active_chip || null;

      finalizeResults(squad, staticData, bankTenths, entryMeta, activeChip);
    } catch (e) {
      setStage('error');
      const code = (e && e.code) || 'ERR_UNKNOWN';
      const messages = {
        ERR_STATIC_DATA: "Couldn't load live FPL player data right now. Try again in a moment, or use Paste from Claude chat instead.",
        ERR_PICKS_FETCH: "FPL's servers aren't responding right now. Try again in a moment, or use Paste from Claude chat instead.",
        ERR_GW_LOCKED: "FPL hasn't published picks for this gameweek yet (they're hidden until the deadline passes). Try again after the deadline, or use Paste from Claude chat for now.",
        ERR_TEAM_NOT_FOUND: "We couldn't find a team with that ID. Double-check the number in your FPL URL and try again.",
        ERR_UNKNOWN: 'Something went wrong pulling your team. Try again, or use Paste from Claude chat instead.',
      };
      setErrorMessage(`${messages[code] || messages.ERR_UNKNOWN} [${code}]`);
    }
  }

  // Used by the paste-JSON path — matches the extracted shape to real players.
  async function processExtractedSquad(extracted, staticDataPromise) {
    if (extracted.not_fpl_screenshot) {
      setErrorMessage("That doesn't look like an FPL squad. Re-check the JSON and try again. [ERR_NOT_FPL_SCREENSHOT]");
      setStage('error');
      return;
    }
    setLoadingMessage('Matching players…');
    const staticData = await staticDataPromise;
    const slots = matchExtractedSquad(extracted, staticData.playersByPosition, staticData.allPlayers);

    setReviewSlots(slots);
    setReviewBank(typeof extracted.bank_millions === 'number' ? extracted.bank_millions : null);
    setPendingStaticData(staticData);
    setStage('review');
  }

  // FREE path: no Claude API key needed. The user pastes their screenshot into
  // a normal Claude.ai chat, asks for the JSON, and pastes the JSON here.
  async function handlePastedJson(rawText) {
    setStage('loading');
    setLoadingMessage('Matching players…');
    try {
      let cleaned = (rawText || '').trim();
      cleaned = cleaned.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
      const extracted = JSON.parse(cleaned);
      const staticDataPromise = ensureStaticData();
      await processExtractedSquad(extracted, staticDataPromise);
    } catch (e) {
      setErrorMessage(`That didn't parse as valid JSON (${e.message || 'parse error'}). Make sure you copied Claude's whole reply, starting with { and ending with }. [ERR_JSON_PARSE]`);
      setStage('error');
    }
  }

  function updateSlotMatch(index, player) {
    setReviewSlots(prev => prev.map((s, i) => i === index ? { ...s, matched: player, manuallyFixed: true } : s));
  }

  function handleConfirmReview() {
    const staticData = pendingStaticData;
    if (!staticData) { setStage('error'); setErrorMessage('Something went wrong. Please start over. [ERR_NO_STATIC_DATA]'); return; }
    const squad = reviewSlots.map(slot => {
      const player = slot.matched;
      if (!player) return null;
      const pred = staticData.predictionsById[player.id];
      return {
        player, predicted: pred.predicted, nextMatchPredicted: pred.nextMatchPredicted, availNote: pred.availNote,
        isStarting: slot.isStarting, isCaptain: !!slot.isCaptain, isViceCaptain: !!slot.isViceCaptain,
        multiplier: slot.isCaptain ? 2 : 1,
      };
    }).filter(Boolean);

    if (squad.length < 11) {
      setErrorMessage('A few players are still unmatched. Go back and fix them. [ERR_UNMATCHED_PLAYERS]');
      setStage('error');
      return;
    }

    const bankTenths = reviewBank != null ? Math.round(reviewBank * 10) : 0;
    finalizeResults(squad, staticData, bankTenths, null, null);
  }

  const headerSummary = (stage === 'results' && resultsData) ? {
    gwLabel: resultsData.targetEvent ? resultsData.targetEvent.name : '',
    countdown: resultsData.targetEvent ? formatCountdown(resultsData.targetEvent.deadline_time) : '',
    xiTotal: resultsData.xiTotal,
  } : null;

  return (
    <div className="fpl-root">
      <GlobalStyle />
      <Header
        summary={headerSummary}
        gwOptions={gwOptions}
        selectedGw={selectedGw}
        onSelectGw={setSelectedGw}
        onGoHome={() => { setStage('intro'); setResultsData(null); setTeamIdInput(''); }}
      />
      <main style={{ maxWidth: 640, margin: '0 auto' }}>
        {stage === 'intro' && (
          <IntroScreen
            onChoose={(m) => {
              if (m === 'build') { handleBuildOptimalTeam(); return; }
              if (m === 'custom') { handleStartCustomBuild(); return; }
              setStage(m === 'id' ? 'teamIdForm' : 'pasteForm');
            }}
          />
        )}
        {stage === 'teamIdForm' && (
          <TeamIdForm
            value={teamIdInput}
            onChange={setTeamIdInput}
            onSubmit={() => handleTeamIdSubmit(teamIdInput)}
            onBack={() => setStage('intro')}
          />
        )}
        {stage === 'pasteForm' && (
          <PasteJsonForm onSubmit={handlePastedJson} onBack={() => setStage('intro')} />
        )}
        {stage === 'customBuild' && customStaticData && (
          <CustomSquadBuilder staticData={customStaticData} onSubmit={handleCustomSquadSubmit} onBack={() => setStage('intro')} />
        )}
        {stage === 'loading' && <LoadingScreen message={loadingMessage} />}
        {stage === 'review' && (
          <ReviewScreen
            slots={reviewSlots}
            allPlayers={pendingStaticData ? pendingStaticData.allPlayers : []}
            onFix={updateSlotMatch}
            onConfirm={handleConfirmReview}
            onBack={() => setStage('pasteForm')}
          />
        )}
        {stage === 'results' && resultsData && (
          <ResultsScreen
            data={resultsData}
            onStartOver={() => { setStage('intro'); setResultsData(null); setTeamIdInput(''); }}
            onSquadUpdate={handleSquadUpdate}
          />
        )}
        {stage === 'error' && (
          <ErrorScreen message={errorMessage} onRetry={() => setStage('intro')} />
        )}
      </main>
    </div>
  );
}