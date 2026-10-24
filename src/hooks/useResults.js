// The squad on the results screen: building what it shows, edits made
// to it, re-scoring it for another gameweek and saving a Team ID's changes.
import { useEffect, useRef, useState } from 'react';
import { computeSquadScore, suggestCaptain, suggestTransfers } from '../lib/squadLogic.js';
import { clearTeamEdit, saveTeamEdit } from '../lib/teamEdits.js';
import { squadSnapshot } from '../lib/savedSquads.js';
import { currentGwId, isGwFinished } from '../lib/gameweeks.js';
import { postJson } from './useAccount.js';
import { scoreSlots } from './useFplData.js';
import { t } from '../lib/i18n.js';
import { predictedMultiplier } from '../lib/format.js';

// `screens` is what useStage returns, `fpl` what useFplData returns, and
// `handleTeamsResult` comes from useAccount.
export function useResults({ screens, fpl, handleTeamsResult }) {
  const { newTicket, isCurrent, setStageRaw, showLoading, showError } = screens;
  const { ensureStaticData, getOptimalXiTotal, staticDataForGw, liveForGw } = fpl;
  const [resultsData, setResultsData] = useState(null);
  // The static data the squad on screen was scored with.
  const currentStaticDataRef = useRef(null);

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

  // Re-scores the squad on screen for another gameweek — for squads that
  // aren't tied to an FPL team (screenshot, custom or saved squads), which
  // keep the same players. Team ID squads reload that gameweek's picks.
  async function rescoreSquadForGw(gwId) {
    const prev = resultsData;
    if (!prev) return;
    const ticket = newTicket();
    showLoading(ticket, t('Re-scoring your squad for that gameweek…'));
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
      showError(ticket, t("Couldn't load that gameweek right now. Try again in a moment."));
    }
  }

  function buildResultsData(squad, staticData, bankTenths, entryMeta, activeChip, isOptimalBuild, extra = {}) {
    const { isPastGw = false, nextRefreshAt = null, builtAt = null, gwUnavailable = false, gwId = null, backfilled = false, entryHistory = null, liveTotal = null } = extra;
    const starters = squad.filter(s => s.isStarting);
    const bench = squad.filter(s => !s.isStarting);

    let xiTotal = 0;
    let actualXiTotal = 0;
    squad.forEach(s => {
      // Starters count at their multiplier (the captain's 2, or 3 under
      // Triple Captain); the bench only counts under Bench Boost. The
      // prediction counts the captain picked, not the vice-captain FPL may
      // have passed the armband to (predictedMultiplier).
      const mult = s.isStarting || activeChip === 'bboost' ? (s.multiplier || 1) : 0;
      xiTotal += s.predicted * predictedMultiplier(s, activeChip);
      actualXiTotal += (s.actualPoints || 0) * mult;
    });

    const captain = squad.find(s => s.isCaptain) || null;
    const captainSuggestion = isPastGw ? null : suggestCaptain(starters);
    const suggestions = isPastGw ? [] : suggestTransfers(squad, staticData.allPlayers, staticData.predictionsById, bankTenths || 0);

    return {
      squad, starters, bench, xiTotal, actualXiTotal: isPastGw ? actualXiTotal : null, captain, captainSuggestion, suggestions,
      entryMeta, bankTenths, activeChip, isOptimalBuild,
      isPastGw, nextRefreshAt, builtAt, gwUnavailable, gwId, backfilled, entryHistory, liveTotal,
      squadScore: isOptimalBuild ? 100 : computeSquadScore(xiTotal, getOptimalXiTotal(staticData, isPastGw ? gwId : null)),
      targetEvent: staticData.targetEvent, teamsById: staticData.teamsById, fixturesByTeam: staticData.fixturesByTeam, allEvents: staticData.allEvents,
      allPlayers: staticData.allPlayers, predictionsById: staticData.predictionsById, totalPlayers: staticData.totalPlayers || 0,
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
        isPastGw: prev.isPastGw, nextRefreshAt: prev.nextRefreshAt, builtAt: prev.builtAt, gwId: prev.gwId, backfilled: prev.backfilled, entryHistory: prev.entryHistory, liveTotal: prev.liveTotal,
      });
      // Changed since it was loaded or last saved.
      return { ...next, edited: true };
    });
  }

  return { resultsData, setResultsData, currentStaticDataRef, buildResultsData, finalizeResults, handleSquadUpdate, rescoreSquadForGw, handleSaveTeamChanges };
}
