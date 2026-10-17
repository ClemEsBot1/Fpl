// Log in / sign up (a pop-up over the current screen) and the saved-teams list.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, Bell, Bookmark, Check, ChevronRight, FileText, KeyRound, Link2, Loader2, LogOut, Mail, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react';
import { TERMS_PATH } from '../lib/terms.js';
import { fetchFplJson } from '../lib/fplClient.js';
import { careerStats } from '../lib/career.js';

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

const TITLES = { login: 'Log in', register: 'Create an account', email: 'Your email', forgot: 'Reset your password', reset: 'Choose a new password', verify: 'Confirm your email', delete: 'Delete your account', backup: 'Add a backup login', password: 'Change your password' };
const SUBMIT_LABELS = { login: 'Log in', register: 'Create account', email: 'Save email', forgot: 'Email me a code', reset: 'Save new password', verify: 'Confirm email', delete: 'Delete my account', backup: 'Save username and password', password: 'Save new password' };

// Google's "G", in its own colours (its sign-in branding rules).
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

// Whether "Continue with Google" is set up on this site (asked once).
let googleEnabledPromise = null;
function useGoogleEnabled() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!googleEnabledPromise) {
      googleEnabledPromise = fetch('/api/auth?google=config').then(r => (r.ok ? r.json() : null)).then(d => !!(d && d.enabled)).catch(() => false);
    }
    let live = true;
    googleEnabledPromise.then(v => { if (live) setEnabled(v); });
    return () => { live = false; };
  }, []);
  return enabled;
}
const codeInputStyle = { ...inputStyle, fontSize: '1.4rem', letterSpacing: '0.4em', textAlign: 'center', padding: '12px 10px' };

// The six digits of an emailed code, as typed or pasted.
const cleanCode = value => value.replace(/\D/g, '').slice(0, 6);

// mode: 'login' | 'register' | 'email' (add or change the logged-in
// user's email) | 'forgot' (ask for a reset code) | 'reset' (the emailed
// code and a new password) | 'verify' (the code that confirms the
// account's email) | 'delete' | 'backup' (a username and password for an
// account made with Google) | 'password' (change it). Uses a native
// <dialog> opened with showModal(), which gives focus trapping,
// Escape-to-close and an inert page behind it.
export function AuthDialog({ initialMode = 'login', initialNotice = '', currentEmail = '', currentUsername = '', hasPassword = true, onSubmit, onSetEmail, onForgot, onReset, onVerify, onResendVerify, onDelete, onSetCredentials, onChangePassword, onClearError, error, loading, onClose }) {
  const dialogRef = useRef(null);
  const pressedOnBackdropRef = useRef(false);
  const [mode, setModeState] = useState(initialMode);
  const [username, setUsername] = useState(initialMode === 'backup' ? currentUsername : '');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmWord, setConfirmWord] = useState('');
  const googleEnabled = useGoogleEnabled();
  const [email, setEmail] = useState(initialMode === 'email' ? currentEmail : '');
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [notice, setNotice] = useState(initialNotice); // "we've sent a code to …"

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
    else if (mode === 'delete') onDelete({ password, confirm: confirmWord });
    else if (mode === 'backup') onSetCredentials({ username, password });
    else if (mode === 'password') onChangePassword({ currentPassword: password, password: newPassword });
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
    delete: confirmWord.trim().toLowerCase() === 'delete' && (!hasPassword || password !== ''),
    backup: Boolean(username.trim() && password),
    password: Boolean(password && newPassword),
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
            delete: 'This deletes your account, saved teams, email and settings straight away. It can’t be undone.',
            backup: 'You’re signed in with Google. Pick a username and password too, so you can still log in without it. You can skip this.',
            password: 'Enter your current password, then a new one. Other devices will be signed out.',
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

          {mode === 'delete' && (
            <>
              {hasPassword && (
                <>
                  <label htmlFor="auth-delete-password" className="fpl-mono" style={labelStyle}>PASSWORD</label>
                  <input
                    id="auth-delete-password"
                    type="password"
                    className="fpl-mono"
                    autoComplete="current-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    style={inputStyle}
                  />
                </>
              )}
              <label htmlFor="auth-delete-confirm" className="fpl-mono" style={labelStyle}>TYPE DELETE TO CONFIRM</label>
              <input
                id="auth-delete-confirm"
                className="fpl-mono"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder="DELETE"
                value={confirmWord}
                onChange={e => setConfirmWord(e.target.value)}
                style={inputStyle}
              />
            </>
          )}

          {mode === 'backup' && (
            <>
              <label htmlFor="auth-backup-username" className="fpl-mono" style={labelStyle}>USERNAME</label>
              <input
                id="auth-backup-username"
                className="fpl-mono"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                aria-describedby="auth-backup-username-hint"
                value={username}
                onChange={e => setUsername(e.target.value)}
                style={inputStyle}
              />
              <div id="auth-backup-username-hint" className="fpl-mono" style={hintStyle}>Keep this one or pick your own: 6-20 letters, numbers, underscores.</div>
              <label htmlFor="auth-backup-password" className="fpl-mono" style={labelStyle}>PASSWORD</label>
              <input
                id="auth-backup-password"
                type="password"
                className="fpl-mono"
                autoComplete="new-password"
                aria-describedby="auth-backup-password-hint"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={inputStyle}
              />
              <div id="auth-backup-password-hint" className="fpl-mono" style={hintStyle}>At least 6 characters, including a number.</div>
            </>
          )}

          {mode === 'password' && (
            <>
              <label htmlFor="auth-current-password" className="fpl-mono" style={labelStyle}>CURRENT PASSWORD</label>
              <input id="auth-current-password" type="password" className="fpl-mono" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />
              <label htmlFor="auth-change-password" className="fpl-mono" style={labelStyle}>NEW PASSWORD</label>
              <input id="auth-change-password" type="password" className="fpl-mono" autoComplete="new-password" aria-describedby="auth-change-password-hint" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={inputStyle} />
              <div id="auth-change-password-hint" className="fpl-mono" style={hintStyle}>At least 6 characters, including a number.</div>
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

          <button type="submit" disabled={loading || !canSubmit} className={`fpl-btn ${mode === 'delete' ? 'fpl-btn-danger' : 'fpl-btn-solid'}`} style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, opacity: loading ? 0.6 : 1 }}>
            {loading ? <Loader2 size={16} className="fpl-spin" /> : SUBMIT_LABELS[mode]}
          </button>
        </form>

        {(mode === 'login' || mode === 'register') && googleEnabled && (
          <>
            <div className="fpl-auth-or fpl-mono" aria-hidden="true"><span>or</span></div>
            <a
              className={`fpl-btn fpl-google-btn${mode === 'register' && !acceptTerms ? ' is-disabled' : ''}`}
              href={`/auth/google${mode === 'register' ? '?terms=1' : ''}`}
              aria-disabled={mode === 'register' && !acceptTerms ? 'true' : undefined}
              onClick={e => { if (mode === 'register' && !acceptTerms) { e.preventDefault(); setNotice('Tick the box to agree to the Terms first.'); } }}
            >
              <GoogleMark /> {mode === 'register' ? 'Sign up with Google' : 'Continue with Google'}
            </a>
          </>
        )}
        {mode === 'backup' && (
          <button type="button" onClick={onClose} className="fpl-mono" style={{ ...linkStyle, color: 'var(--ink-dim)' }}>
            Skip for now
          </button>
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
            No code, or it expired? Send a new one
          </button>
        )}
        {mode === 'delete' && (
          <button type="button" onClick={onClose} className="fpl-mono" style={{ ...linkStyle, color: 'var(--ink-dim)' }}>
            Keep my account
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

/* ----------------------------------------------------------------------------
   PROFILE: the account's page. FPL career stats for a Team ID (theirs, or
   any saved one) and every account setting in one place.
---------------------------------------------------------------------------- */
const fmtInt = n => (n === null || n === undefined ? '–' : Number(n).toLocaleString('en-GB'));
const fmtMoney = n => (n === null || n === undefined ? '–' : `£${n.toFixed(1)}m`);
const memberSince = iso => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : null;
};

function StatTile({ label, value, sub }) {
  return (
    <div className="fpl-profile-stat">
      <div className="fpl-mono fpl-profile-stat-label">{label}</div>
      <div className="fpl-profile-stat-value">{value}</div>
      {sub && <div className="fpl-mono fpl-profile-stat-sub">{sub}</div>}
    </div>
  );
}

function SettingRow({ icon: Icon, title, detail, action, onAction, danger = false, href }) {
  const body = (
    <>
      <Icon size={18} aria-hidden="true" className="fpl-profile-row-icon" />
      <span className="fpl-profile-row-text">
        <span className="fpl-profile-row-title">{title}</span>
        {detail && <span className="fpl-mono fpl-profile-row-detail">{detail}</span>}
      </span>
      {action && <span className="fpl-mono fpl-profile-row-action">{action}</span>}
      {(href || onAction) && <ChevronRight size={16} aria-hidden="true" className="fpl-profile-row-chevron" />}
    </>
  );
  const className = `fpl-profile-row${danger ? ' is-danger' : ''}`;
  if (!href && !onAction) return <div className={`${className} is-static`}>{body}</div>;
  return href
    ? <a className={className} href={href}>{body}</a>
    : <button type="button" className={className} onClick={onAction}>{body}</button>;
}

export function ProfileScreen({ session, notice = '', onDismissNotice, savedTeams = [], homeTeamId, onPickTeam, onOpenDialog, onMyTeams, onLogout }) {
  const googleEnabled = useGoogleEnabled();
  const teamIds = [...new Set([homeTeamId, session.digestTeamId, ...savedTeams.filter(t => t.type === 'teamId').map(t => t.teamId)].filter(Boolean).map(String))];
  const [teamId, setTeamId] = useState(teamIds[0] || '');
  const [typed, setTyped] = useState('');
  // The answer for one team; another team's (or none yet) reads as loading.
  const [loaded, setLoaded] = useState({ teamId: null, status: 'idle', data: null });
  const career = !teamId ? { status: 'idle', data: null } : loaded.teamId === teamId ? loaded : { status: 'loading', data: null };

  useEffect(() => {
    if (!teamId) return undefined;
    let live = true;
    Promise.all([fetchFplJson(`entry/${teamId}/`), fetchFplJson(`entry/${teamId}/history/`)])
      .then(([entry, history]) => { if (live) setLoaded({ teamId, status: 'ready', data: careerStats(history, entry) }); })
      .catch(() => { if (live) setLoaded({ teamId, status: 'error', data: null }); });
    return () => { live = false; };
  }, [teamId]);

  const c = career.data;
  const since = memberSince(session.createdAt);
  const initial = (session.username || '?').slice(0, 1).toUpperCase();

  function showTyped(e) {
    e.preventDefault();
    const id = typed.replace(/\D/g, '');
    if (!id) return;
    setTeamId(id);
    onPickTeam(id);
  }

  return (
    <div className="fpl-screen fpl-profile">
      {notice && (
        <div role="status" className="fpl-verify-bar" style={{ margin: 0 }}>
          <span>{notice}</span>
          <button type="button" className="fpl-verify-bar-x" aria-label="Dismiss" onClick={onDismissNotice}><X size={16} aria-hidden="true" /></button>
        </div>
      )}
      <section className="fpl-profile-hero" aria-label="Your account">
        <div className="fpl-profile-avatar" aria-hidden="true">{initial}</div>
        <div style={{ minWidth: 0 }}>
          <h1 className="fpl-display fpl-profile-name">{session.username}</h1>
          <div className="fpl-mono fpl-profile-meta">
            {since ? `Member since ${since}` : 'FPL Checker member'}
            {c && c.managerName ? ` · ${c.managerName}` : ''}
          </div>
          <div className="fpl-profile-badges">
            {session.google && <span className="fpl-profile-badge"><GoogleMark /> Google</span>}
            {session.email && session.emailVerified && <span className="fpl-profile-badge"><Check size={12} aria-hidden="true" /> Email confirmed</span>}
            {session.admin && <span className="fpl-profile-badge">Admin</span>}
          </div>
        </div>
      </section>

      <section aria-labelledby="career-title" className="fpl-profile-section">
        <div className="fpl-profile-section-head">
          <h2 id="career-title" className="fpl-display fpl-profile-h2">FPL career</h2>
          {teamIds.length > 1 && (
            <select className="fpl-input fpl-profile-team-select" aria-label="Team" value={teamId} onChange={e => { setTeamId(e.target.value); onPickTeam(e.target.value); }}>
              {teamIds.map(id => <option key={id} value={id}>Team {id}</option>)}
            </select>
          )}
        </div>

        {!teamId && (
          <form onSubmit={showTyped} className="fpl-block" style={{ padding: 14 }}>
            <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: 'var(--ink-dim)', lineHeight: 1.5 }}>Add your FPL Team ID to see every season you’ve played, your best rank and this season so far.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="fpl-input" style={{ flex: 1, minWidth: 0 }} inputMode="numeric" placeholder="e.g. 1234567" aria-label="FPL Team ID" value={typed} onChange={e => setTyped(e.target.value.replace(/\D/g, ''))} />
              <button type="submit" className="fpl-btn fpl-btn-solid" disabled={!typed}>Show</button>
            </div>
          </form>
        )}

        {career.status === 'loading' && (
          <div className="fpl-profile-stats" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="fpl-profile-stat fpl-skel" />)}
          </div>
        )}
        {career.status === 'error' && (
          <div className="fpl-block" role="alert" style={{ padding: 14, fontSize: '0.85rem' }}>Couldn’t load that team from FPL just now. Check the Team ID, or try again in a minute.</div>
        )}

        {c && (
          <>
            {c.teamName && <div className="fpl-mono fpl-profile-team-name">{c.teamName}</div>}
            <div className="fpl-profile-stats">
              <StatTile label="SEASONS" value={fmtInt(c.seasons)} sub={c.top10kFinishes ? `${c.top10kFinishes} top-10k finish${c.top10kFinishes > 1 ? 'es' : ''}` : null} />
              <StatTile label="BEST FINISH" value={c.bestRank ? fmtInt(c.bestRank) : '–'} sub={c.bestRank ? 'overall rank' : 'no finished season yet'} />
              <StatTile label="BEST SEASON" value={c.bestSeason ? `${fmtInt(c.bestSeason.points)} pts` : '–'} sub={c.bestSeason ? c.bestSeason.season : null} />
              <StatTile label="AVG SEASON" value={c.averageSeasonPoints ? `${fmtInt(c.averageSeasonPoints)} pts` : '–'} />
              {c.thisSeason && (
                <>
                  <StatTile label="THIS SEASON" value={`${fmtInt(c.thisSeason.points)} pts`} sub={`${c.thisSeason.gameweeks} GWs · avg ${c.thisSeason.averageGw}`} />
                  <StatTile label="OVERALL RANK" value={fmtInt(c.thisSeason.overallRank)} />
                  <StatTile label="BEST GAMEWEEK" value={`${c.thisSeason.bestGw.points} pts`} sub={`GW${c.thisSeason.bestGw.gw}`} />
                  <StatTile label="TRANSFERS" value={fmtInt(c.thisSeason.transfers)} sub={c.thisSeason.hitPoints ? `−${c.thisSeason.hitPoints} pts in hits` : 'no hits taken'} />
                  <StatTile label="BENCH POINTS" value={fmtInt(c.thisSeason.benchPoints)} sub="left on the bench" />
                  <StatTile label="TEAM VALUE" value={fmtMoney(c.thisSeason.value)} sub={c.thisSeason.bank !== null ? `${fmtMoney(c.thisSeason.bank)} in the bank` : null} />
                </>
              )}
            </div>

            {c.chips.length > 0 && (
              <div className="fpl-profile-chips" aria-label="Chips played this season">
                {c.chips.map(chip => <span key={`${chip.name}-${chip.gw}`} className="fpl-profile-chip">{chip.name} <span className="fpl-mono">GW{chip.gw}</span></span>)}
              </div>
            )}

            {c.past.length > 0 && (
              <div className="fpl-block fpl-profile-seasons">
                <div className="fpl-mono fpl-profile-seasons-head"><span>SEASON</span><span>POINTS</span><span>RANK</span></div>
                {c.past.map(s => (
                  <div key={s.season} className="fpl-profile-season">
                    <span>{s.season}</span>
                    <span className="fpl-mono">{fmtInt(s.points)}</span>
                    <span className="fpl-mono">{fmtInt(s.rank)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="settings-title" className="fpl-profile-section">
        <h2 id="settings-title" className="fpl-display fpl-profile-h2">Settings</h2>
        <div className="fpl-block fpl-profile-rows">
          <SettingRow icon={Bookmark} title="Saved teams" detail={`${savedTeams.length} saved`} onAction={onMyTeams} />
          <SettingRow
            icon={Mail}
            title="Email"
            detail={session.email ? `${session.email}${session.emailVerified ? '' : ' · not confirmed'}` : 'None: needed for password resets and deadline emails'}
            action={session.email ? 'Change' : 'Add'}
            onAction={() => onOpenDialog('email')}
          />
          {session.email && !session.emailVerified && (
            <SettingRow icon={ShieldCheck} title="Confirm your email" detail="Enter the 6-digit code we emailed you" action="Enter code" onAction={() => onOpenDialog('verify')} />
          )}
          {session.hasPassword
            ? <SettingRow icon={KeyRound} title="Password" detail="Change it; other devices are signed out" action="Change" onAction={() => onOpenDialog('password')} />
            : <SettingRow icon={KeyRound} title="Backup login" detail="Add a username and password, in case you can’t use Google" action="Add" onAction={() => onOpenDialog('backup')} />}
          {googleEnabled && (
            session.google
              ? <SettingRow icon={Link2} title="Google" detail="Connected: you can sign in with Google" />
              : <SettingRow icon={Link2} title="Google" detail="Connect to sign in with one tap" action="Connect" href="/auth/google?link=1" />
          )}
          <SettingRow icon={Bell} title="Deadline emails" detail={session.digestTeamId ? `On for team ${session.digestTeamId}` : 'Off: turn on from your team’s page'} onAction={onMyTeams} />
          <SettingRow icon={FileText} title="Terms and privacy" href={TERMS_PATH} />
          <SettingRow icon={LogOut} title="Log out" onAction={onLogout} />
        </div>

        <div className="fpl-block fpl-profile-rows" style={{ marginTop: 14 }}>
          <SettingRow icon={Trash2} title="Delete account" detail="Removes your account and saved teams for good" danger onAction={() => onOpenDialog('delete')} />
        </div>
      </section>
    </div>
  );
}
