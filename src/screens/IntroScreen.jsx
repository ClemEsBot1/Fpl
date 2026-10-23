// The prediction-accuracy panel (shown on the welcome page) and the Team ID form.
import { useEffect, useState } from 'react';
import { ArrowRight, ChevronLeft } from 'lucide-react';
import { fmtPts } from '../lib/format.js';
import { parseTeamId } from '../lib/teamIdInput.js';
import { t } from '../lib/i18n.js';
import { tr } from '../lib/i18nRich.jsx';

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
        {t('HOW ACCURATE WERE WE?')} · {(data.gwId ? t('Gameweek {n}', { n: data.gwId }) : data.gwName).toUpperCase()}
      </h2>
      <p style={{ fontSize: '0.85rem', lineHeight: 1.5, margin: 0 }}>
        {tr('The 10 players we rated highest scored <b>{top} pts</b> on average, against {all} for everyone who played. Per player, our predictions were off by {miss} pts on average.', { top: fmtPts(data.topTenAverageActual), all: fmtPts(data.averageActual), miss: fmtPts(data.meanAbsError) }, { b: s => <strong>{s}</strong> })}
      </p>
      <p className="fpl-mono" style={{ fontSize: '0.64rem', color: 'var(--ink-dim)', margin: '8px 0 0' }}>
        {t('Compared across {n} players who played, using predictions saved before the deadline.', { n: data.playersCompared })}
      </p>
    </section>
  );
}

export function TeamIdForm({ value, onChange, onSubmit, onBack }) {
  return (
    <div className="fpl-screen">
      <button onClick={onBack} className="fpl-mono fpl-back-btn">
        <ChevronLeft size={14} /> {t('BACK')}
      </button>
      <h1 className="fpl-display fpl-screen-title">{t('Your FPL Team ID')}</h1>
      <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: 16, lineHeight: 1.5 }}>
        {tr('Open <m>fantasy.premierleague.com</m>, go to Points or My Team, and take the number after <m>/entry/</m> in the URL, or just paste the whole link.', undefined, { m: s => <span className="fpl-mono">{s}</span> })}
      </p>
      <input
        className="fpl-input"
        inputMode="numeric"
        placeholder={t('e.g. 1234567')}
        value={value}
        onChange={e => onChange(parseTeamId(e.target.value))}
        onKeyDown={e => { if (e.key === 'Enter' && value) onSubmit(); }}
      />
      <button
        className="fpl-btn fpl-btn-solid"
        style={{ width: '100%', marginTop: 14, textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
        disabled={!value}
        onClick={onSubmit}
      >
        {t('Check my squad')} <ArrowRight size={16} />
      </button>
    </div>
  );
}
