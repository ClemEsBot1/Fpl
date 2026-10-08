// "Best XI: last gameweek" — what was predicted vs. what scored best.
import { AlertTriangle, Info, RotateCcw } from 'lucide-react';
import { POSITION_LABELS, fmtPrice, fmtPts } from '../lib/format.js';
import { Pitch, PlayerCard } from '../components/Pitch.jsx';

/* ----------------------------------------------------------------------------
   HINDSIGHT: BEST XI FOR A CLOSED GAMEWEEK
   Compact rows for the two side-by-side squads — no edit affordances, since
   both squads are locked in history and can't be changed.
---------------------------------------------------------------------------- */
export function HindsightPlayerRow({ slot, teamsById }) {
  const { player, isCaptain, isViceCaptain, actualPoints, played } = slot;
  const team = teamsById[player.team];
  return (
    <div className="fpl-row">
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
      </div>
      <div className="fpl-row-pred">
        <div className="fpl-row-pred-num" style={{ color: !played ? 'var(--ink-dim)' : (actualPoints >= 6 ? 'var(--lime)' : actualPoints <= 1 ? 'var(--red)' : 'var(--ink)') }}>
          {!played ? 'NP' : (actualPoints ?? '—')}
        </div>
        <div className="fpl-row-pred-label">{!played ? 'NOT PLAYED' : 'ACTUAL PTS'}</div>
      </div>
    </div>
  );
}

export function HindsightSquadColumn({ title, squad, score, teamsById }) {
  const starters = squad.filter(s => s.isStarting);
  const bench = squad.filter(s => !s.isStarting);
  const card = slot => {
    const mult = slot.isStarting ? (slot.multiplier || 1) : 1;
    const club = teamsById[slot.player.team];
    const pts = slot.actualPoints ?? 0;
    return (
      <PlayerCard
        key={slot.player.id}
        slot={slot}
        team={club}
        points={slot.played === false ? '–' : pts * mult}
        pointsTone={slot.played === false ? null : pts >= 6 ? 'high' : pts <= 1 ? 'low' : null}
        info={club ? club.short_name : ''}
      />
    );
  };

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
        <div className="fpl-section-title" style={{ background: 'transparent', border: 'none', padding: 0 }}>{title}</div>
        <div className="fpl-mono" style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--blue)' }}>{fmtPts(score)} <span style={{ fontSize: '0.62rem', color: 'var(--ink-dim)', fontWeight: 500 }}>PTS</span></div>
      </div>
      <Pitch starters={starters} bench={bench} card={card} compact />
    </div>
  );
}

export function HindsightScreen({ data, savedTeams, compare, onSelectCompare, onBack }) {
  if (data.gwUnavailable) {
    return (
      <div className="fpl-block" style={{ margin: '24px 16px', padding: '28px 16px', textAlign: 'center' }}>
        <Info size={28} style={{ color: 'var(--ink-dim)', margin: '0 auto 14px' }} />
        <p style={{ fontSize: '0.92rem', lineHeight: 1.5, marginBottom: 6, color: 'var(--ink)' }}>
          No saved optimal squad for {data.gwName || `gameweek ${data.gwId}`}, so there's nothing to compare against.
        </p>
        <button className="fpl-btn fpl-btn-solid" onClick={onBack}>Back</button>
      </div>
    );
  }

  const { gwName, predictedSquad, predictedScore, hindsightSquad, hindsightScore, teamsById } = data;
  const pct = hindsightScore > 0 ? Math.round((predictedScore / hindsightScore) * 100) : 100;
  const comparePct = compare && compare.score != null && hindsightScore > 0 ? Math.round((compare.score / hindsightScore) * 100) : null;

  return (
    <div style={{ padding: '16px 16px 60px' }}>
      <h1 className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', letterSpacing: '0.04em', margin: '0 0 4px', fontWeight: 400 }}>
        BEST XI · {gwName ? gwName.toUpperCase() : ''}
      </h1>
      <div className="fpl-block" style={{ padding: 14, marginBottom: 22 }}>
        <div style={{ fontSize: '0.85rem', lineHeight: 1.5, color: 'var(--ink)' }}>
          The predicted squad actually scored <strong className="fpl-mono">{fmtPts(predictedScore)}</strong> that gameweek — the best possible squad would have scored <strong className="fpl-mono">{fmtPts(hindsightScore)}</strong> ({pct}%).
          {compare && compare.score != null && (
            <> Your saved <strong>{compare.label}</strong> scored <strong className="fpl-mono">{fmtPts(compare.score)}</strong> ({comparePct}%).</>
          )}
        </div>
      </div>

      {savedTeams && savedTeams.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="fpl-section-title" style={{ background: 'transparent', border: 'none', padding: '0 0 8px', color: 'var(--ink-dim)' }}>Compare with a saved team</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {savedTeams.map(entry => (
              <button
                key={entry.id}
                onClick={() => onSelectCompare(entry)}
                disabled={compare && compare.loading}
                className="fpl-btn"
                style={{
                  padding: '7px 12px', fontSize: '0.78rem',
                  background: compare && compare.entry && compare.entry.id === entry.id ? 'var(--panel-alt)' : undefined,
                  borderColor: compare && compare.entry && compare.entry.id === entry.id ? 'var(--blue)' : undefined,
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {compare && compare.loading && (
            <div className="fpl-mono" style={{ fontSize: '0.7rem', color: 'var(--ink-dim)', marginTop: 8 }}>Loading…</div>
          )}
          {compare && compare.error && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 8, color: 'var(--red)', fontSize: '0.78rem' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {compare.error}
            </div>
          )}
        </div>
      )}

      <HindsightSquadColumn title="What was predicted" squad={predictedSquad} score={predictedScore} teamsById={teamsById} />
      {compare && compare.squad && (
        <HindsightSquadColumn title={compare.label} squad={compare.squad} score={compare.score} teamsById={teamsById} />
      )}
      <HindsightSquadColumn title="Best possible XI" squad={hindsightSquad} score={hindsightScore} teamsById={teamsById} />

      <button className="fpl-btn" style={{ width: '100%', marginTop: 8, textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }} onClick={onBack}>
        <RotateCcw size={16} /> Back
      </button>
    </div>
  );
}
