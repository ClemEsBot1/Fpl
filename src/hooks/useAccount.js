// The logged-in account: its session, its saved teams, and the log-in
// pop-up with everything that can be done from it.
import { useEffect, useRef, useState } from 'react';
import { preload, welcomeChunk } from '../lib/chunks.js';
import { writeTermsAccepted } from '../lib/appStorage.js';
import { squadSnapshot } from '../lib/savedSquads.js';
import { track } from '../lib/track.js';
import { t } from '../lib/i18n.js';
import { serverMessage } from '../lib/serverMessages.js';

// Wraps fetch + JSON parsing consistently for every /api/auth and
// /api/teams call: distinguishes a genuine network failure (fetch itself
// threw) from a server that responded but not with valid JSON (a
// crashed/timed-out function returning an HTML error page) from a normal
// JSON error response — so the UI can show something more useful than a
// blanket "Network error" for problems that aren't actually that.
async function fetchJson(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    return { ok: false, status: null, data: null, error: t('Network error. Please try again.') };
  }
  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, status: res.status, data: null, error: t('Server error (status {status}). Please try again in a moment.', { status: res.status }) };
  }
  return { ok: res.ok, status: res.status, data, error: res.ok ? null : (data.error ? serverMessage(data.error) : t('Something went wrong.')) };
}

export const postJson = (url, body, method = 'POST') => fetchJson(url, {
  method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// `skipWelcome()` says, once on load, whether to go past the welcome page
// even when nobody is logged in.
export function useAccount({ stage, setStage, setStageRaw, skipWelcome }) {
  const [session, setSession] = useState(null); // { username, email } | null
  const [savedTeams, setSavedTeams] = useState([]);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  // The log-in pop-up: null (closed), 'login' (log in / sign up), 'email'
  // (add or change the logged-in user's email), 'forgot' (reset the
  // password with an emailed code) or 'verify' (the code that confirms the
  // account's email).
  const [authDialog, setAuthDialog] = useState(null);
  // A message shown at the top of the pop-up when it opens (after a Google
  // sign-in that needs something more).
  const [authNotice, setAuthNotice] = useState('');
  // A message at the top of the profile page (after linking Google).
  const [profileNotice, setProfileNotice] = useState('');
  // Log-in opened from a delete-account link: go on to deleting after.
  const deleteAfterLoginRef = useRef(false);

  // Password resets used to email a /?reset=<token> link. Resets are by
  // code now: an old link opens the reset pop-up to ask for one.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('reset')) return;
    setAuthDialog('forgot');
    params.delete('reset');
    const query = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
  }, []);

  // Check for an existing logged-in session once on load. The answer
  // includes the saved teams, so returning users skip the login screen
  // entirely on future visits (the session cookie is long-lived).
  useEffect(() => {
    // Fetched while the account is checked, in case it's needed.
    preload(welcomeChunk)();
    const leaveBoot = next => setStageRaw(s => (s === 'boot' ? next : s));
    // Don't hold the app up for long if the account check is slow.
    // A reload of another screen goes back to it, so past the welcome page.
    const skip = skipWelcome();
    // /?delete-account (linked from /delete-account): open the delete
    // pop-up, after logging in if needed.
    const params = new URLSearchParams(window.location.search);
    const wantsDelete = params.has('delete-account');
    // Back from "Continue with Google" (api/auth.js): what happened.
    const googleOutcome = params.get('google');
    if (wantsDelete || googleOutcome) {
      params.delete('delete-account');
      params.delete('google');
      const query = params.toString();
      window.history.replaceState(window.history.state, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
    }
    const timer = setTimeout(() => leaveBoot(skip ? 'home' : 'welcome'), 3000);
    (async () => {
      let loggedIn = false;
      try {
        const res = await fetch('/api/auth?session=1', { credentials: 'include' });
        const data = res.ok ? await res.json() : null;
        if (data && data.username) { applyAccount(data); loggedIn = true; }
      } catch { /* not logged in / API unreachable — treat as logged out */ }
      clearTimeout(timer);
      leaveBoot(loggedIn || skip ? 'home' : 'welcome');
      if (wantsDelete) {
        deleteAfterLoginRef.current = !loggedIn;
        setAuthDialog(loggedIn ? 'delete' : 'login');
      } else if (googleOutcome) {
        afterGoogle(googleOutcome, loggedIn);
      }
    })();
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signed-in responses carry the account and its saved teams.
  function applyAccount(data) {
    setSession({
      username: data.username, email: data.email || '', emailVerified: !!data.emailVerified, admin: !!data.admin, digestTeamId: data.digestTeamId || null,
      hasPassword: data.hasPassword !== false, google: !!data.google, createdAt: data.createdAt || null,
      recapSeen: data.recapSeen && typeof data.recapSeen === 'object' ? data.recapSeen : {},
    });
    if (Array.isArray(data.teams)) setSavedTeams(data.teams);
    else fetchSavedTeams();
  }

  async function fetchSavedTeams() {
    const result = await fetchJson('/api/teams', { credentials: 'include' });
    if (result.ok) setSavedTeams(result.data.teams || []);
    // non-critical — list just stays empty/stale on failure
  }

  // A 401 from the teams API means the session has ended (it expired, or
  // the password was reset on another device).
  function handleTeamsResult(result) {
    if (result.ok) {
      setSavedTeams(result.data.teams);
      return { ok: true };
    }
    if (result.status === 401) {
      setSession(null);
      setSavedTeams([]);
      return { ok: false, error: t('Your session has ended. Log in again to save.') };
    }
    return { ok: false, error: result.error };
  }

  function openAuthDialog(mode, notice = '') {
    setAuthError('');
    setAuthNotice(notice);
    setAuthDialog(mode);
  }

  function closeAuthDialog() {
    setAuthError('');
    setAuthDialog(null);
    deleteAfterLoginRef.current = false;
  }

  // Logging in happens in a pop-up over whatever screen is showing, so on
  // success the user is simply back where they were.
  async function handleAuthSubmit(mode, { username, password, email, acceptTerms }) {
    setAuthError('');
    setAuthLoading(true);
    const result = await postJson('/api/auth', { action: mode, username, password, email, ...(mode === 'register' ? { acceptTerms } : {}) });
    setAuthLoading(false);
    if (!result.ok) { setAuthError(result.error); return; }
    applyAccount(result.data);
    if (mode === 'register') writeTermsAccepted();
    // A new account with an email: straight on to the code we sent.
    const after = deleteAfterLoginRef.current && mode === 'login' ? 'delete' : null;
    deleteAfterLoginRef.current = false;
    setAuthDialog(after || (mode === 'register' && result.data.email && !result.data.emailVerified ? 'verify' : null));
    leaveWelcome();
  }

  // Where "Continue with Google" left off: a new account is offered a
  // username and password as a backup; anything that didn't work says why.
  function afterGoogle(outcome, loggedIn) {
    const problems = {
      terms: ['register', t('Tick the box to agree to the Terms, then sign up with Google again.')],
      cancelled: ['login', t('Google sign-in was cancelled.')],
      error: ['login', t('Google sign-in didn’t work. Please try again.')],
      unavailable: ['login', t('Google sign-in isn’t available right now. Use a username and password instead.')],
      limit: ['login', t('Too many new accounts from this network. Please try again later.')],
    };
    if (outcome === 'new' && loggedIn) { writeTermsAccepted(); setStageRaw('home'); openAuthDialog('backup'); return; }
    if (outcome === 'signed_in' && loggedIn) { setStageRaw(s => (s === 'welcome' || s === 'boot' ? 'home' : s)); return; }
    if (outcome === 'linked' && loggedIn) { setProfileNotice(t('Google connected: you can now sign in with Google.')); setStageRaw('profile'); return; }
    if (outcome === 'in_use' && loggedIn) { setProfileNotice(t('That Google account is already linked to a different FPL Checker account.')); setStageRaw('profile'); return; }
    const problem = problems[outcome];
    if (problem && !loggedIn) openAuthDialog(problem[0], problem[1]);
  }

  // The welcome page is for people who aren't logged in.
  function leaveWelcome() {
    setStageRaw(s => (s === 'welcome' || s === 'boot' ? 'home' : s));
  }

  // Returns the "check your inbox" message on success, otherwise null.
  async function handleForgotPassword(identifier) {
    setAuthError('');
    setAuthLoading(true);
    const result = await postJson('/api/auth', { action: 'forgot_password', identifier });
    setAuthLoading(false);
    if (!result.ok) { setAuthError(result.error); return null; }
    return result.data.message;
  }

  async function handleResetPassword({ identifier, code, password }) {
    setAuthError('');
    setAuthLoading(true);
    const result = await postJson('/api/auth', { action: 'reset_password', identifier, code, password });
    setAuthLoading(false);
    if (!result.ok) { setAuthError(result.error); return; }
    applyAccount(result.data);
    setAuthDialog(null);
    leaveWelcome();
  }

  async function handleDeleteAccount({ password, confirm }) {
    setAuthError('');
    setAuthLoading(true);
    const result = await postJson('/api/auth', { action: 'delete_account', password, confirm });
    setAuthLoading(false);
    if (!result.ok) { setAuthError(result.error); return; }
    setSession(null);
    setSavedTeams([]);
    setAuthDialog(null);
    setStage('welcome');
  }

  // The "Send feedback" pop-up. True once it's sent.
  async function handleSendFeedback({ text, email }) {
    setAuthError('');
    setAuthLoading(true);
    const result = await postJson('/api/auth', { action: 'feedback', text, email, page: stage });
    setAuthLoading(false);
    if (!result.ok) { setAuthError(result.error); return false; }
    return true;
  }

  // A username and password for an account made with Google.
  async function handleSetCredentials({ username, password }) {
    setAuthError('');
    setAuthLoading(true);
    const result = await postJson('/api/auth', { action: 'set_credentials', username, password });
    setAuthLoading(false);
    if (!result.ok) { setAuthError(result.error); return; }
    applyAccount(result.data);
    setAuthDialog(null);
  }

  async function handleChangePassword({ currentPassword, password }) {
    setAuthError('');
    setAuthLoading(true);
    const result = await postJson('/api/auth', { action: 'change_password', currentPassword, password });
    setAuthLoading(false);
    if (!result.ok) { setAuthError(result.error); return; }
    applyAccount(result.data);
    setAuthDialog(null);
  }

  async function handleVerifyEmail(code) {
    setAuthError('');
    setAuthLoading(true);
    const result = await postJson('/api/auth', { action: 'verify_email', code });
    setAuthLoading(false);
    if (!result.ok) {
      if (result.status === 401) { setSession(null); setSavedTeams([]); setAuthDialog(null); return; }
      setAuthError(result.error);
      return;
    }
    setSession(s => (s ? { ...s, emailVerified: !!result.data.emailVerified } : s));
    setAuthDialog(null);
  }

  // Returns the "we've sent a code" message on success, otherwise null.
  async function handleResendVerify() {
    setAuthError('');
    setAuthLoading(true);
    const result = await postJson('/api/auth', { action: 'send_verify' });
    setAuthLoading(false);
    if (!result.ok) { setAuthError(result.error); return null; }
    return result.data.message || null;
  }

  async function handleSetEmail(email) {
    setAuthError('');
    setAuthLoading(true);
    const result = await postJson('/api/auth', { action: 'set_email', email });
    setAuthLoading(false);
    if (!result.ok) {
      if (result.status === 401) { setSession(null); setSavedTeams([]); setAuthDialog(null); return; }
      setAuthError(result.error);
      return;
    }
    setSession(s => (s ? { ...s, email: result.data.email || '', emailVerified: !!result.data.emailVerified, digestTeamId: result.data.digestTeamId || null } : s));
    // A new address: on to the code we sent to it.
    setAuthDialog(result.data.email && !result.data.emailVerified ? 'verify' : null);
  }

  async function handleLogout() {
    await postJson('/api/auth', { action: 'logout' });
    setSession(null);
    setSavedTeams([]);
    setStage('welcome');
  }

  async function handleSaveTeamId(teamId, label, gwId) {
    const result = handleTeamsResult(await postJson('/api/teams', { type: 'teamId', teamId, label, gwId }));
    if (result.ok) track('save_team');
    return result;
  }

  // Saves the squad as it stands: players, armbands, the starting XI and
  // the bank, so loading it later gives back exactly this.
  async function handleSaveCustomSquad(squad, label, gwId, bankTenths) {
    return handleTeamsResult(await postJson('/api/teams', { type: 'custom', label, gwId, squad: squadSnapshot(squad, bankTenths) }));
  }

  async function handleDeleteSavedTeam(entryId) {
    handleTeamsResult(await postJson('/api/teams', { entryId }, 'DELETE'));
    // non-critical — list just stays as-is on failure
  }

  // A gameweek recap seen while logged in is kept on the account, so it
  // doesn't pop up again on another device (useRecap).
  function markRecapSeenOnAccount(teamId, gwId) {
    if (!session || !teamId || !gwId) return;
    if ((Number(session.recapSeen && session.recapSeen[teamId]) || 0) >= gwId) return;
    setSession(s => (s ? { ...s, recapSeen: { ...(s.recapSeen || {}), [teamId]: gwId } } : s));
    postJson('/api/auth', { action: 'recap_seen', teamId, gwId }).catch(() => {});
  }

  return {
    session, savedTeams, authDialog, authNotice, authError, authLoading, profileNotice, setProfileNotice, setAuthError,
    openAuthDialog, closeAuthDialog, handleTeamsResult,
    handleAuthSubmit, handleForgotPassword, handleResetPassword, handleDeleteAccount, handleSendFeedback,
    handleSetCredentials, handleChangePassword, handleVerifyEmail, handleResendVerify, handleSetEmail, handleLogout,
    handleSaveTeamId, handleSaveCustomSquad, handleDeleteSavedTeam, markRecapSeenOnAccount,
  };
}
