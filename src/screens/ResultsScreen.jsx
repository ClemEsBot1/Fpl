// Results for a squad: predicted points per player, captaincy, transfer
// suggestions, chip timing, editing, saving, sharing and reminders.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ArrowRight, ArrowUpDown, Bell, Bookmark, Check, CheckCircle2, ChevronDown, Clipboard, Crown, Download, Edit3, Info, LayoutGrid, List as ListIcon, RefreshCw, RotateCcw, Search, Share2, ShieldAlert, Sparkles, Trophy, X, Zap } from 'lucide-react';
import { DifficultyChips } from '../components/common.jsx';
import { EmptyCard, Pitch, PlayerCard, Shirt } from '../components/Pitch.jsx';
import { nextFixtureLabel } from '../lib/pitch.js';
import { POSITION_LABELS, fmtPrice, fmtPts, formatCountdown, playerMatchesSearch, searchKey } from '../lib/format.js';
import { POSITION_ORDER } from '../lib/predictions.js';
import { CHIP_INFO, analyzeChipTiming, applyFreeTransferEconomics, buildSquadExportPayload, ensureCaptaincy, substitutePlayers, substitutionOptions, swapBlocker, swapPlayerInSquad } from '../lib/squadLogic.js';

// Every input that fed into a player's predicted points, in plain language
// — see computePlayerPrediction in src/lib/predictions.js for where each
// of these numbers actually comes from. Only rendered when a row's "Why?"
// toggle is open, and only for slots that carry a live breakdown (the two
// synthetic "actual points" paths — hindsight and frozen past-gw snapshots
// — don't have one, since there's no live formula to explain there).
export function PredictionBreakdown({ breakdown }) {
  if (!breakdown) return null;
  const b = breakdown;

  // Absolute-value inputs (not deltas) — no +/- sign.
  const inputRows = [
    [`FPL's own model (ep_next, already counts this week's fixtures and fitness)${b.epNextShrunk ? ' — shrunk toward position average, early season' : ''}`, fmtPts(b.epNext)],
  ];
  if (b.formEligible) {
    inputRows.push([
      b.appearanceShare !== null && b.appearanceShare !== undefined && b.appearanceShare < 1
        ? `Season points-per-game × ${Math.round(b.appearanceShare * 100)}% of matches played`
        : 'Season points-per-game',
      fmtPts(b.ppg),
    ]);
    inputRows.push(['Recent form', fmtPts(b.form)]);
  }

  // Signed adjustments layered on top of the input(s) above — shown only
  // when non-zero, always with an explicit sign since they're deltas.
  const adjustmentRows = [];
  if (b.setPieceBonus) adjustmentRows.push(['Set-piece duty (pens/FKs/corners)', b.setPieceBonus]);
  if (b.xgAdjustment) adjustmentRows.push(['Underlying chances (xG/xA)', b.xgAdjustment]);
  if (b.oddsAdjustment) adjustmentRows.push(['Bookmaker odds nudge', b.oddsAdjustment]);

  // Multipliers applied to the base above to reach the final predicted
  // figures — shown as ×values, not deltas, since that's what they are.
  // ep_next already includes this gameweek's fixtures and fitness, so
  // these apply to the rest of the base.
  const multRows = [];
  if (b.isBlankThisEvent) {
    multRows.push(['No fixture this gameweek', 'Blank — 0 pts']);
  } else {
    if (b.isDoubleThisEvent) multRows.push(['Fixtures this gameweek', `Double (${b.fixtureCountThisEvent})`]);
    multRows.push(['Fixture difficulty this gameweek (not on ep_next)', `×${b.nextFixtureMult.toFixed(2)}`]);
    multRows.push(['Fixtures over 4 gameweeks, used for PTS/WK', `×${b.fixtureMult.toFixed(2)}`]);
  }
  if (b.availMult < 1) multRows.push(['Availability (not on ep_next)', `×${b.availMult.toFixed(2)}`]);
  if (b.congestionMult < 1) multRows.push(['Short rest', `×${b.congestionMult.toFixed(2)} (${b.restDays}d since last match)`]);

  return (
    <div className="fpl-block" style={{ padding: 12, marginTop: 2, marginBottom: 8 }} onClick={e => e.stopPropagation()}>
      <div className="fpl-mono" style={{ fontSize: '0.62rem', color: 'var(--ink-dim)', marginBottom: 8, letterSpacing: '0.03em' }}>WHY THIS PREDICTION</div>
      {inputRows.map(([label, val], i) => (
        <div key={`in-${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '3px 0' }}>
          <span className="fpl-dim">{label}</span>
          <span className="fpl-mono">{val}</span>
        </div>
      ))}
      {adjustmentRows.map(([label, val], i) => (
        <div key={`adj-${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '3px 0' }}>
          <span className="fpl-dim">{label}</span>
          <span className="fpl-mono" style={{ color: val < 0 ? 'var(--red)' : 'var(--mint)' }}>{val > 0 ? '+' : ''}{fmtPts(val)}</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '5px 0', borderTop: '1px solid var(--line)', marginTop: 4, fontWeight: 600 }}>
        <span>Base (before fixture/availability)</span>
        <span className="fpl-mono">{fmtPts(b.base)}</span>
      </div>
      {multRows.map(([label, val], i) => (
        <div key={`mult-${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', padding: '3px 0', color: 'var(--ink-dim)' }}>
          <span>{label}</span>
          <span className="fpl-mono">{val}</span>
        </div>
      ))}
    </div>
  );
}

export function PlayerRow({ slot, teamsById, fixturesByTeam, editable, isOpen, onToggle, isPastGw }) {
  const { player, predicted, availNote, isCaptain, isViceCaptain } = slot;
  const [showWhy, setShowWhy] = useState(false);
  const team = teamsById[player.team];
  const fixtures = fixturesByTeam[player.team];
  const rowClass = `fpl-row ${!slot.isStarting ? 'fpl-row-bench' : ''} ${editable ? 'fpl-row-editable' : ''} ${isOpen ? 'fpl-row-open' : ''}`;
  return (
    <>
      <div
        className={rowClass}
        onClick={editable ? onToggle : undefined}
        {...(editable ? {
          role: 'button',
          tabIndex: 0,
          'aria-expanded': !!isOpen,
          'aria-label': `${player.webName}: change player or captaincy`,
          // Only the row itself: Enter on the "Why?" button inside it should
          // open the explanation, not the edit panel.
          onKeyDown: e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle(); } },
        } : {})}
      >
        <div className="fpl-row-pos">{POSITION_LABELS[player.positionId]}</div>
        <div className="fpl-row-main">
          <div className="fpl-row-name">
            {player.webName}
            {isCaptain && <span className="fpl-armband" title="Captain">C</span>}
            {isViceCaptain && <span className="fpl-armband fpl-armband-vc" title="Vice-captain">V</span>}
          </div>
          <div className="fpl-row-sub">{team ? team.short_name : '—'} · {fmtPrice(player.price)}</div>
          <div className="fpl-row-sub fpl-mono" style={{ fontSize: '0.62rem' }}>
            {fmtPts(player.displaySeasonPoints)} pts · {fmtPts(player.displaySeasonPPG)} pts/match{player.displayIsLastSeason ? ' (LS)' : ''}
          </div>
          {availNote && <div className="fpl-availnote">{availNote}</div>}
          {slot.breakdown && (
            <button
              type="button"
              className="fpl-mono"
              aria-expanded={showWhy}
              onClick={(e) => { e.stopPropagation(); setShowWhy(v => !v); }}
              style={{ background: 'none', border: 'none', color: 'var(--ink-dim)', textDecoration: 'underline', fontSize: '0.62rem', padding: 0, marginTop: 3, cursor: 'pointer' }}
            >
              {showWhy ? 'Hide why' : 'Why?'}
            </button>
          )}
        </div>
        {!isPastGw && (
          <div className="fpl-row-fixtures">
            <DifficultyChips fixtures={fixtures} teamsById={teamsById} max={2} />
          </div>
        )}
        {isPastGw ? (
          <div className="fpl-row-pred">
            <div className="fpl-row-pred-num" style={{ color: !slot.played ? 'var(--ink-dim)' : (slot.actualPoints >= 6 ? 'var(--lime)' : slot.actualPoints <= 1 ? 'var(--red)' : 'var(--ink)') }}>
              {!slot.played ? 'NP' : (slot.actualPoints ?? '—')}
            </div>
            <div className="fpl-row-pred-label">{!slot.played ? 'NOT PLAYED' : 'ACTUAL PTS'}</div>
            <div className="fpl-mono" style={{ fontSize: '0.58rem', color: 'var(--ink-dim)', marginTop: 2 }}>{fmtPts(predicted)} predicted</div>
          </div>
        ) : (
          <div className="fpl-row-pred">
            <div className="fpl-row-pred-num" style={{ color: predicted < 2 ? 'var(--red)' : predicted >= 5 ? 'var(--lime)' : 'var(--ink)' }}>{fmtPts(predicted)}</div>
            <div className="fpl-row-pred-label">PTS/WK</div>
          </div>
        )}
        {editable && (
          <ChevronDown size={14} style={{ color: 'var(--ink-dim)', flexShrink: 0, transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .12s' }} />
        )}
      </div>
      {showWhy && <PredictionBreakdown breakdown={slot.breakdown} />}
    </>
  );
}

// Inline replacement search, opened by clicking directly on a player's row in
// edit mode — the same click-the-box-to-change pattern used by the squad
// builder, rather than only being reachable via a form at the top.
// Shown inside the same expand-on-click panel as the swap search, when a
// row is open in edit mode — lets you (re)assign captain/vice-captain
// directly on an already-confirmed squad, the same way the screenshot
// review screen lets you do it before confirming. Works for every way a
// squad can reach this screen (screenshot, custom build, team ID) since they
// all render through this one ResultsScreen.
export function CaptaincyPicker({ slot, onSetCaptain, onSetVice }) {
  return (
    <div style={{ display: 'flex', gap: 16, padding: '10px 10px 0', borderBottom: 'none' }} onClick={e => e.stopPropagation()}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!slot.isCaptain} onChange={() => onSetCaptain(slot.player.id)} />
        Captain
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!slot.isViceCaptain} onChange={() => onSetVice(slot.player.id)} />
        Vice-captain
      </label>
    </div>
  );
}

// Swap an open row's player between the XI and the bench: the players on
// the other side who keep the formation legal, one button each. A
// substitute can also swap with another one to change the bench order.
export function SubstitutePicker({ slot, squad, onSubstitute }) {
  const options = substitutionOptions(squad, slot);
  const groups = [
    { key: 'xi', label: slot.isStarting ? 'Substitute: bring on' : 'Substitute: bring on for', list: options.filter(o => o.isStarting !== slot.isStarting) },
    { key: 'bench', label: 'Bench order: swap with', list: options.filter(o => o.isStarting === slot.isStarting) },
  ].filter(g => g.list.length);
  const ariaFor = other => {
    if (other.isStarting === slot.isStarting) return `Swap ${slot.player.webName} with ${other.player.webName} on the bench`;
    return slot.isStarting ? `Bring on ${other.player.webName} for ${slot.player.webName}` : `Bring on ${slot.player.webName} for ${other.player.webName}`;
  };
  return (
    <div className="fpl-sub-picker" onClick={e => e.stopPropagation()}>
      {groups.length ? groups.map(g => (
        <div key={g.key}>
          <div className="fpl-mono fpl-meta">{g.label}</div>
          <div className="fpl-sub-options">
            {g.list.map(other => (
              <button
                key={other.player.id}
                type="button"
                className="fpl-chip-btn"
                onClick={() => onSubstitute(slot.player.id, other.player.id)}
                aria-label={ariaFor(other)}
              >
                <ArrowUpDown size={13} aria-hidden="true" />
                {POSITION_LABELS[other.player.positionId]} {other.player.webName}
                <span className="fpl-mono">{fmtPts(other.predicted)}</span>
              </button>
            ))}
          </div>
        </div>
      )) : (
        <>
          <div className="fpl-mono fpl-meta">{slot.isStarting ? 'Substitute: bring on' : 'Substitute: bring on for'}</div>
          <div className="fpl-meta">No one can swap in without breaking the formation.</div>
        </>
      )}
    </div>
  );
}

// Each position's players, best first, worked out once per player list
// rather than on every keystroke.
const sortedPositionCache = new WeakMap();
function playersByPositionSorted(allPlayers, predictionsById, posId) {
  let byPos = sortedPositionCache.get(allPlayers);
  if (!byPos || byPos.predictionsById !== predictionsById) {
    byPos = { predictionsById };
    sortedPositionCache.set(allPlayers, byPos);
  }
  if (!byPos[posId]) {
    byPos[posId] = allPlayers
      .filter(p => p.positionId === posId)
      .sort((a, b) => predictionsById[b.id].predicted - predictionsById[a.id].predicted);
  }
  return byPos[posId];
}

export function InlineSwapSearch({ outSlot, squad, allPlayers, predictionsById, teamsById, bankTenths, onSwap }) {
  const [query, setQuery] = useState('');
  const posId = outSlot.player.positionId;
  const searching = searchKey(query).length >= 2;
  const candidates = useMemo(() => {
    const squadIds = new Set(squad.map(s => s.player.id));
    const list = [];
    for (const p of playersByPositionSorted(allPlayers, predictionsById, posId)) {
      if (squadIds.has(p.id) || (searching && !playerMatchesSearch(p, query))) continue;
      list.push(p);
      if (list.length === 8) break;
    }
    return list;
  }, [squad, allPlayers, predictionsById, posId, query, searching]);
  const remaining = (bankTenths || 0) / 10 + outSlot.player.price;

  return (
    <div style={{ padding: 10, borderBottom: '1px solid var(--line)' }} onClick={e => e.stopPropagation()}>
      <div style={{ position: 'relative', marginBottom: 8 }}>
        <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 9, top: 11, color: 'var(--ink-dim)' }} />
        <input
          className="fpl-input"
          style={{ paddingLeft: 30, fontSize: '0.85rem' }}
          placeholder={`Search a replacement ${POSITION_LABELS[posId]}…`}
          aria-label={`Search a replacement ${POSITION_LABELS[posId]}`}
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
        const blocker = swapBlocker(outSlot, p, squad, bankTenths);
        return (
          <button
            type="button"
            key={p.id}
            className="fpl-search-item"
            disabled={!!blocker}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, width: '100%', opacity: blocker ? 0.55 : 1, cursor: blocker ? 'not-allowed' : 'pointer' }}
            onClick={() => { if (!blocker) onSwap(outSlot.player.id, p); }}
          >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>
              <strong>{p.webName}</strong>{' '}
              <span className="fpl-dim">· {team ? team.short_name : '—'} · {fmtPrice(p.price)}</span>
              {blocker && <span className="fpl-mono" style={{ display: 'block', fontSize: '0.62rem', color: 'var(--amber)' }}>{blocker}</span>}
            </span>
            <span className="fpl-mono" style={{ flexShrink: 0, fontSize: '0.72rem', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: 'var(--green)' }}>{fmtPts(predictionsById[p.id].predicted)}pts</span>
              <span style={{ color: priceDelta > 0 ? 'var(--amber)' : 'var(--ink-dim)' }}>{priceDelta >= 0 ? '+' : ''}{priceDelta.toFixed(1)}m</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function TransferCard({ suggestion, onApply }) {
  const { out, inPlayer, inPredicted, gain, costDelta, reason, isFree, hitCost, netGain, horizonGain, pairedWith } = suggestion;
  return (
    <div className="fpl-block" style={{ padding: 12, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 120 }}>
          <div className="fpl-mono" style={{ fontSize: '0.6rem', color: 'var(--red)', fontWeight: 700, letterSpacing: '0.04em' }}>OUT</div>
          <div className="fpl-display" style={{ fontWeight: 600 }}>{out.player.webName}</div>
          <div className="fpl-mono fpl-meta">{fmtPts(out.predicted)} pts/wk</div>
        </div>
        <ArrowRight size={16} style={{ color: 'var(--ink-dim)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 120 }}>
          <div className="fpl-mono" style={{ fontSize: '0.6rem', color: 'var(--green)', fontWeight: 700, letterSpacing: '0.04em' }}>IN</div>
          <div className="fpl-display" style={{ fontWeight: 600 }}>{inPlayer.webName}</div>
          <div className="fpl-mono fpl-meta">{fmtPts(inPredicted)} pts/wk</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line)', flexWrap: 'wrap', gap: 6 }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--ink-dim)' }}>{reason}</span>
        <span className="fpl-mono" style={{ fontSize: '0.75rem', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ color: gain < 0 ? 'var(--amber)' : 'var(--mint)', fontWeight: 700 }}>{gain >= 0 ? '+' : ''}{fmtPts(gain)} pts/wk</span>
          <span style={{ color: costDelta > 0 ? 'var(--amber)' : 'var(--ink-dim)' }}>{costDelta >= 0 ? '+' : ''}{costDelta.toFixed(1)}m</span>
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: pairedWith ? 'space-between' : 'flex-end', alignItems: 'center', marginTop: 6, gap: 8, flexWrap: 'wrap' }}>
        {pairedWith && <span style={{ fontSize: '0.72rem', color: 'var(--ink-dim)' }}>Make together with the {pairedWith} transfer</span>}
        {isFree ? (
          <span className="fpl-mono" style={{ fontSize: '0.62rem', color: 'var(--green)', fontWeight: 700, letterSpacing: '0.03em' }}>
            FREE TRANSFER · {horizonGain >= 0 ? '+' : ''}{fmtPts(horizonGain)} PTS OVER 4 GWS
          </span>
        ) : (
          <span className="fpl-mono" style={{ fontSize: '0.62rem', color: 'var(--amber)', fontWeight: 700, letterSpacing: '0.03em' }}>
            -{hitCost} HIT · NET {netGain >= 0 ? '+' : ''}{fmtPts(netGain)} PTS OVER 4 GWS
          </span>
        )}
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

export function ScoreRing({ score, size = 92, strokeWidth = 9 }) {
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

// Deadline reminder (.ics with a 3-hour alert) and a shareable image of
// the squad's predicted points.
export function ResultsActions({ squad, teamName, gwName, teamsById, deadline }) {
  const [shareState, setShareState] = useState('');
  const deadlineAhead = deadline && new Date(deadline).getTime() > Date.now();

  async function addReminder() {
    const { buildDeadlineIcs, squadWarnings } = await import('../lib/calendar.js');
    const ics = buildDeadlineIcs({ gwName, deadline, notes: squadWarnings(squad), url: window.location.origin });
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fpl-${gwName.toLowerCase().replace(/\s+/g, '-')}-deadline.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function share() {
    setShareState('Preparing…');
    try {
      const { drawShareCard, shareCard } = await import('../lib/shareCard.js');
      // The card's rows show this gameweek's prediction, so its total is
      // the same figure: the XI at their multipliers (captain 2x, or 3x).
      const total = squad.filter(s => s.isStarting).reduce((sum, s) => sum + s.nextMatchPredicted * (s.multiplier || 1), 0);
      const canvas = await drawShareCard({ teamName, gwName, total, slots: squad, teamsById, siteUrl: window.location.host });
      const result = await shareCard(canvas, { title: `${teamName} · ${gwName}`, fileName: 'fpl-squad.png' });
      setShareState(result === 'downloaded' ? 'Image downloaded' : '');
    } catch {
      setShareState("Couldn't create the image");
    }
  }

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
      {deadlineAhead && (
        <button type="button" className="fpl-chip-btn fpl-inline" onClick={addReminder}>
          <Bell size={14} aria-hidden="true" /> Deadline reminder
        </button>
      )}
      <button type="button" className="fpl-chip-btn fpl-inline" onClick={share}>
        <Share2 size={14} aria-hidden="true" /> Share
      </button>
      {shareState && <span className="fpl-mono fpl-meta" role="status">{shareState}</span>}
    </div>
  );
}

// The early return used to sit at the top of ResultsScreen, before its
// hooks — so a screen that went from "unavailable" to a real gameweek (or
// back) rendered a different number of hooks and React threw. Each branch
// is now its own component, so hooks always run in the same order.
export function ResultsScreen(props) {
  return props.data.gwUnavailable
    ? <GameweekUnavailable data={props.data} onStartOver={props.onStartOver} />
    : <SquadResults {...props} />;
}

function GameweekUnavailable({ data, onStartOver }) {
  return (
    <div style={{ padding: '40px 16px', textAlign: 'center' }}>
      <Info size={28} style={{ color: 'var(--ink-dim)', margin: '0 auto 14px' }} />
      <p style={{ fontSize: '0.92rem', lineHeight: 1.5, marginBottom: 6, color: 'var(--ink)' }}>
        No saved optimal squad for {data.targetEvent && data.allEvents ? ((data.allEvents.find(e => e.id === data.gwId) || {}).name || `gameweek ${data.gwId}`) : `gameweek ${data.gwId}`}.
      </p>
      <p style={{ fontSize: '0.8rem', lineHeight: 1.5, color: 'var(--ink-dim)', marginBottom: 22 }}>
        This gameweek closed before a build was ever saved for it, so there's nothing to show.
      </p>
      <button className="fpl-btn fpl-btn-solid" onClick={onStartOver}>Start over</button>
    </div>
  );
}


// Pitch or list, remembered on this device.
const TEAM_VIEW_KEY = 'fpl_team_view';
function readTeamView() {
  try { return localStorage.getItem(TEAM_VIEW_KEY) === 'list' ? 'list' : 'pitch'; } catch { return 'pitch'; }
}
function saveTeamView(view) {
  try { localStorage.setItem(TEAM_VIEW_KEY, view); } catch { /* private mode */ }
}

const tenths = price => Math.round(price * 10);

// A player's details, opened by tapping their card on the pitch, with
// what can be done with them: armband, substitute, transfer out.
function PlayerSheet({ slot, team, teamsById, fixturesByTeam, isPastGw, canEdit, onClose, onCaptain, onVice, onSubstitute, onTransfer }) {
  const dialogRef = useRef(null);
  const [showWhy, setShowWhy] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog && dialog.open) dialog.close(); };
  }, []);
  const { player } = slot;
  return (
    <dialog
      ref={dialogRef}
      className="fpl-dialog fpl-sheet"
      aria-labelledby="sheet-h"
      onCancel={e => { e.preventDefault(); onClose(); }}
      onClick={e => { if (e.target === dialogRef.current) onClose(); }}
    >
      <div className="fpl-dialog-card">
        <button type="button" onClick={onClose} aria-label="Close" className="fpl-dialog-close"><X size={18} /></button>
        <div className="fpl-sheet-head">
          <span className="fpl-sheet-shirt"><Shirt team={team} isKeeper={player.positionId === 1} /></span>
          <div>
            <h2 id="sheet-h" className="fpl-display">{player.webName}{slot.isCaptain ? <span className="fpl-armband">C</span> : null}{slot.isViceCaptain ? <span className="fpl-armband fpl-armband-vc">V</span> : null}</h2>
            <p className="fpl-mono fpl-meta">{POSITION_LABELS[player.positionId]} · {team ? team.name : '—'} · {fmtPrice(player.price)}</p>
          </div>
        </div>
        {slot.availNote ? <p className="fpl-availnote">{slot.availNote}</p> : null}
        <div className="fpl-sheet-stats">
          {isPastGw ? (
            <div><b className="fpl-mono">{slot.played === false ? '–' : slot.actualPoints ?? '–'}</b><span>points this gameweek</span></div>
          ) : (
            <div><b className="fpl-mono">{fmtPts(slot.nextMatchPredicted ?? slot.predicted)}</b><span>predicted this gameweek</span></div>
          )}
          <div><b className="fpl-mono">{fmtPts(slot.predicted)}</b><span>predicted per week</span></div>
          <div><b className="fpl-mono">{fmtPts(player.displaySeasonPoints)}</b><span>season points{player.displayIsLastSeason ? ' (LS)' : ''}</span></div>
          <div><b className="fpl-mono">{typeof player.selectedBy === 'number' ? `${player.selectedBy}%` : '–'}</b><span>owned by</span></div>
        </div>
        {!isPastGw ? <div className="fpl-sheet-fx"><span className="fpl-mono fpl-meta">Next fixtures</span><span><DifficultyChips fixtures={fixturesByTeam[player.team]} teamsById={teamsById} max={4} /></span></div> : null}
        {slot.breakdown ? (
          <>
            <button type="button" className="fpl-link" aria-expanded={showWhy} onClick={() => setShowWhy(v => !v)}>{showWhy ? 'Hide why' : 'Why this prediction?'}</button>
            {showWhy ? <PredictionBreakdown breakdown={slot.breakdown} /> : null}
          </>
        ) : null}
        {canEdit ? (
          <div className="fpl-sheet-actions">
            {slot.isStarting ? (
              <>
                <button type="button" className={`fpl-btn${slot.isCaptain ? ' fpl-btn-solid' : ''}`} aria-pressed={!!slot.isCaptain} onClick={onCaptain}><Crown size={15} aria-hidden="true" /> Captain</button>
                <button type="button" className={`fpl-btn${slot.isViceCaptain ? ' fpl-btn-solid' : ''}`} aria-pressed={!!slot.isViceCaptain} onClick={onVice}>Vice-captain</button>
              </>
            ) : null}
            <button type="button" className="fpl-btn" onClick={onSubstitute}><ArrowUpDown size={15} aria-hidden="true" /> Substitute</button>
            <button type="button" className="fpl-btn" onClick={onTransfer}><ArrowLeftRight size={15} aria-hidden="true" /> Transfer out</button>
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

// The squad with every transfer planned so far applied, and the bank left.
function applyPlanned(squad, bankTenths, planned, predictionsById) {
  let work = squad;
  let bank = bankTenths || 0;
  Object.entries(planned).forEach(([outId, inPlayer]) => {
    if (!inPlayer) return;
    const out = squad.find(s => s.player.id === Number(outId));
    if (!out) return;
    bank -= tenths(inPlayer.price) - tenths(out.player.price);
    work = swapPlayerInSquad(work, out.player.id, inPlayer, predictionsById);
  });
  return { work, bank };
}

// Planning transfers on the pitch, as on the FPL site: all 15 with their
// prices; remove a player and pick who comes in, or let Auto Pick fill the
// gaps with the best-predicted players that fit. Nothing changes until
// Make transfers.
function TransferPlanner({ squad, bankTenths, allPlayers, predictionsById, teamsById, fixturesByTeam, freeTransfers, onFreeTransfers, startOut, onConfirm, onCancel }) {
  const [planned, setPlanned] = useState(() => (startOut ? { [startOut]: null } : {}));
  const [pickFor, setPickFor] = useState(startOut || null);
  const { work, bank } = applyPlanned(squad, bankTenths, planned, predictionsById);
  const made = Object.values(planned).filter(Boolean).length;
  const gaps = Object.values(planned).filter(p => !p).length;
  const hits = Math.max(0, made - freeTransfers) * 4;
  const change = Object.entries(planned).reduce((sum, [outId, p]) => {
    if (!p) return sum;
    const out = squad.find(s => s.player.id === Number(outId));
    return sum + (predictionsById[p.id] ? predictionsById[p.id].predicted : 0) - (out ? out.predicted : 0);
  }, 0);

  const remove = id => { setPlanned(prev => ({ ...prev, [id]: null })); setPickFor(id); };
  const pick = (outId, inPlayer) => { setPlanned(prev => ({ ...prev, [outId]: inPlayer })); setPickFor(null); };
  // Each gap gets the best-predicted player of its position that fits.
  function autoPick() {
    let next = { ...planned };
    Object.keys(next).filter(id => !next[id]).forEach(id => {
      const outSlot = squad.find(s => s.player.id === Number(id));
      if (!outSlot) return;
      const now = applyPlanned(squad, bankTenths, next, predictionsById);
      const ids = new Set(now.work.map(s => s.player.id));
      const choice = playersByPositionSorted(allPlayers, predictionsById, outSlot.player.positionId)
        .find(p => !ids.has(p.id) && !swapBlocker(outSlot, p, now.work, now.bank));
      if (choice) next = { ...next, [id]: choice };
    });
    setPlanned(next);
    setPickFor(null);
  }

  const rows = POSITION_ORDER.map(pos => squad.filter(s => s.player.positionId === pos));
  const pickSlot = pickFor ? squad.find(s => s.player.id === pickFor) : null;
  const card = slot => {
    const id = slot.player.id;
    if (!(id in planned)) {
      return <PlayerCard key={id} slot={slot} team={teamsById[slot.player.team]} price={slot.player.price}
        info={nextFixtureLabel(slot.player, fixturesByTeam, teamsById)} onRemove={() => remove(id)} onClick={() => remove(id)}
        label={`${slot.player.webName}, ${fmtPrice(slot.player.price)}: transfer out`} />;
    }
    const inPlayer = planned[id];
    if (!inPlayer) return <EmptyCard key={id} positionId={slot.player.positionId} onClick={() => setPickFor(id)} />;
    const pred = predictionsById[inPlayer.id];
    return <PlayerCard key={id} slot={{ player: inPlayer, availNote: pred ? pred.availNote : null }} team={teamsById[inPlayer.team]} price={inPlayer.price}
      info={nextFixtureLabel(inPlayer, fixturesByTeam, teamsById)} state="in" tag="IN" onRemove={() => remove(id)} onClick={() => remove(id)}
      label={`${inPlayer.webName} coming in, ${fmtPrice(inPlayer.price)}: change`} />;
  };

  return (
    <section className="fpl-planner" aria-labelledby="planner-h">
      <div className="fpl-planner-head">
        <h2 id="planner-h" className="fpl-section-title fpl-inline"><ArrowLeftRight size={14} aria-hidden="true" /> Transfers</h2>
        <button type="button" className="fpl-link" onClick={onCancel}>Cancel</button>
      </div>
      <dl className="fpl-planner-facts">
        <div><dt>Free transfers</dt><dd>
          <span className="fpl-stepper">
            <button type="button" aria-label="One fewer free transfer" onClick={() => onFreeTransfers(Math.max(0, freeTransfers - 1))} disabled={freeTransfers <= 0}>−</button>
            <b className="fpl-mono">{freeTransfers}</b>
            <button type="button" aria-label="One more free transfer" onClick={() => onFreeTransfers(Math.min(5, freeTransfers + 1))} disabled={freeTransfers >= 5}>+</button>
          </span>
        </dd></div>
        <div><dt>Transfers</dt><dd className="fpl-mono">{made}</dd></div>
        <div><dt>Cost</dt><dd className={`fpl-mono${hits ? ' is-down' : ''}`}>{hits ? `−${hits} pts` : '0 pts'}</dd></div>
        <div><dt>Bank</dt><dd className={`fpl-mono${bank < 0 ? ' is-down' : ''}`}>{fmtPrice(bank / 10)}</dd></div>
        <div><dt>Predicted change</dt><dd className={`fpl-mono ${change - hits / 4 > 0 ? 'is-up' : change < 0 ? 'is-down' : ''}`}>{change >= 0 ? '+' : ''}{fmtPts(change)} pts/wk</dd></div>
      </dl>
      <Pitch rows={rows} card={card} className="is-squad" />
      {pickSlot ? (
        <div className="fpl-planner-pick">
          <p className="fpl-mono fpl-meta">Replacing {pickSlot.player.webName} ({fmtPrice(pickSlot.player.price)})</p>
          <InlineSwapSearch key={pickSlot.player.id} outSlot={pickSlot} squad={work} allPlayers={allPlayers} predictionsById={predictionsById} teamsById={teamsById} bankTenths={bank} onSwap={pick} />
        </div>
      ) : null}
      <div className="fpl-planner-actions">
        <button type="button" className="fpl-btn" onClick={autoPick} disabled={!gaps}><Sparkles size={15} aria-hidden="true" /> Auto pick</button>
        <button type="button" className="fpl-btn" onClick={() => { setPlanned({}); setPickFor(null); }} disabled={!Object.keys(planned).length}><RotateCcw size={15} aria-hidden="true" /> Reset</button>
        <button type="button" className="fpl-btn fpl-btn-solid" onClick={() => onConfirm(planned)} disabled={!made || gaps > 0}>Make transfers</button>
      </div>
      {gaps > 0 ? <p className="fpl-mono fpl-meta">Pick a player for every empty place, or use Auto pick.</p> : null}
    </section>
  );
}

function SquadResults({ data, onStartOver, onSquadUpdate, session, onSaveTeamId, onSaveCustomSquad, onSaveTeamChanges, onResetTeamChanges, onRequestLoginToSave }) {
  const { squad, starters, bench, captain, captainSuggestion, suggestions, entryMeta, bankTenths, squadScore, isOptimalBuild, isPastGw, nextRefreshAt, backfilled, targetEvent, teamsById, fixturesByTeam, allEvents, allPlayers, predictionsById, activeChip } = data;
  const [editMode, setEditMode] = useState(false);
  const [editSlotId, setEditSlotId] = useState(null);
  const [chipPreview, setChipPreview] = useState(null);
  const [view, setViewState] = useState(readTeamView);
  const setView = v => { setViewState(v); saveTeamView(v); setEditMode(false); setSubFrom(null); };
  // Substituting on the pitch: the player picked first.
  const [subFrom, setSubFrom] = useState(null);
  // The player whose details are open.
  const [sheetId, setSheetId] = useState(null);
  // The transfer planner, open with this player already taken out (or true).
  const [planning, setPlanning] = useState(null);
  // A finished gameweek is a record of what happened: no editing, chip
  // planning or transfers.
  const canEdit = !isOptimalBuild && !isPastGw;
  // The captain's multiplier: 3 while Triple Captain is active, else 2.
  const armband = activeChip === '3xc' ? 3 : 2;
  // Purely a UI input — suggestTransfers itself has no idea how many free
  // transfers the person actually has, so this only affects which
  // suggestions get shown as free vs. costing a hit (applyFreeTransferEconomics
  // below), not what gets suggested in the first place. Defaults to 1
  // (the common case) rather than trying to derive it, since that would
  // need transfer-history data this app doesn't fetch.
  const [freeTransfers, setFreeTransfers] = useState(1);
  const visibleSuggestions = applyFreeTransferEconomics(suggestions, freeTransfers);

  // Scans the rest of the season, so only redone when the squad changes
  // (not on every keystroke in the swap search).
  const chipTiming = useMemo(
    () => (isOptimalBuild || isPastGw ? null : analyzeChipTiming(squad, fixturesByTeam, allEvents, predictionsById)),
    [isOptimalBuild, isPastGw, squad, fixturesByTeam, allEvents, predictionsById],
  );
  const [copyState, setCopyState] = useState('idle'); // 'idle' | 'copied' | 'failed'

  function handleDownloadSquadJson() {
    const payload = buildSquadExportPayload(data);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fpl-optimal-squad-gw${payload.gameweek ?? ''}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function handleCopySquadJson() {
    const payload = buildSquadExportPayload(data);
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      // Clipboard API can fail without HTTPS/permission — not worth a hard
      // error, just let the button say so and let the person try again.
      setCopyState('failed');
    }
    setTimeout(() => setCopyState('idle'), 2000);
  }

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
    const outSlot = squad.find(s => s.player.id === outId);
    if (!outSlot || swapBlocker(outSlot, inPlayer, squad, bankTenths)) return;
    const swapped = ensureCaptaincy(swapPlayerInSquad(squad, outId, inPlayer, predictionsById), armband);
    const newBankTenths = (bankTenths || 0) - (Math.round(inPlayer.price * 10) - Math.round(outSlot.player.price * 10));
    onSquadUpdate(swapped, newBankTenths);
    setEditSlotId(null);
    // A transfer uses up a free one, so the next suggestion is judged on
    // what's left.
    setFreeTransfers(n => Math.max(0, n - 1));
  }

  // Same mutual-exclusivity rules as the screenshot review screen: only
  // one captain and one vice-captain at a time, never the same player as
  // both, and re-checking an already-checked box clears it. `multiplier`
  // has to be kept in lockstep with isCaptain here (unlike the review
  // screen, where it's only derived once at final squad construction) —
  // buildResultsData reads slot.multiplier directly for scoring, it
  // doesn't re-derive it from isCaptain.
  function applyCaptainChange(playerId, role) {
    const target = squad.find(s => s.player.id === playerId);
    if (!target || !target.isStarting) return; // armbands are for starters only
    const plain = s => (s.isStarting ? 1 : 0);
    const newSquad = squad.map(s => {
      const isTarget = s.player.id === playerId;
      if (role === 'captain') {
        const nowCaptain = isTarget && !s.isCaptain;
        return {
          ...s,
          isCaptain: nowCaptain,
          multiplier: nowCaptain ? armband : plain(s),
          isViceCaptain: nowCaptain ? false : s.isViceCaptain,
        };
      }
      const nowVice = isTarget && !s.isViceCaptain;
      return {
        ...s,
        isViceCaptain: nowVice,
        isCaptain: nowVice ? false : s.isCaptain,
        multiplier: nowVice && s.isCaptain ? plain(s) : s.multiplier,
      };
    });
    onSquadUpdate(newSquad, bankTenths);
  }

  // Moves two players between the XI and the bench; no transfer is used.
  function applySubstitution(aId, bId) {
    onSquadUpdate(substitutePlayers(squad, aId, bId, armband), bankTenths);
    setEditSlotId(null);
  }

  // Makes every transfer planned on the pitch at once.
  function applyPlanned_(planned) {
    const { work, bank } = applyPlanned(squad, bankTenths, planned, predictionsById);
    const count = Object.values(planned).filter(Boolean).length;
    if (!count || bank < 0) return;
    onSquadUpdate(ensureCaptaincy(work, armband), bank);
    setFreeTransfers(n => Math.max(0, n - count));
    setPlanning(null);
  }

  function toggleRowEdit(playerId) {
    setEditSlotId(current => (current === playerId ? null : playerId));
  }

  const grouped = POSITION_ORDER.map(posId => ({
    posId,
    label: POSITION_LABELS[posId],
    players: starters.filter(s => s.player.positionId === posId),
  })).filter(g => g.players.length > 0);

  const viewedGwName = (isPastGw && allEvents && data.gwId) ? ((allEvents.find(e => e.id === data.gwId) || {}).name) : null;
  const showCaptainSuggestion = captainSuggestion && (!captain || captain.player.id !== captainSuggestion.player.id) && captainSuggestion.nextMatchPredicted > (captain ? captain.nextMatchPredicted : 0) + 0.3;

  return (
    <div style={{ padding: '16px 16px 60px' }}>
      <div style={{ marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
        <div>
          <h1 className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', letterSpacing: '0.04em', margin: 0, fontWeight: 400 }}>
            {entryMeta && entryMeta.teamName ? entryMeta.teamName.toUpperCase() : 'YOUR SQUAD'} · {(viewedGwName || (targetEvent ? targetEvent.name : '')).toUpperCase()}
          </h1>
          {bankTenths !== null && bankTenths !== undefined && (
            <div className="fpl-mono" style={{ fontSize: '0.72rem', color: 'var(--ink-dim)', marginTop: 2 }}>In the bank: {fmtPrice(bankTenths / 10)}</div>
          )}
          {isPastGw && data.entryHistory && (
            <div className="fpl-mono" style={{ fontSize: '0.72rem', color: 'var(--lime)', marginTop: 2, fontWeight: 600 }}>
              Scored {data.entryHistory.points} pts{data.entryHistory.event_transfers_cost ? ` (−${data.entryHistory.event_transfers_cost} hit)` : ''}
              {data.entryHistory.rank ? ` · GW rank ${data.entryHistory.rank.toLocaleString('en-GB')}` : ''}
            </div>
          )}
          {data.asOfGwId && (
            <div className="fpl-mono fpl-meta" style={{ marginTop: 4, lineHeight: 1.5 }}>
              Predictions use only data from before this gameweek's deadline. Prices and set-piece takers are today's.
            </div>
          )}
          {data.asOfFailedGwId && (
            <div className="fpl-mono" role="status" style={{ fontSize: '0.68rem', color: 'var(--amber)', marginTop: 4, fontWeight: 600, lineHeight: 1.5 }}>
              Couldn't load player data from before this gameweek, so these predictions use today's data (they may reflect what happened since).
            </div>
          )}
          {entryMeta && entryMeta.picksFromGwId && (
            <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--amber)', marginTop: 4, fontWeight: 600 }}>
              Your Gameweek {entryMeta.picksFromGwId} team — this gameweek's picks are hidden until the deadline, so transfers made since won't show.
            </div>
          )}
          {isOptimalBuild && !isPastGw && nextRefreshAt && (
            <div className="fpl-mono" style={{ color: 'var(--ink-dim)', fontSize: '0.68rem', padding: 0, marginTop: 4, fontWeight: 600 }}>
              Next refresh: {formatCountdown(nextRefreshAt, { suffix: '', passedLabel: 'due any time' })}
            </div>
          )}
          {isOptimalBuild && isPastGw && (
            <div className="fpl-mono" style={{ color: 'var(--ink-dim)', fontSize: '0.68rem', padding: 0, marginTop: 4, fontWeight: 600 }}>
              Closed gameweek — squad locked in{backfilled ? ' · backfilled from later data' : ''}
            </div>
          )}
          <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', marginTop: 6 }}>Squad Score</div>
        </div>
        <ScoreRing score={squadScore} />
      </div>

      {isOptimalBuild && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <button
            className="fpl-btn"
            style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}
            onClick={handleDownloadSquadJson}
          >
            <Download size={14} /> Download JSON
          </button>
          <button
            className="fpl-btn"
            style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}
            onClick={handleCopySquadJson}
          >
            {copyState === 'copied' ? <Check size={14} /> : <Clipboard size={14} />}
            {copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? "Couldn't copy" : 'Copy to clipboard'}
          </button>
        </div>
      )}

      {!isPastGw && (
        <>
          <div className="fpl-section-title fpl-inline"><Zap size={14} /> How would a chip affect this squad?</div>
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
        </>
      )}

      {!isPastGw && (
        <ResultsActions
          squad={squad}
          teamName={entryMeta && entryMeta.teamName ? entryMeta.teamName : (isOptimalBuild ? 'Optimal squad' : 'My squad')}
          gwName={targetEvent ? targetEvent.name : ''}
          teamsById={teamsById}
          deadline={targetEvent ? targetEvent.deadline_time : null}
        />
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

      <div className="fpl-team-toolbar">
        <div className="fpl-seg" role="group" aria-label="Show the team as">
          <button type="button" className={view === 'pitch' ? 'is-on' : ''} aria-pressed={view === 'pitch'} onClick={() => setView('pitch')}><LayoutGrid size={14} aria-hidden="true" /> Pitch</button>
          <button type="button" className={view === 'list' ? 'is-on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}><ListIcon size={14} aria-hidden="true" /> List</button>
        </div>
        {canEdit && view === 'pitch' && !planning ? (
          <button type="button" className="fpl-btn" onClick={() => { setSubFrom(null); setPlanning(true); }}><ArrowLeftRight size={15} aria-hidden="true" /> Transfers</button>
        ) : null}
      </div>

      {view === 'pitch' && planning ? (
        <TransferPlanner
          key={String(planning)}
          squad={squad}
          bankTenths={bankTenths}
          allPlayers={allPlayers}
          predictionsById={predictionsById}
          teamsById={teamsById}
          fixturesByTeam={fixturesByTeam}
          freeTransfers={freeTransfers}
          onFreeTransfers={setFreeTransfers}
          startOut={planning === true ? null : planning}
          onConfirm={applyPlanned_}
          onCancel={() => setPlanning(null)}
        />
      ) : null}

      {view === 'pitch' && !planning ? (() => {
        const subSlot = subFrom ? squad.find(s => s.player.id === subFrom) : null;
        const subOptions = subSlot ? new Set(substitutionOptions(squad, subSlot).map(s => s.player.id)) : null;
        const card = slot => {
          const id = slot.player.id;
          const mult = slot.isStarting ? (slot.multiplier || 1) : 1;
          const points = isPastGw
            ? (slot.played === false ? '–' : (slot.actualPoints ?? 0) * mult)
            : fmtPts(slot.predicted * mult);
          const raw = isPastGw ? (slot.actualPoints ?? 0) : slot.predicted;
          const tone = isPastGw ? (slot.played === false ? null : raw >= 6 ? 'high' : raw <= 1 ? 'low' : null) : (raw >= 5 ? 'high' : raw < 2 ? 'low' : null);
          let state = null;
          let onClick = () => setSheetId(id);
          if (subSlot) {
            state = id === subFrom ? 'selected' : subOptions.has(id) ? 'eligible' : 'dim';
            onClick = id === subFrom ? () => setSubFrom(null)
              : subOptions.has(id) ? () => { applySubstitution(subFrom, id); setSubFrom(null); }
                : undefined;
          }
          return (
            <PlayerCard
              key={id}
              slot={slot}
              team={teamsById[slot.player.team]}
              points={points}
              pointsTone={tone}
              info={isPastGw ? `pred ${fmtPts(slot.predicted)}` : nextFixtureLabel(slot.player, fixturesByTeam, teamsById)}
              state={state}
              onClick={onClick}
            />
          );
        };
        return (
          <div className="fpl-team-pitch">
            {subSlot ? (
              <div className="fpl-sub-banner" role="status">
                <span><b>Substituting {subSlot.player.webName}.</b> {!subOptions.size ? 'No one can swap in without breaking the formation.'
                  : subSlot.isStarting || subSlot.player.positionId === 1 ? 'Pick a highlighted player to swap with.'
                    : 'Pick a starter to bring them on, or a substitute to change who comes on first.'}</span>
                <button type="button" className="fpl-link" onClick={() => setSubFrom(null)}>Cancel</button>
              </div>
            ) : canEdit ? (
              <p className="fpl-mono fpl-meta">Tap a player to see their details, change the armband, substitute or transfer them.</p>
            ) : null}
            <Pitch starters={starters} bench={bench} card={card} />
          </div>
        );
      })() : null}

      {sheetId && squad.some(s => s.player.id === sheetId) ? (() => {
        const slot = squad.find(s => s.player.id === sheetId);
        return (
          <PlayerSheet
            slot={slot}
            team={teamsById[slot.player.team]}
            teamsById={teamsById}
            fixturesByTeam={fixturesByTeam}
            isPastGw={isPastGw}
            canEdit={canEdit}
            onClose={() => setSheetId(null)}
            onCaptain={() => applyCaptainChange(slot.player.id, 'captain')}
            onVice={() => applyCaptainChange(slot.player.id, 'vice')}
            onSubstitute={() => { setSheetId(null); setSubFrom(slot.player.id); }}
            onTransfer={() => { setSheetId(null); setPlanning(slot.player.id); }}
          />
        );
      })() : null}

      {view === 'list' ? (
        <>
      {canEdit && (
        <button
          className={`fpl-btn ${editMode ? 'fpl-btn-solid' : ''}`}
          style={{ width: '100%', marginBottom: 16, textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
          onClick={() => { setEditMode(m => !m); setEditSlotId(null); }}
        >
          <Edit3 size={16} /> {editMode ? 'Done editing' : 'Edit squad'}
        </button>
      )}

      {canEdit && editMode && (
        <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', marginBottom: 10, lineHeight: 1.5 }}>
          Tap any player below to substitute them, transfer them out, or set captain/vice-captain.
        </div>
      )}

      {grouped.map(g => (
        <div key={g.posId} style={{ marginBottom: 14 }}>
          <div className="fpl-section-title">{g.label}</div>
          <div className="fpl-block" style={{ borderTop: 'none' }}>
            {g.players.map(slot => (
              <Fragment key={slot.player.id}>
                <PlayerRow
                  slot={slot}
                  teamsById={teamsById}
                  fixturesByTeam={fixturesByTeam}
                  editable={canEdit && editMode}
                  isOpen={editSlotId === slot.player.id}
                  onToggle={() => toggleRowEdit(slot.player.id)}
                  isPastGw={isPastGw}
                />
                {canEdit && editMode && editSlotId === slot.player.id && (
                  <>
                    {slot.isStarting ? (
                      <CaptaincyPicker
                        slot={slot}
                        onSetCaptain={(id) => applyCaptainChange(id, 'captain')}
                        onSetVice={(id) => applyCaptainChange(id, 'vice')}
                      />
                    ) : (
                      <div className="fpl-mono fpl-meta" style={{ padding: '10px 10px 0' }}>Bench players can't wear the armband.</div>
                    )}
                    <SubstitutePicker slot={slot} squad={squad} onSubstitute={applySubstitution} />
                    <InlineSwapSearch
                      key={slot.player.id}
                      outSlot={slot}
                      squad={squad}
                      allPlayers={allPlayers}
                      predictionsById={predictionsById}
                      teamsById={teamsById}
                      bankTenths={bankTenths}
                      onSwap={applySwap}
                    />
                  </>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      ))}

      {bench.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="fpl-section-title">Bench</div>
          <div className="fpl-block" style={{ borderTop: 'none' }}>
            {bench.map(slot => (
              <Fragment key={slot.player.id}>
                <PlayerRow
                  slot={slot}
                  teamsById={teamsById}
                  fixturesByTeam={fixturesByTeam}
                  editable={canEdit && editMode}
                  isOpen={editSlotId === slot.player.id}
                  onToggle={() => toggleRowEdit(slot.player.id)}
                  isPastGw={isPastGw}
                />
                {canEdit && editMode && editSlotId === slot.player.id && (
                  <>
                    {slot.isStarting ? (
                      <CaptaincyPicker
                        slot={slot}
                        onSetCaptain={(id) => applyCaptainChange(id, 'captain')}
                        onSetVice={(id) => applyCaptainChange(id, 'vice')}
                      />
                    ) : (
                      <div className="fpl-mono fpl-meta" style={{ padding: '10px 10px 0' }}>Bench players can't wear the armband.</div>
                    )}
                    <SubstitutePicker slot={slot} squad={squad} onSubstitute={applySubstitution} />
                    <InlineSwapSearch
                      key={slot.player.id}
                      outSlot={slot}
                      squad={squad}
                      allPlayers={allPlayers}
                      predictionsById={predictionsById}
                      teamsById={teamsById}
                      bankTenths={bankTenths}
                      onSwap={applySwap}
                    />
                  </>
                )}
              </Fragment>
            ))}
          </div>
        </div>
      )}

        </>
      ) : null}

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
                  <span className="fpl-dim"> expected total with the chip — vs ~{fmtPts(chipTiming.bestTripleCaptain.normalXi)} pts that week with no chip.</span>
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
                  <span className="fpl-dim"> expected total with the chip — vs ~{fmtPts(chipTiming.bestBenchBoost.normalXi)} pts that week with no chip.</span>
                </div>
              </div>
            </div>
          )}
          <p className="fpl-mono" style={{ fontSize: '0.62rem', color: 'var(--ink-dim)', marginTop: 6, lineHeight: 1.5 }}>
            Estimated from currently scheduled fixtures for your squad as it stands now — this will shift as gameweeks pass, your squad changes, and FPL confirms any blank/double gameweeks.
          </p>
        </div>
      )}

      {canEdit && (
        <div style={{ marginBottom: 8 }}>
          <div className="fpl-section-title" style={{ background: 'transparent', border: 'none', padding: '0 0 10px' }}>Transfer suggestions</div>
          {suggestions.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <span className="fpl-mono fpl-meta">Free transfers available:</span>
              {[0, 1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  className={`fpl-chip-btn ${freeTransfers === n ? 'active' : ''}`}
                  onClick={() => setFreeTransfers(n)}
                  style={{ minWidth: 28, padding: '4px 8px' }}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          {visibleSuggestions.length === 0 && (
            <div className="fpl-block" style={{ padding: 14, fontSize: '0.85rem', color: 'var(--ink-dim)', display: 'flex', gap: 10, alignItems: 'center' }}>
              <CheckCircle2 size={18} style={{ color: 'var(--green)', flexShrink: 0 }} />
              {suggestions.length === 0
                ? "Your squad's in good shape — no changes look necessary this week."
                : freeTransfers > 0
                  ? 'Nothing beats saving your free transfer this week — it rolls over to next week.'
                  : "Nothing worth a -4 hit right now — check back once you've got a free transfer, or increase the count above if you already do."}
            </div>
          )}
          {visibleSuggestions.map((s, i) => (
            <TransferCard key={i} suggestion={s} onApply={canEdit ? applySwap : null} />
          ))}
        </div>
      )}

      {!data.isOptimalBuild && (
        <SaveTeamSection
          data={data}
          session={session}
          onSaveTeamId={onSaveTeamId}
          onSaveCustomSquad={onSaveCustomSquad}
          onSaveTeamChanges={onSaveTeamChanges}
          onResetTeamChanges={onResetTeamChanges}
          onRequestLoginToSave={onRequestLoginToSave}
        />
      )}

      <details className="fpl-details">
        <summary className="fpl-inline"><Info size={14} /> How these predictions work</summary>
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

// Handles both save actions (Team ID, and the exact current squad) from
// whichever results view is showing — Team-ID lookup, custom build, or a
// uploaded-screenshot squad. Shows one shared inline status line for
// whichever button was last pressed.
export function SaveTeamSection({ data, session, onSaveTeamId, onSaveCustomSquad, onSaveTeamChanges, onResetTeamChanges, onRequestLoginToSave }) {
  const [status, setStatus] = useState(null); // { kind: 'saving'|'ok'|'error', message }
  const teamId = data.entryMeta && data.entryMeta.teamId;
  // Prefer the gameweek this squad/team was actually fetched/built for
  // (entryMeta.gwId); fall back to whatever gameweek is currently showing
  // in the header if that's somehow missing.
  const gwId = (data.entryMeta && data.entryMeta.gwId) || (data.targetEvent && data.targetEvent.id) || null;
  const defaultLabel = (data.entryMeta && data.entryMeta.teamName) || (teamId ? `Team ${teamId}` : 'My squad');
  const [label, setLabel] = useState(defaultLabel);

  async function handleSaveTeamId() {
    setStatus({ kind: 'saving' });
    const result = await onSaveTeamId(teamId, label.trim() || defaultLabel, gwId);
    setStatus(result.ok ? { kind: 'ok', message: 'Saved.' } : { kind: 'error', message: result.error || 'Could not save.' });
  }

  // A Team ID's changes (transfers, armbands, the XI) saved to the account
  // for this gameweek, so loading the Team ID shows them.
  async function handleSaveChanges() {
    setStatus({ kind: 'saving' });
    const result = await onSaveTeamChanges(data, label.trim() || defaultLabel);
    setStatus(result.ok ? { kind: 'ok', message: 'Changes saved. Loading this Team ID now shows them.' } : { kind: 'error', message: result.error || 'Could not save.' });
  }

  async function handleResetChanges() {
    setStatus({ kind: 'saving' });
    const result = await onResetTeamChanges(data);
    if (!result.ok) setStatus({ kind: 'error', message: result.error || 'Could not reset.' });
  }

  async function handleSaveSquad() {
    setStatus({ kind: 'saving' });
    const result = await onSaveCustomSquad(data.squad, label.trim() || defaultLabel, gwId, data.bankTenths);
    setStatus(result.ok ? { kind: 'ok', message: 'Saved.' } : { kind: 'error', message: result.error || 'Could not save.' });
  }

  const canSaveChanges = !!teamId && !data.isPastGw;
  const savedChanges = !!(data.entryMeta && data.entryMeta.savedChanges);
  const onDevice = !!(data.entryMeta && data.entryMeta.changesOnDevice);
  const busy = status && status.kind === 'saving';

  // Changes to a Team ID's squad are kept on this device as they're made
  // (so Home and Mini-league show them); an account keeps them on every
  // device. Either way they can be dropped for the team on FPL.
  const changesBanner = canSaveChanges && (savedChanges || data.edited) ? (
    <div className="fpl-block" role="status" style={{ padding: 12, marginBottom: 10, display: 'grid', gap: 8 }}>
      <div className="fpl-mono" style={{ fontSize: '0.72rem', lineHeight: 1.5 }}>
        {data.edited
          ? (session
            ? 'Your changes are kept on this device, and show on Home and in Mini-league. Save them to your account to see them on any device.'
            : 'Your changes are kept on this device, and show on Home and in Mini-league. Log in to keep them on any device.')
          : (onDevice ? 'Showing your changes from this device, not the team on FPL.' : 'Showing the changes saved to your account, not the team on FPL.')}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {session && (data.edited || onDevice) && (
          <button onClick={handleSaveChanges} disabled={busy} className="fpl-btn fpl-btn-solid" style={{ flex: 1, minWidth: 140, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            <Bookmark size={14} /> Save to account
          </button>
        )}
        <button onClick={handleResetChanges} disabled={busy} className="fpl-btn" style={{ flex: 1, minWidth: 140, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
          <RotateCcw size={14} /> Use the team on FPL
        </button>
      </div>
      {status && status.kind === 'error' && !session && <div role="alert" style={{ color: 'var(--red)', fontSize: '0.78rem' }}>{status.message}</div>}
    </div>
  ) : null;

  if (!session) {
    return (
      <>
        {changesBanner}
        <button
          onClick={onRequestLoginToSave}
          className="fpl-btn"
          style={{ width: '100%', marginBottom: 10, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
        >
          <Bookmark size={16} /> {canSaveChanges && (data.edited || onDevice) ? 'Log in to save your changes' : 'Log in to save this team'}
        </button>
      </>
    );
  }

  return (
    <div style={{ marginBottom: 10 }}>
      {changesBanner}
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="Name this squad"
        maxLength={40}
        className="fpl-mono"
        style={{ width: '100%', background: 'var(--panel-alt)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 4, padding: '9px 10px', fontSize: '0.85rem', marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {teamId && (
          <button onClick={handleSaveTeamId} disabled={status && status.kind === 'saving'} className="fpl-btn" style={{ flex: 1, minWidth: 140, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            <Bookmark size={14} /> Save this Team ID
          </button>
        )}
        {!data.isPastGw && (
          <button onClick={handleSaveSquad} disabled={status && status.kind === 'saving'} className="fpl-btn" style={{ flex: 1, minWidth: 140, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
            <Bookmark size={14} /> Save this squad
          </button>
        )}
      </div>
      {status && status.kind !== 'saving' && (
        <div className="fpl-mono" style={{ fontSize: '0.7rem', marginTop: 6, color: status.kind === 'ok' ? 'var(--lime)' : 'var(--red)' }}>
          {status.message}
        </div>
      )}
    </div>
  );
}
