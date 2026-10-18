// Home: the remembered team's summary, and the points every player scored
// in the gameweek picked (for Home's recap of a gameweek that has started).
import { useEffect, useRef, useState } from 'react';
import { HOME_TEAM_KEY, readHomeTeamId } from '../lib/appStorage.js';
import { currentGwId, isGwFinished } from '../lib/gameweeks.js';
import { teamChangesFor } from '../lib/savedSquads.js';
import { teamErrorMessage } from './useFplData.js';

// `fpl` is what useFplData returns; `buildResultsData` turns a loaded team
// into what the results screen shows.
export function useHomeTeam({ stage, savedTeams, fpl, buildResultsData }) {
  const { selectedGw, gwOptions, liveStatic, staticDataRef, ensureStaticData, loadTeamForGw, liveForGw } = fpl;
  // The team summarised on Home: { teamId, status: 'idle'|'loading'|'ready'|'error', data, error }.
  const [homeTeam, setHomeTeam] = useState(() => ({ teamId: readHomeTeamId(), status: 'idle', data: null, error: null }));
  const homeTicketRef = useRef(0);

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
      const data = buildResultsData(team.squad, team.gwStatic, team.bankTenths, team.entryMeta, team.activeChip, false, { isPastGw: team.isPastGwView, gwId, entryHistory: team.entryHistory, liveTotal: team.liveTotal });
      setHomeTeam({ teamId, status: 'ready', data: { ...data, entry: team.entry }, error: null, loadedAt: Date.now(), staticData: team.gwStatic, savedSquad });
    } catch (e) {
      if (!isStale()) setHomeTeam({ teamId, status: 'error', data: null, error: teamErrorMessage(e) });
    }
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

  return { homeTeam, rememberHomeTeam, loadHomeTeam, homeLive };
}
