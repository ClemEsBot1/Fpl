// Log in / sign up and everything else about the account that happens in a
// pop-up over the current screen.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { TERMS_PATH } from '../lib/terms.js';
import { useGoogleEnabled } from '../lib/googleEnabled.js';
import { GoogleMark } from '../components/GoogleMark.jsx';
import { t } from '../lib/i18n.js';
import { tr } from '../lib/i18nRich.jsx';

/* ----------------------------------------------------------------------------
   ACCOUNTS: LOGIN / REGISTER
   Username + password, with an optional email (confirmed with an emailed
   code; used for password reset codes, and to log in in place of the
   username). Matches this app's low-stakes, convenience-only use
   case (saving a team ID / squad, nothing sensitive).
---------------------------------------------------------------------------- */
const labelStyle = { display: 'block', textTransform: 'uppercase', fontSize: '0.62rem', color: 'var(--ink-dim)', marginBottom: 6, letterSpacing: '0.04em' };
const inputStyle = { width: '100%', background: 'var(--panel-alt)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 4, padding: '10px 10px', fontSize: '0.9rem', marginBottom: 14 };
const hintStyle = { fontSize: '0.66rem', color: 'var(--ink-dim)', margin: '-10px 0 14px' };
const linkStyle = { width: '100%', textAlign: 'center', background: 'none', border: 'none', color: 'var(--blue)', padding: '14px 0 0', cursor: 'pointer', fontSize: '0.78rem' };

const TITLES = { login: t('Log in'), register: t('Create an account'), email: t('Your email'), forgot: t('Reset your password'), reset: t('Choose a new password'), verify: t('Confirm your email'), delete: t('Delete your account'), backup: t('Add a backup login'), password: t('Change your password'), feedback: t('Send feedback') };
const SUBMIT_LABELS = { login: t('Log in'), register: t('Create account'), email: t('Save email'), forgot: t('Email me a code'), reset: t('Save new password'), verify: t('Confirm email'), delete: t('Delete my account'), backup: t('Save username and password'), password: t('Save new password'), feedback: t('Send') };

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
export function AuthDialog({ initialMode = 'login', initialNotice = '', currentEmail = '', currentUsername = '', hasPassword = true, onSendFeedback, onSubmit, onSetEmail, onForgot, onReset, onVerify, onResendVerify, onDelete, onSetCredentials, onChangePassword, onClearError, error, loading, onClose }) {
  const dialogRef = useRef(null);
  const pressedOnBackdropRef = useRef(false);
  const [mode, setModeState] = useState(initialMode);
  const [username, setUsername] = useState(initialMode === 'backup' ? currentUsername : '');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmWord, setConfirmWord] = useState('');
  const googleEnabled = useGoogleEnabled();
  const [email, setEmail] = useState(initialMode === 'email' || initialMode === 'feedback' ? currentEmail : '');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [notice, setNotice] = useState(initialNotice); // "we've sent a code to …"

  function focusFirstField() {
    setTimeout(() => {
      const field = dialogRef.current && dialogRef.current.querySelector('textarea, input');
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
    const firstField = dialog && dialog.querySelector('textarea, input');
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
    else if (mode === 'feedback') { if (await onSendFeedback({ text: message, email })) setSent(true); }
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
    feedback: message.trim() !== '',
    register: Boolean(username && password && acceptTerms),
  }[mode] ?? Boolean(username && password);

  const codeField = (
    <>
      <label htmlFor="auth-code" className="fpl-mono" style={labelStyle}>{t('6-digit code')}</label>
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
        <button type="button" onClick={onClose} aria-label={t('Close')} className="fpl-dialog-close"><X size={18} /></button>
        <h2 id="auth-title" className="fpl-display" style={{ fontSize: '1.3rem', fontWeight: 700, margin: '0 0 4px', textAlign: 'center' }}>
          {TITLES[mode]}
        </h2>
        <div className="fpl-mono" style={{ fontSize: '0.72rem', color: 'var(--ink-dim)', textAlign: 'center', marginBottom: 22 }}>
          {{
            email: currentEmail ? t('Change the email on your account. We’ll send a code to confirm it.') : t('Add an email address to your account. We’ll send a code to confirm it.'),
            forgot: t('Enter your username or email and we’ll email you a 6-digit code.'),
            reset: t('Enter the code from the email and pick a new password.'),
            verify: currentEmail ? t('Enter the 6-digit code we emailed to {email}.', { email: currentEmail }) : t('Enter the 6-digit code we emailed you.'),
            delete: t('This deletes your account, saved teams, email and settings straight away. It can’t be undone.'),
            backup: t('You’re signed in with Google. Pick a username and password too, so you can still log in without it. You can skip this.'),
            password: t('Enter your current password, then a new one. Other devices will be signed out.'),
            feedback: t('Something broken, confusing or missing? Tell us. Every message is read.'),
          }[mode] || t('Save your Team ID(s) or squads so you don’t have to re-enter them.')}
        </div>

        {notice && (
          <div role="status" className="fpl-block" style={{ padding: 12, fontSize: '0.85rem', lineHeight: 1.5, marginBottom: 16 }}>{notice}</div>
        )}

        <form onSubmit={handleSubmit}>
          {mode === 'forgot' && (
            <>
              <label htmlFor="auth-identifier" className="fpl-mono" style={labelStyle}>{t('Username or email')}</label>
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

          {mode === 'feedback' && sent && (
            <div role="status" className="fpl-block" style={{ padding: 12, fontSize: '0.9rem', lineHeight: 1.5, marginBottom: 16 }}>{t('Thanks! Your message has been sent.')}</div>
          )}
          {mode === 'feedback' && !sent && (
            <>
              <label htmlFor="auth-feedback" className="fpl-mono" style={labelStyle}>{t('Your message')}</label>
              <textarea
                id="auth-feedback"
                rows={5}
                maxLength={2000}
                value={message}
                onChange={e => setMessage(e.target.value)}
                style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical', minHeight: 110 }}
              />
              <label htmlFor="auth-feedback-email" className="fpl-mono" style={labelStyle}>{t('Email')} <span style={{ textTransform: 'none' }}>{t('(optional, if you’d like a reply)')}</span></label>
              <input id="auth-feedback-email" type="email" className="fpl-mono" autoComplete="email" inputMode="email" autoCapitalize="none" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} style={inputStyle} />
            </>
          )}

          {mode === 'delete' && (
            <>
              {hasPassword && (
                <>
                  <label htmlFor="auth-delete-password" className="fpl-mono" style={labelStyle}>{t('Password')}</label>
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
              <label htmlFor="auth-delete-confirm" className="fpl-mono" style={labelStyle}>{t('Type {word} to confirm', { word: 'DELETE' })}</label>
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
              <label htmlFor="auth-backup-username" className="fpl-mono" style={labelStyle}>{t('Username')}</label>
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
              <div id="auth-backup-username-hint" className="fpl-mono" style={hintStyle}>{t('Keep this one or pick your own: 6-20 letters, numbers, underscores.')}</div>
              <label htmlFor="auth-backup-password" className="fpl-mono" style={labelStyle}>{t('Password')}</label>
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
              <div id="auth-backup-password-hint" className="fpl-mono" style={hintStyle}>{t('At least 6 characters, including a number.')}</div>
            </>
          )}

          {mode === 'password' && (
            <>
              <label htmlFor="auth-current-password" className="fpl-mono" style={labelStyle}>{t('Current password')}</label>
              <input id="auth-current-password" type="password" className="fpl-mono" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />
              <label htmlFor="auth-change-password" className="fpl-mono" style={labelStyle}>{t('New password')}</label>
              <input id="auth-change-password" type="password" className="fpl-mono" autoComplete="new-password" aria-describedby="auth-change-password-hint" value={newPassword} onChange={e => setNewPassword(e.target.value)} style={inputStyle} />
              <div id="auth-change-password-hint" className="fpl-mono" style={hintStyle}>{t('At least 6 characters, including a number.')}</div>
            </>
          )}

          {mode === 'reset' && (
            <>
              <label htmlFor="auth-new-password" className="fpl-mono" style={labelStyle}>{t('New password')}</label>
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
              <div id="auth-new-password-hint" className="fpl-mono" style={hintStyle}>{t('At least 6 characters, including a number.')}</div>
            </>
          )}

          {(mode === 'login' || mode === 'register') && (
            <>
              <label htmlFor="auth-username" className="fpl-mono" style={labelStyle}>{mode === 'login' ? t('Username or email') : t('Username')}</label>
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
                <div id="auth-username-hint" className="fpl-mono" style={hintStyle}>{t('6-20 characters: letters, numbers, underscores.')}</div>
              )}
              <label htmlFor="auth-password" className="fpl-mono" style={labelStyle}>{t('Password')}</label>
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
                <div id="auth-password-hint" className="fpl-mono" style={hintStyle}>{t('At least 6 characters, including a number.')}</div>
              )}
              {mode === 'login' && (
                <button type="button" onClick={() => setMode('forgot')} className="fpl-mono" style={{ ...linkStyle, width: 'auto', display: 'block', margin: '-6px 0 14px auto', padding: 0, fontSize: '0.7rem' }}>
                  {t('Forgot password?')}
                </button>
              )}
            </>
          )}

          {(mode === 'register' || mode === 'email') && (
            <>
              <label htmlFor="auth-email" className="fpl-mono" style={labelStyle}>
                {t('Email')}{mode === 'register' && <span style={{ textTransform: 'none' }}> {t('(optional, for password resets)')}</span>}
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
              <span>{tr('I agree to the <a>Terms and privacy notice</a>.', {}, { a: s => <a href={TERMS_PATH} target="_blank" rel="noopener">{s}</a> })}</span>
            </label>
          )}

          {error && (
            <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 14, color: 'var(--red)', fontSize: '0.8rem' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} /> {error}
            </div>
          )}

          {!(mode === 'feedback' && sent) && <button type="submit" disabled={loading || !canSubmit} className={`fpl-btn ${mode === 'delete' ? 'fpl-btn-danger' : 'fpl-btn-solid'}`} style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, opacity: loading ? 0.6 : 1 }}>
            {loading ? <Loader2 size={16} className="fpl-spin" /> : SUBMIT_LABELS[mode]}
          </button>}
          {mode === 'feedback' && sent && (
            <button type="button" onClick={onClose} className="fpl-btn fpl-btn-solid" style={{ width: '100%' }}>{t('Close')}</button>
          )}
        </form>

        {(mode === 'login' || mode === 'register') && googleEnabled && (
          <>
            <div className="fpl-auth-or fpl-mono" aria-hidden="true"><span>{t('or')}</span></div>
            <a
              className={`fpl-btn fpl-google-btn${mode === 'register' && !acceptTerms ? ' is-disabled' : ''}`}
              href={`/auth/google${mode === 'register' ? '?terms=1' : ''}`}
              aria-disabled={mode === 'register' && !acceptTerms ? 'true' : undefined}
              onClick={e => { if (mode === 'register' && !acceptTerms) { e.preventDefault(); setNotice(t('Tick the box to agree to the Terms first.')); } }}
            >
              <GoogleMark /> {mode === 'register' ? t('Sign up with Google') : t('Continue with Google')}
            </a>
          </>
        )}
        {mode === 'backup' && (
          <button type="button" onClick={onClose} className="fpl-mono" style={{ ...linkStyle, color: 'var(--ink-dim)' }}>
            {t('Skip for now')}
          </button>
        )}
        {mode === 'email' && currentEmail && (
          <button type="button" onClick={() => onSetEmail('')} disabled={loading} className="fpl-mono" style={{ ...linkStyle, color: 'var(--ink-dim)' }}>
            {t('Remove email')}
          </button>
        )}
        {(mode === 'login' || mode === 'register') && (
          <button type="button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')} className="fpl-mono" style={linkStyle}>
            {mode === 'login' ? t('Don’t have an account? Create one') : t('Already have an account? Log in')}
          </button>
        )}
        {mode === 'forgot' && (
          <button type="button" onClick={() => setMode('login')} className="fpl-mono" style={linkStyle}>
            {t('Back to log in')}
          </button>
        )}
        {mode === 'reset' && (
          <button type="button" onClick={() => setMode('forgot')} className="fpl-mono" style={linkStyle}>
            {t('No code, or it expired? Send a new one')}
          </button>
        )}
        {mode === 'delete' && (
          <button type="button" onClick={onClose} className="fpl-mono" style={{ ...linkStyle, color: 'var(--ink-dim)' }}>
            {t('Keep my account')}
          </button>
        )}
        {mode === 'verify' && (
          <>
            <button type="button" onClick={resendVerify} disabled={loading} className="fpl-mono" style={linkStyle}>
              {t('Didn’t get it? Send a new code')}
            </button>
            <button type="button" onClick={onClose} className="fpl-mono" style={{ ...linkStyle, color: 'var(--ink-dim)', paddingTop: 8 }}>
              {t('Do it later')}
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
