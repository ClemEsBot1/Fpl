// Mini-league: the standings of one of your classic leagues, with what
// every member's team is predicted to score this gameweek. Tap a member to
// see their team.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Anchor, Armchair, ArrowDown, ArrowRight, ArrowRightLeft, ArrowUp, Ban, ChartBar, ChevronDown, Crown, Gem, Heart, LogIn, LogOut, Medal, PiggyBank, RotateCcw, Shuffle, Star, StarOff, Target, ThumbsDown, TrendingDown, TrendingUp, Trophy, Users } from 'lucide-react';
import { SkeletonRows } from '../components/common.jsx';
import { Pitch, PlayerCard } from '../components/Pitch.jsx';
import { fmtPrice, fmtPts } from '../lib/format.js';
import { expectedPositions, forEachLimited, leagueHighlights, membersAtGw, parseStandings, privateLeagues } from '../lib/leagues.js';

const LEAGUE_KEY = 'fpl_league_id';
// Members' teams are fetched a few at a time, so a 50-team league doesn't
// fire 150 requests at once. Teams that still fail (FPL turning requests
// away) get one more go once the rest are in, two at a time.
const TEAM_LOADS_AT_ONCE = 4;
const RETRIES_AT_ONCE = 2;
const RETRY_AFTER_MS = 1500;

function readSavedLeague() {
  try { return Number(localStorage.getItem(LEAGUE_KEY)) || null; } catch { return null; }
}
function saveLeague(id) {
  try { localStorage.setItem(LEAGUE_KEY, String(id)); } catch { /* private mode */ }
}

// One member's 15 on a pitch: the XI, then the bench, each player's
// predicted points (or what they scored, for a gameweek that has started).
function MemberTeam({ team, teamsById, onOpen }) {
  const starters = team.squad.filter(s => s.isStarting);
  const bench = team.squad.filter(s => !s.isStarting);
  const card = slot => {
    const mult = slot.isStarting ? (slot.multiplier || 1) : 1;
    const scored = slot.actualPoints !== undefined;
    const club = teamsById[slot.player.team];
    return (
      <PlayerCard
        key={slot.player.id}
        slot={slot}
        team={club}
        points={scored ? (slot.played === false ? '–' : slot.actualPoints * mult) : fmtPts(slot.predicted * mult)}
        info={scored ? `pred ${fmtPts(slot.predicted * mult)}` : (club ? club.short_name : '')}
      />
    );
  };
  return (
    <div className="fpl-league-team">
      {team.edited
        ? <p className="fpl-home-hint">Showing your edits to this team. Open it to change it more, or go back to the team on FPL.</p>
        : team.picksFromGwId && <p className="fpl-home-hint">This gameweek's picks are hidden until the deadline, so this is their Gameweek {team.picksFromGwId} team.</p>}
      <Pitch starters={starters} bench={bench} card={card} compact />
      <button type="button" className="fpl-link" onClick={onOpen}>Open and edit this team <ArrowRight size={14} /></button>
    </div>
  );
}

// Expected position after the next gameweek, with how far that is from
// the current rank.
function ExpectedCell({ rank, expected, loading }) {
  if (loading) return <span className="fpl-league-exp"><span className="fpl-skel fpl-league-skel" aria-label="Loading" /></span>;
  if (!expected) return <span className="fpl-league-exp fpl-mono">–</span>;
  const move = rank - expected.position;
  return (
    <span className="fpl-league-exp fpl-mono" title={`${expected.projected} pts expected`}>
      {expected.position}
      {move !== 0 && (
        <small className={move > 0 ? 'is-up' : 'is-down'} aria-label={move > 0 ? `up ${move}` : `down ${-move}`}>
          {move > 0 ? <ArrowUp size={11} aria-hidden="true" /> : <ArrowDown size={11} aria-hidden="true" />}{Math.abs(move)}
        </small>
      )}
    </span>
  );
}

// The league analysis: who leads each category this week and this season,
// and the players the league is captaining, owning, buying and selling.
const MANAGER_ICONS = {
  motw: Target, worst: ThumbsDown, rise: TrendingUp, fall: TrendingDown, bestTransfers: ArrowRightLeft, worstTransfers: Ban,
  bench: Armchair, mostTransfers: Shuffle, leastTransfers: Anchor, bestValue: Gem, lowestValue: PiggyBank, bestRank: Medal,
  bestCaptain: Star, worstCaptain: StarOff,
};
const PLAYER_ICONS = { captained: Crown, owned: Heart, in: LogIn, out: LogOut };

function managerValue(h) {
  if (h.value === null) return '';
  switch (h.key) {
    case 'rise': case 'fall': return `${h.value} place${h.value === 1 ? '' : 's'}`;
    case 'bestTransfers': case 'worstTransfers': return `${h.value > 0 ? '+' : ''}${h.value} pts`;
    case 'mostTransfers': case 'leastTransfers': return `${h.value} transfer${h.value === 1 ? '' : 's'}`;
    case 'bestValue': case 'lowestValue': return fmtPrice(h.value);
    case 'bestRank': return h.value.toLocaleString('en-GB');
    default: return `${h.value} pts`;
  }
}

function names(list, limit = 2) {
  if (!list.length) return null;
  return list.length > limit ? `${list.slice(0, limit).join(', ')} +${list.length - limit}` : list.join(', ');
}

function LeagueAnalysis({ members, teams, playersById, liveGwId, total }) {
  const { managers, players, counted } = useMemo(() => leagueHighlights(members, teams), [members, teams]);
  const loading = counted < total;
  const item = (key, Icon, label, who, value) => (
    <li key={key} className="fpl-analysis-item">
      <Icon size={16} aria-hidden="true" />
      <span className="fpl-analysis-label">{label}</span>
      <span className="fpl-analysis-who">{who || <span className="fpl-dim">–</span>}</span>
      {value ? <span className="fpl-analysis-value fpl-mono">{value}</span> : null}
    </li>
  );
  return (
    <section className="fpl-glass fpl-home-card" aria-labelledby="analysis-h" aria-busy={loading}>
      <div className="fpl-home-team-head">
        <h2 id="analysis-h" className="fpl-home-h"><ChartBar size={18} aria-hidden="true" /> League analysis</h2>
        <span className="fpl-mono fpl-home-meta">{loading ? `${counted} of ${total} teams` : liveGwId ? `GW${liveGwId}` : ''}</span>
      </div>
      <div className="fpl-analysis-grid">
        <div>
          <h3 className="fpl-home-sub"><Trophy size={15} aria-hidden="true" /> Manager highlights</h3>
          <ul className="fpl-analysis-list">
            {managers.map(h => item(h.key, MANAGER_ICONS[h.key] || Trophy, h.label, names(h.winners.map(w => w.name)), managerValue(h)))}
          </ul>
        </div>
        <div>
          <h3 className="fpl-home-sub"><Users size={15} aria-hidden="true" /> Player highlights</h3>
          <ul className="fpl-analysis-list">
            {players.map(h => item(
              h.key, PLAYER_ICONS[h.key] || Users, h.label,
              names(h.players.map(id => (playersById[id] ? playersById[id].webName : `#${id}`))),
              h.count ? `${h.count} of ${counted} team${counted === 1 ? '' : 's'}` : '',
            ))}
          </ul>
        </div>
      </div>
      <p className="fpl-home-hint">"This week" is Gameweek {liveGwId || '–'}. Transfers are scored by the points the players brought in made against the ones sold, less any hit.</p>
    </section>
  );
}

// One league's standings with each member's predicted points; mounted
// afresh for each league picked.
function LeagueTable({ leagueId, gwId, targetGwId, gwName, liveGwId, liveGwFinished, teamsById, playersById, fetchJson, loadTeam, onOpenTeam }) {
  // A gameweek that has started is shown as it stood after it; the one
  // being planned with the latest points and its predictions.
  const started = !!(gwId && targetGwId && gwId < targetGwId);
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
        const failed = [];
        const settle = (m, team, error) => {
          if (cancelled) return;
          if (error || !team) failed.push(m);
          setTeams(prev => ({ ...prev, [m.entry]: error || !team ? { status: 'error' } : { status: 'ready', ...team } }));
        };
        forEachLimited(data.members, TEAM_LOADS_AT_ONCE, m => loadTeam(m.entry, gwId), settle).then(() => {
          if (cancelled || !failed.length) return;
          const again = failed.splice(0);
          setTimeout(() => {
            if (cancelled) return;
            setTeams(prev => ({ ...prev, ...Object.fromEntries(again.map(m => [m.entry, { status: 'loading' }])) }));
            forEachLimited(again, RETRIES_AT_ONCE, m => loadTeam(m.entry, gwId), settle);
          }, RETRY_AFTER_MS);
        });
      })
      .catch(() => { if (!cancelled) setStandings({ status: 'error', data: null }); });
    return () => { cancelled = true; };
  }, [leagueId, gwId, fetchJson, loadTeam]);

  // Where everyone would be after the next gameweek if it went as
  // predicted, worked out again as each team arrives.
  // The members as they stood after the gameweek picked, once it has started.
  const shownMembers = useMemo(() => {
    if (!standings.data) return [];
    return started ? membersAtGw(standings.data.members, teams, gwId, { finished: liveGwFinished }) : standings.data.members;
  }, [standings.data, teams, started, gwId, liveGwFinished]);
  const expected = useMemo(() => expectedPositions(shownMembers, teams, { beforeWeek: started }), [shownMembers, teams, started]);

  const members = useMemo(() => {
    const list = [...shownMembers];
    const ready = m => teams[m.entry] && teams[m.entry].status === 'ready';
    const keyFor = {
      live: m => (ready(m) && typeof teams[m.entry].livePoints === 'number' ? teams[m.entry].livePoints : -Infinity),
      predicted: m => (ready(m) ? teams[m.entry].xiTotal : -Infinity),
      expected: m => -(expected[m.entry] ? expected[m.entry].position : Infinity),
    }[sortBy];
    const byRank = (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.teamName.localeCompare(b.teamName);
    list.sort(keyFor ? (a, b) => keyFor(b) - keyFor(a) || byRank(a, b) : byRank);
    return list;
  }, [shownMembers, teams, sortBy, expected]);

  // A team that still couldn't be loaded is tried again when tapped.
  function retryTeam(entry) {
    setTeams(prev => ({ ...prev, [entry]: { status: 'loading' } }));
    loadTeam(entry, gwId)
      .then(team => setTeams(prev => ({ ...prev, [entry]: team ? { status: 'ready', ...team } : { status: 'error' } })))
      .catch(() => setTeams(prev => ({ ...prev, [entry]: { status: 'error' } })));
  }

  const gwShort = name => (name ? name.replace('Gameweek ', 'GW') : '');
  const SORTS = [['rank', 'Rank'], ['live', 'Live'], ['predicted', 'Predicted'], ['expected', 'Expected']];

  return (
    // Side by side on a wide screen: the table, then the analysis.
    <div className="fpl-league-pair">
    <section className="fpl-glass fpl-home-card" aria-labelledby="league-h" aria-busy={standings.status === 'loading'}>
      <div className="fpl-home-team-head">
        <h2 id="league-h" className="fpl-home-h"><Trophy size={18} aria-hidden="true" /> {standings.data ? standings.data.league.name : 'League'}</h2>
        <div className="fpl-league-sort" role="group" aria-label="Sort by">
          {SORTS.map(([key, label]) => (
            <button key={key} type="button" className={`fpl-chip-btn${sortBy === key ? ' active' : ''}`} aria-pressed={sortBy === key} onClick={() => setSortBy(key)}>{label}</button>
          ))}
        </div>
      </div>
      {standings.status === 'loading' && <SkeletonRows rows={8} label="Loading the league…" />}
      {standings.status === 'error' && <p className="fpl-home-text" role="alert">Couldn't load league {leagueId}. Check the ID, or try again in a minute.</p>}
      {standings.status === 'ready' && (
        <>
          <div className="fpl-league-cols fpl-mono" aria-hidden="true">
            <span>#</span><span>Team</span>
            <span>{liveGwId ? `GW${liveGwId} ${liveGwFinished ? 'pts' : 'live'}` : 'Live'}</span>
            <span>{gwName ? `${gwShort(gwName)} pred` : 'Pred'}</span>
            <span>Exp</span>
          </div>
          <ol className="fpl-league-list">
            {members.map(m => {
              const team = teams[m.entry];
              const isOpen = open === m.entry;
              const failed = team && team.status === 'error';
              const notStarted = !!(team && team.notStarted);
              const pending = !team || team.status === 'loading';
              return (
                <Fragment key={m.entry}>
                  <li className={`fpl-league-row${isOpen ? ' is-open' : ''}`}>
                    <span className="fpl-league-rank fpl-mono">{m.rank ?? '–'}</span>
                    <button type="button" className={`fpl-league-who${failed ? ' is-failed' : ''}`} aria-expanded={failed ? undefined : isOpen}
                      onClick={() => (failed ? retryTeam(m.entry) : setOpen(isOpen ? null : m.entry))} disabled={pending || notStarted}>
                      <b>{m.teamName}{team && team.edited && <span className="fpl-league-edited">Edited</span>}</b>
                      <small>{m.total ?? '–'} pts · {failed ? "Couldn't load, tap to try again" : notStarted ? `Joined after Gameweek ${gwId}` : m.managerName}</small>
                      {failed ? <RotateCcw size={14} aria-hidden="true" className="fpl-league-chev" /> : <ChevronDown size={14} aria-hidden="true" className="fpl-league-chev" />}
                    </button>
                    <span className="fpl-league-live fpl-mono">
                      {pending ? <span className="fpl-skel fpl-league-skel" aria-label="Loading" />
                        : team.status === 'ready' && typeof team.livePoints === 'number' ? team.livePoints : '–'}
                    </span>
                    <span className="fpl-league-pred fpl-mono">
                      {pending ? <span className="fpl-skel fpl-league-skel" aria-label="Loading" />
                        : team.status === 'ready' && !notStarted ? fmtPts(team.xiTotal) : '–'}
                    </span>
                    <ExpectedCell rank={m.rank} expected={team && team.status === 'ready' && !notStarted ? expected[m.entry] : null} loading={pending} />
                  </li>
                  {isOpen && team && team.status === 'ready' && (
                    <li className="fpl-league-open"><MemberTeam team={team} teamsById={teamsById} onOpen={() => onOpenTeam(m.entry)} /></li>
                  )}
                </Fragment>
              );
            })}
          </ol>
          <p className="fpl-home-hint">
            {started ? (
              <>
                Positions and totals are as they stood after Gameweek {gwId}{liveGwFinished ? '' : ', with live points so far'}.
                Predicted is what each starting XI was predicted before that deadline, captain doubled.
                Expected is the position had every team scored its prediction.
              </>
            ) : (
              <>
                {liveGwId ? `Live is each team's points so far in Gameweek ${liveGwId}, before automatic subs. ` : ''}
                Predicted is each team's starting XI for {gwName || 'the next gameweek'}, captain doubled.
                Expected is the position if every team scores its prediction.
              </>
            )}
            {standings.data.hasMore ? ' Showing the top 50.' : ''}
          </p>
        </>
      )}
    </section>
    {standings.status === 'ready' && standings.data.members.length > 1 && (
      <LeagueAnalysis members={shownMembers} teams={teams} playersById={playersById} liveGwId={liveGwId} total={standings.data.members.length} />
    )}
    </div>
  );
}

export function MiniLeagueScreen({ homeTeamId, gwId, targetGwId, gwName, liveGwId, liveGwFinished, teamsById, playersById = {}, fetchJson, loadTeam, onOpenTeam, onAddTeamId }) {
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
        // Mounted afresh for each league and gameweek.
        <LeagueTable key={`${leagueId}-${gwId}`} leagueId={leagueId} gwId={gwId} targetGwId={targetGwId} gwName={gwName} liveGwId={liveGwId} liveGwFinished={liveGwFinished} teamsById={teamsById} playersById={playersById} fetchJson={fetchJson} loadTeam={loadTeam} onOpenTeam={onOpenTeam} />
      )}
    </div>
  );
}

function ordinal(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
}
