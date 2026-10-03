// App shell: state, data loading and which screen is shown. The screens
// themselves live in src/screens/, shared pieces in src/components/, and
// non-UI logic in src/lib/.
import { useEffect, useRef, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { ErrorScreen, Header, LoadingScreen } from './components/common.jsx';
import { DAILY_REFRESH_HOUR_UTC, formatCountdown, getNextDailyRefreshUTC } from './lib/format.js';
import { fetchFplJson, loadStaticData } from './lib/fplClient.js';
import { SQUAD_BUDGET, applyAutomaticSubs, buildHindsightSquad, buildOptimalTeam, buildSavedSquadActualPerformance, hydrateFrozenSquadSnapshot, hydrateSquadSnapshot, isEventLocked } from './lib/predictions.js';
import { computeOptimalXiTotal, computeSquadScore, ensureCaptaincy, matchExtractedSquad, suggestCaptain, suggestTransfers } from './lib/squadLogic.js';
import { AuthScreen, MyTeamsScreen } from './screens/AccountScreens.jsx';
import { CustomSquadBuilder } from './screens/CustomSquadBuilder.jsx';
import { HindsightScreen } from './screens/HindsightScreen.jsx';
import { IntroScreen, TeamIdForm } from './screens/IntroScreen.jsx';
import { ResultsScreen } from './screens/ResultsScreen.jsx';
import { ReviewScreen, ScreenshotForm } from './screens/ScreenshotScreens.jsx';
import './styles.css';

export default function FPLSquadChecker() {
  const [stage, setStage] = useState('intro');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [teamIdInput, setTeamIdInput] = useState('');
  const [reviewSlots, setReviewSlots] = useState([]);
  // The screenshot behind the current review, for the optional report.
  const [reviewShotImg, setReviewShotImg] = useState(null);
  const [reviewBank, setReviewBank] = useState(null);
  const [pendingStaticData, setPendingStaticData] = useState(null);
  const [resultsData, setResultsData] = useState(null);
  const [selectedGw, setSelectedGw] = useState(null); // null = use current/next gameweek
  const [gwOptions, setGwOptions] = useState([]);
  const [customStaticData, setCustomStaticData] = useState(null);
  const [hindsightData, setHindsightData] = useState(null);
  const [hindsightCompare, setHindsightCompare] = useState(null); // { loading, entry, label, squad?, score?, error? }
  const [session, setSession] = useState(null); // { username } | null
  const [savedTeams, setSavedTeams] = useState([]);
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authReturnStage, setAuthReturnStage] = useState(null);

  const staticPromiseRef = useRef(null);
  const optimalXiTotalRef = useRef(null);
  const currentStaticDataRef = useRef(null);

  // Check for an existing logged-in session once on load, and pull in
  // their saved teams if so — lets returning users skip the login screen
  // entirely on future visits (the session cookie is long-lived).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          setSession({ username: data.username });
          fetchSavedTeams();
        }
      } catch (e) { /* not logged in / API unreachable — treat as logged out */ }
    })();
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
    } catch (e) {
      return { ok: false, status: null, data: null, error: 'Network error — please try again.' };
    }
    let data;
    try {
      data = await res.json();
    } catch (e) {
      return { ok: false, status: res.status, data: null, error: `Server error (status ${res.status}) — please try again in a moment.` };
    }
    return { ok: res.ok, status: res.status, data, error: res.ok ? null : (data.error || 'Something went wrong.') };
  }

  async function fetchSavedTeams() {
    const result = await fetchJson('/api/teams', { credentials: 'include' });
    if (result.ok) setSavedTeams(result.data.teams || []);
    // non-critical — list just stays empty/stale on failure
  }

  async function handleAuthSubmit(mode, username, password) {
    setAuthError('');
    setAuthLoading(true);
    const result = await fetchJson('/api/auth', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: mode, username, password }),
    });
    setAuthLoading(false);
    if (!result.ok) { setAuthError(result.error); return; }
    setSession({ username: result.data.username });
    fetchSavedTeams();
    if (authReturnStage) { setStage(authReturnStage); setAuthReturnStage(null); }
    else setStage('intro');
  }

  async function handleLogout() {
    await fetchJson('/api/auth', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    setSession(null);
    setSavedTeams([]);
  }

  async function handleSaveTeamId(teamId, label, gwId) {
    const result = await fetchJson('/api/teams', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'teamId', teamId, label, gwId }),
    });
    if (result.ok) setSavedTeams(result.data.teams);
    return { ok: result.ok, error: result.error };
  }

  async function handleSaveCustomSquad(squad, label, gwId) {
    const playerIds = squad.map(s => s.player.id);
    const captain = squad.find(s => s.isCaptain);
    const vice = squad.find(s => s.isViceCaptain);
    const result = await fetchJson('/api/teams', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'custom', label, gwId,
        squad: { playerIds, captainId: captain ? captain.player.id : null, viceCaptainId: vice ? vice.player.id : null },
      }),
    });
    if (result.ok) setSavedTeams(result.data.teams);
    return { ok: result.ok, error: result.error };
  }

  async function handleDeleteSavedTeam(entryId) {
    const result = await fetchJson('/api/teams', {
      method: 'DELETE', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId }),
    });
    if (result.ok) setSavedTeams(result.data.teams);
    // non-critical — list just stays as-is on failure
  }


  async function handleLoadSavedTeam(entry) {
    if (entry.type === 'teamId') {
      handleTeamIdSubmit(String(entry.teamId));
      return;
    }
    setStage('loading');
    setLoadingMessage('Loading your saved squad…');
    try {
      const staticData = await ensureStaticData();
      const hydrated = hydrateSquadSnapshot(entry.squad, staticData);
      if (!hydrated) throw new Error('could not hydrate saved squad');
      finalizeResults(hydrated.squad, staticData, hydrated.bankTenths, { teamName: entry.label, gwId: entry.gwId }, null, false);
    } catch (e) {
      setErrorMessage("Couldn't load that saved squad — try again in a moment.");
      setStage('error');
    }
  }

  function handleRequestLoginToSave() {
    setAuthReturnStage('results');
    setAuthError('');
    setStage('auth');
  }

  // Every screen is a fresh "page" — reset scroll position whenever we
  // navigate to a new stage, so scrolling down on one screen (e.g. the
  // intro) doesn't carry over and leave the next screen scrolled past its
  // own top.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stage]);

  function ensureStaticData() {
    if (!staticPromiseRef.current) {
      staticPromiseRef.current = loadStaticData();
    }
    return staticPromiseRef.current;
  }

  function getOptimalXiTotal(staticData) {
    if (optimalXiTotalRef.current === null) {
      optimalXiTotalRef.current = computeOptimalXiTotal(staticData);
    }
    return optimalXiTotalRef.current;
  }

  useEffect(() => {
    ensureStaticData().then(data => {
      // Selectable gameweeks: any that have closed (deadline passed — safe
      // to browse as history) plus whichever one is currently the target.
      // Using is_current/is_next here would let a gameweek whose deadline
      // has already passed keep showing as "current" for days, since that
      // FPL flag tracks match-play status rather than transfer deadlines.
      const selectable = data.allEvents.filter(e => isEventLocked(e) || (data.targetEvent && e.id === data.targetEvent.id));
      setGwOptions(selectable);
      if (selectedGw === null && data.targetEvent) setSelectedGw(data.targetEvent.id);
    }).catch(() => {});
  }, []);

  // Picking a different gameweek while looking at the optimal squad should
  // actually switch what's shown — re-resolve for whichever gameweek is now
  // selected (its frozen results if it's closed, or the live build if it's
  // the current one), instead of silently doing nothing.
  useEffect(() => {
    if (selectedGw === null) return;
    if (stage === 'results' && resultsData && resultsData.isOptimalBuild && resultsData.gwId !== selectedGw) {
      loadOptimalSquadForGw(selectedGw);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGw]);

  function buildResultsData(squad, staticData, bankTenths, entryMeta, activeChip, isOptimalBuild, extra = {}) {
    const { isPastGw = false, nextRefreshAt = null, builtAt = null, gwUnavailable = false, gwId = null, backfilled = false } = extra;
    const starters = squad.filter(s => s.isStarting);
    const bench = squad.filter(s => !s.isStarting);

    let xiTotal = 0;
    let actualXiTotal = 0;
    squad.forEach(s => {
      const mult = activeChip === 'bboost' ? 1 : (s.isStarting ? (s.multiplier || 1) : 0);
      xiTotal += s.predicted * mult;
      actualXiTotal += (s.actualPoints || 0) * mult;
    });

    const captain = squad.find(s => s.isCaptain) || null;
    const captainSuggestion = isPastGw ? null : suggestCaptain(starters);
    const suggestions = isPastGw ? [] : suggestTransfers(squad, staticData.allPlayers, staticData.predictionsById, bankTenths || 0);

    return {
      squad, starters, bench, xiTotal, actualXiTotal: isPastGw ? actualXiTotal : null, captain, captainSuggestion, suggestions,
      entryMeta, bankTenths, activeChip, isOptimalBuild,
      isPastGw, nextRefreshAt, builtAt, gwUnavailable, gwId, backfilled,
      squadScore: isOptimalBuild ? 100 : computeSquadScore(xiTotal, getOptimalXiTotal(staticData)),
      targetEvent: staticData.targetEvent, teamsById: staticData.teamsById, fixturesByTeam: staticData.fixturesByTeam, allEvents: staticData.allEvents,
      allPlayers: staticData.allPlayers, predictionsById: staticData.predictionsById,
    };
  }

  function finalizeResults(squad, staticData, bankTenths, entryMeta, activeChip, isOptimalBuild, extra) {
    currentStaticDataRef.current = staticData;
    setResultsData(buildResultsData(squad, staticData, bankTenths, entryMeta, activeChip, isOptimalBuild, extra));
    setStage('results');
  }

  // Called after an in-place squad edit (manual swap, or accepting a
  // transfer suggestion) — recomputes everything derived (predicted total,
  // squad score, fresh transfer suggestions) against the edited squad.
  function handleSquadUpdate(newSquad, newBankTenths) {
    setResultsData(prev => {
      if (!prev || !currentStaticDataRef.current) return prev;
      return buildResultsData(newSquad, currentStaticDataRef.current, newBankTenths, prev.entryMeta, prev.activeChip, prev.isOptimalBuild, {
        isPastGw: prev.isPastGw, nextRefreshAt: prev.nextRefreshAt, builtAt: prev.builtAt,
      });
    });
  }

  async function handleStartCustomBuild() {
    setStage('loading');
    setLoadingMessage('Loading live player data…');
    try {
      const staticData = await ensureStaticData();
      setCustomStaticData(staticData);
      setStage('customBuild');
    } catch (e) {
      setErrorMessage("Couldn't load live FPL player data right now. Please try again in a moment.");
      setStage('error');
    }
  }

  function handleCustomSquadSubmit(squad, bankTenths) {
    if (!customStaticData) { setStage('error'); setErrorMessage('Something went wrong. Please start over. [ERR_NO_STATIC_DATA]'); return; }
    const gwId = customStaticData.targetEvent ? customStaticData.targetEvent.id : null;
    finalizeResults(squad, customStaticData, bankTenths, { teamName: 'My Squad', gwId }, null, false);
  }

  async function loadOptimalSquadForGw(gwId) {
    setStage('loading');
    setLoadingMessage(`Testing lineups within £${SQUAD_BUDGET.toFixed(1)}m…`);
    try {
      const staticData = await ensureStaticData();
      const targetId = staticData.targetEvent ? staticData.targetEvent.id : 1;
      const resolvedGwId = gwId || targetId;
      const isPastGw = resolvedGwId < targetId;

      if (isPastGw) {
        // Closed gameweek — only ever show the frozen snapshot from when it
        // was current, plus how those players actually scored. Never
        // rebuild: an "optimal squad" recomputed today with today's prices
        // and news for a gameweek that's already over wouldn't mean
        // anything, and would silently disagree with what was shown at the
        // time.
        let snap = null;
        try {
          const res = await fetch(`/api/optimal-squad?gw=${resolvedGwId}`);
          if (res.ok) snap = await res.json();
        } catch (e) { /* nothing saved for this gameweek */ }

        if (!snap || !Array.isArray(snap.playerIds)) {
          currentStaticDataRef.current = staticData;
          setResultsData({ gwUnavailable: true, isOptimalBuild: true, isPastGw: true, gwId: resolvedGwId, targetEvent: staticData.targetEvent, allEvents: staticData.allEvents });
          setStage('results');
          return;
        }

        setLoadingMessage('Fetching gameweek results…');
        const liveById = {};
        try {
          const live = await fetchFplJson(`event/${resolvedGwId}/live/`);
          (live.elements || []).forEach(el => {
            liveById[el.id] = { totalPoints: el.stats.total_points, minutes: el.stats.minutes };
          });
        } catch (e) { /* actual points unavailable — still show the frozen squad, just without scores */ }

        const hydrated = hydrateFrozenSquadSnapshot(snap, staticData, liveById);
        if (!hydrated) throw new Error('could not hydrate frozen snapshot');
        finalizeResults(hydrated.squad, staticData, hydrated.bankTenths, { teamName: 'Optimal Squad' }, null, true, {
          isPastGw: true, builtAt: snap.builtAt, gwId: resolvedGwId, backfilled: !!snap.backfilled,
        });
        return;
      }

      // Current (open) gameweek.
      const cacheKey = `fpl_optimal_squad_gw${resolvedGwId}`;
      let squad = null, bankTenths = null, builtAt = null;

      // 1) Prefer the shared snapshot our server refreshes automatically (see
      // api/refresh-optimal.js) — computed once and reused by every visitor,
      // rather than every browser solving the same optimisation on its own.
      try {
        const res = await fetch(`/api/optimal-squad?gw=${resolvedGwId}`);
        if (res.ok) {
          const snap = await res.json();
          if (snap && snap.gwId === resolvedGwId) {
            const hydrated = hydrateSquadSnapshot(snap, staticData);
            if (hydrated) { squad = hydrated.squad; bankTenths = hydrated.bankTenths; builtAt = snap.builtAt; }
          }
        }
      } catch (e) { /* server snapshot unavailable — fall through to local cache */ }

      // 2) Fall back to this browser's own cache for the gameweek, so a
      // person isn't forced to wait on a full rebuild every single visit
      // even before the server has a snapshot for this gameweek yet.
      if (!squad) {
        try {
          const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
          const hydrated = hydrateSquadSnapshot(cached, staticData);
          if (hydrated) { squad = hydrated.squad; bankTenths = hydrated.bankTenths; builtAt = cached.builtAt; }
        } catch (e) { /* corrupt/unavailable cache — fall through to a fresh build */ }
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
            predictedById: Object.fromEntries(squad.map(s => [s.player.id, s.nextMatchPredicted])),
            gwId: resolvedGwId,
            builtAt,
          }));
        } catch (e) { /* storage unavailable — non-critical, just won't persist */ }
      }

      // Refreshes once a day at a fixed time (see vercel.json's cron
      // schedule) — countdown to that fixed time directly, rather than to
      // "24h after whichever build happened to load here". The latter
      // resets to ~24h any time the fallback chain lands on a fresh local
      // build instead of the shared server snapshot (e.g. before the cron
      // has ever run, or in a browser/session with no local cache yet),
      // which looks like a broken countdown even though nothing's wrong.
      const nextRefreshAt = getNextDailyRefreshUTC(DAILY_REFRESH_HOUR_UTC);

      finalizeResults(squad, staticData, bankTenths, { teamName: 'Optimal Squad' }, null, true, {
        isPastGw: false, builtAt, nextRefreshAt, gwId: resolvedGwId,
      });
    } catch (e) {
      setErrorMessage("Couldn't build a squad right now — FPL's data might be temporarily unavailable. Please try again.");
      setStage('error');
    }
  }

  async function handleViewHindsight() {
    setStage('loading');
    setLoadingMessage('Working out what would have scored best…');
    setHindsightCompare(null);
    try {
      const staticData = await ensureStaticData();
      const targetId = staticData.targetEvent ? staticData.targetEvent.id : 1;
      // Last CLOSED gameweek: the most recent one whose deadline has
      // passed, i.e. one before whatever's currently open for transfers.
      const closed = (staticData.allEvents || []).filter(e => isEventLocked(e) && e.id < targetId);
      const lastClosed = closed.length ? closed.reduce((a, b) => (b.id > a.id ? b : a)) : null;

      if (!lastClosed) {
        setHindsightData({ gwUnavailable: true, gwId: null, gwName: null });
        setStage('hindsight');
        return;
      }

      let snap = null;
      try {
        const res = await fetch(`/api/optimal-squad?gw=${lastClosed.id}`);
        if (res.ok) snap = await res.json();
      } catch (e) { /* nothing saved for this gameweek */ }

      if (!snap || !Array.isArray(snap.playerIds)) {
        setHindsightData({ gwUnavailable: true, gwId: lastClosed.id, gwName: lastClosed.name });
        setStage('hindsight');
        return;
      }

      const liveById = {};
      try {
        const live = await fetchFplJson(`event/${lastClosed.id}/live/`);
        (live.elements || []).forEach(el => {
          liveById[el.id] = { totalPoints: el.stats.total_points, minutes: el.stats.minutes };
        });
      } catch (e) { /* actual points unavailable */ }

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
      setStage('hindsight');
    } catch (e) {
      setErrorMessage("Couldn't work out the best XI right now — FPL's data might be temporarily unavailable. Please try again.");
      setStage('error');
    }
  }

  // Loads one of the user's saved teams (a Team ID or a custom squad) into
  // the hindsight comparison, showing what it actually scored that
  // gameweek alongside the predicted-optimal and best-possible squads.
  async function handleCompareSavedInHindsight(entry) {
    if (!hindsightData || hindsightData.gwUnavailable) return;
    setHindsightCompare({ loading: true, entry, label: entry.label });
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
          setHindsightCompare({
            loading: false, entry, label: entry.label,
            error: notReady ? `This team didn't exist yet in ${hindsightData.gwName} — nothing to compare.` : "Couldn't fetch that team's picks for this gameweek right now.",
          });
          return;
        }
        if (!picks || picks.detail === 'Not found.' || !Array.isArray(picks.picks) || picks.picks.length === 0) {
          setHindsightCompare({ loading: false, entry, label: entry.label, error: "Couldn't find picks for that team in this gameweek." });
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
        // This gameweek is closed by definition here (hindsight comparison
        // only runs against a past gw), so FPL's own automatic_subs for it
        // are final — apply them so the squad/score reflect what actually
        // happened, not the manager's original pre-autosub picks.
        const squad = applyAutomaticSubs(rawSquad, picks.automatic_subs);
        const totalScore = squad.reduce((s, slot) => (slot.isStarting ? s + slot.actualPoints * slot.multiplier : s), 0);
        setHindsightCompare({ loading: false, entry, label: entry.label, squad, score: totalScore });
        return;
      }

      // Custom saved squad — no real historical picks exist for it, so
      // work out the best XI it could have fielded from those exact 15
      // players using that gameweek's actual scores.
      const result = buildSavedSquadActualPerformance(
        entry.squad.playerIds, entry.squad.captainId, entry.squad.viceCaptainId, liveById, staticData.playersById
      );
      if (!result) {
        setHindsightCompare({ loading: false, entry, label: entry.label, error: "Couldn't match this saved squad's players to current data." });
        return;
      }
      setHindsightCompare({ loading: false, entry, label: entry.label, squad: result.squad, score: result.totalScore });
    } catch (e) {
      setHindsightCompare({ loading: false, entry, label: entry.label, error: 'Something went wrong loading that comparison.' });
    }
  }

  async function handleTeamIdSubmit(rawId) {
    const teamId = (rawId || '').trim();
    if (!/^\d+$/.test(teamId)) {
      setErrorMessage('Enter a numeric Team ID — just the number from your FPL URL.');
      setStage('error');
      return;
    }
    setStage('loading');
    setLoadingMessage('Pulling live player data…');
    try {
      let staticData;
      try {
        staticData = await ensureStaticData();
      } catch (e) {
        throw { code: 'ERR_STATIC_DATA' };
      }
      setLoadingMessage('Fetching your team…');
      const gwId = selectedGw || (staticData.targetEvent ? staticData.targetEvent.id : 1);

      const targetId = staticData.targetEvent ? staticData.targetEvent.id : 1;
      const isPastGwView = gwId < targetId;
      const hasPicks = p => p && !p.detail && Array.isArray(p.picks) && p.picks.length > 0;

      let picks = null;
      try {
        picks = await fetchFplJson(`entry/${teamId}/event/${gwId}/picks/`);
      } catch (e) {
        // A 404 here means either a bad Team ID or picks FPL hides until
        // the deadline passes — the entry lookup below tells them apart.
        if (!(e && e.message === 'status 404')) throw { code: 'ERR_PICKS_FETCH' };
      }

      let entry = null;
      try {
        entry = await fetchFplJson(`entry/${teamId}/`);
      } catch (e) {
        if (!hasPicks(picks) && e && e.message === 'status 404') throw { code: 'ERR_TEAM_NOT_FOUND' };
        /* otherwise non-critical — it only supplies the team name */
      }
      let entryMeta = { teamId: Number(teamId), gwId };
      if (entry && !entry.detail) entryMeta.teamName = entry.name || 'Your Squad';

      // FPL hides a team's picks for a gameweek until its deadline passes.
      // Rather than give up, load the most recent gameweek we *can* see —
      // the squad is the same unless they've made transfers since — and
      // score it for the gameweek that was asked for. Only for the
      // upcoming gameweek: a missing past gameweek means the team didn't
      // exist yet, and borrowing a later squad there would be wrong.
      let picksGwId = gwId;
      if (!hasPicks(picks) && !isPastGwView && entry && !entry.detail) {
        setLoadingMessage("This gameweek's picks are hidden until the deadline — loading your latest team…");
        const earliest = entry.started_event || 1;
        let candidate = Math.min(gwId - 1, entry.current_event || gwId - 1);
        // A few steps is plenty: one for the hidden gameweek, one more to
        // skip a Free Hit week (that squad reverts afterwards).
        for (let tries = 0; candidate >= earliest && tries < 4; tries++, candidate--) {
          let prev = null;
          try {
            prev = await fetchFplJson(`entry/${teamId}/event/${candidate}/picks/`);
          } catch (e) { /* not visible either — keep walking back */ }
          if (!hasPicks(prev)) continue;
          if (prev.active_chip === 'freehit') continue;
          picks = prev;
          picksGwId = candidate;
          break;
        }
      }
      if (!hasPicks(picks)) {
        throw { code: entry && !entry.detail ? 'ERR_GW_LOCKED' : 'ERR_TEAM_NOT_FOUND' };
      }
      if (picksGwId !== gwId) entryMeta.picksFromGwId = picksGwId;

      setLoadingMessage('Checking fixtures and working out predictions…');

      let liveById = {};
      if (isPastGwView) {
        setLoadingMessage('Fetching gameweek results…');
        try {
          const live = await fetchFplJson(`event/${gwId}/live/`);
          (live.elements || []).forEach(el => {
            liveById[el.id] = { totalPoints: el.stats.total_points, minutes: el.stats.minutes };
          });
        } catch (e) { /* actual points unavailable — still show predicted-only */ }
      }

      const rawSquad = picks.picks.map(pk => {
        const player = staticData.playersById[pk.element];
        if (!player) return null;
        const pred = staticData.predictionsById[pk.element];
        const live = liveById[pk.element];
        return {
          player, predicted: pred.predicted, nextMatchPredicted: pred.nextMatchPredicted, availNote: pred.availNote, breakdown: pred.breakdown,
          isStarting: pk.position <= 11, isCaptain: !!pk.is_captain, isViceCaptain: !!pk.is_vice_captain,
          multiplier: pk.multiplier,
          ...(isPastGwView ? { actualPoints: live ? live.totalPoints : 0, played: live ? live.minutes > 0 : false } : {}),
        };
      }).filter(Boolean);
      // Only meaningful once the gameweek is closed — automatic_subs is
      // empty for a gameweek still in progress (there's nothing final to
      // apply yet), so this is a no-op for the live/current-gw view.
      const squad = isPastGwView ? applyAutomaticSubs(rawSquad, picks.automatic_subs) : rawSquad;

      const bankTenths = picks.entry_history ? picks.entry_history.bank : 0;
      // A chip played in an earlier gameweek doesn't carry over.
      const activeChip = picksGwId === gwId ? (picks.active_chip || null) : null;

      finalizeResults(squad, staticData, bankTenths, entryMeta, activeChip, false, { isPastGw: isPastGwView, gwId });
    } catch (e) {
      setStage('error');
      const code = (e && e.code) || 'ERR_UNKNOWN';
      const messages = {
        ERR_STATIC_DATA: "Couldn't load live FPL player data right now. Try again in a moment, or upload a screenshot instead.",
        ERR_PICKS_FETCH: "FPL's servers aren't responding right now. Try again in a moment, or upload a screenshot instead.",
        ERR_GW_LOCKED: "FPL hasn't published any picks for this team yet (a new team's picks are hidden until its first deadline passes). Try again after the deadline, or upload a screenshot for now.",
        ERR_TEAM_NOT_FOUND: "We couldn't find a team with that ID. Double-check the number in your FPL URL and try again.",
        ERR_UNKNOWN: 'Something went wrong pulling your team. Try again, or upload a screenshot instead.',
      };
      setErrorMessage(`${messages[code] || messages.ERR_UNKNOWN} [${code}]`);
    }
  }

  // Used by the screenshot path — matches the extracted shape to real players.
  async function processExtractedSquad(extracted, staticDataPromise) {
    if (extracted.not_fpl_screenshot) {
      setErrorMessage("We couldn't find any FPL players in that image. Use a clear, uncropped screenshot of your Pick Team or Points page and try again. [ERR_NOT_FPL_SCREENSHOT]");
      setStage('error');
      return;
    }
    setLoadingMessage('Matching players…');
    const staticData = await staticDataPromise;
    const slots = matchExtractedSquad(extracted, staticData.playersByPosition, staticData.allPlayers, staticData.teamsById);

    setReviewSlots(slots);
    setReviewBank(typeof extracted.bank_millions === 'number' ? extracted.bank_millions : null);
    setPendingStaticData(staticData);
    setStage('review');
  }

  // Reads the screenshot with OCR in the browser (no server, no AI
  // service), finds FPL player names in the text, then hands off to the
  // same review screen as every other squad source. Prices come from live
  // FPL data once each player is matched.
  async function handleScreenshot(shot) {
    setReviewShotImg(shot.img);
    setStage('loading');
    setLoadingMessage('Loading player data…');
    let staticData;
    try {
      staticData = await ensureStaticData();
    } catch (e) {
      setErrorMessage("Couldn't load live FPL player data right now. Try again in a moment. [ERR_STATIC_DATA]");
      setStage('error');
      return;
    }
    let extracted;
    try {
      setLoadingMessage('Reading your screenshot…');
      const { readSquadFromScreenshot } = await import('./lib/screenshotOcr.js');
      extracted = await readSquadFromScreenshot(shot.img, staticData.allPlayers, p => {
        setLoadingMessage(`Reading your screenshot… ${Math.round(p * 100)}%`);
      }, { teamsById: staticData.teamsById, fixturesByTeam: staticData.fixturesByTeam });
    } catch (e) {
      setErrorMessage(`Couldn't read that screenshot (${(e && e.message) || 'OCR failed'}). Try again, or enter your Team ID instead. [ERR_OCR]`);
      setStage('error');
      return;
    }
    await processExtractedSquad(extracted, Promise.resolve(staticData));
  }

  function updateSlotMatch(index, player) {
    setReviewSlots(prev => prev.map((s, i) => i === index ? { ...s, matched: player, manuallyFixed: true } : s));
  }

  // Only one captain and one vice-captain at a time, and never the same
  // player as both. Clicking the checkbox that's already checked for a
  // player unsets it (so you can end up with none selected mid-edit,
  // rather than being forced to immediately pick a replacement).
  function updateSlotCaptain(index) {
    setReviewSlots(prev => prev.map((s, i) => {
      if (i === index) {
        const nowCaptain = !s.isCaptain;
        return { ...s, isCaptain: nowCaptain, isViceCaptain: nowCaptain ? false : s.isViceCaptain };
      }
      return { ...s, isCaptain: false };
    }));
  }

  function updateSlotViceCaptain(index) {
    setReviewSlots(prev => prev.map((s, i) => {
      if (i === index) {
        const nowVice = !s.isViceCaptain;
        return { ...s, isViceCaptain: nowVice, isCaptain: nowVice ? false : s.isCaptain };
      }
      return { ...s, isViceCaptain: false };
    }));
  }

  async function handleConfirmReview() {
    const staticData = pendingStaticData;
    if (!staticData) { setStage('error'); setErrorMessage('Something went wrong. Please start over. [ERR_NO_STATIC_DATA]'); return; }

    const matchedCount = reviewSlots.filter(slot => slot.matched).length;
    if (matchedCount < 11) {
      setErrorMessage('A few players are still unmatched. Go back and fix them. [ERR_UNMATCHED_PLAYERS]');
      setStage('error');
      return;
    }

    const targetId = staticData.targetEvent ? staticData.targetEvent.id : null;
    const gwId = selectedGw || targetId;
    const isPastGwView = targetId != null && gwId < targetId;

    let liveById = {};
    if (isPastGwView) {
      setStage('loading');
      setLoadingMessage('Fetching gameweek results…');
      try {
        const live = await fetchFplJson(`event/${gwId}/live/`);
        (live.elements || []).forEach(el => {
          liveById[el.id] = { totalPoints: el.stats.total_points, minutes: el.stats.minutes };
        });
      } catch (e) { /* actual points unavailable — still show predicted-only */ }
    }

    const squad = reviewSlots.map(slot => {
      const player = slot.matched;
      if (!player) return null;
      const pred = staticData.predictionsById[player.id];
      const live = liveById[player.id];
      return {
        player, predicted: pred.predicted, nextMatchPredicted: pred.nextMatchPredicted, availNote: pred.availNote, breakdown: pred.breakdown,
        isStarting: slot.isStarting, isCaptain: !!slot.isCaptain, isViceCaptain: !!slot.isViceCaptain,
        multiplier: slot.isCaptain ? 2 : 1,
        ...(isPastGwView ? { actualPoints: live ? live.totalPoints : 0, played: live ? live.minutes > 0 : false } : {}),
      };
    }).filter(Boolean);

    const bankTenths = reviewBank != null && !Number.isNaN(reviewBank) ? Math.max(0, Math.round(reviewBank * 10)) : 0;
    finalizeResults(ensureCaptaincy(squad), staticData, bankTenths, { gwId }, null, false, { isPastGw: isPastGwView, gwId });
  }

  const headerSummary = (stage === 'results' && resultsData) ? {
    gwLabel: resultsData.isPastGw
      ? ((resultsData.allEvents?.find(e => e.id === resultsData.gwId))?.name || '')
      : (resultsData.targetEvent ? resultsData.targetEvent.name : ''),
    countdown: resultsData.isPastGw ? '' : (resultsData.targetEvent ? formatCountdown(resultsData.targetEvent.deadline_time) : ''),
    xiTotal: resultsData.xiTotal,
    actualXiTotal: resultsData.isPastGw ? resultsData.actualXiTotal : null,
  } : null;

  return (
    <div className="fpl-root">
      <Header
        summary={headerSummary}
        gwOptions={gwOptions}
        selectedGw={selectedGw}
        onSelectGw={setSelectedGw}
        onGoHome={() => { setStage('intro'); setResultsData(null); setTeamIdInput(''); setHindsightData(null); setHindsightCompare(null); }}
        session={session}
        onLoginClick={() => { setAuthReturnStage(null); setAuthError(''); setStage('auth'); }}
        onMyTeamsClick={() => setStage('myTeams')}
        onLogoutClick={handleLogout}
      />
      <main style={{ maxWidth: 640, margin: '0 auto' }}>
        {stage === 'intro' && (
          <IntroScreen
            showHindsight={gwOptions.some(e => isEventLocked(e))}
            showMyTeams={!!session}
            onChoose={(m) => {
              if (m === 'build') { loadOptimalSquadForGw(selectedGw); return; }
              if (m === 'custom') { handleStartCustomBuild(); return; }
              if (m === 'hindsight') { handleViewHindsight(); return; }
              if (m === 'myTeams') { setStage('myTeams'); return; }
              setStage(m === 'id' ? 'teamIdForm' : 'screenshotForm');
            }}
          />
        )}
        {stage === 'teamIdForm' && (
          <TeamIdForm
            value={teamIdInput}
            onChange={setTeamIdInput}
            onSubmit={() => handleTeamIdSubmit(teamIdInput)}
            onBack={() => setStage('intro')}
          />
        )}
        {stage === 'screenshotForm' && (
          <ScreenshotForm onSubmit={handleScreenshot} onBack={() => setStage('intro')} />
        )}
        {stage === 'customBuild' && customStaticData && (
          <CustomSquadBuilder staticData={customStaticData} onSubmit={handleCustomSquadSubmit} onBack={() => setStage('intro')} />
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
            onConfirm={handleConfirmReview}
            onBack={() => setStage('screenshotForm')}
            shotImg={reviewShotImg}
          />
        )}
        {stage === 'results' && resultsData && (
          <ResultsScreen
            data={resultsData}
            onStartOver={() => { setStage('intro'); setResultsData(null); setTeamIdInput(''); }}
            onSquadUpdate={handleSquadUpdate}
            session={session}
            onSaveTeamId={handleSaveTeamId}
            onSaveCustomSquad={handleSaveCustomSquad}
            onRequestLoginToSave={handleRequestLoginToSave}
          />
        )}
        {stage === 'hindsight' && hindsightData && (
          <HindsightScreen
            data={hindsightData}
            savedTeams={savedTeams}
            compare={hindsightCompare}
            onSelectCompare={handleCompareSavedInHindsight}
            onBack={() => { setStage('intro'); setHindsightData(null); setHindsightCompare(null); }}
          />
        )}
        {stage === 'auth' && (
          <AuthScreen
            onSubmit={handleAuthSubmit}
            error={authError}
            loading={authLoading}
            onCancel={() => { setAuthError(''); setStage(authReturnStage || 'intro'); setAuthReturnStage(null); }}
          />
        )}
        {stage === 'myTeams' && (
          <MyTeamsScreen
            teams={savedTeams}
            onLoad={handleLoadSavedTeam}
            onDelete={handleDeleteSavedTeam}
            onBack={() => setStage('intro')}
          />
        )}
        {stage === 'error' && (
          <ErrorScreen message={errorMessage} onRetry={() => setStage('intro')} />
        )}
      </main>
      <Analytics />
    </div>
  );
}
