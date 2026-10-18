// Admins only: which predictions the squads on screen use, the formula
// the app runs on or the ML model's (see withModelPredictions).
import { Calculator, Sparkles } from 'lucide-react';

export function ModelSwitch({ choice, available, onChange }) {
  return (
    <div className="fpl-model-switch">
      <span className="fpl-mono fpl-model-switch-label" id="model-switch-label">ADMIN · PREDICTIONS</span>
      <div className="fpl-seg" role="group" aria-labelledby="model-switch-label">
        <button type="button" className={choice === 'formula' ? 'is-on' : ''} aria-pressed={choice === 'formula'} onClick={() => onChange('formula')}>
          <Calculator size={14} aria-hidden="true" /> Formula
        </button>
        <button type="button" className={choice === 'ml' ? 'is-on' : ''} aria-pressed={choice === 'ml'} disabled={!available && choice !== 'ml'} onClick={() => onChange('ml')}>
          <Sparkles size={14} aria-hidden="true" /> ML model
        </button>
      </div>
      {!available && <span className="fpl-meta fpl-model-switch-note">No ML predictions for this gameweek yet.</span>}
    </div>
  );
}
