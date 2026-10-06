// Log in / sign up (a pop-up over the current screen) and the saved-teams list.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Bookmark, Loader2, RotateCcw, Trash2, X } from 'lucide-react';

/* ----------------------------------------------------------------------------
   ACCOUNTS: LOGIN / REGISTER + SAVED TEAMS
   Username + password, with an optional email (used for password resets,
   and to log in in place of the username). Matches this app's low-stakes, convenience-only use
   case (saving a team ID / squad, nothing sensitive).
---------------------------------------------------------------------------- */
const labelStyle = { display: 'block', fontSize: '0.62rem', color: 'var(--ink-dim)', marginBottom: 6, letterSpacing: '0.04em' };
const inputStyle = { width: '100%', background: 'var(--panel-alt)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 4, padding: '10px 10px', fontSize: '0.9rem', marginBottom: 14 };
const hintStyle = { fontSize: '0.66rem', color: 'var(--ink-dim)', margin: '-10px 0 14px' };
const linkStyle = { width: '100%', textAlign: 'center', background: 'none', border: 'none', color: 'var(--blue)', padding: '14px 0 0', cursor: 'pointer', fontSize: '0.78rem' };

const TITLES = { login: 'Log in', register: 'Create an account', email: 'Your email', forgot: 'Reset your password', reset: 'Choose a new password' };
const SUBMIT_LABELS = { login: 'Log in', register: 'Create account', email: 'Save email', forgot: 'Send reset link', reset: 'Save new password' };

// mode: 'login' | 'register' | 'email' (add or change the logged-in
// user's email) | 'forgot' (ask for a reset link) | 'reset' (set a new
// password from an emailed link). Uses a native <dialog> opened with
// showModal(), which gives focus trapping, Escape-to-close and an inert
// page behind it.
export function AuthDialog({ initialMode = 'login', currentEmail = '', onSubmit, onSetEmail, onForgot, onReset, onClearError, error, loading, onClose }) {
  const dialogRef = useRef(null);
  const pressedOnBackdropRef = useRef(false);
  const [mode, setModeState] = useState(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState(initialMode === 'email' ? currentEmail : '');
  const [identifier, setIdentifier] = useState('');
  const [notice, setNotice] = useState(''); // "check your inbox" after a reset request

  function setMode(next) {
    setNotice('');
    onClearError();
    setModeState(next);
    // Put the cursor in the new form's first field.
    setTimeout(() => {
      const field = dialogRef.current && dialogRef.current.querySelector('input');
      if (field) field.focus();
    }, 0);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    // showModal() focuses the first focusable element (the close button);
    // start in the first field instead.
    const firstField = dialog && dialog.querySelector('input');
    if (firstField) firstField.focus();
    return () => { if (dialog && dialog.open) dialog.close(); };
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (mode === 'email') onSetEmail(email);
    else if (mode === 'forgot') {
      const message = await onForgot(identifier);
      if (message) setNotice(message);
    } else if (mode === 'reset') onReset(password);
    else onSubmit(mode, { username, password, email: mode === 'register' ? email : undefined });
  }

  const canSubmit = {
    email: email.trim() !== '',
    forgot: identifier.trim() !== '',
    reset: password !== '',
  }[mode] ?? Boolean(username && password);

  return (
    <dialog
      ref={dialogRef}
      className="fpl-dialog"
      aria-labelledby="auth-title"
      onCancel={e => { e.preventDefault(); onClose(); }}
      // A click on the dialog element itself (not its contents) is a click
      // on the dimmed backdrop around the card. It has to start there too:
      // selecting text in a field and letting go over the backdrop also
      // ends with a click on it, and shouldn't throw away what was typed.
      onMouseDown={e => { pressedOnBackdropRef.current = e.target === dialogRef.current; }}
      onClick={e => {
        if (e.target === dialogRef.current && pressedOnBackdropRef.current) onClose();
        pressedOnBackdropRef.current = false;
      }}
    >
      <div className="fpl-dialog-card">
        <button type="button" onClick={onClose} aria-label="Close" className="fpl-dialog-close"><X size={18} /></button>
        <h2 id="auth-title" className="fpl-display" style={{ fontSize: '1.3rem', fontWeight: 700, margin: '0 0 4px', textAlign: 'center' }}>
          {TITLES[mode]}
        </h2>
        <div className="fpl-mono" style={{ fontSize: '0.72rem', color: 'var(--ink-dim)', textAlign: 'center', marginBottom: 22 }}>
          {{
            email: currentEmail ? 'Change the email on your account.' : 'Add an email address to your account.',
            forgot: "Enter your username or email and we'll email you a link to choose a new password.",
            reset: 'Pick a new password for your account.',
          }[mode] || "Save your Team ID(s) or squads so you don't have to re-enter them."}
        </div>

        {notice ? (
          <div role="status" className="fpl-block" style={{ padding: 12, fontSize: '0.85rem', lineHeight: 1.5, marginBottom: 4 }}>{notice}</div>
        ) : (
        <form onSubmit={handleSubmit}>
          {mode === 'forgot' && (
            <>
              <label htmlFor="auth-identifier" className="fpl-mono" style={labelStyle}>USERNAME OR EMAIL</label>
              <input
                id="auth-identifier"
                className="fpl-mono"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                style={inputStyle}
              />
            </>
          )}

          {mode === 'reset' && (
            <>
              <label htmlFor="auth-new-password" className="fpl-mono" style={labelStyle}>NEW PASSWORD</label>
              <input
                id="auth-new-password"
                type="password"
                className="fpl-mono"
                autoComplete="new-password"
                minLength={8}
                aria-describedby="auth-new-password-hint"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={inputStyle}
              />
              <div id="auth-new-password-hint" className="fpl-mono" style={hintStyle}>At least 8 characters.</div>
            </>
          )}

          {(mode === 'login' || mode === 'register') && (
            <>
              <label htmlFor="auth-username" className="fpl-mono" style={labelStyle}>{mode === 'login' ? 'USERNAME OR EMAIL' : 'USERNAME'}</label>
              <input
                id="auth-username"
                className="fpl-mono"
                autoComplete="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                style={inputStyle}
              />
              <label htmlFor="auth-password" className="fpl-mono" style={labelStyle}>PASSWORD</label>
              <input
                id="auth-password"
                type="password"
                className="fpl-mono"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={mode === 'login' ? undefined : 8}
                aria-describedby={mode === 'login' ? undefined : 'auth-password-hint'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={inputStyle}
              />
              {mode === 'register' && (
                <div id="auth-password-hint" className="fpl-mono" style={hintStyle}>At least 8 characters.</div>
              )}
              {mode === 'login' && (
                <button type="button" onClick={() => setMode('forgot')} className="fpl-mono" style={{ ...linkStyle, width: 'auto', display: 'block', margin: '-6px 0 14px auto', padding: 0, fontSize: '0.7rem' }}>
                  Forgot password?
                </button>
              )}
            </>
          )}

          {(mode === 'register' || mode === 'email') && (
            <>
              <label htmlFor="auth-email" className="fpl-mono" style={labelStyle}>
                EMAIL{mode === 'register' && <span style={{ textTransform: 'none' }}> (optional)</span>}
              </label>
              <input
                id="auth-email"
                type="email"
                className="fpl-mono"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                style={inputStyle}
              />
            </>
          )}

          {error && (
            <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 14, color: 'var(--red)', fontSize: '0.8rem' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {error}
            </div>
          )}

          <button type="submit" disabled={loading || !canSubmit} className="fpl-btn fpl-btn-solid" style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, opacity: loading ? 0.6 : 1 }}>
            {loading ? <Loader2 size={16} className="fpl-spin" /> : SUBMIT_LABELS[mode]}
          </button>
        </form>
        )}

        {mode === 'email' && currentEmail && (
          <button type="button" onClick={() => onSetEmail('')} disabled={loading} className="fpl-mono" style={{ ...linkStyle, color: 'var(--ink-dim)' }}>
            Remove email
          </button>
        )}
        {(mode === 'login' || mode === 'register') && (
          <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="fpl-mono" style={linkStyle}>
            {mode === 'login' ? "Don't have an account? Create one" : 'Already have an account? Log in'}
          </button>
        )}
        {mode === 'forgot' && (
          <button type="button" onClick={() => setMode('login')} className="fpl-mono" style={linkStyle}>
            Back to log in
          </button>
        )}
        {mode === 'reset' && (
          <button type="button" onClick={() => setMode('forgot')} className="fpl-mono" style={linkStyle}>
            Link expired? Send me a new one
          </button>
        )}
      </div>
    </dialog>
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
