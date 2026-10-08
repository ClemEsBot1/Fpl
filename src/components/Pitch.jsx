// A squad laid out on a pitch, the way the FPL site shows a team: the
// starting XI in formation rows, the bench on a strip below. Each player
// is a card with their club shirt, name and one line of info. Cards can be
// highlighted (picked, can swap in, out of reach) for substitutions.
import { useState } from 'react';
import { Plus, TriangleAlert, X } from 'lucide-react';
import { POSITION_LABELS, fmtPrice } from '../lib/format.js';
import { POSITION_ORDER } from '../lib/predictions.js';
import { benchLabels, shirtUrl } from '../lib/pitch.js';

// A plain shirt when the club's can't be loaded (offline, or no club).
function ShirtFallback({ isKeeper, empty }) {
  return (
    <svg viewBox="0 0 64 64" className="fpl-shirt" aria-hidden="true">
      <path
        d="M22 7 9 14l5 14 7-3v32h22V25l7 3 5-14-13-7c-2 5-6 8-10 8s-8-3-10-8z"
        fill={empty ? 'rgba(255,255,255,0.18)' : isKeeper ? '#FFD60A' : '#E9E9F2'}
        stroke={empty ? 'rgba(255,255,255,0.55)' : 'rgba(5,4,26,0.25)'}
        strokeWidth="1.5"
        strokeDasharray={empty ? '3 3' : undefined}
      />
    </svg>
  );
}

export function Shirt({ team, isKeeper }) {
  const [failed, setFailed] = useState(false);
  const src = shirtUrl(team, isKeeper);
  if (!src || failed) return <ShirtFallback isKeeper={isKeeper} />;
  return <img className="fpl-shirt" src={src} alt="" loading="lazy" decoding="async" draggable="false" onError={() => setFailed(true)} />;
}

// Injured, suspended or unavailable: red; a doubt: yellow.
function flagFor(player, availNote) {
  if (!availNote) return null;
  return ['i', 's', 'u', 'n'].includes(player.status) ? 'out' : 'doubt';
}

// One player's card. `state` is 'selected', 'eligible' or 'dim' while
// substituting; `points` shows in the corner; `price` above the card and
// `onRemove` a remove button (the transfer planner).
export function PlayerCard({ slot, team, info, points, pointsTone, state, onClick, onRemove, price, tag, label }) {
  const { player } = slot;
  const flag = flagFor(player, slot.availNote);
  return (
    <div className={`fpl-pc${state ? ` is-${state}` : ''}`}>
      {price !== undefined ? <span className="fpl-pc-price fpl-mono">{fmtPrice(price)}</span> : null}
      {onRemove ? (
        <button type="button" className="fpl-pc-x" aria-label={`Remove ${player.webName}`} onClick={onRemove}><X size={12} aria-hidden="true" /></button>
      ) : null}
      <button
        type="button"
        className="fpl-pc-body"
        onClick={onClick}
        disabled={!onClick}
        aria-label={label || `${player.webName}${info ? `, ${info}` : ''}${points !== undefined ? `, ${points} points` : ''}`}
        aria-pressed={state === 'selected' ? true : undefined}
      >
        <span className="fpl-pc-shirt">
          <Shirt team={team} isKeeper={player.positionId === 1} />
          {slot.isCaptain || slot.isViceCaptain ? <span className={`fpl-pc-arm${slot.isViceCaptain ? ' is-vc' : ''}`} aria-hidden="true">{slot.isCaptain ? 'C' : 'V'}</span> : null}
          {flag ? <span className={`fpl-pc-flag is-${flag}`} aria-hidden="true"><TriangleAlert size={11} /></span> : null}
          {tag ? <span className="fpl-pc-tag fpl-mono" aria-hidden="true">{tag}</span> : null}
          {points !== undefined && points !== null ? <span className={`fpl-pc-pts fpl-mono${pointsTone ? ` is-${pointsTone}` : ''}`} aria-hidden="true">{points}</span> : null}
        </span>
        <span className={`fpl-pc-name${flag ? ` is-${flag}` : ''}`}>{player.webName}</span>
        {info ? <span className="fpl-pc-info fpl-mono">{info}</span> : null}
      </button>
    </div>
  );
}

// An empty place in the squad (the transfer planner): a dashed shirt.
export function EmptyCard({ positionId, onClick, price }) {
  return (
    <div className="fpl-pc is-empty">
      {price !== undefined ? <span className="fpl-pc-price fpl-mono">{fmtPrice(price)}</span> : null}
      <button type="button" className="fpl-pc-body" onClick={onClick} aria-label={`Pick a ${POSITION_LABELS[positionId]}`}>
        <span className="fpl-pc-shirt"><ShirtFallback empty /><span className="fpl-pc-plus" aria-hidden="true"><Plus size={16} /></span></span>
        <span className="fpl-pc-name">Pick {POSITION_LABELS[positionId]}</span>
      </button>
    </div>
  );
}

// The pitch. `rows` are the XI by position (or any rows of slots, as in
// the transfer planner); `bench` the substitutes in order. `card(slot, i)`
// draws each one.
export function Pitch({ starters, bench, rows, card, compact, benchTitle = 'Substitutes', className = '' }) {
  const lines = rows || POSITION_ORDER.map(pos => (starters || []).filter(s => s.player.positionId === pos)).filter(r => r.length);
  const labels = benchLabels(bench || []);
  return (
    <div className={`fpl-pitch${compact ? ' is-compact' : ''} ${className}`}>
      <div className="fpl-pitch-field">
        <span className="fpl-pitch-lines" aria-hidden="true"><span className="fpl-pitch-box" /><span className="fpl-pitch-mid" /><span className="fpl-pitch-circle" /></span>
        {lines.map((row, i) => (
          <div key={i} className="fpl-pitch-row">{row.map((slot, j) => card(slot, j))}</div>
        ))}
      </div>
      {bench && bench.length ? (
        <div className="fpl-pitch-bench" role="group" aria-label={benchTitle}>
          {bench.map((slot, i) => (
            <div key={slot.player.id} className="fpl-pitch-benchslot">
              <span className="fpl-pitch-benchlabel fpl-mono">{labels[i]}</span>
              {card(slot, i)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
