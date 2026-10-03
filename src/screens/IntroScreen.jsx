// Home screen (with the prediction-accuracy panel) and the Team ID form.
import { useEffect, useState } from 'react';
import { ArrowRight, Bookmark, Camera, ChevronLeft, Hash, History, Trophy, Wand2 } from 'lucide-react';
import { fmtPts } from '../lib/format.js';
import { SQUAD_BUDGET } from '../lib/predictions.js';

// "How accurate were we?" — last gameweek's predictions against what
// players actually scored (api/accuracy.js). Hidden until there's data.
export function AccuracyPanel() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/accuracy')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d && typeof d.meanAbsError === 'number') setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  if (!data) return null;
  return (
    <section aria-labelledby="accuracy-title" className="fpl-block" style={{ padding: 14, marginTop: 28 }}>
      <h2 id="accuracy-title" className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', letterSpacing: '0.04em', margin: '0 0 8px', fontWeight: 600 }}>
        HOW ACCURATE WERE WE? · {data.gwName.toUpperCase()}
      </h2>
      <p style={{ fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }}>
        The 10 players we rated highest scored <strong>{fmtPts(data.topTenAverageActual)} pts</strong> on average, against {fmtPts(data.averageActual)} for everyone who played. Per player, our predictions were off by {fmtPts(data.meanAbsError)} pts on average.
      </p>
      <p className="fpl-mono" style={{ fontSize: '0.64rem', color: 'var(--ink-dim)', margin: '8px 0 0' }}>
        Compared across {data.playersCompared} players who played, using predictions saved before the deadline.
      </p>
    </section>
  );
}

export function IntroScreen({ onChoose, showHindsight, showMyTeams }) {
  return (
    <div className="fpl-screen">
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
            <span className="fpl-option-title">Enter Team ID</span>
            <span className="fpl-mono fpl-option-sub">Exact data, straight from the FPL API</span>
          </span>
        </button>
        <button className="fpl-btn" onClick={() => onChoose('screenshot')} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Camera size={22} />
          <span>
            <span className="fpl-option-title">Upload a screenshot</span>
            <span className="fpl-mono fpl-option-sub">We read the players and work out their prices</span>
          </span>
        </button>
        <button className="fpl-btn" onClick={() => onChoose('build')} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Trophy size={22} />
          <span>
            <span className="fpl-option-title">Build the best squad</span>
            <span className="fpl-mono fpl-option-sub">Optimal 15 within £{SQUAD_BUDGET.toFixed(1)}m, not your team</span>
          </span>
        </button>
      </div>

      <div className="fpl-section-title" style={{ background: 'transparent', border: 'none', padding: '28px 0 10px', color: 'var(--ink-dim)' }}>Or build it yourself</div>
      <button className="fpl-btn" onClick={() => onChoose('custom')} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
        <Wand2 size={22} />
        <span>
          <span className="fpl-option-title">Pick your own squad</span>
          <span className="fpl-mono fpl-option-sub">Choose every player, formation & captain, preview chips</span>
        </span>
      </button>

      {showMyTeams && (
        <>
          <div className="fpl-section-title" style={{ background: 'transparent', border: 'none', padding: '28px 0 10px', color: 'var(--ink-dim)' }}>Or use a saved team</div>
          <button className="fpl-btn" onClick={() => onChoose('myTeams')} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
            <Bookmark size={22} />
            <span>
              <span className="fpl-option-title">My Teams</span>
              <span className="fpl-mono fpl-option-sub">Load a Team ID or squad you've saved to your account</span>
            </span>
          </button>
        </>
      )}

      {showHindsight && (
        <>
          <div className="fpl-section-title" style={{ background: 'transparent', border: 'none', padding: '28px 0 10px', color: 'var(--ink-dim)' }}>Or look back</div>
          <button className="fpl-btn" onClick={() => onChoose('hindsight')} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
            <History size={22} />
            <span>
              <span className="fpl-option-title">Best XI: last gameweek</span>
              <span className="fpl-mono fpl-option-sub">What was predicted vs. what would've actually scored best</span>
            </span>
          </button>
        </>
      )}
      <AccuracyPanel />
    </div>
  );
}

export function TeamIdForm({ value, onChange, onSubmit, onBack }) {
  return (
    <div className="fpl-screen">
      <button onClick={onBack} className="fpl-mono fpl-back-btn">
        <ChevronLeft size={14} /> BACK
      </button>
      <h1 className="fpl-display fpl-screen-title">Your FPL Team ID</h1>
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
