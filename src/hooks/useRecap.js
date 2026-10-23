// The gameweek recap: the slides for the Home team's gameweek, opened from
// Home or popping up once a gameweek is over.
import { useEffect, useRef, useState } from 'react';
import { fetchFplJson } from '../lib/fplClient.js';
import { SQUAD_BUDGET, buildHindsightSquad, hydrateFrozenSquadSnapshot, snapshotIsForSeason } from '../lib/predictions.js';
import { forEachLimited, parseStandings, privateLeagues } from '../lib/leagues.js';
import { summariseAccuracy } from '../lib/accuracy.js';
import { buildRecap, lastFinishedGw, markRecapSeen, recapSeenFor } from '../lib/recap.js';
import { recapChunk } from '../lib/chunks.js';
import { isGwFinished, liveGwIdFor } from '../lib/gameweeks.js';
import { teamErrorMessage } from './useFplData.js';
import { t } from '../lib/i18n.js';

// `fpl` is what useFplData returns.
export function useRecap({ stage, homeTeamId, fpl }) {
  const { liveStatic, ensureStaticData, loadTeamForGw, liveForGw, formulaSnapshot, staticDataForGw } = fpl;
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
    const teamId = homeTeamId;
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
      const [team, history, transfers, liveById, snap, savedAccuracy, topPicks, topMeta] = await Promise.all([
        loadTeamForGw(teamId, gwId, staticData, { isStale }),
        optional(fetchFplJson(`entry/${teamId}/history/`)),
        optional(fetchFplJson(`entry/${teamId}/transfers/`)),
        liveForGw(gwId, isGwFinished(staticData, gwId)),
        optional(fetch(`/api/optimal-squad?gw=${gwId}`).then(res => (res.ok ? res.json() : null)).then(s => formulaSnapshot(s, gwId))),
        optional(fetch(`/api/accuracy?gw=${gwId}`).then(res => (res.ok ? res.json() : null))),
        // The week's highest-scoring manager's team.
        topEntry ? optional(fetchFplJson(`entry/${topEntry}/event/${gwId}/picks/`)) : null,
        topEntry ? optional(fetchFplJson(`entry/${topEntry}/`)) : null,
      ]);
      if (!team || isStale()) return;
      // How the predictions did across every player: from the ones saved
      // before the deadline when there are some, otherwise worked out here
      // from that gameweek's predictions (made only from what was known
      // before it) and every player's points.
      let accuracy = savedAccuracy;
      if (!accuracy) {
        const gwStatic = await optional(staticDataForGw(gwId));
        if (gwStatic && !gwStatic.asOfFailedGwId) {
          const predictedById = Object.fromEntries(Object.entries(gwStatic.predictionsById).map(([id, p]) => [id, p.predicted]));
          const elements = Object.entries(liveById).map(([id, l]) => ({ id: Number(id), stats: { total_points: l.totalPoints, minutes: l.minutes } }));
          const positionById = Object.fromEntries(gwStatic.allPlayers.map(p => [p.id, p.positionId]));
          accuracy = summariseAccuracy(predictedById, elements, positionById);
        }
      }
      if (isStale()) return;
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
        gwId, gwName: event ? event.name : t('Gameweek {n}', { n: gwId }), teamId: Number(teamId),
        teamName: (team.entryMeta && team.entryMeta.teamName) || t('Team {id}', { id: teamId }),
        squad: team.squad, entryHistory: team.entryHistory, activeChip: team.activeChip, entry: team.entry,
        event, events: staticData.allEvents, totalPlayers: staticData.totalPlayers, history, transfers, liveById,
        playersById: staticData.playersById, allPlayers: staticData.allPlayers, teamsById: staticData.teamsById,
        fixturesByTeam: staticData.fixturesByTeam, predictionsById: staticData.predictionsById,
        top: topPicks && !topPicks.detail ? { name: (topMeta && topMeta.name) || t('Top team'), picks: topPicks } : null,
        league, leagues, modelScore, bestScore: best.totalScore, modelSquad: frozen ? frozen.squad : null, bestSquad: best.squad,
        accuracy,
      });
      setRecap({ gwId, teamId, status: 'ready', data, error: null, open: true });
    } catch (e) {
      if (isStale()) return;
      setRecap(r => (r && r.open ? { ...r, status: 'error', error: teamErrorMessage(e) } : null));
    }
  }

  function closeRecap() {
    recapTicketRef.current += 1;
    setRecap(null);
  }

  // Once a gameweek is over, its recap pops up on Home, once per team on
  // this device.
  useEffect(() => {
    if (stage !== 'home' || !liveStatic || !homeTeamId || recap) return;
    const gwId = lastFinishedGw(liveStatic.allEvents);
    if (!gwId || recapSeenFor(homeTeamId) >= gwId) return;
    markRecapSeen(homeTeamId, gwId);
    openRecap(gwId, { open: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, liveStatic, homeTeamId]);

  return { recap, openRecap, closeRecap, loadRecapLeague };
}
