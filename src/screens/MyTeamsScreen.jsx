// The saved-teams list.
import { ArrowRight, Bookmark, RotateCcw, Trash2 } from 'lucide-react';

export function MyTeamsScreen({ teams, onLoad, onDelete, onBack }) {
  return (
    <div style={{ padding: '16px 16px 60px' }}>
      <h1 className="fpl-display" style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: 16 }}>My Teams</h1>

      {teams.length === 0 && (
        <div style={{ padding: '32px 8px', textAlign: 'center' }}>
          <Bookmark size={26} style={{ color: 'var(--ink-dim)', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '0.88rem', color: 'var(--ink-dim)', lineHeight: 1.5 }}>
            Nothing saved yet. Check a Team ID or build a squad, then save it from the results screen.
          </p>
        </div>
      )}

      {teams.map(entry => (
        <div key={entry.id} className="fpl-block" style={{ padding: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.9rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.label}</div>
            <div className="fpl-mono" style={{ fontSize: '0.66rem', color: 'var(--ink-dim)', marginTop: 2 }}>
              {entry.type === 'teamId' ? `Team ID ${entry.teamId}` : 'Custom squad'}{entry.gwId ? ` · GW${entry.gwId}` : ''}
            </div>
          </div>
          <button onClick={() => onLoad(entry)} className="fpl-btn" style={{ padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}>
            <ArrowRight size={14} /> Load
          </button>
          <button onClick={() => onDelete(entry.id)} aria-label="Remove" style={{ background: 'none', border: '1px solid var(--line)', color: 'var(--red)', padding: '7px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <button className="fpl-btn" style={{ width: '100%', marginTop: 16, textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }} onClick={onBack}>
        <RotateCcw size={16} /> Back
      </button>
    </div>
  );
}
