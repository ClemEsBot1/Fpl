import React, { useState, useEffect, useRef } from 'react';
import { Hash, Camera, Loader2, AlertTriangle, CheckCircle2, Crown, ArrowRight, Search, ChevronLeft, Info, ShieldAlert, RotateCcw } from 'lucide-react';

/* ============================================================================
   CONSTANTS
============================================================================ */

const FPL_BASE = 'https://fantasy.premierleague.com/api/';
const POSITION_LABELS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const POSITION_ORDER = [1, 2, 3, 4];
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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Could not read file'));
    r.readAsDataURL(file);
  });
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
   ANTHROPIC API (screenshot -> structured squad extraction)
============================================================================ */

async function extractSquadFromImage(base64Data, mediaType) {
  const prompt = `You are looking at a screenshot of a Fantasy Premier League (FPL) squad screen (the "Pitch View" of a manager's 15-player team).

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

  const response = await fetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
          { type: 'text', text: prompt },
        ],
      }],
    }),
  });
  const data = await response.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('No response from image analysis');
  let cleaned = textBlock.text.trim();
  cleaned = cleaned.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

/* ============================================================================
   PREDICTION ENGINE
============================================================================ */

function computePlayerPrediction(p, fixturesByTeam, seasonStarted) {
  const epNext = p.epNext || 0;
  const ppg = p.pointsPerGame || 0;
  const form = p.form || 0;

  let base;
  if (seasonStarted && form > 0) {
    base = 0.45 * epNext + 0.35 * ppg + 0.20 * form;
  } else {
    base = 0.6 * epNext + 0.4 * ppg;
  }

  function fixtureMultFor(diff) {
    return Math.max(0.8, Math.min(1.18, 1 + (3 - diff) * 0.075));
  }

  const fixtures = fixturesByTeam[p.team] || [];
  const upcoming = fixtures.slice(0, 4);
  let fixtureMult = 1;
  if (upcoming.length) {
    const avgDiff = upcoming.reduce((s, f) => s + f.difficulty, 0) / upcoming.length;
    fixtureMult = fixtureMultFor(avgDiff);
  }

  // Captaincy is a free pick every gameweek, so only the very next fixture's
  // difficulty is relevant there — not the 4-game rolling average used above
  // for the general "predicted" figure (which suits squad/transfer decisions,
  // since you're stuck with those players over several weeks).
  const nextFixtureMult = upcoming.length ? fixtureMultFor(upcoming[0].difficulty) : 1;

  let availMult = 1;
  let availNote = null;
  if (p.status === 'i') { availMult = 0.05; availNote = 'Injured'; }
  else if (p.status === 's') { availMult = 0.05; availNote = 'Suspended'; }
  else if (p.status === 'u' || p.status === 'n') { availMult = 0; availNote = 'Unavailable'; }
  else if (typeof p.chanceNext === 'number' && p.chanceNext !== null) {
    availMult = p.chanceNext / 100;
    if (p.chanceNext <= 75) availNote = `${p.chanceNext}% chance of playing`;
  } else if (p.status === 'd') {
    availMult = 0.7; availNote = 'Doubtful';
  }

  const predicted = Math.max(0, base * fixtureMult * availMult);
  const nextMatchPredicted = Math.max(0, base * nextFixtureMult * availMult);
  return {
    predicted: Math.round(predicted * 10) / 10,
    nextMatchPredicted: Math.round(nextMatchPredicted * 10) / 10,
    availNote,
    fixtureMult,
    upcomingFixtures: upcoming,
  };
}

function suggestCaptain(starters) {
  if (!starters.length) return null;
  return [...starters].sort((a, b) => b.nextMatchPredicted - a.nextMatchPredicted)[0];
}

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

  const teamsById = {};
  bootstrap.teams.forEach(t => { teamsById[t.id] = t; });

  const seasonStarted = bootstrap.events.some(e => e.finished);
  const currentEvent = bootstrap.events.find(e => e.is_current);
  const nextEvent = bootstrap.events.find(e => e.is_next);
  const targetEvent = currentEvent || nextEvent || bootstrap.events[0];

  const fixturesByTeam = {};
  bootstrap.teams.forEach(t => { fixturesByTeam[t.id] = []; });
  fixturesRaw
    .filter(f => f.event !== null && f.event !== undefined && f.event >= (targetEvent ? targetEvent.id : 1))
    .sort((a, b) => a.event - b.event)
    .forEach(f => {
      if (fixturesByTeam[f.team_h]) {
        fixturesByTeam[f.team_h].push({ event: f.event, opponent: f.team_a, isHome: true, difficulty: f.team_h_difficulty, kickoff: f.kickoff_time });
      }
      if (fixturesByTeam[f.team_a]) {
        fixturesByTeam[f.team_a].push({ event: f.event, opponent: f.team_h, isHome: false, difficulty: f.team_a_difficulty, kickoff: f.kickoff_time });
      }
    });

  const allPlayers = bootstrap.elements.map(e => ({
    id: e.id,
    webName: e.web_name,
    firstName: e.first_name,
    secondName: e.second_name,
    team: e.team,
    positionId: e.element_type,
    price: e.now_cost / 10,
    form: parseFloat(e.form) || 0,
    pointsPerGame: parseFloat(e.points_per_game) || 0,
    totalPoints: e.total_points,
    epNext: parseFloat(e.ep_next) || 0,
    status: e.status,
    chanceNext: e.chance_of_playing_next_round,
    news: e.news,
    selectedBy: parseFloat(e.selected_by_percent) || 0,
  }));

  const playersById = {};
  const playersByPosition = { 1: [], 2: [], 3: [], 4: [] };
  allPlayers.forEach(p => { playersById[p.id] = p; playersByPosition[p.positionId].push(p); });

  const predictionsById = {};
  allPlayers.forEach(p => { predictionsById[p.id] = computePlayerPrediction(p, fixturesByTeam, seasonStarted); });

  return { teamsById, allPlayers, playersById, playersByPosition, fixturesByTeam, targetEvent, seasonStarted, predictionsById };
}

/* ============================================================================
   PRESENTATIONAL PRIMITIVES
============================================================================ */

function GlobalStyle() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600;700&display=swap');

      .fpl-root { --bg:#0C1512; --panel:#132420; --panel-alt:#1A2E27; --line:#274038;
        --ink:#F1F6F1; --ink-dim:#9FB8AB; --yellow:#FFD230; --green:#35D07F;
        --red:#FF5A5A; --cyan:#5BE0F0; --amber:#FF9A45; }
      .fpl-root { font-family:'Inter',sans-serif; background:var(--bg); color:var(--ink); min-height:100%; }
      .fpl-display { font-family:'Space Grotesk',sans-serif; }
      .fpl-mono { font-family:'IBM Plex Mono',monospace; }

      .fpl-block { background:var(--panel); border:1px solid var(--line); }
      .fpl-btn { font-family:'Space Grotesk',sans-serif; font-weight:600; letter-spacing:0.02em;
        border:2px solid var(--yellow); background:transparent; color:var(--yellow);
        padding:14px 18px; cursor:pointer; transition:background .15s,color .15s; text-align:left; }
      .fpl-btn:hover, .fpl-btn:focus-visible { background:var(--yellow); color:#1A1400; }
      .fpl-btn:focus-visible { outline:3px solid var(--cyan); outline-offset:2px; }
      .fpl-btn-solid { background:var(--yellow); color:#1A1400; }
      .fpl-btn-solid:hover { background:#FFE066; }
      .fpl-btn:disabled { opacity:0.5; cursor:not-allowed; }

      .fpl-input { font-family:'IBM Plex Mono',monospace; font-size:1.1rem; letter-spacing:0.04em;
        background:var(--panel-alt); border:2px solid var(--line); color:var(--ink);
        padding:12px 14px; width:100%; }
      .fpl-input:focus { outline:none; border-color:var(--yellow); }
      .fpl-input::placeholder { color:var(--ink-dim); }

      .fpl-tag { display:inline-block; font-family:'IBM Plex Mono',monospace; font-size:0.68rem;
        font-weight:600; padding:2px 6px; letter-spacing:0.03em; }

      .fpl-armband { display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px;
        font-size:0.62rem; font-weight:700; margin-left:5px; background:var(--yellow); color:#1A1400;
        font-family:'IBM Plex Mono',monospace; }
      .fpl-armband-vc { background:var(--cyan); }

      .fpl-fixchip { font-family:'IBM Plex Mono',monospace; font-size:0.66rem; font-weight:600;
        padding:3px 5px; display:inline-block; min-width:38px; text-align:center; }

      .fpl-row { display:flex; align-items:center; gap:10px; padding:10px 10px; border-bottom:1px solid var(--line); }
      .fpl-row:last-child { border-bottom:none; }
      .fpl-row-bench { opacity:0.72; }
      .fpl-row-pos { font-family:'IBM Plex Mono',monospace; font-size:0.62rem; font-weight:700;
        color:var(--ink-dim); background:var(--panel-alt); padding:4px 5px; min-width:34px; text-align:center; }
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
        letter-spacing:0.06em; text-transform:uppercase; color:var(--yellow); padding:10px 12px;
        background:var(--panel-alt); border-bottom:1px solid var(--line); }

      .fpl-pulse-wrap { display:flex; gap:6px; }
      .fpl-pulse { width:10px; height:10px; background:var(--yellow); animation:fplPulse 1.1s ease-in-out infinite; }
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
        border:1px solid var(--line); background:var(--panel-alt); color:var(--ink); cursor:pointer; }
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

function Header({ summary }) {
  return (
    <header style={{ borderBottom: '1px solid var(--line)' }}>
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 10, height: 10, background: 'var(--yellow)' }} />
        <div className="fpl-display" style={{ fontWeight: 700, fontSize: '1.05rem', letterSpacing: '0.02em' }}>
          SQUAD CHECK <span style={{ color: 'var(--ink-dim)', fontWeight: 500 }}>· FPL</span>
        </div>
      </div>
      {summary && (
        <div style={{ background: 'var(--panel-alt)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div className="fpl-mono" style={{ fontSize: '0.72rem', color: 'var(--ink-dim)' }}>
            {summary.gwLabel}{summary.countdown ? ` · ${summary.countdown}` : ''}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="fpl-mono" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--yellow)' }}>{fmtPts(summary.xiTotal)}</span>
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
        <button className="fpl-btn" onClick={() => onChoose('screenshot')} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Camera size={22} />
          <span>
            <span style={{ display: 'block', fontSize: '1rem' }}>Upload a screenshot</span>
            <span className="fpl-mono" style={{ display: 'block', fontSize: '0.7rem', fontWeight: 400, marginTop: 2, opacity: 0.75 }}>Uses your Claude API key (costs a small amount)</span>
          </span>
        </button>
        <button className="fpl-btn" onClick={() => onChoose('paste')} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Info size={22} />
          <span>
            <span style={{ display: 'block', fontSize: '1rem' }}>Paste from Claude chat</span>
            <span className="fpl-mono" style={{ display: 'block', fontSize: '0.7rem', fontWeight: 400, marginTop: 2, opacity: 0.75 }}>Free — read your screenshot in a normal chat</span>
          </span>
        </button>
      </div>
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

function ScreenshotForm({ onFile, onBack }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  return (
    <div style={{ padding: '20px 16px 40px' }}>
      <button onClick={onBack} className="fpl-mono" style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', marginBottom: 18, cursor: 'pointer', padding: 0 }}>
        <ChevronLeft size={14} /> BACK
      </button>
      <h2 className="fpl-display" style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 6 }}>Upload your squad</h2>
      <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: 16, lineHeight: 1.5 }}>
        Works best with the full "Pitch View" screen showing all 15 players, captain armband, and bench.
      </p>
      <div
        onClick={() => inputRef.current && inputRef.current.click()}
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) onFile(f); }}
        style={{
          border: `2px dashed ${dragOver ? 'var(--yellow)' : 'var(--line)'}`,
          padding: '36px 16px', textAlign: 'center', cursor: 'pointer',
          background: dragOver ? 'var(--panel-alt)' : 'transparent',
        }}
      >
        <Camera size={28} style={{ margin: '0 auto 10px', color: 'var(--ink-dim)' }} />
        <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>Tap to choose a screenshot</div>
        <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', marginTop: 6 }}>PNG · JPG · WEBP</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files && e.target.files[0]; if (f) onFile(f); }}
      />
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

  function copyPrompt() {
    navigator.clipboard.writeText(CLAUDE_CHAT_PROMPT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  return (
    <div style={{ padding: '20px 16px 40px' }}>
      <button onClick={onBack} className="fpl-mono" style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', marginBottom: 18, cursor: 'pointer', padding: 0 }}>
        <ChevronLeft size={14} /> BACK
      </button>
      <h2 className="fpl-display" style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 6 }}>Paste from a Claude chat</h2>
      <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: 14, lineHeight: 1.5 }}>
        Free — no API key needed. Open a normal chat at <span className="fpl-mono">claude.ai</span>, attach your Pitch View screenshot, paste the prompt below, then paste Claude's JSON reply into the box.
      </p>

      <div className="fpl-block" style={{ padding: 10, marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)' }}>PROMPT TO SEND CLAUDE (not your squad — copy this into a separate Claude chat)</span>
          <button className="fpl-chip-btn" onClick={copyPrompt}>{copied ? 'Copied!' : 'Copy prompt'}</button>
        </div>
        <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', maxHeight: 80, overflow: 'hidden', lineHeight: 1.5 }}>
          {CLAUDE_CHAT_PROMPT.slice(0, 160)}…
        </div>
      </div>

      <textarea
        className="fpl-input"
        style={{ minHeight: 160, resize: 'vertical', fontSize: '0.78rem' }}
        placeholder={'Paste Claude\'s JSON reply here, e.g. { "starting_xi": { ... }, "bench": [...] }'}
        value={text}
        onChange={e => setText(e.target.value)}
      />

      <button
        className="fpl-btn fpl-btn-solid"
        style={{ width: '100%', marginTop: 14, textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
        disabled={!text.trim()}
        onClick={() => onSubmit(text)}
      >
        Check my squad <ArrowRight size={16} />
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

function PlayerRow({ slot, teamsById, fixturesByTeam }) {
  const { player, predicted, availNote, isCaptain, isViceCaptain } = slot;
  const team = teamsById[player.team];
  const fixtures = fixturesByTeam[player.team];
  return (
    <div className={`fpl-row ${!slot.isStarting ? 'fpl-row-bench' : ''}`}>
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
        <div className="fpl-row-pred-num" style={{ color: predicted < 2 ? 'var(--red)' : predicted >= 5 ? 'var(--green)' : 'var(--ink)' }}>{fmtPts(predicted)}</div>
        <div className="fpl-row-pred-label">PTS/WK</div>
      </div>
    </div>
  );
}

function TransferCard({ suggestion, teamsById, fixturesByTeam }) {
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
        <span className="fpl-mono" style={{ fontSize: '0.75rem', display: 'flex', gap: 10 }}>
          <span style={{ color: 'var(--green)', fontWeight: 700 }}>+{fmtPts(gain)} pts</span>
          <span style={{ color: costDelta > 0 ? 'var(--amber)' : 'var(--ink-dim)' }}>{costDelta >= 0 ? '+' : ''}{costDelta.toFixed(1)}m</span>
        </span>
      </div>
    </div>
  );
}

// Squad Score: maps predicted starting-XI points this gameweek onto a 0-100
// scale, centered so a squad predicted right at AVERAGE scores 50. AVERAGE is
// a working estimate of what a typical XI predicts to (tune this as you see
// real results — it's a judgment call, not derived from official FPL data).
// SPREAD is how many points above/below AVERAGE it takes to reach 100/0.
function computeSquadScore(xiTotal) {
  const AVERAGE = 45, SPREAD = 20;
  const pct = 50 + ((xiTotal - AVERAGE) / SPREAD) * 50;
  return Math.round(Math.max(0, Math.min(100, pct)));
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

function ResultsScreen({ data, onStartOver }) {
  const { squad, starters, bench, xiTotal, captain, captainSuggestion, suggestions, entryMeta, bankTenths, squadScore, targetEvent, teamsById, fixturesByTeam } = data;

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
          <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', marginTop: 6 }}>Squad Score</div>
        </div>
        <ScoreRing score={squadScore} />
      </div>

      {captainSuggestion && (
        <div className="fpl-block" style={{ padding: 12, marginBottom: 16, borderLeft: `3px solid ${showCaptainSuggestion ? 'var(--cyan)' : 'var(--green)'}`, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <Crown size={18} style={{ color: showCaptainSuggestion ? 'var(--cyan)' : 'var(--green)', flexShrink: 0, marginTop: 2 }} />
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
              <PlayerRow key={slot.player.id} slot={slot} teamsById={teamsById} fixturesByTeam={fixturesByTeam} />
            ))}
          </div>
        </div>
      ))}

      {bench.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="fpl-section-title">Bench</div>
          <div className="fpl-block" style={{ borderTop: 'none' }}>
            {bench.map(slot => (
              <PlayerRow key={slot.player.id} slot={slot} teamsById={teamsById} fixturesByTeam={fixturesByTeam} />
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 8 }}>
        <div className="fpl-section-title" style={{ background: 'transparent', border: 'none', padding: '0 0 10px' }}>Transfer suggestions</div>
        {suggestions.length === 0 && (
          <div className="fpl-block" style={{ padding: 14, fontSize: '0.85rem', color: 'var(--ink-dim)', display: 'flex', gap: 10, alignItems: 'center' }}>
            <CheckCircle2 size={18} style={{ color: 'var(--green)', flexShrink: 0 }} />
            Your squad's in good shape — no changes look necessary this week.
          </div>
        )}
        {suggestions.map((s, i) => (
          <TransferCard key={i} suggestion={s} teamsById={teamsById} fixturesByTeam={fixturesByTeam} />
        ))}
      </div>

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

  const staticPromiseRef = useRef(null);

  function ensureStaticData() {
    if (!staticPromiseRef.current) {
      staticPromiseRef.current = loadStaticData();
    }
    return staticPromiseRef.current;
  }

  useEffect(() => { ensureStaticData().catch(() => {}); }, []);

  function finalizeResults(squad, staticData, bankTenths, entryMeta, activeChip) {
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

    setResultsData({
      squad, starters, bench, xiTotal, captain, captainSuggestion, suggestions,
      entryMeta, bankTenths, activeChip,
      squadScore: computeSquadScore(xiTotal),
      targetEvent: staticData.targetEvent, teamsById: staticData.teamsById, fixturesByTeam: staticData.fixturesByTeam,
    });
    setStage('results');
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
      const gwId = staticData.targetEvent ? staticData.targetEvent.id : 1;

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
        ERR_STATIC_DATA: "Couldn't load live FPL player data right now. Try again in a moment, or upload a screenshot instead.",
        ERR_PICKS_FETCH: "FPL's servers aren't responding right now. Try again in a moment, or upload a screenshot instead.",
        ERR_GW_LOCKED: "FPL hasn't published picks for this gameweek yet (they're hidden until the deadline passes). Try again after the deadline, or upload a screenshot instead for now.",
        ERR_TEAM_NOT_FOUND: "We couldn't find a team with that ID. Double-check the number in your FPL URL and try again.",
        ERR_UNKNOWN: 'Something went wrong pulling your team. Try again, or upload a screenshot instead.',
      };
      setErrorMessage(`${messages[code] || messages.ERR_UNKNOWN} [${code}]`);
    }
  }

  // Shared by both the (paid) screenshot path and the (free) paste-JSON path —
  // both end up with the same `extracted` shape, this just matches it to real players.
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

  async function handleScreenshotFile(file) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setErrorMessage('Please upload a PNG, JPG, or WEBP image. [ERR_BAD_FILE_TYPE]');
      setStage('error');
      return;
    }
    setStage('loading');
    setLoadingMessage('Reading your squad…');
    try {
      const staticDataPromise = ensureStaticData();
      const base64 = await fileToBase64(file);
      const extracted = await extractSquadFromImage(base64, file.type);
      await processExtractedSquad(extracted, staticDataPromise);
    } catch (e) {
      setErrorMessage('Couldn\'t read that screenshot clearly. Try a sharper, full "Pitch View" image, or enter your Team ID instead. [ERR_SCREENSHOT_READ]');
      setStage('error');
    }
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
      setErrorMessage('A few players are still unmatched. Go back and fix them, or try a clearer screenshot. [ERR_UNMATCHED_PLAYERS]');
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
      <Header summary={headerSummary} />
      <main style={{ maxWidth: 640, margin: '0 auto' }}>
        {stage === 'intro' && <IntroScreen onChoose={(m) => setStage(m === 'id' ? 'teamIdForm' : m === 'paste' ? 'pasteForm' : 'screenshotForm')} />}
        {stage === 'teamIdForm' && (
          <TeamIdForm
            value={teamIdInput}
            onChange={setTeamIdInput}
            onSubmit={() => handleTeamIdSubmit(teamIdInput)}
            onBack={() => setStage('intro')}
          />
        )}
        {stage === 'screenshotForm' && (
          <ScreenshotForm onFile={handleScreenshotFile} onBack={() => setStage('intro')} />
        )}
        {stage === 'pasteForm' && (
          <PasteJsonForm onSubmit={handlePastedJson} onBack={() => setStage('intro')} />
        )}
        {stage === 'loading' && <LoadingScreen message={loadingMessage} />}
        {stage === 'review' && (
          <ReviewScreen
            slots={reviewSlots}
            allPlayers={pendingStaticData ? pendingStaticData.allPlayers : []}
            onFix={updateSlotMatch}
            onConfirm={handleConfirmReview}
            onBack={() => setStage('screenshotForm')}
          />
        )}
        {stage === 'results' && resultsData && (
          <ResultsScreen data={resultsData} onStartOver={() => { setStage('intro'); setResultsData(null); setTeamIdInput(''); }} />
        )}
        {stage === 'error' && (
          <ErrorScreen message={errorMessage} onRetry={() => setStage('intro')} />
        )}
      </main>
    </div>
  );
}
