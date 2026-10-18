// App shell: state, data loading and which screen is shown. The screens
// themselves live in src/screens/, shared pieces in src/components/, the
// state that's shared between screens in src/hooks/, and non-UI logic in
// src/lib/.
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { ErrorScreen, Header, LoadingScreen } from './components/common.jsx';
import { DAILY_REFRESH_HOUR_UTC, formatCountdown, getNextDailyRefreshUTC, isDeadlineSoon, officialGwPoints } from './lib/format.js';
import { fetchFplJson } from './lib/fplClient.js';
import { SQUAD_BUDGET, applyAutomaticSubs, buildHindsightSquad, buildOptimalTeam, buildSavedSquadActualPerformance, hydrateFrozenSquadSnapshot, hydrateSquadSnapshot, isEventLocked, snapshotIsForSeason } from './lib/predictions.js';
import { livePointsFor, memberWeekStats, predictedXiTotal } from './lib/leagues.js';
import { liveTeamScore, projectedBonus, teamStates } from './lib/live.js';
import { leagueSlide, markRecapSeen } from './lib/recap.js';
import { clearTeamEdit } from './lib/teamEdits.js';
import { ensureCaptaincy, matchExtractedSquad, squadProblems } from './lib/squadLogic.js';
import { Bookmark, MessageSquare, CalendarRange, Camera, Compass, Download, GitCompareArrows, History, House, Info, Radio, ShieldCheck, Shirt, Trophy, Users, Wand2 } from 'lucide-react';
import { FooterNav, SideNav } from './components/AppNav.jsx';
import { NoticeBars } from './components/NoticeBars.jsx';
import { ModelSwitch } from './components/ModelSwitch.jsx';
import { ScreenErrorBoundary } from './components/ScreenErrorBoundary.jsx';
import { useInstallPrompt } from './lib/pwa.js';
import { HomeScreen } from './screens/HomeScreen.jsx';
import { TeamIdForm } from './screens/IntroScreen.jsx';
import { AdminScreen, AuthDialog, CompareScreen, CustomSquadBuilder, ExploreScreen, FixturesScreen, GwRecap, HindsightScreen, LiveScreen, MiniLeagueScreen, MyTeamsScreen, ProfileScreen, ResultsScreen, ReviewScreen, ScreenshotForm, WelcomeScreen } from './screens/lazyScreens.js';
import { TermsDialog } from './components/TermsDialog.jsx';
import { track } from './lib/track.js';
import { parseTeamId } from './lib/teamIdInput.js';
import { ALL_CHUNKS, loadCustomSquadBuilder, loadHindsightScreen, loadResultsScreen, preload } from './lib/chunks.js';
import { MAX_COMPARE, RESTORABLE_VIEWS, readCompareIds, readInApp, readTeamParam, readTermsAccepted, readViewParam, writeCompareIds, writeInApp, writeParams, writeTermsAccepted } from './lib/appStorage.js';
import { currentGwId, isGwFinished, liveGwIdFor, recapGwFor } from './lib/gameweeks.js';
import { savedChangesFor, teamChangesFor } from './lib/savedSquads.js';
import { useStage } from './hooks/useStage.js';
import { postJson, useAccount } from './hooks/useAccount.js';
import { scoreSlots, teamErrorMessage, useFplData } from './hooks/useFplData.js';
import { useHomeTeam } from './hooks/useHomeTeam.js';
import { useRecap } from './hooks/useRecap.js';
import { useReviewSlots } from './hooks/useReviewSlots.js';
import { useResults } from './hooks/useResults.js';
import './styles.css';

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
    case 'myTeams': case 'profile': return 'saved';
    case 'league': return 'league';
    case 'fixtures': return 'fixtures';
    case 'compare': return 'compare';
    case 'explore': return 'explore';
    case 'live': return 'live';
    case 'admin': return 'admin';
    case 'results':
      if (!resultsData) return null;
      if (resultsData.isOptimalBuild) return 'best';
      if (resultsData.entryMeta && resultsData.entryMeta.teamId) return 'team';
      return null;
    default: return null;
  }
}

// The screens whose squads are predicted (results covers My team, Best
// squad, saved and screenshot squads): admins get the formula / ML switch.
const MODEL_SWITCH_STAGES = ['home', 'results', 'customBuild', 'league'];

export default function FPLSquadChecker() {
  const { stage, setStage, setStageRaw, newTicket, isCurrent, showStage, showLoading, showError, loadingMessage, errorMessage, errorAction } = useStage();
  const [teamIdInput, setTeamIdInput] = useState('');
  const { reviewSlots, setReviewSlots, updateSlotMatch, updateSlotCaptain, updateSlotViceCaptain, updateSlotStarting } = useReviewSlots();
  // The screenshot behind the current review, for the optional report.
  const [reviewShotImg, setReviewShotImg] = useState(null);
  const [reviewBank, setReviewBank] = useState(null);
  const [pendingStaticData, setPendingStaticData] = useState(null);
  const [customStaticData, setCustomStaticData] = useState(null);
  const [hindsightData, setHindsightData] = useState(null);
  const [hindsightCompare, setHindsightCompare] = useState(null); // { loading, entry, label, squad?, score?, error? }
  // The screen to reopen after a reload, until it has been.
  const restoreViewRef = useRef(readViewParam());
  const account = useAccount({ stage, setStage, setStageRaw, skipWelcome: () => !!restoreViewRef.current || readInApp() });
  const { session, savedTeams, openAuthDialog, handleTeamsResult } = account;
  const fpl = useFplData({ admin: !!(session && session.admin) });
  const { selectedGw, setSelectedGw, gwOptions, liveStatic, staticDataRef, ensureStaticData, staticDataForGw, formulaSnapshot, liveForGw, fixturesForGw, loadTeamForGw, modelChoice, setModelChoice, modelAvailable } = fpl;
  const { resultsData, setResultsData, currentStaticDataRef, buildResultsData, finalizeResults, handleSquadUpdate, rescoreSquadForGw, handleSaveTeamChanges } = useResults({ screens: { newTicket, isCurrent, setStageRaw, showLoading, showError }, fpl, handleTeamsResult });
  // The Terms pop-up shown the first time someone presses Start.
  const [termsOpen, setTermsOpen] = useState(false);
  // Counts the screens worth knowing about as they're opened.
  useEffect(() => {
    const name = { league: 'league', live: 'live', customBuild: 'build_squad' }[stage];
    if (name) track(name);
  }, [stage]);

  const [compareIds, setCompareIdsRaw] = useState(readCompareIds);
  const setCompareIds = ids => { setCompareIdsRaw(ids); writeCompareIds(ids); };
  const toggleCompare = id => setCompareIds(compareIds.includes(id) ? compareIds.filter(x => x !== id) : [...compareIds, id].slice(0, MAX_COMPARE));
  const mainRef = useRef(null);

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
    track('best_squad');
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
          fetch(`/api/optimal-squad?gw=${resolvedGwId}`).then(res => (res.ok ? res.json() : null)).then(s => formulaSnapshot(s, resolvedGwId)).catch(() => null),
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

      // Current (open) gameweek. The server's squad is picked with the
      // blend (or the formula alone, before the model's file is out); when
      // what's on screen predicts otherwise (an admin's view of one model
      // alone, or the model's file came out since), it's built here.
      const viewSource = staticData.predictionView || staticData.predictionSource || 'formula';
      const cacheKey = `fpl_optimal_squad_${staticData.seasonId || ''}_gw${resolvedGwId}_${viewSource}`;
      let squad = null, bankTenths = null, builtAt = null;

      // 1) Prefer the shared snapshot our server refreshes automatically (see
      // api/refresh-optimal.js) — computed once and reused by every visitor,
      // rather than every browser solving the same optimisation on its own.
      try {
        const res = await fetch(`/api/optimal-squad?gw=${resolvedGwId}`);
        if (res.ok) {
          const snap = await res.json();
          if (snap && snap.gwId === resolvedGwId && isThisSeason(snap) && (snap.source || 'formula') === viewSource) {
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
        fetch(`/api/optimal-squad?gw=${lastClosed.id}`).then(res => (res.ok ? res.json() : null)).then(s => formulaSnapshot(s, lastClosed.id)).catch(() => null),
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

  // `gwOverride` loads that gameweek instead of the selected one.
  // `ignoreSaved` shows the picks on FPL even when changes are saved.
  async function handleTeamIdSubmit(rawId, gwOverride, { ignoreSaved = false } = {}) {
    const ticket = newTicket();
    const teamId = parseTeamId(rawId);
    if (!gwOverride && teamId) track('team_check');
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
      finalizeResults(ticket, team.squad, team.gwStatic, team.bankTenths, team.entryMeta, team.activeChip, false, { isPastGw: team.isPastGwView, gwId, entryHistory: team.entryHistory, liveTotal: team.liveTotal });
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

  const { homeTeam, rememberHomeTeam, loadHomeTeam, homeLive } = useHomeTeam({ stage, savedTeams, fpl, buildResultsData });

  // An admin switching between the blend, the formula and the ML model: the
  // squad on screen is worked out again with the chosen predictions.
  const modelChoiceRef = useRef(modelChoice);
  useEffect(() => {
    if (modelChoiceRef.current === modelChoice) return;
    modelChoiceRef.current = modelChoice;
    if (stage === 'results' && resultsData && !resultsData.gwUnavailable) {
      if (resultsData.isOptimalBuild) loadOptimalSquadForGw(resultsData.gwId);
      else if (resultsData.entryMeta && resultsData.entryMeta.teamId) handleTeamIdSubmit(String(resultsData.entryMeta.teamId), resultsData.gwId);
      else rescoreSquadForGw(resultsData.gwId);
    } else if (stage === 'home' && homeTeam.teamId) {
      loadHomeTeam(homeTeam.teamId);
    } else if (stage === 'customBuild') {
      ensureStaticData().then(setCustomStaticData, () => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelChoice]);
  // The menu item to highlight while loading or on an error.
  const lastNavRef = useRef('home');

  // Shows the summary's squad as full results, without loading it again.
  function openHomeTeam() {
    if (homeTeam.status !== 'ready') { handleTeamIdSubmit(homeTeam.teamId); return; }
    if (selectedGw && selectedGw !== homeTeam.data.gwId) { handleTeamIdSubmit(homeTeam.teamId); return; }
    newTicket();
    currentStaticDataRef.current = homeTeam.staticData;
    setResultsData(homeTeam.data);
    setStageRaw('results');
  }

  // Reads the screenshot with OCR in the browser (no server, no AI
  // service), finds FPL player names in the text, then hands off to the
  // same review screen as every other squad source. Prices come from live
  // FPL data once each player is matched.
  async function handleScreenshot(shot) {
    const ticket = newTicket();
    track('screenshot_check');
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
      ? history.current.map(r => ({ event: r.event, points: r.points, hit: r.event_transfers_cost || 0, total: r.total_points })) : null;
    // A finished week's points from FPL's own record, which counts
    // automatic subs; one still being played from the picks and live scores.
    const weekRow = seasonSoFar && weekGw && isGwFinished(staticData, weekGw) ? seasonSoFar.find(r => r.event === weekGw) : null;
    if (result.notStarted) return { squad: [], xiTotal: 0, livePoints: null, liveHit: 0, notStarted: true, history: seasonSoFar, stats: null };
    // The week's picks: already loaded when that's the gameweek shown.
    const livePicks = !weekGw ? null : (started && result.picks ? result.picks : await optional(`entry/${entryId}/event/${weekGw}/picks/`));
    // While the week is on, score it as FPL will settle it: projected
    // bonus, automatic subs and the vice-captain (see src/lib/live.js).
    const weekFixtures = weekGw && !weekRow && livePicks ? await fixturesForGw(weekGw) : null;
    const liveNow = weekFixtures
      ? liveTeamScore({ picks: livePicks, liveById, bonus: projectedBonus(weekFixtures), states: teamStates(weekFixtures), playersById: staticData.playersById }).total
      : null;
    return {
      squad: result.squad, xiTotal: predictedXiTotal(result.squad),
      // The week's points, like FPL's, before any transfer hit (liveHit),
      // which comes off the season total.
      livePoints: weekRow ? weekRow.points : liveNow !== null ? liveNow : weekGw ? livePointsFor(livePicks, liveById) : null,
      liveHit: weekRow ? weekRow.hit : (livePicks && livePicks.entry_history && livePicks.entry_history.event_transfers_cost) || 0,
      picksFromGwId: result.entryMeta.picksFromGwId || null, edited: !!result.entryMeta.savedChanges,
      history: seasonSoFar,
      // For the league analysis (most captained, best transfers and so on).
      stats: memberWeekStats({ gw: weekGw, picks: livePicks, liveById, transfers, entry: result.entry, history }),
    };
  };
  // A new one when an admin switches model, so the league loads again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadLeagueTeam = useCallback((entryId, gwId) => loadLeagueTeamRef.current(entryId, gwId), [modelChoice]);

  /* ---------- The gameweek recap ---------- */

  const { recap, openRecap, closeRecap, loadRecapLeague } = useRecap({ stage, homeTeamId: homeTeam.teamId, fpl });

  const navItems = [
    { id: 'home', label: 'Home', desc: 'Your gameweek and the fixture ticker', group: 'Your team', Icon: House, footer: true, run: () => setStage('home') },
    {
      id: 'team', label: 'My team', desc: 'Every player in your squad, predicted', group: 'Your team', Icon: Shirt, footer: true,
      run: () => (homeTeam.teamId ? handleTeamIdSubmit(homeTeam.teamId) : setStage('teamIdForm')),
    },
    { id: 'league', label: 'Mini-league', desc: 'Your leagues, every team predicted', group: 'Your team', Icon: Users, run: () => setStage('league') },
    ...(gwOptions.some(e => isEventLocked(e)) ? [{ id: 'live', label: 'Live', desc: 'Your points and every match, as it happens', group: 'Your team', Icon: Radio, run: () => setStage('live') }] : []),
    { id: 'screenshot', label: 'Screenshot', desc: 'Read a squad from a screenshot', group: 'Your team', Icon: Camera, footer: true, run: () => setStage('screenshotForm') },
    { id: 'best', label: 'Best squad', desc: 'The top-predicted 15 for £100m', group: 'Tools', Icon: Trophy, footer: true, run: () => loadOptimalSquadForGw(selectedGw) },
    { id: 'build', label: 'Build a squad', desc: 'Pick your own and preview chips', group: 'Tools', Icon: Wand2, run: handleStartCustomBuild },
    { id: 'fixtures', label: 'Fixtures', desc: 'Every club\'s next 8 gameweeks', group: 'Tools', Icon: CalendarRange, run: () => setStage('fixtures') },
    { id: 'compare', label: 'Compare players', desc: 'Up to 3 players side by side', group: 'Tools', Icon: GitCompareArrows, run: () => setStage('compare') },
    { id: 'explore', label: 'Explore', desc: 'Search players, price moves and chip timing', group: 'Tools', Icon: Compass, run: () => setStage('explore') },
    ...(gwOptions.some(e => isEventLocked(e)) ? [{ id: 'lookback', label: 'Look back', desc: 'Past gameweeks against the best XI', group: 'Tools', Icon: History, run: handleViewHindsight }] : []),
    { id: 'saved', label: 'Saved teams', desc: 'Team IDs and squads on your account', group: 'Tools', Icon: Bookmark, run: () => (session ? setStage('myTeams') : openAuthDialog('login')) },
    { id: 'about', label: 'About this app', desc: 'What it does and how it predicts', group: 'App', Icon: Info, run: () => setStage('welcome') },
    { id: 'feedback', label: 'Send feedback', desc: 'Report a problem or suggest something', group: 'App', Icon: MessageSquare, run: () => openAuthDialog('feedback') },
    ...(session && session.admin ? [{ id: 'admin', label: 'Admin', desc: 'Model, data, reports and users', group: 'App', Icon: ShieldCheck, run: () => setStage('admin') }] : []),
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
    if (view === 'live') { setStage('live'); return; }
    const item = navItems.find(i => i.id === view);
    if (item) item.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const showNav = stage !== 'welcome' && stage !== 'boot';
  const wideStage = ['home', 'welcome', 'league', 'customBuild', 'fixtures', 'compare', 'explore', 'live', 'admin'].includes(stage);
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
          onProfileClick={() => setStage('profile')}
          profileOpen={stage === 'profile'}
        />
      )}
      <div className="fpl-shell">
      {showNav && <SideNav items={navItems} active={activeNav} />}
      <main ref={mainRef} tabIndex={-1} className={`fpl-main${wideStage ? ' fpl-main-wide' : ''}${stage === 'league' ? ' fpl-main-full' : ''}`}>
        <NoticeBars stage={stage} session={session} onEnterCode={() => openAuthDialog('verify')} />
        {session && session.admin && MODEL_SWITCH_STAGES.includes(stage) && (
          <ModelSwitch choice={modelChoice} available={modelAvailable} onChange={setModelChoice} />
        )}
        <ScreenErrorBoundary key={stage}>
          <Suspense fallback={<LoadingScreen />}>
            {stage === 'boot' && <LoadingScreen />}
            {stage === 'welcome' && (
              <WelcomeScreen
                loggedIn={!!session}
                onStart={() => { track('start'); if (readTermsAccepted()) setStage('home'); else setTermsOpen(true); }}
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
                onSaveTeamId={account.handleSaveTeamId}
                onSaveCustomSquad={account.handleSaveCustomSquad}
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
            {(stage === 'fixtures' || stage === 'compare' || stage === 'explore' || stage === 'live') && !liveStatic && <LoadingScreen message="Loading fixtures and players…" />}
            {stage === 'live' && liveStatic && liveGwIdFor(liveStatic) && (
              <LiveScreen
                key={leagueWeekGw}
                staticData={liveStatic}
                gwId={leagueWeekGw}
                teamId={homeTeam.teamId}
                fetchJson={fetchFplJson}
                onOpenLeague={() => setStage('league')}
                onAddTeam={() => setStage('home')}
              />
            )}
            {stage === 'fixtures' && liveStatic && (
              <FixturesScreen staticData={liveStatic} compareIds={compareIds} onToggleCompare={toggleCompare} onOpenCompare={() => setStage('compare')} />
            )}
            {stage === 'compare' && liveStatic && (
              <CompareScreen staticData={liveStatic} compareIds={compareIds} onToggleCompare={toggleCompare} onClear={() => setCompareIds([])} />
            )}
            {stage === 'explore' && liveStatic && (
              <ExploreScreen staticData={liveStatic} compareIds={compareIds} onToggleCompare={toggleCompare} />
            )}
            {stage === 'admin' && (session && session.admin
              ? <AdminScreen session={session} />
              : <ErrorScreen message="This page is for admins only." retryLabel="Home" onRetry={() => setStage('home')} />)}
            {stage === 'profile' && session && (
              <ProfileScreen
                session={session}
                notice={account.profileNotice}
                onDismissNotice={() => account.setProfileNotice('')}
                savedTeams={savedTeams}
                homeTeamId={homeTeam.teamId}
                onPickTeam={id => { if (!homeTeam.teamId) rememberHomeTeam(id); }}
                onOpenDialog={mode => openAuthDialog(mode)}
                onMyTeams={() => setStage('myTeams')}
                onLogout={account.handleLogout}
              />
            )}
            {stage === 'myTeams' && (
              <MyTeamsScreen
                teams={savedTeams}
                onLoad={handleLoadSavedTeam}
                onDelete={account.handleDeleteSavedTeam}
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
      {termsOpen && (
        <TermsDialog
          onAgree={() => { writeTermsAccepted(); setTermsOpen(false); setStage('home'); }}
          onClose={() => setTermsOpen(false)}
        />
      )}
      {account.authDialog && (
        <ScreenErrorBoundary key={account.authDialog} overlay>
          <Suspense fallback={null}>
            <AuthDialog
              // Remount when switching between log-in and email so the fields start fresh.
              key={account.authDialog}
              initialMode={account.authDialog}
              initialNotice={account.authNotice}
              currentEmail={session ? session.email : ''}
              currentUsername={session ? session.username : ''}
              hasPassword={session ? session.hasPassword !== false : true}
              onSetCredentials={account.handleSetCredentials}
              onSendFeedback={account.handleSendFeedback}
              onChangePassword={account.handleChangePassword}
              onSubmit={account.handleAuthSubmit}
              onSetEmail={account.handleSetEmail}
              onForgot={account.handleForgotPassword}
              onReset={account.handleResetPassword}
              onVerify={account.handleVerifyEmail}
              onDelete={account.handleDeleteAccount}
              onResendVerify={account.handleResendVerify}
              onClearError={() => account.setAuthError('')}
              error={account.authError}
              loading={account.authLoading}
              onClose={account.closeAuthDialog}
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
              onClose={closeRecap}
              onRetry={() => openRecap(recap.gwId)}
              onLoadLeague={id => loadRecapLeague(id, recap.gwId).then(l => leagueSlide(l, Number(recap.teamId)))}
            />
          </Suspense>
        </ScreenErrorBoundary>
      )}
      <Analytics />
      <SpeedInsights />
    </div>
  );
}
