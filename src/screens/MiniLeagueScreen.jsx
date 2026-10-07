// Mini-league: the standings of one of your classic leagues, with what
// every member's team is predicted to score this gameweek. Tap a member to
// see their team.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, Trophy, Users } from 'lucide-react';
import { SkeletonRows } from '../components/common.jsx';
import { POSITION_LABELS, fmtPts } from '../lib/format.js';
import { forEachLimited, parseStandings, privateLeagues } from '../lib/leagues.js';
import { POSITION_ORDER } from '../lib/predictions.js';

const LEAGUE_KEY = 'fpl_league_id';
// Members' teams are fetched a few at a time, so a 50-team league doesn't
// fire 150 requests at once.
const TEAM_LOADS_AT_ONCE = 6;

function readSavedLeague() {
  try { return Number(localStorage.getItem(LEAGUE_KEY)) || null; } catch { return null; }
}
function saveLeague(id) {
  try { localStorage.setItem(LEAGUE_KEY, String(id)); } catch { /* private mode */ }
}

// One member's 15: the XI by position, then the bench, each player's
// predicted points beside their name.
function MemberTeam({ team, teamsById, onOpen }) {
  const starters = team.squad.filter(s => s.isStarting);
  const bench = team.squad.filter(s => !s.isStarting);
  const row = s => {
    const club = teamsById[s.player.team];
    return (
      <li key={s.player.id} className="fpl-league-player">
        <span className="fpl-row-pos">{POSITION_LABELS[s.player.positionId]}</span>
        <span className="fpl-league-player-name">
          {s.player.webName}
          {s.isCaptain && <span className="fpl-armband" title="Captain">C</span>}
          {s.isViceCaptain && <span className="fpl-armband fpl-armband-vc" title="Vice-captain">V</span>}
          <small>{club ? club.short_name : ''}</small>
        </span>
        <span className="fpl-league-player-pts">{fmtPts(s.predicted * (s.isStarting ? (s.multiplier || 1) : 1))}</span>
      </li>
    );
  };
  return (
    <div className="fpl-league-team">
      {team.edited
        ? <p className="fpl-home-hint">Showing your edits to this team. Open it to change it more, or go back to the team on FPL.</p>
        : team.picksFromGwId && <p className="fpl-home-hint">This gameweek's picks are hidden until the deadline, so this is their Gameweek {team.picksFromGwId} team.</p>}
      <ul>{POSITION_ORDER.flatMap(pos => starters.filter(s => s.player.positionId === pos)).map(row)}</ul>
      <h4 className="fpl-home-sub">Bench</h4>
      <ul>{bench.map(row)}</ul>
      <button type="button" className="fpl-link" onClick={onOpen}>Open and edit this team <ArrowRight size={14} /></button>
    </div>
  );
}

// One league's standings with each member's predicted points; mounted
// afresh for each league picked.
function LeagueTable({ leagueId, gwName, teamsById, fetchJson, loadTeam, onOpenTeam }) {
  const [standings, setStandings] = useState({ status: 'loading', data: null });
  const [teams, setTeams] = useState({}); // entry -> { status, squad, xiTotal, picksFromGwId }
  const [open, setOpen] = useState(null);
  const [sortBy, setSortBy] = useState('rank');

  // The standings, then every member's team a few at a time.
  useEffect(() => {
    let cancelled = false;
    fetchJson(`leagues-classic/${leagueId}/standings/`)
      .then(json => {
        if (cancelled) return;
        const data = parseStandings(json);
        if (!data) { setStandings({ status: 'error', data: null }); return; }
        saveLeague(leagueId);
        setStandings({ status: 'ready', data });
        forEachLimited(data.members, TEAM_LOADS_AT_ONCE, m => loadTeam(m.entry), (m, team, error) => {
          if (cancelled) return;
          setTeams(prev => ({ ...prev, [m.entry]: error || !team ? { status: 'error' } : { status: 'ready', ...team } }));
        });
      })
      .catch(() => { if (!cancelled) setStandings({ status: 'error', data: null }); });
    return () => { cancelled = true; };
  }, [leagueId, fetchJson, loadTeam]);

  const members = useMemo(() => {
    const list = standings.data ? [...standings.data.members] : [];
    if (sortBy === 'predicted') {
      const pts = m => (teams[m.entry] && teams[m.entry].status === 'ready' ? teams[m.entry].xiTotal : -1);
      list.sort((a, b) => pts(b) - pts(a) || a.rank - b.rank);
    }
    return list;
  }, [standings.data, teams, sortBy]);

  return (
    <section className="fpl-glass fpl-home-card" aria-labelledby="league-h" aria-busy={standings.status === 'loading'}>
      <div className="fpl-home-team-head">
        <h2 id="league-h" className="fpl-home-h"><Trophy size={18} aria-hidden="true" /> {standings.data ? standings.data.league.name : 'League'}</h2>
        <div className="fpl-league-sort" role="group" aria-label="Sort by">
          <button type="button" className={`fpl-chip-btn${sortBy === 'rank' ? ' active' : ''}`} aria-pressed={sortBy === 'rank'} onClick={() => setSortBy('rank')}>Rank</button>
          <button type="button" className={`fpl-chip-btn${sortBy === 'predicted' ? ' active' : ''}`} aria-pressed={sortBy === 'predicted'} onClick={() => setSortBy('predicted')}>Predicted</button>
        </div>
      </div>
      {standings.status === 'loading' && <SkeletonRows rows={8} label="Loading the league…" />}
      {standings.status === 'error' && <p className="fpl-home-text" role="alert">Couldn't load league {leagueId}. Check the ID, or try again in a minute.</p>}
      {standings.status === 'ready' && (
        <>
          <div className="fpl-league-cols fpl-mono" aria-hidden="true"><span>#</span><span>Team</span><span>Total</span><span>{gwName ? `${gwName.replace('Gameweek', 'GW')} pred` : 'Pred'}</span></div>
          <ol className="fpl-league-list">
            {members.map(m => {
              const team = teams[m.entry];
              const isOpen = open === m.entry;
              return (
                <Fragment key={m.entry}>
                  <li className={`fpl-league-row${isOpen ? ' is-open' : ''}`}>
                    <span className="fpl-league-rank fpl-mono">{m.rank}</span>
                    <button type="button" className="fpl-league-who" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : m.entry)} disabled={!team || team.status !== 'ready'}>
                      <b>{m.teamName}{team && team.edited && <span className="fpl-league-edited">Edited</span>}</b>
                      <small>{m.managerName}</small>
                      <ChevronDown size={14} aria-hidden="true" className="fpl-league-chev" />
                    </button>
                    <span className="fpl-league-total fpl-mono">{m.total}</span>
                    <span className="fpl-league-pred fpl-mono">
                      {!team ? <span className="fpl-skel fpl-league-skel" aria-label="Loading" />
                        : team.status === 'ready' ? fmtPts(team.xiTotal) : '–'}
                    </span>
                  </li>
                  {isOpen && team && team.status === 'ready' && (
                    <li className="fpl-league-open"><MemberTeam team={team} teamsById={teamsById} onOpen={() => onOpenTeam(m.entry)} /></li>
                  )}
                </Fragment>
              );
            })}
          </ol>
          <p className="fpl-home-hint">
            Predicted points are each team's starting XI, captain doubled.
            {standings.data.hasMore ? ' Showing the top 50.' : ''}
          </p>
        </>
      )}
    </section>
  );
}

export function MiniLeagueScreen({ homeTeamId, gwName, teamsById, fetchJson, loadTeam, onOpenTeam, onAddTeamId }) {
  const [leagues, setLeagues] = useState({ status: homeTeamId ? 'loading' : 'none', list: [] });
  const [leagueId, setLeagueId] = useState(readSavedLeague);
  const [idInput, setIdInput] = useState('');

  // Your leagues, from your Team ID. The first one is shown unless a
  // league was picked last time.
  useEffect(() => {
    if (!homeTeamId) return undefined;
    let cancelled = false;
    fetchJson(`entry/${homeTeamId}/`)
      .then(entry => {
        if (cancelled) return;
        const list = privateLeagues(entry);
        setLeagues({ status: 'ready', list });
        setLeagueId(current => current || (list[0] ? list[0].id : null));
      })
      .catch(() => { if (!cancelled) setLeagues({ status: 'error', list: [] }); });
    return () => { cancelled = true; };
  }, [homeTeamId, fetchJson]);

  function submitLeagueId(e) {
    e.preventDefault();
    const id = Number(idInput);
    if (id > 0) { setLeagueId(id); setIdInput(''); }
  }

  return (
    <div className="fpl-league">
      <h1 className="fpl-display fpl-league-title">Mini-league</h1>

      <section className="fpl-glass fpl-home-card" aria-labelledby="league-pick-h">
        <h2 id="league-pick-h" className="fpl-home-h"><Users size={18} aria-hidden="true" /> Your leagues</h2>
        {leagues.status === 'loading' && <SkeletonRows rows={2} label="Loading your leagues…" />}
        {leagues.status === 'none' && (
          <p className="fpl-home-text">
            Add your Team ID to see your leagues here, or enter a league ID below.{' '}
            <button type="button" className="fpl-link" onClick={onAddTeamId}>Add your Team ID</button>
          </p>
        )}
        {leagues.status === 'error' && <p className="fpl-home-text" role="alert">Couldn't load your leagues from FPL. You can still enter a league ID below.</p>}
        {leagues.status === 'ready' && !leagues.list.length && <p className="fpl-home-text">You're not in any private leagues yet.</p>}
        {leagues.list.length > 0 && (
          <div className="fpl-league-chips">
            {leagues.list.map(l => (
              <button key={l.id} type="button" className={`fpl-chip-btn${l.id === leagueId ? ' active' : ''}`} aria-pressed={l.id === leagueId} onClick={() => setLeagueId(l.id)}>
                {l.name}{l.rank ? <span className="fpl-mono"> · {l.rank}{ordinal(l.rank)}</span> : null}
              </button>
            ))}
          </div>
        )}
        <form className="fpl-home-tid" onSubmit={submitLeagueId}>
          <input
            className="fpl-input"
            inputMode="numeric"
            placeholder="Another league ID"
            aria-label="League ID"
            value={idInput}
            onChange={e => setIdInput(e.target.value.replace(/[^0-9]/g, ''))}
          />
          <button type="submit" className="fpl-btn fpl-btn-solid" disabled={!idInput}>Show</button>
        </form>
        <p className="fpl-home-hint">A league's ID is the number after <span className="fpl-mono">/leagues/</span> in its address on the FPL site.</p>
      </section>

      {leagueId && (
        <LeagueTable key={leagueId} leagueId={leagueId} gwName={gwName} teamsById={teamsById} fetchJson={fetchJson} loadTeam={loadTeam} onOpenTeam={onOpenTeam} />
      )}
    </div>
  );
}

function ordinal(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
}
