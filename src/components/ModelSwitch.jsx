// Admins only: which predictions the squads on screen use, the blend the
// app runs on, or the formula's or the ML model's alone (see
// withPredictionSource).
import { Blend, Calculator, Sparkles } from 'lucide-react';

const OPTIONS = [
  { id: 'blend', label: 'Blend', Icon: Blend, needsModel: true },
  { id: 'formula', label: 'Formula', Icon: Calculator, needsModel: false },
  { id: 'ml', label: 'ML model', Icon: Sparkles, needsModel: true },
];

export function ModelSwitch({ choice, available, onChange }) {
  return (
    <div className="fpl-model-switch">
      <span className="fpl-mono fpl-model-switch-label" id="model-switch-label">ADMIN · PREDICTIONS</span>
      <div className="fpl-seg" role="group" aria-labelledby="model-switch-label">
        {OPTIONS.map(({ id, label, Icon, needsModel }) => (
          <button key={id} type="button" className={choice === id ? 'is-on' : ''} aria-pressed={choice === id} disabled={needsModel && !available && choice !== id} onClick={() => onChange(id)}>
            <Icon size={14} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      {!available && <span className="fpl-meta fpl-model-switch-note">No ML predictions for this gameweek yet, so every view is the formula's.</span>}
    </div>
  );
}
