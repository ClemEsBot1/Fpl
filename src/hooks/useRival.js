// Your mini-league rival's last picks, for the heads-up before the
// deadline (rivalAlert in src/lib/alerts.js). Uses the league last opened
// in Mini-league (kept on this device) and only looks in the 48 hours
// before the deadline. null otherwise, or if anything fails to load.
import { useEffect, useState } from 'react';
import { fetchFplJson } from '../lib/fplClient.js';
import { parseStandings } from '../lib/leagues.js';
import { pickRival } from '../lib/alerts.js';

const LEAGUE_KEY = 'fpl_league_id';
const WINDOW = 48 * 3600 * 1000;

export function useRival(teamId, staticData) {
  const [rival, setRival] = useState(null);
  const target = staticData && staticData.targetEvent;
  const gw = target ? target.id : null;
  const deadline = target ? target.deadline_time : null;
  useEffect(() => {
    let leagueId = null;
    try { leagueId = Number(localStorage.getItem(LEAGUE_KEY)) || null; } catch { /* none */ }
    const left = deadline ? new Date(deadline).getTime() - Date.now() : -1;
    if (!teamId || !leagueId || !gw || gw < 2 || !(left > 0 && left < WINDOW)) return undefined;
    let live = true;
    (async () => {
      const standings = parseStandings(await fetchFplJson(`leagues-classic/${leagueId}/standings/`));
      const who = standings && pickRival(standings.members, teamId);
      if (!who) return;
      const picks = await fetchFplJson(`entry/${who.entry}/event/${gw - 1}/picks/`);
      if (live && picks && Array.isArray(picks.picks)) setRival({ ...who, picks: picks.picks, fromGw: gw - 1 });
    })().catch(() => {});
    return () => { live = false; };
  }, [teamId, gw, deadline]);
  return rival;
}
