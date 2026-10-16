// Log in / sign up (a pop-up over the current screen) and the saved-teams list.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Bookmark, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import { TERMS_PATH } from '../lib/terms.js';

/* ----------------------------------------------------------------------------
   ACCOUNTS: LOGIN / REGISTER + SAVED TEAMS
   Username + password, with an optional email (confirmed with an emailed
   code; used for password reset codes, and to log in in place of the
   username). Matches this app's low-stakes, convenience-only use
   case (saving a team ID / squad, nothing sensitive).
---------------------------------------------------------------------------- */
const labelStyle = { display: 'block', fontSize: '0.62rem', color: 'var(--ink-dim)', marginBottom: 6, letterSpacing: '0.04em' };
const inputStyle = { width: '100%', background: 'var(--panel-alt)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 4, padding: '10px 10px', fontSize: '0.9rem', marginBottom: 14 };
const hintStyle = { fontSize: '0.66rem', color: 'var(--ink-dim)', margin: '-10px 0 14px' };
const linkStyle = { width: '100%', textAlign: 'center', background: 'none', border: 'none', color: 'var(--blue)', padding: '14px 0 0', cursor: 'pointer', fontSize: '0.78rem' };

const TITLES = { login: 'Log in', register: 'Create an account', email: 'Your email', forgot: 'Reset your password', reset: 'Choose a new password', verify: 'Confirm your email' };
const SUBMIT_LABELS = { login: 'Log in', register: 'Create account', email: 'Save email', forgot: 'Email me a code', reset: 'Save new password', verify: 'Confirm email' };
const codeInputStyle = { ...inputStyle, fontSize: '1.4rem', letterSpacing: '0.4em', textAlign: 'center', padding: '12px 10px' };

// The six digits of an emailed code, as typed or pasted.
const cleanCode = value => value.replace(/\D/g, '').slice(0, 6);

// mode: 'login' | 'register' | 'email' (add or change the logged-in
// user's email) | 'forgot' (ask for a reset code) | 'reset' (the emailed
// code and a new password) | 'verify' (the code that confirms the
// account's email). Uses a native <dialog> opened with showModal(), which
// gives focus trapping, Escape-to-close and an inert page behind it.
export function AuthDialog({ initialMode = 'login', currentEmail = '', onSubmit, onSetEmail, onForgot, onReset, onVerify, onResendVerify, onClearError, error, loading, onClose }) {
  const dialogRef = useRef(null);
  const pressedOnBackdropRef = useRef(false);
  const [mode, setModeState] = useState(initialMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState(initialMode === 'email' ? currentEmail : '');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [notice, setNotice] = useState(''); // "we've sent a code to …"

  function focusFirstField() {
    setTimeout(() => {
      const field = dialogRef.current && dialogRef.current.querySelector('input');
      if (field) field.focus();
    }, 0);
  }

  function setMode(next, keepNotice = '') {
    setNotice(keepNotice);
    onClearError();
    setCode('');
    setModeState(next);
    focusFirstField();
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
      if (message) { setPassword(''); setMode('reset', message); }
    } else if (mode === 'reset') onReset({ identifier, code, password });
    else if (mode === 'verify') onVerify(code);
    else onSubmit(mode, { username, password, email: mode === 'register' ? email : undefined, acceptTerms: mode === 'register' ? acceptTerms : undefined });
  }

  async function resendVerify() {
    const message = await onResendVerify();
    if (message) setNotice(message);
  }

  const canSubmit = {
    email: email.trim() !== '',
    forgot: identifier.trim() !== '',
    reset: code.length === 6 && password !== '',
    verify: code.length === 6,
    register: Boolean(username && password && acceptTerms),
  }[mode] ?? Boolean(username && password);

  const codeField = (
    <>
      <label htmlFor="auth-code" className="fpl-mono" style={labelStyle}>6-DIGIT CODE</label>
      <input
        id="auth-code"
        className="fpl-mono"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        value={code}
        onChange={e => setCode(cleanCode(e.target.value))}
        style={codeInputStyle}
      />
    </>
  );

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
            email: currentEmail ? 'Change the email on your account. We’ll send a code to confirm it.' : 'Add an email address to your account. We’ll send a code to confirm it.',
            forgot: "Enter your username or email and we'll email you a 6-digit code.",
            reset: 'Enter the code from the email and pick a new password.',
            verify: currentEmail ? `Enter the 6-digit code we emailed to ${currentEmail}.` : 'Enter the 6-digit code we emailed you.',
          }[mode] || "Save your Team ID(s) or squads so you don't have to re-enter them."}
        </div>

        {notice && (
          <div role="status" className="fpl-block" style={{ padding: 12, fontSize: '0.85rem', lineHeight: 1.5, marginBottom: 16 }}>{notice}</div>
        )}

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

          {(mode === 'reset' || mode === 'verify') && codeField}

          {mode === 'reset' && (
            <>
              <label htmlFor="auth-new-password" className="fpl-mono" style={labelStyle}>NEW PASSWORD</label>
              <input
                id="auth-new-password"
                type="password"
                className="fpl-mono"
                autoComplete="new-password"
                aria-describedby="auth-new-password-hint"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={inputStyle}
              />
              <div id="auth-new-password-hint" className="fpl-mono" style={hintStyle}>At least 6 characters, including a number.</div>
            </>
          )}

          {(mode === 'login' || mode === 'register') && (
            <>
              <label htmlFor="auth-username" className="fpl-mono" style={labelStyle}>{mode === 'login' ? 'USERNAME OR EMAIL' : 'USERNAME'}</label>
              <input
                id="auth-username"
                className="fpl-mono"
                autoComplete="username"
                aria-describedby={mode === 'register' ? 'auth-username-hint' : undefined}
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                style={inputStyle}
              />
              {mode === 'register' && (
                <div id="auth-username-hint" className="fpl-mono" style={hintStyle}>6-20 characters: letters, numbers, underscores.</div>
              )}
              <label htmlFor="auth-password" className="fpl-mono" style={labelStyle}>PASSWORD</label>
              <input
                id="auth-password"
                type="password"
                className="fpl-mono"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                aria-describedby={mode === 'login' ? undefined : 'auth-password-hint'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={inputStyle}
              />
              {mode === 'register' && (
                <div id="auth-password-hint" className="fpl-mono" style={hintStyle}>At least 6 characters, including a number.</div>
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
                EMAIL{mode === 'register' && <span style={{ textTransform: 'none' }}> (optional, for password resets)</span>}
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

          {mode === 'register' && (
            <label className="fpl-terms-check">
              <input type="checkbox" checked={acceptTerms} onChange={e => setAcceptTerms(e.target.checked)} />
              <span>I agree to the <a href={TERMS_PATH} target="_blank" rel="noopener">Terms and privacy notice</a>.</span>
            </label>
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
            No code, or it expired? Send a new one
          </button>
        )}
        {mode === 'verify' && (
          <>
            <button type="button" onClick={resendVerify} disabled={loading} className="fpl-mono" style={linkStyle}>
              Didn’t get it? Send a new code
            </button>
            <button type="button" onClick={onClose} className="fpl-mono" style={{ ...linkStyle, color: 'var(--ink-dim)', paddingTop: 8 }}>
              Do it later
            </button>
          </>
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
