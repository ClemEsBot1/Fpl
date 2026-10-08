// App shell: state, data loading and which screen is shown. The screens
// themselves live in src/screens/, shared pieces in src/components/, and
// non-UI logic in src/lib/.
import { Component, Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { ErrorScreen, Header, LoadingScreen } from './components/common.jsx';
import { DAILY_REFRESH_HOUR_UTC, formatCountdown, getNextDailyRefreshUTC, isDeadlineSoon, officialGwPoints } from './lib/format.js';
import { fetchFplJson, loadStaticData, loadStaticDataAsOf } from './lib/fplClient.js';
import { SQUAD_BUDGET, applyAutomaticSubs, buildHindsightSquad, buildOptimalTeam, buildSavedSquadActualPerformance, getDefaultEvent, hydrateFrozenSquadSnapshot, hydrateSquadSnapshot, isEventLocked, snapshotIsForSeason } from './lib/predictions.js';
import { forEachLimited, livePointsFor, memberWeekStats, parseStandings, predictedXiTotal, privateLeagues } from './lib/leagues.js';
import { buildRecap, lastFinishedGw, leagueSlide, markRecapSeen, recapSeenFor } from './lib/recap.js';
import { clearTeamEdit, saveTeamEdit, teamEditFor } from './lib/teamEdits.js';
import { computeOptimalXiTotal, computeSquadScore, ensureCaptaincy, matchExtractedSquad, squadProblems, suggestCaptain, suggestTransfers } from './lib/squadLogic.js';
import { Bookmark, Camera, Download, History, House, Info, Shirt, Trophy, Users, Wand2 } from 'lucide-react';
import { FooterNav, SideNav } from './components/AppNav.jsx';
import { useInstallPrompt } from './lib/pwa.js';
import { HomeScreen } from './screens/HomeScreen.jsx';
import { TeamIdForm } from './screens/IntroScreen.jsx';
import './styles.css';

// Everything but the home screen loads on demand, so the first visit only
// downloads what the first screen needs. The rest is fetched once the page
// is idle (see the effect in FPLSquadChecker), so screens still open
// instantly and work offline.
function chunk(importer) {
  let module = null;
  let promise = null;
  return {
    load() {
      if (!promise) {
        promise = importer().then(m => { module = m; return m; }, err => { promise = null; throw err; });
      }
      return promise;
    },
    loaded: () => module,
  };
}

// A screen from one of those chunks. Once its code is here it renders
// straight away: going through Suspense would still hold it behind the
// loading placeholder for a few hundred milliseconds. Which of the two is
// used is fixed per mount, so a screen never remounts and loses its state.
function lazyScreen(source, name) {
  const Lazy = lazy(() => source.load().then(m => ({ default: m[name] })));
  function Screen(props) {
    const [Loaded] = useState(() => (source.loaded() ? source.loaded()[name] : Lazy));
    return <Loaded {...props} />;
  }
  Screen.displayName = name;
  return Screen;
}

const resultsChunk = chunk(() => import('./screens/ResultsScreen.jsx'));
const screenshotChunk = chunk(() => import('./screens/ScreenshotScreens.jsx'));
const accountChunk = chunk(() => import('./screens/AccountScreens.jsx'));
const builderChunk = chunk(() => import('./screens/CustomSquadBuilder.jsx'));
const hindsightChunk = chunk(() => import('./screens/HindsightScreen.jsx'));
const welcomeChunk = chunk(() => import('./screens/WelcomeScreen.jsx'));
const leagueChunk = chunk(() => import('./screens/MiniLeagueScreen.jsx'));
const recapChunk = chunk(() => import('./components/GwRecap.jsx'));
const ALL_CHUNKS = [resultsChunk, screenshotChunk, accountChunk, builderChunk, hindsightChunk, welcomeChunk, leagueChunk, recapChunk];
// For fetching a screen ahead of time; a failure shows up when it's opened.
const preload = source => () => { source.load().catch(() => {}); };
const loadResultsScreen = preload(resultsChunk);
const loadCustomSquadBuilder = preload(builderChunk);
const loadHindsightScreen = preload(hindsightChunk);

const ResultsScreen = lazyScreen(resultsChunk, 'ResultsScreen');
const ScreenshotForm = lazyScreen(screenshotChunk, 'ScreenshotForm');
const ReviewScreen = lazyScreen(screenshotChunk, 'ReviewScreen');
const CustomSquadBuilder = lazyScreen(builderChunk, 'CustomSquadBuilder');
const HindsightScreen = lazyScreen(hindsightChunk, 'HindsightScreen');
const WelcomeScreen = lazyScreen(welcomeChunk, 'WelcomeScreen');
const MiniLeagueScreen = lazyScreen(leagueChunk, 'MiniLeagueScreen');
const MyTeamsScreen = lazyScreen(accountChunk, 'MyTeamsScreen');
const AuthDialog = lazyScreen(accountChunk, 'AuthDialog');
const GwRecap = lazyScreen(recapChunk, 'GwRecap');

// Shown instead of a blank page when a screen fails to render — most
// likely its code couldn't be downloaded (offline, or the app was updated
// since this page was opened and the old files are gone). A reload fixes
// both.
class ScreenErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    const screen = (
      <ErrorScreen
        message="Something went wrong showing this. Reloading usually fixes it — the app may have just been updated."
        retryLabel="Reload"
        onRetry={() => window.location.reload()}
      />
    );
    return this.props.overlay ? <div className="fpl-dialog-card fpl-error-overlay">{screen}</div> : screen;
  }
}

// Which menu item a screen belongs to (null while loading or on an error,
// which keep the previous one).
function navSectionFor(stage, resultsData) {
  switch (stage) {
    case 'home': return 'home';
    case 'welcome': return 'about';
    case 'teamIdForm': return 'team';
    case 'screenshotForm': case 'review': return 'screenshot';
    case 'customBuild': return 'build';
    case 'hindsight': return 'lookback';
    case 'myTeams': return 'saved';
    case 'league': return 'league';
    case 'results':
      if (!resultsData) return null;
      if (resultsData.isOptimalBuild) return 'best';
      if (resultsData.entryMeta && resultsData.entryMeta.teamId) return 'team';
      return null;
    default: return null;
  }
}

// A squad as a compact snapshot to save: players, armbands, the starting
// XI and the bank.
function squadSnapshot(squad, bankTenths) {
  const captain = squad.find(s => s.isCaptain);
  const vice = squad.find(s => s.isViceCaptain);
  const starters = squad.filter(s => s.isStarting).map(s => s.player.id);
  return {
    playerIds: squad.map(s => s.player.id),
    captainId: captain ? captain.player.id : null,
    viceCaptainId: vice ? vice.player.id : null,
    ...(starters.length === 11 ? { startingIds: starters } : {}),
    ...(Number.isInteger(bankTenths) && bankTenths >= 0 ? { bankTenths } : {}),
  };
}

// The changes saved to the account for a Team ID in one gameweek, or null.
function savedChangesFor(savedTeams, teamId, gwId) {
  const entry = savedTeams.find(t => t.type === 'teamId' && String(t.teamId) === String(teamId));
  return entry && entry.squad && entry.squad.gwId === gwId ? entry.squad : null;
}

// The changes to show for a Team ID in one gameweek: the latest edits made
// on this device, else the ones saved to the account, else null (the
// picks on FPL). Edits on this device are marked `onDevice`.
function teamChangesFor(savedTeams, teamId, gwId) {
  const local = teamEditFor(teamId, gwId);
  return local ? { ...local, onDevice: true } : savedChangesFor(savedTeams, teamId, gwId);
}

// Where the Team ID shown on Home is remembered.
const HOME_TEAM_KEY = 'fpl_home_team_id';
function readHomeTeamId() {
  try { return localStorage.getItem(HOME_TEAM_KEY) || null; } catch { return null; }
}

// The gameweek picked in the header is kept in the address (?gw=7), so a
// reload or a shared link opens on the same gameweek.
function readGwParam() {
  const gw = Number(new URLSearchParams(window.location.search).get('gw'));
  return Number.isInteger(gw) && gw >= 1 && gw <= 38 ? gw : null;
}
function writeGwParam(gw) {
  writeParams({ gw: gw ? String(gw) : null });
}
// Sets (or, for null, removes) query parameters without a new history entry.
function writeParams(values) {
  const params = new URLSearchParams(window.location.search);
  Object.entries(values).forEach(([key, value]) => { if (value) params.set(key, value); else params.delete(key); });
  const query = params.toString();
  const next = window.location.pathname + (query ? `?${query}` : '') + window.location.hash;
  if (next !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, '', next);
}

// The screen open is kept in the address too (?view=team, and ?team=123
// for someone else's team), so a reload opens it again rather than Home.
const RESTORABLE_VIEWS = ['team', 'league', 'screenshot', 'best', 'build', 'lookback', 'saved'];
function readViewParam() {
  const view = new URLSearchParams(window.location.search).get('view');
  return RESTORABLE_VIEWS.includes(view) ? view : null;
}
// Whether this tab was past the welcome page, so a reload of Home stays
// on Home. Kept for the tab only: a new visit still starts with welcome.
const IN_APP_KEY = 'fpl_in_app';
function readInApp() {
  try { return sessionStorage.getItem(IN_APP_KEY) === '1'; } catch { return false; }
}
function writeInApp(inApp) {
  try { if (inApp) sessionStorage.setItem(IN_APP_KEY, '1'); else sessionStorage.removeItem(IN_APP_KEY); } catch { /* storage unavailable */ }
}
function readTeamParam() {
  const team = new URLSearchParams(window.location.search).get('team');
  return team && /^\d{1,10}$/.test(team) ? team : null;
}

// What went wrong loading a team, in words (codes thrown by loadTeamForGw).
// The gameweek Home's recap button opens: the one picked in the header if
// it's over, else the latest to finish. null before any has.
function recapGwFor(staticData, selectedGw) {
  if (!staticData) return null;
  const picked = (staticData.allEvents || []).find(e => e.id === selectedGw);
  return picked && picked.finished ? picked.id : lastFinishedGw(staticData.allEvents);
}

function teamErrorMessage(e) {
  const messages = {
    ERR_STATIC_DATA: "Couldn't load live FPL player data right now. Try again in a moment, or upload a screenshot instead.",
    ERR_PICKS_FETCH: "FPL's servers aren't responding right now. Try again in a moment, or upload a screenshot instead.",
    ERR_GW_LOCKED: "FPL hasn't published any picks for this team yet (a new team's picks are hidden until its first deadline passes). Try again after the deadline, or upload a screenshot for now.",
    ERR_TEAM_NOT_FOUND: "We couldn't find a team with that ID. Double-check the number in your FPL URL and try again.",
    ERR_TEAM_NOT_STARTED: `This team started in Gameweek ${e && e.startedEvent}, so it has no squad for Gameweek ${e && e.gwId}.`,
    ERR_UNKNOWN: 'Something went wrong pulling your team. Try again, or upload a screenshot instead.',
  };
  return messages[(e && e.code) || 'ERR_UNKNOWN'] || messages.ERR_UNKNOWN;
}

// How long live points for a gameweek that's still being played stay fresh.
const LIVE_IN_PROGRESS_TTL_MS = 60_000;

export default function FPLSquadChecker() {
  // 'boot' until we know whether someone is logged in: the welcome page
  // is for people who aren't, everyone else starts on Home.
  const [stage, setStageRaw] = useState('boot');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  // An optional way forward offered on the error screen: { label, run }.
  const [errorAction, setErrorAction] = useState(null);
  const [teamIdInput, setTeamIdInput] = useState('');
  const [reviewSlots, setReviewSlots] = useState([]);
  // The screenshot behind the current review, for the optional report.
  const [reviewShotImg, setReviewShotImg] = useState(null);
  const [reviewBank, setReviewBank] = useState(null);
  const [pendingStaticData, setPendingStaticData] = useState(null);
  const [resultsData, setResultsData] = useState(null);
  const [selectedGw, setSelectedGw] = useState(readGwParam); // null = use current/next gameweek
  const [gwOptions, setGwOptions] = useState([]);
  const [customStaticData, setCustomStaticData] = useState(null);
  const [hindsightData, setHindsightData] = useState(null);
  const [hindsightCompare, setHindsightCompare] = useState(null); // { loading, entry, label, squad?, score?, error? }
  const [session, setSession] = useState(null); // { username, email } | null
  const [savedTeams, setSavedTeams] = useState([]);
  // The team summarised on Home: { teamId, status: 'idle'|'loading'|'ready'|'error', data, error }.
  const [homeTeam, setHomeTeam] = useState(() => ({ teamId: readHomeTeamId(), status: 'idle', data: null, error: null }));
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  // The log-in pop-up: null (closed), 'login' (log in / sign up), 'email'
  // (add or change the logged-in user's email) or 'reset' (choose a new
  // password from an emailed ?reset= link).
  const [authDialog, setAuthDialog] = useState(null);
  const [resetToken, setResetToken] = useState(null);

  const staticPromiseRef = useRef(null);
  // The most recently loaded static data (to tell when its gameweek has
  // closed and it needs loading again).
  const staticDataRef = useRef(null);
  // The current static data, for screens that show it directly (Home).
  const [liveStatic, setLiveStatic] = useState(null);
  // A reload of that data in progress (see ensureStaticData).
  const refreshPromiseRef = useRef(null);
  // The optimal XI's predicted total, per static-data set (the current one,
  // or a past gameweek rebuilt "as of" its deadline).
  const optimalXiTotalRef = useRef(new WeakMap());
  // Past gameweeks' "as of" static data, by gameweek id (promises).
  const asOfCacheRef = useRef(new Map());
  // Live points per gameweek: { at, promise }.
  const liveCacheRef = useRef(new Map());
  const currentStaticDataRef = useRef(null);
  const mainRef = useRef(null);

  // Every navigation and every load takes a ticket. A load only changes
  // the screen if no newer navigation or load has happened since it
  // started, so tapping Home (or starting something else) while a slow
  // lookup is running can't be overridden by that lookup finishing later.
  const ticketRef = useRef(0);
  // The screen to reopen after a reload, until it has been.
  const restoreViewRef = useRef(readViewParam());
  const newTicket = () => { ticketRef.current += 1; return ticketRef.current; };
  const isCurrent = ticket => ticket === ticketRef.current;
  // Navigating somewhere abandons whatever was loading.
  function setStage(next) {
    newTicket();
    setStageRaw(next);
  }
  // For use inside a load: change the screen only if the load is current.
  function showStage(ticket, next) {
    if (isCurrent(ticket)) setStageRaw(next);
  }
  function showLoading(ticket, message) {
    if (!isCurrent(ticket)) return;
    setLoadingMessage(message);
    setStageRaw('loading');
  }
  function showError(ticket, message, action = null) {
    if (!isCurrent(ticket)) return;
    setErrorMessage(message);
    setErrorAction(action);
    setStageRaw('error');
  }

  // A password-reset email links to /?reset=<token>: open the pop-up to
  // choose a new password, and take the token out of the address bar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('reset');
    if (!token) return;
    setResetToken(token);
    setAuthDialog('reset');
    params.delete('reset');
    const query = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);
  }, []);

  // Fetch the other screens once the home screen has settled.
  useEffect(() => {
    const fetchAll = () => ALL_CHUNKS.forEach(source => preload(source)());
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(fetchAll, { timeout: 5000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(fetchAll, 2000);
    return () => clearTimeout(timer);
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
    const skipWelcome = !!restoreViewRef.current || readInApp();
    const timer = setTimeout(() => leaveBoot(skipWelcome ? 'home' : 'welcome'), 3000);
    (async () => {
      let loggedIn = false;
      try {
        const res = await fetch('/api/auth', { credentials: 'include' });
        if (res.ok) { applyAccount(await res.json()); loggedIn = true; }
      } catch { /* not logged in / API unreachable — treat as logged out */ }
      clearTimeout(timer);
      leaveBoot(loggedIn || skipWelcome ? 'home' : 'welcome');
    })();
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      return { ok: false, status: null, data: null, error: 'Network error — please try again.' };
    }
    let data;
    try {
      data = await res.json();
    } catch {
      return { ok: false, status: res.status, data: null, error: `Server error (status ${res.status}) — please try again in a moment.` };
    }
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : (data.error || 'Something went wrong.') };
  }

  const postJson = (url, body, method = 'POST') => fetchJson(url, {
    method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  // Signed-in responses carry the account and its saved teams.
  function applyAccount(data) {
    setSession({ username: data.username, email: data.email || '' });
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
      return { ok: false, error: 'Your session has ended. Log in again to save.' };
    }
    return { ok: false, error: result.error };
  }

  function openAuthDialog(mode) {
    setAuthError('');
    setAuthDialog(mode);
  }

  // Logging in happens in a pop-up over whatever screen is showing, so on
  // success the user is simply back where they were.
  async function handleAuthSubmit(mode, { username, password, email }) {
    setAuthError('');
    setAuthLoading(true);
    const result = await postJson('/api/auth', { action: mode, username, password, email });
    setAuthLoading(false);
    if (!result.ok) { setAuthError(result.error); return; }
    applyAccount(result.data);
    setAuthDialog(null);
    leaveWelcome();
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

  async function handleResetPassword(password) {
    setAuthError('');
    setAuthLoading(true);
    const result = await postJson('/api/auth', { action: 'reset_password', token: resetToken, password });
    setAuthLoading(false);
    if (!result.ok) { setAuthError(result.error); return; }
    applyAccount(result.data);
    setResetToken(null);
    setAuthDialog(null);
    leaveWelcome();
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
    setSession(s => (s ? { ...s, email: result.data.email || '' } : s));
    setAuthDialog(null);
  }

  async function handleLogout() {
    await postJson('/api/auth', { action: 'logout' });
    setSession(null);
    setSavedTeams([]);
    setStage('welcome');
  }

  async function handleSaveTeamId(teamId, label, gwId) {
    return handleTeamsResult(await postJson('/api/teams', { type: 'teamId', teamId, label, gwId }));
  }

  // Saves the squad as it stands: players, armbands, the starting XI and
  // the bank, so loading it later gives back exactly this.
  async function handleSaveCustomSquad(squad, label, gwId, bankTenths) {
    return handleTeamsResult(await postJson('/api/teams', { type: 'custom', label, gwId, squad: squadSnapshot(squad, bankTenths) }));
  }

  // Saves the changes made to a Team ID's squad to the account, for the
  // gameweek on screen. Loading that Team ID for that gameweek (on Home or
  // My team) then shows them instead of the picks on FPL.
  async function handleSaveTeamChanges(data, label) {
    const { teamId, gwId } = data.entryMeta;
    const result = handleTeamsResult(await postJson('/api/teams', {
      type: 'teamId', teamId, label, gwId,
      squad: { ...squadSnapshot(data.squad, data.bankTenths), gwId },
    }));
    if (result.ok) {
      // The account now has them, so this device's copy isn't needed.
      clearTeamEdit(teamId);
      setResultsData(prev => (prev === data || (prev && prev.squad === data.squad)
        ? { ...prev, edited: false, entryMeta: { ...prev.entryMeta, savedChanges: true, changesOnDevice: false } } : prev));
    }
    return result;
  }

  // Forgets a Team ID's changes, on this device and (when they were saved
  // there) on the account, and shows its picks on FPL again.
  async function handleResetTeamChanges(data) {
    const { teamId, gwId, teamName } = data.entryMeta;
    clearTeamEdit(teamId);
    if (session && savedChangesFor(savedTeams, teamId, gwId)) {
      const result = handleTeamsResult(await postJson('/api/teams', { type: 'teamId', teamId, label: teamName, gwId, squad: null }));
      if (!result.ok) return result;
    }
    handleTeamIdSubmit(String(teamId), gwId, { ignoreSaved: true });
    return { ok: true };
  }

  async function handleDeleteSavedTeam(entryId) {
    handleTeamsResult(await postJson('/api/teams', { entryId }, 'DELETE'));
    // non-critical — list just stays as-is on failure
  }

  async function handleLoadSavedTeam(entry) {
    if (entry.type === 'teamId') {
      handleTeamIdSubmit(String(entry.teamId));
      return;
    }
    const ticket = newTicket();
    showLoading(ticket, 'Loading your saved squad…');
    loadResultsScreen();
    try {
      const staticData = await ensureStaticData();
      if (!isCurrent(ticket)) return;
      const hydrated = hydrateSquadSnapshot(entry.squad, staticData, { keepStartingXi: true });
      if (!hydrated) throw new Error('could not hydrate saved squad');
      // Shown for the gameweek being planned; the gameweek menu re-scores
      // it if an earlier one is selected.
      finalizeResults(ticket, hydrated.squad, staticData, hydrated.bankTenths, { teamName: entry.label, gwId: currentGwId(staticData) }, null, false, { gwId: currentGwId(staticData) });
    } catch {
      showError(ticket, "Couldn't load that saved squad — try again in a moment.");
    }
  }

  function handleRequestLoginToSave() {
    openAuthDialog('login');
  }

  // Every screen is a fresh "page": back to the top, with keyboard and
  // screen-reader focus moved to the new content (otherwise it's lost with
  // the button that was pressed).
  const firstStageRef = useRef(true);
  useEffect(() => {
    window.scrollTo(0, 0);
    if (firstStageRef.current) { firstStageRef.current = false; return; }
    if (mainRef.current) mainRef.current.focus({ preventScroll: true });
  }, [stage]);

  const currentGwId = staticData => (staticData.targetEvent ? staticData.targetEvent.id : 1);
  // The latest gameweek whose deadline has passed: the one being played, or
  // the last one played. null before the season starts.
  const liveGwIdFor = staticData => {
    const started = (staticData.allEvents || []).filter(e => isEventLocked(e));
    return started.length ? Math.max(...started.map(e => e.id)) : null;
  };
  // The gameweek to show when none was picked (see applyGameweekOptions).
  const defaultGwId = staticData => (getDefaultEvent(staticData.allEvents) || staticData.targetEvent || { id: 1 }).id;

  // Loads (once) the FPL data everything else needs. A failed first load
  // isn't kept, so the next attempt tries again. Once the gameweek it was
  // planning for has closed (the app was left open past a deadline) it's
  // loaded afresh for the next one. FPL is often unavailable for a while
  // just after a deadline, so if that fails the old data is used until the
  // next attempt works.
  function ensureStaticData() {
    const loaded = staticDataRef.current;
    const outdated = loaded && loaded.targetEvent && isEventLocked(loaded.targetEvent)
      && loaded.allEvents.some(e => e.id > loaded.targetEvent.id);
    if (outdated && !refreshPromiseRef.current) {
      const refresh = loadStaticData().then(data => {
        staticDataRef.current = data;
        staticPromiseRef.current = refresh;
        asOfCacheRef.current.clear();
        applyGameweekOptions(data, defaultGwId(loaded));
        return data;
      }, () => loaded).finally(() => { refreshPromiseRef.current = null; });
      refreshPromiseRef.current = refresh;
    }
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    if (!staticPromiseRef.current) {
      const promise = loadStaticData().then(data => {
        staticDataRef.current = data;
        applyGameweekOptions(data, null);
        return data;
      }).catch(err => {
        if (staticPromiseRef.current === promise) staticPromiseRef.current = null;
        throw err;
      });
      staticPromiseRef.current = promise;
    }
    return staticPromiseRef.current;
  }

  // Selectable gameweeks: any that have closed (deadline passed — safe to
  // browse as history) plus whichever one is currently the target. Using
  // is_current/is_next here would let a gameweek whose deadline has already
  // passed keep showing as "current" for days, since that FPL flag tracks
  // match-play status rather than transfer deadlines.
  //
  // The one picked to start with is the gameweek being played, until all
  // of its matches are over, and then the next one (getDefaultEvent).
  function applyGameweekOptions(data, previousDefaultId) {
    setLiveStatic(data);
    setGwOptions(data.allEvents.filter(e => isEventLocked(e) || (data.targetEvent && e.id === data.targetEvent.id)));
    if (data.targetEvent) {
      // Follow the default forward if it was what was selected. A
      // gameweek from the address that can't be picked falls back to it.
      const pickable = id => data.allEvents.some(e => e.id === id && (isEventLocked(e) || e.id === data.targetEvent.id));
      const next = defaultGwId(data);
      setSelectedGw(prev => (prev === null || prev === previousDefaultId || !pickable(prev) ? next : prev));
    }
  }

  // While a gameweek is being played, check FPL every 10 minutes so the app
  // moves on to the next one once its last match has finished.
  const liveDefaultId = liveStatic && liveStatic.targetEvent && defaultGwId(liveStatic) !== liveStatic.targetEvent.id ? defaultGwId(liveStatic) : null;
  useEffect(() => {
    if (!liveDefaultId) return undefined;
    const id = setInterval(() => {
      const before = staticDataRef.current;
      loadStaticData().then(data => {
        if (staticDataRef.current !== before) return; // a deadline refresh got there first
        staticDataRef.current = data;
        staticPromiseRef.current = Promise.resolve(data);
        asOfCacheRef.current.clear();
        applyGameweekOptions(data, liveDefaultId);
      }, () => {});
    }, 10 * 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveDefaultId]);

  useEffect(() => {
    ensureStaticData().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getOptimalXiTotal(staticData) {
    if (!optimalXiTotalRef.current.has(staticData)) {
      optimalXiTotalRef.current.set(staticData, computeOptimalXiTotal(staticData));
    }
    return optimalXiTotalRef.current.get(staticData);
  }

  // Static data to predict `gwId` with. The current/upcoming gameweek uses
  // today's data; a past gameweek is rebuilt from only the gameweeks before
  // it (see src/lib/asOf.js), so its predictions can't see what happened
  // since. If that can't be loaded, falls back to today's data and says so.
  async function staticDataForGw(gwId) {
    const base = await ensureStaticData();
    if (!gwId || gwId >= currentGwId(base)) return base;
    if (!asOfCacheRef.current.has(gwId)) {
      asOfCacheRef.current.set(gwId, loadStaticDataAsOf(base, gwId).catch(err => {
        asOfCacheRef.current.delete(gwId);
        throw err;
      }));
    }
    try {
      return await asOfCacheRef.current.get(gwId);
    } catch {
      return { ...base, asOfFailedGwId: gwId };
    }
  }

  // Live points for a gameweek ({ [playerId]: { totalPoints, minutes } }),
  // shared by every screen that needs them. A finished gameweek never
  // changes, so it's fetched once; one still being played is refetched
  // after a minute. Never throws: without live data, screens still show
  // predictions.
  function liveForGw(gwId, finished) {
    const cached = liveCacheRef.current.get(gwId);
    if (cached && (finished || Date.now() - cached.at < LIVE_IN_PROGRESS_TTL_MS)) return cached.promise;
    const promise = fetchFplJson(`event/${gwId}/live/`).then(live => {
      const liveById = {};
      (live.elements || []).forEach(el => {
        liveById[el.id] = {
          totalPoints: el.stats.total_points, minutes: el.stats.minutes,
          // For the gameweek recap's star and flop.
          goals: el.stats.goals_scored, assists: el.stats.assists, bonus: el.stats.bonus,
          cleanSheets: el.stats.clean_sheets, conceded: el.stats.goals_conceded, yellow: el.stats.yellow_cards,
        };
      });
      return liveById;
    }).catch(() => {
      liveCacheRef.current.delete(gwId);
      return {};
    });
    liveCacheRef.current.set(gwId, { at: Date.now(), promise });
    return promise;
  }

  const isGwFinished = (staticData, gwId) => !!(staticData.allEvents || []).find(e => e.id === gwId && e.finished);

  // Predictions and (for a finished gameweek) actual points for each squad
  // slot, from the given static data.
  function scoreSlots(slots, staticData, liveById, isPastGw) {
    return slots.map(slot => {
      const player = staticData.playersById[slot.playerId];
      if (!player) return null;
      const pred = staticData.predictionsById[slot.playerId];
      const live = liveById[slot.playerId];
      return {
        player, predicted: pred.predicted, nextMatchPredicted: pred.nextMatchPredicted, availNote: pred.availNote, breakdown: pred.breakdown,
        isStarting: slot.isStarting, isCaptain: !!slot.isCaptain, isViceCaptain: !!slot.isViceCaptain,
        multiplier: slot.multiplier,
        ...(isPastGw ? { actualPoints: live ? live.totalPoints : 0, played: live ? live.minutes > 0 : false } : {}),
      };
    }).filter(Boolean);
  }

  // Re-scores the squad on screen for another gameweek — for squads that
  // aren't tied to an FPL team (screenshot, custom or saved squads), which
  // keep the same players. Team ID squads reload that gameweek's picks.
  async function rescoreSquadForGw(gwId) {
    const prev = resultsData;
    if (!prev) return;
    const ticket = newTicket();
    showLoading(ticket, 'Re-scoring your squad for that gameweek…');
    try {
      const base = await ensureStaticData();
      const isPastGw = gwId < currentGwId(base);
      const [gwStatic, liveById] = await Promise.all([
        staticDataForGw(gwId),
        isPastGw ? liveForGw(gwId, isGwFinished(base, gwId)) : Promise.resolve({}),
      ]);
      if (!isCurrent(ticket)) return;
      const slots = prev.squad.map(s => ({
        playerId: s.player.id, isStarting: s.isStarting, isCaptain: s.isCaptain, isViceCaptain: s.isViceCaptain,
        multiplier: s.isCaptain ? 2 : (s.isStarting ? 1 : 0),
      }));
      const squad = scoreSlots(slots, gwStatic, liveById, isPastGw);
      finalizeResults(ticket, squad, gwStatic, prev.bankTenths, { ...prev.entryMeta, gwId }, null, false, { isPastGw, gwId });
    } catch {
      showError(ticket, "Couldn't load that gameweek right now. Try again in a moment.");
    }
  }

  // Keep what's on screen in step with the gameweek menu. This also runs
  // when a load finishes, so a gameweek picked while something else was
  // loading isn't lost.
  useEffect(() => {
    if (selectedGw === null || stage !== 'results' || !resultsData || resultsData.gwId === selectedGw) return;
    if (resultsData.isOptimalBuild) {
      loadOptimalSquadForGw(selectedGw);
    } else if (resultsData.entryMeta && resultsData.entryMeta.teamId) {
      // Your own team: a Team ID reloads that gameweek's actual picks;
      // other squads keep their players and are re-scored.
      handleTeamIdSubmit(String(resultsData.entryMeta.teamId));
    } else {
      rescoreSquadForGw(selectedGw);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGw, stage, resultsData]);

  // Look back follows the gameweek menu too, for gameweeks that have closed.
  useEffect(() => {
    if (stage !== 'hindsight' || !hindsightData || !selectedGw || hindsightData.gwId === selectedGw) return;
    const base = staticDataRef.current;
    if (base && selectedGw < currentGwId(base)) handleViewHindsight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGw, stage, hindsightData]);

  function buildResultsData(squad, staticData, bankTenths, entryMeta, activeChip, isOptimalBuild, extra = {}) {
    const { isPastGw = false, nextRefreshAt = null, builtAt = null, gwUnavailable = false, gwId = null, backfilled = false, entryHistory = null } = extra;
    const starters = squad.filter(s => s.isStarting);
    const bench = squad.filter(s => !s.isStarting);

    let xiTotal = 0;
    let actualXiTotal = 0;
    squad.forEach(s => {
      // Starters count at their multiplier (the captain's 2, or 3 under
      // Triple Captain); the bench only counts under Bench Boost.
      const mult = s.isStarting || activeChip === 'bboost' ? (s.multiplier || 1) : 0;
      xiTotal += s.predicted * mult;
      actualXiTotal += (s.actualPoints || 0) * mult;
    });

    const captain = squad.find(s => s.isCaptain) || null;
    const captainSuggestion = isPastGw ? null : suggestCaptain(starters);
    const suggestions = isPastGw ? [] : suggestTransfers(squad, staticData.allPlayers, staticData.predictionsById, bankTenths || 0);

    return {
      squad, starters, bench, xiTotal, actualXiTotal: isPastGw ? actualXiTotal : null, captain, captainSuggestion, suggestions,
      entryMeta, bankTenths, activeChip, isOptimalBuild,
      isPastGw, nextRefreshAt, builtAt, gwUnavailable, gwId, backfilled, entryHistory,
      squadScore: isOptimalBuild ? 100 : computeSquadScore(xiTotal, getOptimalXiTotal(staticData)),
      targetEvent: staticData.targetEvent, teamsById: staticData.teamsById, fixturesByTeam: staticData.fixturesByTeam, allEvents: staticData.allEvents,
      allPlayers: staticData.allPlayers, predictionsById: staticData.predictionsById,
      asOfGwId: staticData.asOfGwId || null, asOfFailedGwId: staticData.asOfFailedGwId || null,
    };
  }

  function finalizeResults(ticket, squad, staticData, bankTenths, entryMeta, activeChip, isOptimalBuild, extra) {
    if (!isCurrent(ticket)) return;
    currentStaticDataRef.current = staticData;
    setResultsData(buildResultsData(squad, staticData, bankTenths, entryMeta, activeChip, isOptimalBuild, extra));
    setStageRaw('results');
  }

  // Edits to a Team ID's squad for the gameweek being planned are kept on
  // this device straight away, so Home and Mini-league show them too.
  useEffect(() => {
    const d = resultsData;
    if (!d || !d.edited || d.isPastGw || !d.entryMeta || !d.entryMeta.teamId) return;
    saveTeamEdit(d.entryMeta.teamId, d.entryMeta.gwId, { ...squadSnapshot(d.squad, d.bankTenths), gwId: d.entryMeta.gwId });
  }, [resultsData]);

  // Called after an in-place squad edit (manual swap, or accepting a
  // transfer suggestion) — recomputes everything derived (predicted total,
  // squad score, fresh transfer suggestions) against the edited squad.
  function handleSquadUpdate(newSquad, newBankTenths) {
    setResultsData(prev => {
      if (!prev || !currentStaticDataRef.current) return prev;
      const next = buildResultsData(newSquad, currentStaticDataRef.current, newBankTenths, prev.entryMeta, prev.activeChip, prev.isOptimalBuild, {
        isPastGw: prev.isPastGw, nextRefreshAt: prev.nextRefreshAt, builtAt: prev.builtAt, gwId: prev.gwId, backfilled: prev.backfilled, entryHistory: prev.entryHistory,
      });
      // Changed since it was loaded or last saved.
      return { ...next, edited: true };
    });
  }

  async function handleStartCustomBuild() {
    const ticket = newTicket();
    showLoading(ticket, 'Loading live player data…');
    loadCustomSquadBuilder();
    try {
      const staticData = await ensureStaticData();
      if (!isCurrent(ticket)) return;
      setCustomStaticData(staticData);
      showStage(ticket, 'customBuild');
      loadResultsScreen(); // next, once the squad is picked
    } catch {
      showError(ticket, "Couldn't load live FPL player data right now. Please try again in a moment.");
    }
  }

  function handleCustomSquadSubmit(squad, bankTenths) {
    const ticket = newTicket();
    if (!customStaticData) { showError(ticket, 'Something went wrong. Please start over. [ERR_NO_STATIC_DATA]'); return; }
    const gwId = currentGwId(customStaticData);
    finalizeResults(ticket, squad, customStaticData, bankTenths, { teamName: 'My Squad', gwId }, null, false, { gwId });
  }

  async function loadOptimalSquadForGw(gwId) {
    const ticket = newTicket();
    showLoading(ticket, `Testing lineups within £${SQUAD_BUDGET.toFixed(1)}m…`);
    loadResultsScreen();
    try {
      const staticData = await ensureStaticData();
      if (!isCurrent(ticket)) return;
      const targetId = currentGwId(staticData);
      const resolvedGwId = gwId || targetId;
      const isPastGw = resolvedGwId < targetId;
      // The saved file for a gameweek number can be last season's.
      const isThisSeason = snap => snapshotIsForSeason(snap, staticData.seasonId, staticData.allEvents);

      if (isPastGw) {
        // Closed gameweek — only ever show the frozen snapshot from when it
        // was current, plus how those players actually scored. Never
        // rebuild: an "optimal squad" recomputed today with today's prices
        // and news for a gameweek that's already over wouldn't mean
        // anything, and would silently disagree with what was shown at the
        // time.
        const [snap, liveById] = await Promise.all([
          fetch(`/api/optimal-squad?gw=${resolvedGwId}`).then(res => (res.ok ? res.json() : null)).catch(() => null),
          liveForGw(resolvedGwId, isGwFinished(staticData, resolvedGwId)),
        ]);
        if (!isCurrent(ticket)) return;

        if (!snap || !Array.isArray(snap.playerIds) || !isThisSeason(snap)) {
          currentStaticDataRef.current = staticData;
          setResultsData({ gwUnavailable: true, isOptimalBuild: true, isPastGw: true, gwId: resolvedGwId, targetEvent: staticData.targetEvent, allEvents: staticData.allEvents });
          showStage(ticket, 'results');
          return;
        }

        const hydrated = hydrateFrozenSquadSnapshot(snap, staticData, liveById);
        if (!hydrated) throw new Error('could not hydrate frozen snapshot');
        finalizeResults(ticket, hydrated.squad, staticData, hydrated.bankTenths, { teamName: 'Optimal Squad' }, null, true, {
          isPastGw: true, builtAt: snap.builtAt, gwId: resolvedGwId, backfilled: !!snap.backfilled,
        });
        return;
      }

      // Current (open) gameweek.
      const cacheKey = `fpl_optimal_squad_${staticData.seasonId || ''}_gw${resolvedGwId}`;
      let squad = null, bankTenths = null, builtAt = null;

      // 1) Prefer the shared snapshot our server refreshes automatically (see
      // api/refresh-optimal.js) — computed once and reused by every visitor,
      // rather than every browser solving the same optimisation on its own.
      try {
        const res = await fetch(`/api/optimal-squad?gw=${resolvedGwId}`);
        if (res.ok) {
          const snap = await res.json();
          if (snap && snap.gwId === resolvedGwId && isThisSeason(snap)) {
            const hydrated = hydrateSquadSnapshot(snap, staticData);
            if (hydrated) { squad = hydrated.squad; bankTenths = hydrated.bankTenths; builtAt = snap.builtAt; }
          }
        }
      } catch { /* server snapshot unavailable — fall through to local cache */ }
      if (!isCurrent(ticket)) return;

      // 2) Fall back to this browser's own cache for the gameweek, so a
      // person isn't forced to wait on a full rebuild every single visit
      // even before the server has a snapshot for this gameweek yet.
      if (!squad) {
        try {
          const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
          const hydrated = cached && cached.gwId === resolvedGwId ? hydrateSquadSnapshot(cached, staticData) : null;
          if (hydrated) { squad = hydrated.squad; bankTenths = hydrated.bankTenths; builtAt = cached.builtAt; }
        } catch { /* corrupt/unavailable cache — fall through to a fresh build */ }
      }

      // 3) Nothing cached anywhere yet — build it fresh right here, and
      // save it locally so at least this device doesn't repeat the work.
      if (!squad) {
        const built = buildOptimalTeam(staticData, SQUAD_BUDGET);
        squad = built.squad;
        bankTenths = built.bankTenths;
        builtAt = new Date().toISOString();
        try {
          localStorage.setItem(cacheKey, JSON.stringify({
            playerIds: squad.map(s => s.player.id),
            startingIds: squad.filter(s => s.isStarting).map(s => s.player.id),
            captainId: built.captainId,
            viceCaptainId: built.viceCaptainId,
            gwId: resolvedGwId,
            builtAt,
          }));
        } catch { /* storage unavailable — non-critical, just won't persist */ }
      }

      // Refreshes once a day at a fixed time (see vercel.json's cron
      // schedule) — countdown to that fixed time directly, rather than to
      // "24h after whichever build happened to load here". The latter
      // resets to ~24h any time the fallback chain lands on a fresh local
      // build instead of the shared server snapshot (e.g. before the cron
      // has ever run, or in a browser/session with no local cache yet),
      // which looks like a broken countdown even though nothing's wrong.
      const nextRefreshAt = getNextDailyRefreshUTC(DAILY_REFRESH_HOUR_UTC);

      finalizeResults(ticket, squad, staticData, bankTenths, { teamName: 'Optimal Squad' }, null, true, {
        isPastGw: false, builtAt, nextRefreshAt, gwId: resolvedGwId,
      });
    } catch {
      showError(ticket, "Couldn't build a squad right now — FPL's data might be temporarily unavailable. Please try again.");
    }
  }

  async function handleViewHindsight() {
    const ticket = newTicket();
    showLoading(ticket, 'Working out what would have scored best…');
    loadHindsightScreen();
    setHindsightCompare(null);
    try {
      const staticData = await ensureStaticData();
      if (!isCurrent(ticket)) return;
      const targetId = currentGwId(staticData);
      // Last CLOSED gameweek: the most recent one whose deadline has
      // passed, i.e. one before whatever's currently open for transfers.
      const closed = (staticData.allEvents || []).filter(e => isEventLocked(e) && e.id < targetId);
      // The gameweek picked in the header, when it's one that has closed;
      // otherwise the latest that has.
      const lastClosed = closed.find(e => e.id === selectedGw)
        || (closed.length ? closed.reduce((a, b) => (b.id > a.id ? b : a)) : null);

      if (!lastClosed) {
        setHindsightData({ gwUnavailable: true, gwId: null, gwName: null });
        showStage(ticket, 'hindsight');
        return;
      }

      const [snap, liveById] = await Promise.all([
        fetch(`/api/optimal-squad?gw=${lastClosed.id}`).then(res => (res.ok ? res.json() : null)).catch(() => null),
        liveForGw(lastClosed.id, !!lastClosed.finished),
      ]);
      if (!isCurrent(ticket)) return;

      if (!snap || !Array.isArray(snap.playerIds) || !snapshotIsForSeason(snap, staticData.seasonId, staticData.allEvents)) {
        setHindsightData({ gwUnavailable: true, gwId: lastClosed.id, gwName: lastClosed.name });
        showStage(ticket, 'hindsight');
        return;
      }

      const hydratedPredicted = hydrateFrozenSquadSnapshot(snap, staticData, liveById);
      if (!hydratedPredicted) throw new Error('could not hydrate frozen snapshot');

      const predictedScore = hydratedPredicted.squad
        .filter(s => s.isStarting)
        .reduce((s, sl) => s + (sl.actualPoints || 0) * (sl.multiplier || 1), 0);

      const best = buildHindsightSquad(staticData.allPlayers, liveById, SQUAD_BUDGET);

      setHindsightData({
        gwId: lastClosed.id, gwName: lastClosed.name,
        predictedSquad: hydratedPredicted.squad, predictedScore,
        hindsightSquad: best.squad, hindsightScore: best.totalScore,
        teamsById: staticData.teamsById, liveById,
      });
      showStage(ticket, 'hindsight');
    } catch {
      showError(ticket, "Couldn't work out the best XI right now — FPL's data might be temporarily unavailable. Please try again.");
    }
  }

  // Loads one of the user's saved teams (a Team ID or a custom squad) into
  // the hindsight comparison, showing what it actually scored that
  // gameweek alongside the predicted-optimal and best-possible squads. A
  // newer pick replaces an older one still loading.
  const compareTicketRef = useRef(0);
  async function handleCompareSavedInHindsight(entry) {
    if (!hindsightData || hindsightData.gwUnavailable) return;
    const ticket = ++compareTicketRef.current;
    const show = value => { if (ticket === compareTicketRef.current) setHindsightCompare(value); };
    show({ loading: true, entry, label: entry.label });
    try {
      const staticData = await ensureStaticData();
      const gwId = hindsightData.gwId;
      const liveById = hindsightData.liveById || {};

      if (entry.type === 'teamId') {
        let picks;
        try {
          picks = await fetchFplJson(`entry/${entry.teamId}/event/${gwId}/picks/`);
        } catch (e) {
          const notReady = e && e.message === 'status 404';
          show({
            loading: false, entry, label: entry.label,
            error: notReady ? `This team didn't exist yet in ${hindsightData.gwName} — nothing to compare.` : "Couldn't fetch that team's picks for this gameweek right now.",
          });
          return;
        }
        if (!picks || picks.detail === 'Not found.' || !Array.isArray(picks.picks) || picks.picks.length === 0) {
          show({ loading: false, entry, label: entry.label, error: "Couldn't find picks for that team in this gameweek." });
          return;
        }
        const rawSquad = picks.picks.map(pk => {
          const player = staticData.playersById[pk.element];
          if (!player) return null;
          const live = liveById[pk.element];
          return {
            player, isStarting: pk.position <= 11, isCaptain: !!pk.is_captain, isViceCaptain: !!pk.is_vice_captain,
            multiplier: pk.multiplier,
            actualPoints: live ? live.totalPoints : 0,
            played: live ? live.minutes > 0 : false,
          };
        }).filter(Boolean);
        // FPL's own automatic subs, so the squad and score reflect what
        // actually happened rather than the manager's original picks. The
        // gameweek may still be being played: then there are none yet and
        // the captain keeps the armband.
        const squad = applyAutomaticSubs(rawSquad, picks.automatic_subs, { finished: isGwFinished(staticData, gwId) });
        // FPL's multipliers already say who counts: 0 for the bench (1 for
        // everyone under Bench Boost), 2 or 3 for the captain.
        const totalScore = squad.reduce((s, slot) => s + slot.actualPoints * (slot.multiplier || 0), 0);
        show({ loading: false, entry, label: entry.label, squad, score: totalScore });
        return;
      }

      // Custom saved squad — no real historical picks exist for it, so
      // work out the best XI it could have fielded from those exact 15
      // players using that gameweek's actual scores.
      const result = buildSavedSquadActualPerformance(
        entry.squad.playerIds, entry.squad.captainId, entry.squad.viceCaptainId, liveById, staticData.playersById
      );
      if (!result) {
        show({ loading: false, entry, label: entry.label, error: "Couldn't match this saved squad's players to current data." });
        return;
      }
      show({ loading: false, entry, label: entry.label, squad: result.squad, score: result.totalScore });
    } catch {
      show({ loading: false, entry, label: entry.label, error: 'Something went wrong loading that comparison.' });
    }
  }

  // Loads a team's squad for `gwId`, scored with that gameweek's data.
  // Shared by the Team ID results and the home screen's summary. Throws
  // { code } (see TEAM_ERRORS); returns null if `isStale()` says the
  // answer is no longer wanted.
  async function loadTeamForGw(teamId, gwId, staticData, { isStale = () => false, onProgress = () => {}, savedSquad = null } = {}) {
    const targetId = currentGwId(staticData);
    const isPastGwView = gwId < targetId;
    const hasPicks = p => p && !p.detail && Array.isArray(p.picks) && p.picks.length > 0;

    // Everything that only depends on the gameweek starts straight away,
    // alongside the team's own lookups.
    const gwStaticPromise = isPastGwView ? staticDataForGw(gwId) : Promise.resolve(staticData);
    const livePromise = isPastGwView ? liveForGw(gwId, isGwFinished(staticData, gwId)) : Promise.resolve({});
    const settle = promise => promise.then(value => ({ value }), error => ({ error }));
    const [picksResult, entryResult] = await Promise.all([
      settle(fetchFplJson(`entry/${teamId}/event/${gwId}/picks/`)),
      settle(fetchFplJson(`entry/${teamId}/`)),
    ]);
    if (isStale()) return null;
    const is404 = r => !!(r.error && r.error.message === 'status 404');

    // A 404 for the picks means either a bad Team ID or picks FPL hides
    // until the deadline passes — the entry lookup tells them apart.
    if (picksResult.error && !is404(picksResult)) throw { code: 'ERR_PICKS_FETCH' };
    let picks = picksResult.value || null;
    const entry = entryResult.value && !entryResult.value.detail ? entryResult.value : null;
    if (!hasPicks(picks)) {
      if (is404(entryResult)) throw { code: 'ERR_TEAM_NOT_FOUND' };
      // FPL couldn't be reached for the team itself: don't claim the ID
      // is wrong.
      if (entryResult.error) throw { code: 'ERR_PICKS_FETCH' };
    }
    if (entry && entry.started_event && gwId < entry.started_event) {
      throw { code: 'ERR_TEAM_NOT_STARTED', startedEvent: entry.started_event, gwId };
    }

    const entryMeta = { teamId: Number(teamId), gwId };
    if (entry) entryMeta.teamName = entry.name || 'Your Squad';

    // FPL hides a team's picks for a gameweek until its deadline passes.
    // Rather than give up, load the most recent gameweek we *can* see —
    // the squad is the same unless they've made transfers since — and
    // score it for the gameweek that was asked for. Only for the
    // upcoming gameweek: a missing past gameweek means the team didn't
    // exist yet, and borrowing a later squad there would be wrong.
    let picksGwId = gwId;
    if (!hasPicks(picks) && !isPastGwView && entry) {
      onProgress("This gameweek's picks are hidden until the deadline — loading your latest team…");
      const earliest = entry.started_event || 1;
      let candidate = Math.min(gwId - 1, entry.current_event || gwId - 1);
      // A few steps is plenty: one for the hidden gameweek, one more to
      // skip a Free Hit week (that squad reverts afterwards).
      for (let tries = 0; candidate >= earliest && tries < 4; tries++, candidate--) {
        let prev = null;
        try {
          prev = await fetchFplJson(`entry/${teamId}/event/${candidate}/picks/`);
        } catch { /* not visible either — keep walking back */ }
        if (isStale()) return null;
        if (!hasPicks(prev)) continue;
        if (prev.active_chip === 'freehit') continue;
        picks = prev;
        picksGwId = candidate;
        break;
      }
    }
    if (!hasPicks(picks)) {
      throw { code: entry ? 'ERR_GW_LOCKED' : 'ERR_TEAM_NOT_FOUND' };
    }
    const borrowed = picksGwId !== gwId;
    if (borrowed) entryMeta.picksFromGwId = picksGwId;

    onProgress(isPastGwView ? 'Rebuilding player data from before that deadline…' : 'Checking fixtures and working out predictions…');
    const [gwStatic, liveById] = await Promise.all([gwStaticPromise, livePromise]);
    if (isStale()) return null;

    const rawSquad = scoreSlots(picks.picks.map(pk => ({
      playerId: pk.element, isStarting: pk.position <= 11, isCaptain: !!pk.is_captain, isViceCaptain: !!pk.is_vice_captain,
      // A borrowed week's chips (Triple Captain, Bench Boost) don't carry
      // over, so its multipliers are reset to a normal week's.
      multiplier: borrowed ? (pk.is_captain ? 2 : (pk.position <= 11 ? 1 : 0)) : pk.multiplier,
    })), gwStatic, liveById, isPastGwView);
    // Only meaningful once the gameweek is closed — automatic_subs is
    // empty for a gameweek still in progress (there's nothing final to
    // apply yet), so this is a no-op for the live/current-gw view.
    const squad = isPastGwView ? applyAutomaticSubs(rawSquad, picks.automatic_subs, { finished: isGwFinished(staticData, gwId) }) : rawSquad;

    // Changes saved to the account for this gameweek replace the picks on
    // FPL. Only for the gameweek being planned: once it has started, its
    // real picks are what scored.
    const saved = savedSquad && !isPastGwView ? hydrateSquadSnapshot(savedSquad, gwStatic, { keepStartingXi: true }) : null;
    if (saved) {
      return {
        squad: saved.squad, gwStatic, entry, isPastGwView, entryHistory: null, bankTenths: saved.bankTenths, activeChip: null,
        entryMeta: { teamId: entryMeta.teamId, gwId, teamName: entryMeta.teamName, savedChanges: true, changesOnDevice: !!savedSquad.onDevice },
      };
    }

    return {
      squad, gwStatic, entry, entryMeta, isPastGwView,
      // The picks themselves, for callers that also want the week's points.
      picks: borrowed ? null : picks,
      // FPL's own record of the week (points, hit, ranks), for a gameweek
      // whose picks are its own.
      entryHistory: borrowed ? null : (picks.entry_history || null),
      bankTenths: picks.entry_history ? picks.entry_history.bank : 0,
      // A chip played in an earlier gameweek doesn't carry over.
      activeChip: borrowed ? null : (picks.active_chip || null),
    };
  }

  // `gwOverride` loads that gameweek instead of the selected one.
  // `ignoreSaved` shows the picks on FPL even when changes are saved.
  async function handleTeamIdSubmit(rawId, gwOverride, { ignoreSaved = false } = {}) {
    const ticket = newTicket();
    const teamId = (rawId || '').trim();
    if (!/^\d+$/.test(teamId)) {
      showError(ticket, 'Enter a numeric Team ID — just the number from your FPL URL.');
      return;
    }
    showLoading(ticket, 'Pulling live player data…');
    loadResultsScreen();
    try {
      let staticData;
      try {
        staticData = await ensureStaticData();
      } catch {
        throw { code: 'ERR_STATIC_DATA' };
      }
      if (!isCurrent(ticket)) return;
      showLoading(ticket, 'Fetching your team…');
      const gwId = gwOverride || selectedGw || currentGwId(staticData);
      const team = await loadTeamForGw(teamId, gwId, staticData, {
        isStale: () => !isCurrent(ticket),
        onProgress: message => showLoading(ticket, message),
        savedSquad: ignoreSaved ? null : teamChangesFor(savedTeams, teamId, gwId),
      });
      if (!team) return;
      // The first team someone checks becomes the one Home shows.
      if (!homeTeam.teamId) rememberHomeTeam(teamId);
      finalizeResults(ticket, team.squad, team.gwStatic, team.bankTenths, team.entryMeta, team.activeChip, false, { isPastGw: team.isPastGwView, gwId, entryHistory: team.entryHistory });
    } catch (e) {
      const code = (e && e.code) || 'ERR_UNKNOWN';
      const action = code === 'ERR_TEAM_NOT_STARTED' ? {
        label: `Show Gameweek ${e.startedEvent}`,
        run: () => { setSelectedGw(e.startedEvent); handleTeamIdSubmit(teamId, e.startedEvent); },
      } : null;
      showError(ticket, `${teamErrorMessage(e)} [${code}]`, action);
    }
  }

  /* ---------- Home: the remembered team's summary ---------- */

  const homeTicketRef = useRef(0);
  // The menu item to highlight while loading or on an error.
  const lastNavRef = useRef('home');
  function rememberHomeTeam(teamId) {
    const id = teamId ? String(teamId) : null;
    try {
      if (id) localStorage.setItem(HOME_TEAM_KEY, id);
      else localStorage.removeItem(HOME_TEAM_KEY);
    } catch { /* storage unavailable: remembered for this visit only */ }
    homeTicketRef.current += 1;
    setHomeTeam({ teamId: id, status: 'idle', data: null, error: null });
  }

  async function loadHomeTeam(teamId) {
    const ticket = ++homeTicketRef.current;
    const isStale = () => ticket !== homeTicketRef.current;
    setHomeTeam(h => ({ ...h, teamId, status: 'loading', error: null }));
    try {
      let staticData;
      try {
        staticData = await ensureStaticData();
      } catch {
        throw { code: 'ERR_STATIC_DATA' };
      }
      const gwId = selectedGw || currentGwId(staticData);
      const savedSquad = teamChangesFor(savedTeams, teamId, gwId);
      const team = await loadTeamForGw(teamId, gwId, staticData, { isStale, savedSquad });
      if (!team || isStale()) return;
      const data = buildResultsData(team.squad, team.gwStatic, team.bankTenths, team.entryMeta, team.activeChip, false, { isPastGw: team.isPastGwView, gwId, entryHistory: team.entryHistory });
      setHomeTeam({ teamId, status: 'ready', data: { ...data, entry: team.entry }, error: null, loadedAt: Date.now(), staticData: team.gwStatic, savedSquad });
    } catch (e) {
      if (!isStale()) setHomeTeam({ teamId, status: 'error', data: null, error: teamErrorMessage(e) });
    }
  }

  // Shows the summary's squad as full results, without loading it again.
  function openHomeTeam() {
    if (homeTeam.status !== 'ready') { handleTeamIdSubmit(homeTeam.teamId); return; }
    if (selectedGw && selectedGw !== homeTeam.data.gwId) { handleTeamIdSubmit(homeTeam.teamId); return; }
    newTicket();
    currentStaticDataRef.current = homeTeam.staticData;
    setResultsData(homeTeam.data);
    setStageRaw('results');
  }

  // Load the summary when Home is shown and it's missing, for another
  // gameweek than the one picked, or more than ten minutes old. Picking a
  // gameweek also retries after an error.
  const homeGwRef = useRef(selectedGw);
  useEffect(() => {
    const gwChanged = homeGwRef.current !== selectedGw;
    homeGwRef.current = selectedGw;
    if (stage !== 'home' || !homeTeam.teamId || homeTeam.status === 'loading' || (homeTeam.status === 'error' && !gwChanged)) return;
    const target = selectedGw || (staticDataRef.current ? currentGwId(staticDataRef.current) : null);
    // Saved changes arriving (after logging in) or changing also count.
    const fresh = homeTeam.status === 'ready' && homeTeam.data && homeTeam.data.gwId === target
      && JSON.stringify(homeTeam.savedSquad) === JSON.stringify(teamChangesFor(savedTeams, homeTeam.teamId, target))
      && Date.now() - homeTeam.loadedAt < 10 * 60 * 1000;
    if (!fresh) loadHomeTeam(homeTeam.teamId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, homeTeam.teamId, homeTeam.status, gwOptions, selectedGw, savedTeams]);

  // Keep the address in step with the gameweek picked: the default one
  // needs no ?gw, any other is written in.
  useEffect(() => {
    const target = liveStatic && liveStatic.targetEvent ? defaultGwId(liveStatic) : null;
    if (!target) return;
    writeGwParam(selectedGw && selectedGw !== target ? selectedGw : null);
  }, [selectedGw, liveStatic]);

  // Points scored by every player in the picked gameweek, for Home's
  // recap of a gameweek that has started.
  const [homeLive, setHomeLive] = useState(null); // { gwId, liveById }
  useEffect(() => {
    const target = liveStatic && liveStatic.targetEvent ? liveStatic.targetEvent.id : null;
    if (stage !== 'home' || !target || !selectedGw || selectedGw >= target) return undefined;
    if (homeLive && homeLive.gwId === selectedGw) return undefined;
    let cancelled = false;
    liveForGw(selectedGw, isGwFinished(liveStatic, selectedGw)).then(liveById => {
      if (!cancelled) setHomeLive({ gwId: selectedGw, liveById });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, selectedGw, liveStatic]);

  // Someone logged in without a team on this device: use their first
  // saved Team ID.
  useEffect(() => {
    if (homeTeam.teamId) return;
    const saved = savedTeams.find(t => t.type === 'teamId' && t.teamId);
    if (saved) rememberHomeTeam(saved.teamId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTeams]);

  // Reads the screenshot with OCR in the browser (no server, no AI
  // service), finds FPL player names in the text, then hands off to the
  // same review screen as every other squad source. Prices come from live
  // FPL data once each player is matched.
  async function handleScreenshot(shot) {
    const ticket = newTicket();
    setReviewShotImg(shot.img);
    showLoading(ticket, 'Loading player data…');
    let staticData;
    try {
      staticData = await ensureStaticData();
    } catch {
      showError(ticket, "Couldn't load live FPL player data right now. Try again in a moment. [ERR_STATIC_DATA]");
      return;
    }
    if (!isCurrent(ticket)) return;
    let extracted;
    try {
      showLoading(ticket, 'Reading your screenshot…');
      const { readSquadFromScreenshot } = await import('./lib/screenshotOcr.js');
      extracted = await readSquadFromScreenshot(shot.img, staticData.allPlayers, p => {
        showLoading(ticket, `Reading your screenshot… ${Math.round(p * 100)}%`);
      }, { teamsById: staticData.teamsById, fixturesByTeam: staticData.fixturesByTeam });
    } catch (e) {
      showError(ticket, `Couldn't read that screenshot (${(e && e.message) || 'OCR failed'}). Try again, or enter your Team ID instead. [ERR_OCR]`);
      return;
    }
    if (!isCurrent(ticket)) return;
    if (extracted.not_fpl_screenshot) {
      showError(ticket, "We couldn't find any FPL players in that image. Use a clear, uncropped screenshot of your Pick Team or Points page and try again. [ERR_NOT_FPL_SCREENSHOT]");
      return;
    }
    showLoading(ticket, 'Matching players…');
    setReviewSlots(matchExtractedSquad(extracted, staticData.playersByPosition, staticData.allPlayers, staticData.teamsById));
    setReviewBank(typeof extracted.bank_millions === 'number' ? extracted.bank_millions : null);
    setPendingStaticData(staticData);
    showStage(ticket, 'review');
    loadResultsScreen(); // next, once the squad is confirmed
  }

  function updateSlotMatch(index, player) {
    setReviewSlots(prev => prev.map((s, i) => i === index ? { ...s, matched: player, manuallyFixed: true } : s));
  }

  // Only one captain and one vice-captain at a time, never the same player
  // as both, and only for starters. Clicking the checkbox that's already
  // checked for a player unsets it (so you can end up with none selected
  // mid-edit, rather than being forced to immediately pick a replacement).
  function updateSlotCaptain(index) {
    setReviewSlots(prev => prev.map((s, i) => {
      if (i === index) {
        const nowCaptain = !s.isCaptain && s.isStarting;
        return { ...s, isCaptain: nowCaptain, isViceCaptain: nowCaptain ? false : s.isViceCaptain };
      }
      return { ...s, isCaptain: false };
    }));
  }

  function updateSlotViceCaptain(index) {
    setReviewSlots(prev => prev.map((s, i) => {
      if (i === index) {
        const nowVice = !s.isViceCaptain && s.isStarting;
        return { ...s, isViceCaptain: nowVice, isCaptain: nowVice ? false : s.isCaptain };
      }
      return { ...s, isViceCaptain: false };
    }));
  }

  // Moves a read player between the starting XI and the bench (the reader
  // can get that wrong when it misses a name). A benched player loses any
  // armband.
  function updateSlotStarting(index) {
    setReviewSlots(prev => prev.map((s, i) => {
      if (i !== index) return s;
      const isStarting = !s.isStarting;
      return isStarting ? { ...s, isStarting } : { ...s, isStarting, isCaptain: false, isViceCaptain: false };
    }));
  }

  async function handleConfirmReview() {
    const ticket = newTicket();
    if (!pendingStaticData) { showError(ticket, 'Something went wrong. Please start over. [ERR_NO_STATIC_DATA]'); return; }

    const matched = reviewSlots.filter(slot => slot.matched);
    if (matched.length < 11 || matched.length !== reviewSlots.length) {
      showError(ticket, 'A few players are still unmatched. Go back and fix them. [ERR_UNMATCHED_PLAYERS]');
      return;
    }
    // The review screen won't let a broken squad through, but double-check.
    if (squadProblems(matched.map(s => s.matched), matched.filter(s => s.isStarting).map(s => s.matched)).length) {
      showError(ticket, "That squad isn't a valid FPL squad yet. Go back and fix the highlighted problems. [ERR_INVALID_SQUAD]");
      return;
    }

    try {
      // Current data, in case a deadline passed while the squad was checked.
      const staticData = await ensureStaticData();
      if (!isCurrent(ticket)) return;
      const targetId = currentGwId(staticData);
      const gwId = selectedGw || targetId;
      const isPastGwView = gwId < targetId;

      // A past gameweek is predicted from what was known before its deadline.
      if (isPastGwView) showLoading(ticket, 'Rebuilding player data from before that deadline…');
      const [gwStatic, liveById] = await Promise.all([
        isPastGwView ? staticDataForGw(gwId) : Promise.resolve(staticData),
        isPastGwView ? liveForGw(gwId, isGwFinished(staticData, gwId)) : Promise.resolve({}),
      ]);
      if (!isCurrent(ticket)) return;

      const squad = scoreSlots(matched.map(slot => ({
        playerId: slot.matched.id, isStarting: slot.isStarting, isCaptain: !!slot.isCaptain, isViceCaptain: !!slot.isViceCaptain,
        multiplier: slot.isCaptain ? 2 : (slot.isStarting ? 1 : 0),
      })), gwStatic, liveById, isPastGwView);

      const bankTenths = reviewBank != null && !Number.isNaN(reviewBank) ? Math.max(0, Math.round(reviewBank * 10)) : 0;
      finalizeResults(ticket, ensureCaptaincy(squad), gwStatic, bankTenths, { gwId }, null, false, { isPastGw: isPastGwView, gwId });
    } catch {
      showError(ticket, "Couldn't load live FPL player data right now. Try again in a moment. [ERR_STATIC_DATA]");
    }
  }

  function goHome() {
    setStage('home');
    setResultsData(null);
    setTeamIdInput('');
    setHindsightData(null);
    setHindsightCompare(null);
  }

  // The menu (sidebar on a computer, footer on a phone). Hidden on the
  // welcome page, which has its own Start button.
  const install = useInstallPrompt();
  // A mini-league member's team for gameweek `gwId` (the one picked in the
  // header; the one being planned when that's later), with its predicted
  // points. Kept as one function across renders: the league screen reloads
  // its teams whenever this changes.
  const loadLeagueTeamRef = useRef(null);
  // Also their points that gameweek once it has started (otherwise in the
  // latest gameweek to have started; null before the season), their
  // season so far, and the numbers the league analysis needs.
  loadLeagueTeamRef.current = async (entryId, gwId) => {
    const staticData = await ensureStaticData();
    const target = currentGwId(staticData);
    const gw = gwId && gwId < target ? gwId : target;
    const started = gw < target;
    const weekGw = started ? gw : liveGwIdFor(staticData);
    const optional = path => fetchFplJson(path).catch(() => null);
    const [result, liveById, transfers, history] = await Promise.all([
      loadTeamForGw(entryId, gw, staticData, { savedSquad: started ? null : teamChangesFor(savedTeams, entryId, gw) }).catch(e => {
        // A team that joined after this gameweek has nothing to show for it.
        if (e && e.code === 'ERR_TEAM_NOT_STARTED') return { notStarted: true };
        throw e;
      }),
      weekGw ? liveForGw(weekGw, isGwFinished(staticData, weekGw)) : {},
      optional(`entry/${entryId}/transfers/`),
      optional(`entry/${entryId}/history/`),
    ]);
    if (!result) return null;
    const seasonSoFar = history && Array.isArray(history.current)
      ? history.current.map(r => ({ event: r.event, points: r.points - (r.event_transfers_cost || 0), total: r.total_points })) : null;
    // A finished week's points from FPL's own record, which counts
    // automatic subs; one still being played from the picks and live scores.
    const weekRow = seasonSoFar && weekGw && isGwFinished(staticData, weekGw) ? seasonSoFar.find(r => r.event === weekGw) : null;
    if (result.notStarted) return { squad: [], xiTotal: 0, livePoints: null, notStarted: true, history: seasonSoFar, stats: null };
    // The week's picks: already loaded when that's the gameweek shown.
    const livePicks = !weekGw ? null : (started && result.picks ? result.picks : await optional(`entry/${entryId}/event/${weekGw}/picks/`));
    return {
      squad: result.squad, xiTotal: predictedXiTotal(result.squad),
      livePoints: weekRow ? weekRow.points : weekGw ? livePointsFor(livePicks, liveById) : null,
      picksFromGwId: result.entryMeta.picksFromGwId || null, edited: !!result.entryMeta.savedChanges,
      history: seasonSoFar,
      // For the league analysis (most captained, best transfers and so on).
      stats: memberWeekStats({ gw: weekGw, picks: livePicks, liveById, transfers, entry: result.entry, history }),
    };
  };
  const loadLeagueTeam = useCallback((entryId, gwId) => loadLeagueTeamRef.current(entryId, gwId), []);

  /* ---------- The gameweek recap ---------- */

  // { gwId, teamId, status: 'loading' | 'ready' | 'error', data, error, open }
  const [recap, setRecap] = useState(null);
  const recapTicketRef = useRef(0);

  // One mini-league for the recap: its standings and what its members
  // captained in gameweek `gwId` (their picks, a few at a time).
  async function loadRecapLeague(leagueId, gwId) {
    const parsed = parseStandings(await fetchFplJson(`leagues-classic/${leagueId}/standings/`));
    if (!parsed) return null;
    const staticData = await ensureStaticData();
    const byPlayer = {};
    const names = {};
    let counted = 0;
    await forEachLimited(parsed.members, 6, m => fetchFplJson(`entry/${m.entry}/event/${gwId}/picks/`), (m, picks) => {
      const captain = picks && Array.isArray(picks.picks) ? picks.picks.find(p => p.is_captain) : null;
      if (!captain) return;
      counted += 1;
      byPlayer[captain.element] = (byPlayer[captain.element] || 0) + 1;
      const player = staticData.playersById[captain.element];
      if (player) names[captain.element] = player.webName;
    });
    return { id: parsed.league.id, name: parsed.league.name, members: parsed.members, hasMore: parsed.hasMore, captains: { byPlayer, names, counted } };
  }

  // Everything the recap's slides show for the Home team's gameweek `gwId`.
  // `open` shows it straight away (from the button on Home); otherwise
  // (the pop-up once a gameweek ends) it only opens if it loads.
  async function openRecap(gwId, { open = true } = {}) {
    const teamId = homeTeam.teamId;
    if (!teamId || !gwId) return;
    const ticket = ++recapTicketRef.current;
    const isStale = () => ticket !== recapTicketRef.current;
    recapChunk.load().catch(() => {});
    setRecap({ gwId, teamId, status: 'loading', data: null, error: null, open });
    try {
      let staticData;
      try {
        staticData = await ensureStaticData();
      } catch {
        throw { code: 'ERR_STATIC_DATA' };
      }
      const optional = promise => promise.catch(() => null);
      const event = staticData.allEvents.find(e => e.id === gwId) || null;
      const topEntry = event && event.highest_scoring_entry;
      const [team, history, transfers, liveById, snap, accuracy, topPicks, topMeta] = await Promise.all([
        loadTeamForGw(teamId, gwId, staticData, { isStale }),
        optional(fetchFplJson(`entry/${teamId}/history/`)),
        optional(fetchFplJson(`entry/${teamId}/transfers/`)),
        liveForGw(gwId, isGwFinished(staticData, gwId)),
        optional(fetch(`/api/optimal-squad?gw=${gwId}`).then(res => (res.ok ? res.json() : null))),
        optional(fetch(`/api/accuracy?gw=${gwId}`).then(res => (res.ok ? res.json() : null))),
        // The week's highest-scoring manager's team.
        topEntry ? optional(fetchFplJson(`entry/${topEntry}/event/${gwId}/picks/`)) : null,
        topEntry ? optional(fetchFplJson(`entry/${topEntry}/`)) : null,
      ]);
      if (!team || isStale()) return;
      // The mini-leagues, while no later gameweek has started (their
      // standings are FPL's current ones). The one last picked on the
      // Mini-league screen is shown first if the team is in it; the others
      // load when picked.
      const leagues = liveGwIdFor(staticData) === gwId && team.entry ? privateLeagues(team.entry) : [];
      const saved = Number((() => { try { return localStorage.getItem('fpl_league_id'); } catch { return null; } })());
      const first = leagues.find(l => l.id === saved) || leagues[0];
      const league = first ? await optional(loadRecapLeague(first.id, gwId)) : null;
      if (isStale()) return;
      // The app's best squad for the week (as saved before its deadline) and
      // the best XI anyone could have picked, as on Look back.
      const frozen = snap && Array.isArray(snap.playerIds) && snapshotIsForSeason(snap, staticData.seasonId, staticData.allEvents)
        ? hydrateFrozenSquadSnapshot(snap, staticData, liveById) : null;
      const modelScore = frozen ? frozen.squad.filter(s => s.isStarting).reduce((sum, s) => sum + (s.actualPoints || 0) * (s.multiplier || 1), 0) : null;
      const best = buildHindsightSquad(staticData.allPlayers, liveById, SQUAD_BUDGET);
      const data = buildRecap({
        gwId, gwName: event ? event.name : `Gameweek ${gwId}`, teamId: Number(teamId),
        teamName: (team.entryMeta && team.entryMeta.teamName) || `Team ${teamId}`,
        squad: team.squad, entryHistory: team.entryHistory, activeChip: team.activeChip, entry: team.entry,
        event, events: staticData.allEvents, totalPlayers: staticData.totalPlayers, history, transfers, liveById,
        playersById: staticData.playersById, allPlayers: staticData.allPlayers, teamsById: staticData.teamsById,
        fixturesByTeam: staticData.fixturesByTeam, predictionsById: staticData.predictionsById,
        top: topPicks && !topPicks.detail ? { name: (topMeta && topMeta.name) || 'Top team', picks: topPicks } : null,
        league, leagues, modelScore, bestScore: best.totalScore, modelSquad: frozen ? frozen.squad : null, bestSquad: best.squad,
        accuracy,
      });
      setRecap({ gwId, teamId, status: 'ready', data, error: null, open: true });
    } catch (e) {
      if (isStale()) return;
      setRecap(r => (r && r.open ? { ...r, status: 'error', error: teamErrorMessage(e) } : null));
    }
  }

  // Once a gameweek is over, its recap pops up on Home, once per team on
  // this device.
  useEffect(() => {
    if (stage !== 'home' || !liveStatic || !homeTeam.teamId || recap) return;
    const gwId = lastFinishedGw(liveStatic.allEvents);
    if (!gwId || recapSeenFor(homeTeam.teamId) >= gwId) return;
    markRecapSeen(homeTeam.teamId, gwId);
    openRecap(gwId, { open: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, liveStatic, homeTeam.teamId]);

  const navItems = [
    { id: 'home', label: 'Home', desc: 'Your gameweek and the fixture ticker', group: 'Your team', Icon: House, footer: true, run: () => setStage('home') },
    {
      id: 'team', label: 'My team', desc: 'Every player in your squad, predicted', group: 'Your team', Icon: Shirt, footer: true,
      run: () => (homeTeam.teamId ? handleTeamIdSubmit(homeTeam.teamId) : setStage('teamIdForm')),
    },
    { id: 'league', label: 'Mini-league', desc: 'Your leagues, every team predicted', group: 'Your team', Icon: Users, run: () => setStage('league') },
    { id: 'screenshot', label: 'Screenshot', desc: 'Read a squad from a screenshot', group: 'Your team', Icon: Camera, footer: true, run: () => setStage('screenshotForm') },
    { id: 'best', label: 'Best squad', desc: 'The top-predicted 15 for £100m', group: 'Tools', Icon: Trophy, footer: true, run: () => loadOptimalSquadForGw(selectedGw) },
    { id: 'build', label: 'Build a squad', desc: 'Pick your own and preview chips', group: 'Tools', Icon: Wand2, run: handleStartCustomBuild },
    ...(gwOptions.some(e => isEventLocked(e)) ? [{ id: 'lookback', label: 'Look back', desc: 'Past gameweeks against the best XI', group: 'Tools', Icon: History, run: handleViewHindsight }] : []),
    { id: 'saved', label: 'Saved teams', desc: 'Team IDs and squads on your account', group: 'Tools', Icon: Bookmark, run: () => (session ? setStage('myTeams') : openAuthDialog('login')) },
    { id: 'about', label: 'About this app', desc: 'What it does and how it predicts', group: 'App', Icon: Info, run: () => setStage('welcome') },
    ...(install ? [{ id: 'install', label: 'Install the app', desc: 'Open it full screen, like an app', group: 'App', Icon: Download, run: install }] : []),
  ];
  // After a reload, reopen the screen that was open (see readViewParam).
  useEffect(() => {
    const view = restoreViewRef.current;
    if (!view || stage !== 'home') return;
    restoreViewRef.current = null;
    const teamParam = readTeamParam();
    if (view === 'team' && teamParam) { handleTeamIdSubmit(teamParam); return; }
    // Look back is only in the menu once the gameweeks are known.
    if (view === 'lookback') { handleViewHindsight(); return; }
    const item = navItems.find(i => i.id === view);
    if (item) item.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const showNav = stage !== 'welcome' && stage !== 'boot';
  const wideStage = stage === 'home' || stage === 'welcome' || stage === 'league' || stage === 'customBuild';
  const activeNav = navSectionFor(stage, resultsData) || lastNavRef.current;
  lastNavRef.current = activeNav;

  // Keep the screen open in the address. Loading and error screens keep
  // the one they came from; nothing is written until a reload's screen
  // has been reopened.
  const resultsTeamId = stage === 'results' && resultsData && resultsData.entryMeta && resultsData.entryMeta.teamId ? String(resultsData.entryMeta.teamId) : null;
  useEffect(() => {
    if (stage === 'boot' || stage === 'loading' || stage === 'error' || restoreViewRef.current) return;
    writeInApp(stage !== 'welcome');
    if (stage === 'welcome') { writeParams({ view: null, team: null }); return; }
    writeParams({
      view: RESTORABLE_VIEWS.includes(activeNav) ? activeNav : null,
      team: resultsTeamId && resultsTeamId !== String(homeTeam.teamId) ? resultsTeamId : null,
    });
  }, [stage, activeNav, resultsTeamId, homeTeam.teamId]);

  // The summary row under the header: the squad on the results screen, or
  // on Home the remembered team for the picked gameweek.
  const summaryData = stage === 'results' ? resultsData
    : (stage === 'home' && homeTeam.status === 'ready' && homeTeam.data && homeTeam.data.gwId === (selectedGw || homeTeam.data.gwId) ? homeTeam.data : null);
  const headerSummary = (summaryData && !summaryData.gwUnavailable) ? {
    gwLabel: summaryData.isPastGw
      ? ((summaryData.allEvents?.find(e => e.id === summaryData.gwId))?.name || '')
      : (summaryData.targetEvent ? summaryData.targetEvent.name : ''),
    countdown: summaryData.isPastGw ? '' : (summaryData.targetEvent ? formatCountdown(summaryData.targetEvent.deadline_time) : ''),
    countdownSoon: !summaryData.isPastGw && !!summaryData.targetEvent && isDeadlineSoon(summaryData.targetEvent.deadline_time),
    xiTotal: summaryData.xiTotal,
    actualXiTotal: summaryData.isPastGw ? officialGwPoints(summaryData) : null,
  } : null;

  // The mini-league follows the gameweek picked in the header: one that has
  // started shows its points and positions; the one being planned shows the
  // latest points and its predictions.
  const leagueTarget = liveStatic && liveStatic.targetEvent ? liveStatic.targetEvent.id : null;
  const leagueGw = leagueTarget ? (selectedGw && selectedGw < leagueTarget ? selectedGw : leagueTarget) : null;
  const leagueGwEvent = liveStatic && leagueGw ? liveStatic.allEvents.find(e => e.id === leagueGw) : null;
  const leagueWeekGw = leagueGw && leagueGw < leagueTarget ? leagueGw : (liveStatic ? liveGwIdFor(liveStatic) : null);

  return (
    <div className={`fpl-root${showNav ? ' fpl-has-nav' : ''}`}>
      {showNav && (
        <Header
          summary={headerSummary}
          gwOptions={gwOptions}
          selectedGw={selectedGw}
          onSelectGw={setSelectedGw}
          onGoHome={goHome}
          session={session}
          onLoginClick={() => openAuthDialog('login')}
          onEmailClick={() => openAuthDialog('email')}
          onMyTeamsClick={() => setStage('myTeams')}
          onLogoutClick={handleLogout}
        />
      )}
      <div className="fpl-shell">
      {showNav && <SideNav items={navItems} active={activeNav} />}
      <main ref={mainRef} tabIndex={-1} className={`fpl-main${wideStage ? ' fpl-main-wide' : ''}`}>
        <ScreenErrorBoundary key={stage}>
          <Suspense fallback={<LoadingScreen />}>
            {stage === 'boot' && <LoadingScreen />}
            {stage === 'welcome' && (
              <WelcomeScreen
                loggedIn={!!session}
                onStart={() => setStage('home')}
                onSignUp={() => openAuthDialog('register')}
                onLogIn={() => openAuthDialog('login')}
              />
            )}
            {stage === 'home' && (
              <HomeScreen
                staticData={liveStatic}
                selectedGw={selectedGw}
                live={homeLive && homeLive.gwId === selectedGw ? homeLive.liveById : null}
                homeTeam={homeTeam}
                onCheckTeam={id => { rememberHomeTeam(id); }}
                onOpenTeam={openHomeTeam}
                onChangeTeam={() => rememberHomeTeam(null)}
                onRetryTeam={() => loadHomeTeam(homeTeam.teamId)}
                recapGw={homeTeam.teamId ? recapGwFor(liveStatic, selectedGw) : null}
                onOpenRecap={gwId => { markRecapSeen(homeTeam.teamId, gwId); openRecap(gwId); }}
              />
            )}
            {stage === 'teamIdForm' && (
              <TeamIdForm
                value={teamIdInput}
                onChange={setTeamIdInput}
                onSubmit={() => handleTeamIdSubmit(teamIdInput)}
                onBack={() => setStage('home')}
              />
            )}
            {stage === 'screenshotForm' && (
              <ScreenshotForm onSubmit={handleScreenshot} onBack={() => setStage('home')} />
            )}
            {stage === 'customBuild' && customStaticData && (
              <CustomSquadBuilder staticData={customStaticData} onSubmit={handleCustomSquadSubmit} onBack={() => setStage('home')} />
            )}
            {stage === 'loading' && <LoadingScreen message={loadingMessage} />}
            {stage === 'review' && (
              <ReviewScreen
                slots={reviewSlots}
                allPlayers={pendingStaticData ? pendingStaticData.allPlayers : []}
                teamsById={pendingStaticData ? pendingStaticData.teamsById : {}}
                bank={reviewBank}
                onBankChange={setReviewBank}
                onFix={updateSlotMatch}
                onSetCaptain={updateSlotCaptain}
                onSetViceCaptain={updateSlotViceCaptain}
                onToggleStarting={updateSlotStarting}
                onConfirm={handleConfirmReview}
                onBack={() => setStage('screenshotForm')}
                shotImg={reviewShotImg}
              />
            )}
            {stage === 'results' && resultsData && (
              <ResultsScreen
                data={resultsData}
                onStartOver={() => { setStage('home'); setResultsData(null); setTeamIdInput(''); }}
                onSquadUpdate={handleSquadUpdate}
                session={session}
                onSaveTeamId={handleSaveTeamId}
                onSaveCustomSquad={handleSaveCustomSquad}
                onSaveTeamChanges={handleSaveTeamChanges}
                onResetTeamChanges={handleResetTeamChanges}
                onRequestLoginToSave={handleRequestLoginToSave}
              />
            )}
            {stage === 'hindsight' && hindsightData && (
              <HindsightScreen
                data={hindsightData}
                savedTeams={savedTeams}
                compare={hindsightCompare}
                onSelectCompare={handleCompareSavedInHindsight}
                onBack={() => { setStage('home'); setHindsightData(null); setHindsightCompare(null); }}
              />
            )}
            {stage === 'league' && (
              <MiniLeagueScreen
                homeTeamId={homeTeam.teamId}
                gwId={leagueGw}
                targetGwId={liveStatic && liveStatic.targetEvent ? liveStatic.targetEvent.id : null}
                gwName={leagueGwEvent ? leagueGwEvent.name : ''}
                liveGwId={leagueWeekGw}
                liveGwFinished={!!(liveStatic && leagueWeekGw && isGwFinished(liveStatic, leagueWeekGw))}
                teamsById={liveStatic ? liveStatic.teamsById : {}}
                playersById={liveStatic ? liveStatic.playersById : {}}
                fetchJson={fetchFplJson}
                loadTeam={loadLeagueTeam}
                onOpenTeam={entryId => handleTeamIdSubmit(String(entryId))}
                onAddTeamId={() => setStage('home')}
              />
            )}
            {stage === 'myTeams' && (
              <MyTeamsScreen
                teams={savedTeams}
                onLoad={handleLoadSavedTeam}
                onDelete={handleDeleteSavedTeam}
                onBack={() => setStage('home')}
              />
            )}
            {stage === 'error' && (
              <ErrorScreen message={errorMessage} action={errorAction} onRetry={() => setStage('home')} />
            )}
          </Suspense>
        </ScreenErrorBoundary>
      </main>
      </div>
      {showNav && <FooterNav items={navItems} active={activeNav} />}
      {authDialog && (
        <ScreenErrorBoundary key={authDialog} overlay>
          <Suspense fallback={null}>
            <AuthDialog
              // Remount when switching between log-in and email so the fields start fresh.
              key={authDialog}
              initialMode={authDialog}
              currentEmail={session ? session.email : ''}
              onSubmit={handleAuthSubmit}
              onSetEmail={handleSetEmail}
              onForgot={handleForgotPassword}
              onReset={handleResetPassword}
              onClearError={() => setAuthError('')}
              error={authError}
              loading={authLoading}
              onClose={() => { setAuthError(''); setAuthDialog(null); }}
            />
          </Suspense>
        </ScreenErrorBoundary>
      )}
      {recap && recap.open && recap.teamId === homeTeam.teamId && (
        <ScreenErrorBoundary key={`recap-${recap.gwId}`} overlay>
          <Suspense fallback={null}>
            <GwRecap
              key={recap.gwId}
              gwId={recap.gwId}
              state={recap}
              onClose={() => { recapTicketRef.current += 1; setRecap(null); }}
              onRetry={() => openRecap(recap.gwId)}
              onLoadLeague={id => loadRecapLeague(id, recap.gwId).then(l => leagueSlide(l, Number(recap.teamId)))}
            />
          </Suspense>
        </ScreenErrorBoundary>
      )}
      <Analytics />
    </div>
  );
}
