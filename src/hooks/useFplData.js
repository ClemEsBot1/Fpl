// FPL's data, loaded once and shared by every screen: the players,
// predictions and gameweeks (the "static data"), live points, fixtures, and
// any team's squad for a gameweek. Also the gameweek picked in the header.
import { useEffect, useRef, useState } from 'react';
import { fetchFplJson, loadStaticData, loadStaticDataAsOf } from '../lib/fplClient.js';
import { applyAutomaticSubs, formulaSnapshotFor, hydrateSquadSnapshot, isEventLocked, snapshotFromModel, withPredictionSource } from '../lib/predictions.js';
import { liveTeamScore, projectedBonus, teamStates } from '../lib/live.js';
import { computeOptimalXiTotal } from '../lib/squadLogic.js';
import { readGwParam, readModelChoice, writeGwParam, writeModelChoice } from '../lib/appStorage.js';
import { currentGwId, defaultGwId, isGwFinished } from '../lib/gameweeks.js';
import { t } from '../lib/i18n.js';

// How long live points for a gameweek that's still being played stay fresh.
const LIVE_IN_PROGRESS_TTL_MS = 60_000;

// What went wrong loading a team, in words (codes thrown by loadTeamForGw).
export function teamErrorMessage(e) {
  const messages = {
    ERR_STATIC_DATA: t("Couldn't load live FPL player data right now. Try again in a moment, or upload a screenshot instead."),
    ERR_PICKS_FETCH: t("FPL's servers aren't responding right now. Try again in a moment, or upload a screenshot instead."),
    ERR_GW_LOCKED: t("FPL hasn't published any picks for this team yet (a new team's picks are hidden until its first deadline passes). Try again after the deadline, or upload a screenshot for now."),
    ERR_TEAM_NOT_FOUND: t("We couldn't find a team with that ID. Double-check the number in your FPL URL and try again."),
    ERR_TEAM_NOT_STARTED: t('This team started in Gameweek {start}, so it has no squad for Gameweek {gw}.', { start: e && e.startedEvent, gw: e && e.gwId }),
    ERR_UNKNOWN: t('Something went wrong pulling your team. Try again, or upload a screenshot instead.'),
  };
  return messages[(e && e.code) || 'ERR_UNKNOWN'] || messages.ERR_UNKNOWN;
}

// Predictions and (for a finished gameweek) actual points for each squad
// slot, from the given static data.
export function scoreSlots(slots, staticData, liveById, isPastGw) {
  return slots.map(slot => {
    const player = staticData.playersById[slot.playerId];
    if (!player) return null;
    const pred = staticData.predictionsById[slot.playerId];
    const live = liveById[slot.playerId];
    return {
      player, predicted: pred.predicted, nextMatchPredicted: pred.nextMatchPredicted, availNote: pred.availNote, breakdown: pred.breakdown, range: pred.range,
      isStarting: slot.isStarting, isCaptain: !!slot.isCaptain, isViceCaptain: !!slot.isViceCaptain,
      multiplier: slot.multiplier,
      ...(isPastGw ? { actualPoints: live ? live.totalPoints : 0, played: live ? live.minutes > 0 : false } : {}),
    };
  }).filter(Boolean);
}

// `admin`: whether the logged-in account may switch from the blend to the
// formula's or the ML model's predictions alone (see withPredictionSource).
export function useFplData({ admin = false } = {}) {
  const [selectedGw, setSelectedGw] = useState(readGwParam); // null = use current/next gameweek
  const [modelChoice, setModelChoiceState] = useState(readModelChoice);
  const choice = admin ? modelChoice : 'blend';
  // Read by loads already under way, so they use the choice made since.
  const choiceRef = useRef(choice);
  choiceRef.current = choice;
  const setModelChoice = next => { writeModelChoice(next); setModelChoiceState(next); };
  const viewOf = data => withPredictionSource(data, choiceRef.current);
  const [gwOptions, setGwOptions] = useState([]);
  // The current static data, for screens that show it directly (Home).
  const [liveStatic, setLiveStatic] = useState(null);

  const staticPromiseRef = useRef(null);
  // The most recently loaded static data (to tell when its gameweek has
  // closed and it needs loading again).
  const staticDataRef = useRef(null);
  // A reload of that data in progress (see ensureStaticData).
  const refreshPromiseRef = useRef(null);
  // The optimal XI's predicted total, per static-data set (the current one,
  // or a past gameweek rebuilt "as of" its deadline).
  const optimalXiTotalRef = useRef(new WeakMap());
  // Past gameweeks' "as of" static data, by gameweek id (promises).
  const asOfCacheRef = useRef(new Map());
  // Live points per gameweek: { at, promise }.
  const liveCacheRef = useRef(new Map());
  const fixturesCacheRef = useRef(new Map());

  // Loads (once) the FPL data everything else needs. A failed first load
  // isn't kept, so the next attempt tries again. Once the gameweek it was
  // planning for has closed (the app was left open past a deadline) it's
  // loaded afresh for the next one. FPL is often unavailable for a while
  // just after a deadline, so if that fails the old data is used until the
  // next attempt works. ensureStaticData() gives it as the screens show
  // it (one model's figures alone, when an admin picked one).
  function ensureStaticData() {
    return loadFormulaData().then(viewOf);
  }
  function loadFormulaData() {
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

  // Keep the address in step with the gameweek picked: the default one
  // needs no ?gw, any other is written in.
  useEffect(() => {
    const target = liveStatic && liveStatic.targetEvent ? defaultGwId(liveStatic) : null;
    if (!target) return;
    writeGwParam(selectedGw && selectedGw !== target ? selectedGw : null);
  }, [selectedGw, liveStatic]);

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
  // `formula` uses the formula's predictions alone whatever an admin picked.
  async function staticDataForGw(gwId, { formula = false } = {}) {
    const view = formula ? data => withPredictionSource(data, 'formula') : viewOf;
    const base = await loadFormulaData();
    if (!gwId || gwId >= currentGwId(base)) return view(base);
    if (!asOfCacheRef.current.has(gwId)) {
      asOfCacheRef.current.set(gwId, loadStaticDataAsOf(base, gwId).catch(err => {
        asOfCacheRef.current.delete(gwId);
        throw err;
      }));
    }
    try {
      return view(await asOfCacheRef.current.get(gwId));
    } catch {
      return { ...view(base), asOfFailedGwId: gwId };
    }
  }

  // A closed gameweek's saved best squad, as the formula picked it. One the
  // model picked (snapshotFromModel) is rebuilt here from the formula and
  // that gameweek's pre-deadline data; if that data can't be had, the saved
  // one is kept.
  async function formulaSnapshot(snap, gwId) {
    if (!snapshotFromModel(snap)) return snap;
    const gwStatic = await staticDataForGw(gwId, { formula: true });
    if (!gwStatic || gwStatic.asOfFailedGwId) return snap;
    try { return formulaSnapshotFor(snap, gwStatic); } catch { return snap; }
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

  // One gameweek's matches (scores, BPS, bonus), for live scoring of a
  // gameweek still being played. Refetched after a minute; null on failure.
  function fixturesForGw(gwId) {
    const cached = fixturesCacheRef.current.get(gwId);
    if (cached && Date.now() - cached.at < LIVE_IN_PROGRESS_TTL_MS) return cached.promise;
    const promise = fetchFplJson(`fixtures/?event=${gwId}`).catch(() => {
      fixturesCacheRef.current.delete(gwId);
      return null;
    });
    fixturesCacheRef.current.set(gwId, { at: Date.now(), promise });
    return promise;
  }

  // Loads a team's squad for `gwId`, scored with that gameweek's data.
  // Shared by the Team ID results and the home screen's summary. Throws
  // { code } (see teamErrorMessage); returns null if `isStale()` says the
  // answer is no longer wanted.
  async function loadTeamForGw(teamId, gwId, staticData, { isStale = () => false, onProgress = () => {}, savedSquad = null } = {}) {
    const targetId = currentGwId(staticData);
    const isPastGwView = gwId < targetId;
    const hasPicks = p => p && !p.detail && Array.isArray(p.picks) && p.picks.length > 0;

    // Everything that only depends on the gameweek starts straight away,
    // alongside the team's own lookups.
    const gwStaticPromise = isPastGwView ? staticDataForGw(gwId) : Promise.resolve(staticData);
    const weekFinished = isGwFinished(staticData, gwId);
    const livePromise = isPastGwView ? liveForGw(gwId, weekFinished) : Promise.resolve({});
    // A week still being played is scored as FPL will settle it (projected
    // bonus, automatic subs, the vice-captain), which needs its matches.
    const fixturesPromise = isPastGwView && !weekFinished ? fixturesForGw(gwId) : Promise.resolve(null);
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
    if (entry) entryMeta.teamName = entry.name || t('Your Squad');

    // FPL hides a team's picks for a gameweek until its deadline passes.
    // Rather than give up, load the most recent gameweek we *can* see —
    // the squad is the same unless they've made transfers since — and
    // score it for the gameweek that was asked for. Only for the
    // upcoming gameweek: a missing past gameweek means the team didn't
    // exist yet, and borrowing a later squad there would be wrong.
    let picksGwId = gwId;
    if (!hasPicks(picks) && !isPastGwView && entry) {
      onProgress(t("This gameweek's picks are hidden until the deadline. Loading your latest team…"));
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

    onProgress(isPastGwView ? t('Rebuilding player data from before that deadline…') : t('Checking fixtures and working out predictions…'));
    const [gwStatic, liveById, weekFixtures] = await Promise.all([gwStaticPromise, livePromise, fixturesPromise]);
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

    const liveTotal = weekFixtures && !borrowed
      ? liveTeamScore({ picks, liveById, bonus: projectedBonus(weekFixtures), states: teamStates(weekFixtures), playersById: staticData.playersById }).total
      : null;

    return {
      squad, gwStatic, entry, entryMeta, isPastGwView, liveTotal,
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

  return {
    selectedGw, setSelectedGw, gwOptions, liveStatic: withPredictionSource(liveStatic, choice), staticDataRef,
    modelChoice: choice, setModelChoice, modelAvailable: !!(liveStatic && liveStatic.mlBuiltAt),
    ensureStaticData, getOptimalXiTotal, staticDataForGw, formulaSnapshot, liveForGw, fixturesForGw, loadTeamForGw,
  };
}
