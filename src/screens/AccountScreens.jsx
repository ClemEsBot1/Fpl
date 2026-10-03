// Log in / sign up and the saved-teams list.
import { useState } from 'react';
import { AlertTriangle, ArrowRight, Bookmark, Loader2, RotateCcw, Trash2 } from 'lucide-react';

/* ----------------------------------------------------------------------------
   ACCOUNTS: LOGIN / REGISTER + SAVED TEAMS
   Username + password only, no email — matches this app's low-stakes,
   convenience-only use case (saving a team ID / squad, nothing sensitive).
---------------------------------------------------------------------------- */
export function AuthScreen({ onSubmit, error, loading, onCancel }) {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(mode, username, password);
  }

  return (
    <div style={{ padding: '32px 16px 60px', maxWidth: 380, margin: '0 auto' }}>
      <h1 className="fpl-display" style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: 4, textAlign: 'center' }}>
        {mode === 'login' ? 'Log in' : 'Create an account'}
      </h1>
      <div className="fpl-mono" style={{ fontSize: '0.72rem', color: 'var(--ink-dim)', textAlign: 'center', marginBottom: 24 }}>
        Save your Team ID(s) or squads so you don't have to re-enter them.
      </div>

      <form onSubmit={handleSubmit}>
        <label htmlFor="auth-username" className="fpl-mono" style={{ display: 'block', fontSize: '0.62rem', color: 'var(--ink-dim)', marginBottom: 6, letterSpacing: '0.04em' }}>USERNAME</label>
        <input
          id="auth-username"
          className="fpl-mono"
          autoComplete="username"
          value={username}
          onChange={e => setUsername(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          style={{ width: '100%', background: 'var(--panel-alt)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 4, padding: '10px 10px', fontSize: '0.9rem', marginBottom: 14 }}
        />
        <label htmlFor="auth-password" className="fpl-mono" style={{ display: 'block', fontSize: '0.62rem', color: 'var(--ink-dim)', marginBottom: 6, letterSpacing: '0.04em' }}>PASSWORD</label>
        <input
          id="auth-password"
          type="password"
          className="fpl-mono"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          minLength={mode === 'login' ? undefined : 8}
          aria-describedby={mode === 'login' ? undefined : 'auth-password-hint'}
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ width: '100%', background: 'var(--panel-alt)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 4, padding: '10px 10px', fontSize: '0.9rem', marginBottom: mode === 'login' ? 14 : 4 }}
        />
        {mode !== 'login' && (
          <div id="auth-password-hint" className="fpl-mono" style={{ fontSize: '0.66rem', color: 'var(--ink-dim)', marginBottom: 14 }}>At least 8 characters.</div>
        )}

        {error && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 14, color: 'var(--red)', fontSize: '0.8rem' }}>
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {error}
          </div>
        )}

        <button type="submit" disabled={loading || !username || !password} className="fpl-btn fpl-btn-solid" style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, opacity: loading ? 0.6 : 1 }}>
          {loading ? <Loader2 size={16} className="fpl-spin" /> : (mode === 'login' ? 'Log in' : 'Create account')}
        </button>
      </form>

      <button
        onClick={() => setMode(m => (m === 'login' ? 'register' : 'login'))}
        className="fpl-mono"
        style={{ width: '100%', textAlign: 'center', background: 'none', border: 'none', color: 'var(--blue)', padding: '14px 0 0', cursor: 'pointer', fontSize: '0.78rem' }}
      >
        {mode === 'login' ? "Don't have an account? Create one" : 'Already have an account? Log in'}
      </button>

      <button
        onClick={onCancel}
        className="fpl-mono"
        style={{ width: '100%', textAlign: 'center', background: 'none', border: 'none', color: 'var(--ink-dim)', padding: '10px 0 0', cursor: 'pointer', fontSize: '0.78rem' }}
      >
        Cancel
      </button>
    </div>
  );
}

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
