// The prediction-accuracy panel (shown on the welcome page) and the Team ID form.
import { useEffect, useState } from 'react';
import { ArrowRight, ChevronLeft } from 'lucide-react';
import { fmtPts } from '../lib/format.js';

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
