// Mini-league: the standings of one of your classic leagues, with what
// every member's team is predicted to score this gameweek. Tap a member to
// see their team.
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Anchor, Armchair, Check, MessageCircle, Scale, Share2, Swords, ArrowDown, ArrowRight, ArrowRightLeft, ArrowUp, Ban, ChartBar, ChevronDown, Crown, Gem, Heart, LogIn, LogOut, Medal, PiggyBank, RotateCcw, Shuffle, Star, StarOff, Target, ThumbsDown, TrendingDown, TrendingUp, Trophy, Users } from 'lucide-react';
import { SkeletonRows } from '../components/common.jsx';
import './headToHead.css';
import { Pitch, PlayerCard } from '../components/Pitch.jsx';
import { fmtPrice, fmtPts, noPointsLabel } from '../lib/format.js';
import { expectedPositions, forEachLimited, h2hLeagues, headToHead, latestTransfers, leagueDifferentials, leagueHighlights, liveLeagueRank, membersAtGw, parseH2hMatches, parseH2hStandings, parseStandings, privateLeagues } from '../lib/leagues.js';
import { parseLeagueId } from '../lib/teamIdInput.js';
import { fmtNumber, ordinal as ordinalFor, t } from '../lib/i18n.js';
import { tr } from '../lib/i18nRich.jsx';

const LEAGUE_KEY = 'fpl_league_id';
// Members' teams are fetched a few at a time, so a 50-team league doesn't
// fire 150 requests at once. Teams that still fail (FPL turning requests
// away) get one more go once the rest are in, two at a time.
const TEAM_LOADS_AT_ONCE = 4;
const RETRIES_AT_ONCE = 2;
const RETRY_AFTER_MS = 1500;
// While a gameweek is being played, the teams' live points and your leagues'
// ranks are fetched again this often (while the page is in view).
const LIVE_REFRESH_MS = 2 * 60 * 1000;

// Runs `fn` every LIVE_REFRESH_MS while `on` and the page is visible.
function useLiveRefresh(on, fn) {
  useEffect(() => {
    if (!on) return undefined;
    const id = setInterval(() => { if (document.visibilityState === 'visible') fn(); }, LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [on, fn]);
}

function readSavedLeague() {
  try { return Number(localStorage.getItem(LEAGUE_KEY)) || null; } catch { return null; }
}
function saveLeague(id) {
  try { localStorage.setItem(LEAGUE_KEY, String(id)); } catch { /* private mode */ }
}

// One member's 15 on a pitch: the XI, then the bench, each player's
// predicted points (or what they scored, for a gameweek that has started).
function MemberTeam({ team, teamsById, onOpen, onViewLive }) {
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
        points={scored ? (slot.played === false ? noPointsLabel(slot) : slot.actualPoints * mult) : fmtPts(slot.predicted * mult)}
        info={scored ? t('pred {n}', { n: fmtPts(slot.predicted * mult) }) : (club ? club.short_name : '')}
      />
    );
  };
  return (
    <div className="fpl-league-team">
      {team.edited
        ? <p className="fpl-home-hint">{t('Showing your edits to this team. Open it to change it more, or go back to the team on FPL.')}</p>
        : team.picksFromGwId && <p className="fpl-home-hint">{t("This gameweek's picks are hidden until the deadline, so this is their Gameweek {n} team.", { n: team.picksFromGwId })}</p>}
      <Pitch starters={starters} bench={bench} card={card} compact />
      {/* While the gameweek is on: their points live, as on the Live screen. */}
      {onViewLive
        ? <button type="button" className="fpl-link" onClick={onViewLive}>{t('View live')} <ArrowRight size={14} /></button>
        : <button type="button" className="fpl-link" onClick={onOpen}>{t('Open and edit this team')} <ArrowRight size={14} /></button>}
    </div>
  );
}

// Expected position after the next gameweek, with how far that is from
// the current rank.
function ExpectedCell({ rank, expected, loading }) {
  if (loading) return <span className="fpl-league-exp"><span className="fpl-skel fpl-league-skel" aria-label={t('Loading')} /></span>;
  if (!expected) return <span className="fpl-league-exp fpl-mono">–</span>;
  const move = rank - expected.position;
  return (
    <span className="fpl-league-exp fpl-mono" title={t('{n} pts expected', { n: expected.projected })}>
      {expected.position}
      {move !== 0 && (
        <small className={move > 0 ? 'is-up' : 'is-down'} aria-label={move > 0 ? t('up {n}', { n: move }) : t('down {n}', { n: -move })}>
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
    case 'rise': case 'fall': return h.value === 1 ? t('1 place') : t('{n} places', { n: h.value });
    case 'bestTransfers': case 'worstTransfers': return t('{n} pts', { n: `${h.value > 0 ? '+' : ''}${h.value}` });
    case 'mostTransfers': case 'leastTransfers': return h.value === 1 ? t('1 transfer') : t('{n} transfers', { n: h.value });
    case 'bestValue': case 'lowestValue': return fmtPrice(h.value);
    case 'bestRank': return fmtNumber(h.value);
    default: return t('{n} pts', { n: h.value });
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
        <h2 id="analysis-h" className="fpl-home-h"><ChartBar size={18} aria-hidden="true" /> {t('League analysis')}</h2>
        <span className="fpl-mono fpl-home-meta">{loading ? t('{n} of {total} teams', { n: counted, total }) : liveGwId ? `GW${liveGwId}` : ''}</span>
      </div>
      <div className="fpl-analysis-grid">
        <div>
          <h3 className="fpl-home-sub"><Trophy size={15} aria-hidden="true" /> {t('Manager highlights')}</h3>
          <ul className="fpl-analysis-list">
            {managers.map(h => item(h.key, MANAGER_ICONS[h.key] || Trophy, h.label, names(h.winners.map(w => w.name)), managerValue(h)))}
          </ul>
        </div>
        <div>
          <h3 className="fpl-home-sub"><Users size={15} aria-hidden="true" /> {t('Player highlights')}</h3>
          <ul className="fpl-analysis-list">
            {players.map(h => item(
              h.key, PLAYER_ICONS[h.key] || Users, h.label,
              names(h.players.map(id => (playersById[id] ? playersById[id].webName : `#${id}`))),
              h.count ? (counted === 1 ? t('{n} of 1 team', { n: h.count }) : t('{n} of {total} teams', { n: h.count, total: counted })) : '',
            ))}
          </ul>
        </div>
      </div>
      <p className="fpl-home-hint">{t('"This week" is Gameweek {n}. Transfers are scored by the points the players brought in made against the ones sold, less any hit.', { n: liveGwId || '–' })}</p>
    </section>
  );
}

// Where your team differs from the league's this week: the players you
// have more of than the league (your edge), the ones it has more of (the
// threat), and against the team just above you.
function LeagueDifferentials({ members, teams, youEntry, liveGwId }) {
  const d = useMemo(() => leagueDifferentials(members, teams, youEntry), [members, teams, youEntry]);
  if (!d) return null;
  const list = (rows, sign) => (
    <ul className="fpl-diff-list">
      {rows.map(r => (
        <li key={r.player.id}>
          <span className="fpl-diff-name">{r.player.webName}</span>
          <span className="fpl-mono fpl-meta">{t('you ×{a} · league ×{b}', { a: r.yours, b: r.eo.toFixed(1) })}</span>
          <span className={`fpl-mono fpl-diff-swing${sign > 0 ? ' is-up' : ' is-down'}`}>{sign > 0 ? '+' : '−'}{fmtPts(Math.abs(r.swing))}</span>
        </li>
      ))}
      {!rows.length ? <li className="fpl-meta">{t('None')}</li> : null}
    </ul>
  );
  const r = d.rival;
  return (
    <section className="fpl-glass fpl-home-card" aria-labelledby="diff-h">
      <div className="fpl-home-team-head">
        <h2 id="diff-h" className="fpl-home-h"><Scale size={18} aria-hidden="true" /> {t('Your differentials')}</h2>
        <span className="fpl-mono fpl-home-meta">{t('{n} teams', { n: d.counted })}</span>
      </div>
      {r ? (
        <p className="fpl-home-text fpl-diff-rival">
          {r.ahead ? tr('<b>{team}</b> is {n} pts ahead.', { team: r.teamName, n: r.gap }, { b: s => <b>{s}</b> }) : tr('You lead <b>{team}</b> by {n} pts.', { team: r.teamName, n: r.gap }, { b: s => <b>{s}</b> })}{' '}
          {r.swing >= 0
            ? tr('Your differing players are predicted to gain you <s>{n} pts</s> on them this week.', { n: fmtPts(Math.abs(r.swing)) }, { s: x => <b className="fpl-diff-up">{x}</b> })
            : tr('Your differing players are predicted to lose you <s>{n} pts</s> on them this week.', { n: fmtPts(Math.abs(r.swing)) }, { s: x => <b className="fpl-diff-down">{x}</b> })}
          {r.yourEdge.length ? <> {t('Yours: {names}.', { names: r.yourEdge.map(x => x.player.webName).join(', ') })}</> : null}
          {r.theirEdge.length ? <> {t('Theirs: {names}.', { names: r.theirEdge.map(x => x.player.webName).join(', ') })}</> : null}
        </p>
      ) : null}
      <div className="fpl-diff-grid">
        <div>
          <h3 className="fpl-home-sub">{t('Your edge')}</h3>
          {list(d.edges, 1)}
        </div>
        <div>
          <h3 className="fpl-home-sub">{t('The threat')}</h3>
          {list(d.threats, -1)}
        </div>
      </div>
      <p className="fpl-home-hint">{t("×1.4 means the league scores that player's points 1.4 times on average (a captain counts twice, the bench not at all). The number is the points he's predicted to swing for you against the league in Gameweek {n}.", { n: liveGwId || '–' })}</p>
    </section>
  );
}

// One column of a head-to-head: the players only this side has.
function H2hColumn({ title, rows, teamsById }) {
  return (
    <div className="fpl-h2h-col">
      <h3 className="fpl-home-sub">{title}</h3>
      <ul className="fpl-h2h-list">
        {rows.length ? rows.map(r => (
          <li key={r.player.id} className={r.starting ? '' : 'is-bench'}>
            <span className="fpl-h2h-name">{r.player.webName}<span className="fpl-meta"> · {teamsById[r.player.team]?.short_name}</span>{!r.starting ? <span className="fpl-meta"> · {t('bench')}</span> : null}</span>
            <span className="fpl-mono fpl-h2h-pts">{fmtPts(r.predicted)}</span>
          </li>
        )) : <li className="fpl-meta">{t('Same as you')}</li>}
      </ul>
    </div>
  );
}

// Pick any rival in the league and see who you share, who's unique to each
// side, each XI's predicted total and the edge from the differing players.
// The rival's latest transfers (FPL shows them once that deadline passes).
function RivalTransfers({ entry, rivalName, playersById, fetchJson }) {
  const [state, setState] = useState({ entry: null, data: null });
  useEffect(() => {
    let live = true;
    fetchJson(`entry/${entry}/transfers/`)
      .then(list => { if (live) setState({ entry, data: latestTransfers(list) || 'none' }); })
      .catch(() => { if (live) setState({ entry, data: 'none' }); });
    return () => { live = false; };
  }, [entry, fetchJson]);
  if (state.entry !== entry || !state.data) return <p className="fpl-home-hint">{t("Loading {name}'s transfers…", { name: rivalName })}</p>;
  if (state.data === 'none') return <p className="fpl-home-hint">{t("{name} hasn't made a transfer yet this season.", { name: rivalName })}</p>;
  const name = id => (playersById[id] ? playersById[id].webName : `#${id}`);
  return (
    <div className="fpl-h2h-transfers">
      <h3 className="fpl-mono fpl-meta" style={{ margin: '0 0 6px' }}>{t("{name}'S GW{n} TRANSFERS", { name: rivalName.toUpperCase(), n: state.data.gw })}</h3>
      <ul>
        {state.data.moves.map((m, i) => (
          <li key={i}><span className="fpl-diff-down">{name(m.outId)}</span> <span aria-label={t('out, in')}>→</span> <span className="fpl-diff-up">{name(m.inId)}</span></li>
        ))}
      </ul>
    </div>
  );
}

function HeadToHead({ members, teams, youEntry, teamsById, playersById, fetchJson }) {
  const others = useMemo(() => members.filter(m => String(m.entry) !== String(youEntry)), [members, youEntry]);
  const [rivalEntry, setRivalEntry] = useState(null);
  const chosen = rivalEntry != null && others.some(m => String(m.entry) === String(rivalEntry)) ? rivalEntry : (others[0] ? others[0].entry : null);
  const youTeam = teams[youEntry];
  const rivalTeam = chosen != null ? teams[chosen] : null;
  const h = useMemo(
    () => (youTeam && youTeam.status === 'ready' && rivalTeam && rivalTeam.status === 'ready' ? headToHead(youTeam, rivalTeam) : null),
    [youTeam, rivalTeam],
  );
  if (!others.length || !youTeam || youTeam.status !== 'ready') return null;
  const rivalName = (others.find(m => String(m.entry) === String(chosen)) || {}).teamName || t('Rival');
  return (
    <section className="fpl-glass fpl-home-card" aria-labelledby="h2h-h">
      <div className="fpl-home-team-head">
        <h2 id="h2h-h" className="fpl-home-h"><Swords size={18} aria-hidden="true" /> {t('Head-to-head')}</h2>
        <label className="fpl-h2h-pick">
          <span className="fpl-sr-only">{t('Rival')}</span>
          <select className="fpl-input" value={chosen ?? ''} onChange={e => setRivalEntry(Number(e.target.value))}>
            {others.map(m => <option key={m.entry} value={m.entry}>{m.teamName}</option>)}
          </select>
        </label>
      </div>
      {h ? (
        <>
          <p className="fpl-home-text" style={{ margin: 0 }}>
            {tr("Your XI is predicted <b>{you}</b> to {name}'s <b>{them}</b>.", { you: fmtPts(h.yourXiTotal), name: rivalName, them: fmtPts(h.theirXiTotal) }, { b: s => <b>{s}</b> })}{' '}
            {h.edge >= 0
              ? tr("From the players only one of you owns, you're predicted to gain <s>{n} pts</s> this week.", { n: fmtPts(Math.abs(h.edge)) }, { s: x => <b className="fpl-diff-up">{x}</b> })
              : tr("From the players only one of you owns, you're predicted to lose <s>{n} pts</s> this week.", { n: fmtPts(Math.abs(h.edge)) }, { s: x => <b className="fpl-diff-down">{x}</b> })}
          </p>
          <div className="fpl-h2h-grid">
            <H2hColumn title={t('Only you')} rows={h.yourOnly} teamsById={teamsById} />
            <H2hColumn title={t('Only {name}', { name: rivalName })} rows={h.theirOnly} teamsById={teamsById} />
          </div>
          <p className="fpl-home-hint">{t('{n} players shared. Captains: you {mine}, {name} {theirs}.', { n: h.shared.length, mine: h.yourCaptain ? h.yourCaptain.webName : '–', name: rivalName, theirs: h.theirCaptain ? h.theirCaptain.webName : '–' })}</p>
          {fetchJson && <RivalTransfers entry={chosen} rivalName={rivalName} playersById={playersById || {}} fetchJson={fetchJson} />}
        </>
      ) : <p className="fpl-home-text" style={{ margin: 0 }}>{t("Loading {name}'s team…", { name: rivalName })}</p>}
    </section>
  );
}

// One league's standings with each member's predicted points; mounted
// afresh for each league picked.
// A link to the league's page on the site (/league/<id>: standings,
// captains and predicted points) to send to the rest of the league.
// The league's page (/league/<id>), shared to the league's group chat:
// WhatsApp straight away, anything else through the share sheet or a link.
function ShareLeague({ leagueId, name, gwName }) {
  const [copied, setCopied] = useState(false);
  const url = `https://fplchecker.co.uk/league/${leagueId}`;
  const gwNo = gwName ? (String(gwName).match(/\d+/) || [''])[0] : '';
  const message = `${name || t('Our league')}: ${gwNo ? `GW${gwNo} ` : ''}${t('predicted points, captains and standings for everyone')} 👀 ${url}`;
  const share = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: name || t('FPL mini-league'), text: `${name || t('Our league')}: ${t('standings, captains and predicted points')}`, url }); return; }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* closed the share sheet */ }
  };
  return (
    <>
      <a className="fpl-chip-btn fpl-chip-wa" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" aria-label={t("Send this league's page to WhatsApp")}>
        <MessageCircle size={14} aria-hidden="true" /> {t('Send to league')}
      </a>
      <button type="button" className="fpl-chip-btn" onClick={share} aria-label={t("Share a link to this league's page")}>
        {copied ? <Check size={14} aria-hidden="true" /> : <Share2 size={14} aria-hidden="true" />} {copied ? t('Link copied') : t('Share')}
      </button>
    </>
  );
}

function LeagueTable({ homeTeamId, leagueId, gwId, targetGwId, gwName, liveGwId, liveGwFinished, teamsById, playersById, fetchJson, loadTeam, onOpenTeam, onViewLive, onLiveRank }) {
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

  // While the gameweek is on, every team's live points again now and then
  // (kept on screen while they load), and your live place for the league
  // picker.
  const isLive = !!(liveGwId && !liveGwFinished);
  const [refreshAt, setRefreshAt] = useState(0);
  const refresh = useCallback(() => setRefreshAt(Date.now()), []);
  useLiveRefresh(isLive && standings.status === 'ready', refresh);
  useEffect(() => {
    if (!refreshAt || !standings.data) return undefined;
    let cancelled = false;
    forEachLimited(standings.data.members, TEAM_LOADS_AT_ONCE, m => loadTeam(m.entry, gwId), (m, team, error) => {
      if (cancelled || error || !team) return;
      setTeams(prev => ({ ...prev, [m.entry]: { status: 'ready', ...team } }));
    });
    return () => { cancelled = true; };
  }, [refreshAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const liveRank = useMemo(() => (isLive ? liveLeagueRank(standings.data, teams, liveGwId, homeTeamId) : null), [isLive, standings.data, teams, liveGwId, homeTeamId]);
  useEffect(() => { if (liveRank !== null && onLiveRank) onLiveRank(leagueId, liveRank); }, [liveRank, leagueId, onLiveRank]);

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

  const SORTS = [['rank', t('Rank')], ['live', t('Live')], ['predicted', t('Predicted')], ['expected', t('Expected')]];

  return (
    // Side by side on a wide screen: the table, the analysis, then your
    // differentials and head-to-head (a third column on the widest).
    <div className="fpl-league-pair">
    <section className="fpl-glass fpl-home-card" aria-labelledby="league-h" aria-busy={standings.status === 'loading'}>
      <div className="fpl-home-team-head">
        <h2 id="league-h" className="fpl-home-h"><Trophy size={18} aria-hidden="true" /> {standings.data ? standings.data.league.name : t('League')}</h2>
        <ShareLeague leagueId={leagueId} name={standings.data ? standings.data.league.name : null} gwName={gwName} />
        <div className="fpl-league-sort" role="group" aria-label={t('Sort by')}>
          {SORTS.map(([key, label]) => (
            <button key={key} type="button" className={`fpl-chip-btn${sortBy === key ? ' active' : ''}`} aria-pressed={sortBy === key} onClick={() => setSortBy(key)}>{label}</button>
          ))}
        </div>
      </div>
      {standings.status === 'loading' && <SkeletonRows rows={8} label={t('Loading the league…')} />}
      {standings.status === 'error' && <p className="fpl-home-text" role="alert">{t("Couldn't load league {id}. Check the ID, or try again in a minute.", { id: leagueId })}</p>}
      {standings.status === 'ready' && (
        <>
          <div className="fpl-league-cols fpl-mono" aria-hidden="true">
            <span>#</span><span>{t('Team')}</span>
            <span>{liveGwId ? (liveGwFinished ? t('GW{n} pts', { n: liveGwId }) : t('GW{n} live', { n: liveGwId })) : t('Live')}</span>
            <span>{gwId ? t('GW{n} pred', { n: gwId }) : t('Pred')}</span>
            <span>{t('Exp')}</span>
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
                      <b>{m.teamName}{team && team.edited && <span className="fpl-league-edited">{t('Edited')}</span>}</b>
                      <small>{t('{n} pts', { n: m.total ?? '–' })} · {failed ? t("Couldn't load, tap to try again") : notStarted ? t('Joined after Gameweek {n}', { n: gwId }) : m.managerName}</small>
                      {failed ? <RotateCcw size={14} aria-hidden="true" className="fpl-league-chev" /> : <ChevronDown size={14} aria-hidden="true" className="fpl-league-chev" />}
                    </button>
                    <span className="fpl-league-live fpl-mono">
                      {pending ? <span className="fpl-skel fpl-league-skel" aria-label={t('Loading')} />
                        : team.status === 'ready' && typeof team.livePoints === 'number' ? team.livePoints : '–'}
                    </span>
                    <span className="fpl-league-pred fpl-mono">
                      {pending ? <span className="fpl-skel fpl-league-skel" aria-label={t('Loading')} />
                        : team.status === 'ready' && !notStarted ? fmtPts(team.xiTotal) : '–'}
                    </span>
                    <ExpectedCell rank={m.rank} expected={team && team.status === 'ready' && !notStarted ? expected[m.entry] : null} loading={pending} />
                  </li>
                  {isOpen && team && team.status === 'ready' && (
                    <li className="fpl-league-open"><MemberTeam team={team} teamsById={teamsById} onOpen={() => onOpenTeam(m.entry)} onViewLive={isLive && onViewLive && !notStarted ? () => onViewLive(m.entry, String(m.entry) === String(homeTeamId) ? null : m.managerName) : null} /></li>
                  )}
                </Fragment>
              );
            })}
          </ol>
          <p className="fpl-home-hint">
            {started ? (
              <>
                {liveGwFinished ? t('Positions and totals are as they stood after Gameweek {n}.', { n: gwId }) : t('Positions and totals are as they stood after Gameweek {n}, with live points so far.', { n: gwId })}
                {' '}{t('Predicted is what each starting XI was predicted before that deadline, captain doubled.')}
                {' '}{t('Expected is the position had every team scored its prediction.')}
              </>
            ) : (
              <>
                {liveGwId ? `${t("Live is each team's points so far in Gameweek {n}, with bonus from the bonus points system until it's confirmed and automatic subs.", { n: liveGwId })} ` : ''}
                {t("Predicted is each team's starting XI for {gw}, captain doubled.", { gw: gwName || t('the next gameweek') })}
                {' '}{t('Expected is the position if every team scores its prediction.')}
              </>
            )}
            {standings.data.hasMore ? ` ${t('Showing the top 50.')}` : ''}
          </p>
        </>
      )}
    </section>
    <div className="fpl-league-side">
    {standings.status === 'ready' && standings.data.members.length > 1 && (
      <LeagueAnalysis members={shownMembers} teams={teams} playersById={playersById} liveGwId={liveGwId} total={standings.data.members.length} />
    )}
    </div>
    <div className="fpl-league-side fpl-league-you">
    {standings.status === 'ready' && homeTeamId && standings.data.members.some(m => String(m.entry) === String(homeTeamId)) && (
      <LeagueDifferentials members={shownMembers} teams={teams} youEntry={standings.data.members.find(m => String(m.entry) === String(homeTeamId)).entry} liveGwId={gwId} />
    )}
    {standings.status === 'ready' && homeTeamId && standings.data.members.some(m => String(m.entry) === String(homeTeamId)) && (
      <HeadToHead members={shownMembers} teams={teams} youEntry={standings.data.members.find(m => String(m.entry) === String(homeTeamId)).entry} teamsById={teamsById} playersById={playersById} fetchJson={fetchJson} />
    )}
    </div>
    </div>
  );
}

// A head-to-head league: this gameweek's matches (yours first), the table
// (won, drawn, lost, league points, points scored), and who you play next.
// matchGw: the gameweek being played or just played; nextGw: the one being
// planned, when different.
const MATCHES_SHOWN = 6; // yours first, then the rest behind "Show all"
function H2hLeague({ leagueId, homeTeamId, matchGw, nextGw, fetchJson }) {
  const [state, setState] = useState({ status: 'loading' });
  const [allMatches, setAllMatches] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const matches = gw => (gw ? fetchJson(`leagues-h2h-matches/league/${leagueId}/?event=${gw}`).catch(() => null) : Promise.resolve(null));
    Promise.all([fetchJson(`leagues-h2h/${leagueId}/standings/`), matches(matchGw), nextGw && nextGw !== matchGw ? matches(nextGw) : Promise.resolve(null)])
      .then(([standingsJson, nowJson, nextJson]) => {
        if (cancelled) return;
        const standings = parseH2hStandings(standingsJson);
        if (!standings) { setState({ status: 'error' }); return; }
        setState({ status: 'ready', standings, now: nowJson ? parseH2hMatches(nowJson, homeTeamId) : [], next: nextJson ? parseH2hMatches(nextJson, homeTeamId) : [] });
      })
      .catch(() => { if (!cancelled) setState({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [leagueId, homeTeamId, matchGw, nextGw, fetchJson]);

  if (state.status === 'loading') return <section className="fpl-glass fpl-home-card"><SkeletonRows rows={6} label={t('Loading the league…')} /></section>;
  if (state.status === 'error') return <section className="fpl-glass fpl-home-card"><p className="fpl-home-text" role="alert">{t("Couldn't load league {id}. Check the ID, or try again in a minute.", { id: leagueId })}</p></section>;
  const { standings, now, next } = state;
  const shownMatches = allMatches ? now : now.slice(0, MATCHES_SHOWN);
  const isYou = entry => String(entry) === String(homeTeamId);
  const yourNext = next.find(m => m.isYou);
  const side = (x, won) => (x ? (
    <span className={`fpl-h2h-side${isYou(x.entry) ? ' is-you' : ''}${won ? ' is-won' : ''}`}>
      <b>{x.teamName}</b><small>{x.managerName}</small>
    </span>
  ) : <span className="fpl-h2h-side"><b>{t('Bye')}</b></span>);
  return (
    <section className="fpl-glass fpl-home-card" aria-labelledby="h2h-h">
      <h2 id="h2h-h" className="fpl-home-h"><Swords size={18} aria-hidden="true" /> {standings.league.name}</h2>
      {now.length ? (
        <>
          <h3 className="fpl-h2h-sub">{t('Gameweek {n} matches', { n: matchGw })}</h3>
          <ul className="fpl-h2h-matches">
            {shownMatches.map(m => (
              <li key={m.id} className={m.isYou ? 'is-you' : ''}>
                {side(m.home, m.winner === 'home')}
                <span className="fpl-mono fpl-h2h-score">{m.home.points}–{m.away ? m.away.points : '–'}</span>
                {side(m.away, m.winner === 'away')}
              </li>
            ))}
          </ul>
          {now.length > MATCHES_SHOWN ? (
            <button type="button" className="fpl-link" onClick={() => setAllMatches(v => !v)}>
              {allMatches ? t('Show fewer') : t('Show all {n} matches', { n: now.length })}
            </button>
          ) : null}
        </>
      ) : null}
      {yourNext ? (
        <p className="fpl-home-text">
          {t('Gameweek {n}: you play {team} ({manager}).', { n: nextGw, team: (isYou(yourNext.home.entry) ? yourNext.away : yourNext.home)?.teamName || t('Bye'), manager: (isYou(yourNext.home.entry) ? yourNext.away : yourNext.home)?.managerName || '–' })}
        </p>
      ) : null}
      <div className="fpl-compare-wrap">
        <table className="fpl-h2h-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">{t('Team')}</th>
              <th scope="col" title={t('Won')}>{t('W')}</th>
              <th scope="col" title={t('Drawn')}>{t('D')}</th>
              <th scope="col" title={t('Lost')}>{t('L')}</th>
              <th scope="col" title={t('League points')}>{t('Pts')}</th>
              <th scope="col" title={t('FPL points scored')}>{t('Score')}</th>
            </tr>
          </thead>
          <tbody>
            {standings.rows.map(r => (
              <tr key={r.entry} className={isYou(r.entry) ? 'is-you' : ''}>
                <td className="fpl-mono">{r.rank}</td>
                <td><b>{r.teamName}</b><small>{r.managerName}</small></td>
                <td className="fpl-mono">{r.won}</td>
                <td className="fpl-mono">{r.drawn}</td>
                <td className="fpl-mono">{r.lost}</td>
                <td className="fpl-mono"><b>{r.leaguePoints}</b></td>
                <td className="fpl-mono">{fmtNumber(r.pointsFor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {standings.hasMore ? <p className="fpl-meta">{t('Showing the top 50.')}</p> : null}
    </section>
  );
}

// Your place in a league on its picker button; a green dot while the
// gameweek is being played, as the place moves with the live points.
function LeagueRank({ rank, live }) {
  if (!rank) return null;
  return (
    <span className="fpl-mono fpl-league-chip-rank">
      {' · '}{ordinalFor(rank)}
      {live ? <span className="fpl-league-live-dot" role="img" aria-label={t('Live')} title={t('Updates live')} /> : null}
    </span>
  );
}

export function MiniLeagueScreen({ homeTeamId, gwId, targetGwId, gwName, liveGwId, liveGwFinished, teamsById, playersById = {}, fetchJson, loadTeam, onOpenTeam, onViewLive, onAddTeamId }) {
  const [leagues, setLeagues] = useState({ status: homeTeamId ? 'loading' : 'none', list: [] });
  const [leagueId, setLeagueId] = useState(readSavedLeague);
  const [idInput, setIdInput] = useState('');
  // A head-to-head league picked instead of a classic one.
  const [h2hId, setH2hId] = useState(null);
  const [h2hList, setH2hList] = useState([]);
  // Your place in each league opened here, worked out live (LeagueTable).
  const [liveRanks, setLiveRanks] = useState({});
  const onLiveRank = useCallback((id, rank) => setLiveRanks(prev => (prev[id] === rank ? prev : { ...prev, [id]: rank })), []);
  const isLive = !!(liveGwId && !liveGwFinished);
  const [leaguesAt, setLeaguesAt] = useState(0);
  const refreshLeagues = useCallback(() => setLeaguesAt(Date.now()), []);
  // FPL's ranks in every league, fetched again while the gameweek is on.
  useLiveRefresh(isLive && !!homeTeamId, refreshLeagues);

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
        setH2hList(h2hLeagues(entry));
        setLeagueId(current => current || (list[0] ? list[0].id : null));
      })
      .catch(() => { if (!cancelled && !leaguesAt) setLeagues({ status: 'error', list: [] }); });
    return () => { cancelled = true; };
  }, [homeTeamId, fetchJson, leaguesAt]);

  function submitLeagueId(e) {
    e.preventDefault();
    const id = Number(idInput);
    if (id > 0) { setLeagueId(id); setH2hId(null); setIdInput(''); }
  }

  return (
    <div className="fpl-league">
      <h1 className="fpl-display fpl-league-title">{t('Mini-league')}</h1>

      <section className="fpl-glass fpl-home-card" aria-labelledby="league-pick-h">
        <h2 id="league-pick-h" className="fpl-home-h"><Users size={18} aria-hidden="true" /> {t('Your leagues')}</h2>
        {leagues.status === 'loading' && <SkeletonRows rows={2} label={t('Loading your leagues…')} />}
        {leagues.status === 'none' && (
          <p className="fpl-home-text">
            {t('Add your Team ID to see your leagues here, or enter a league ID below.')}{' '}
            <button type="button" className="fpl-link" onClick={onAddTeamId}>{t('Add your Team ID')}</button>
          </p>
        )}
        {leagues.status === 'error' && <p className="fpl-home-text" role="alert">{t("Couldn't load your leagues from FPL. You can still enter a league ID below.")}</p>}
        {leagues.status === 'ready' && !leagues.list.length && <p className="fpl-home-text">{t("You're not in any private leagues yet.")}</p>}
        {leagues.list.length > 0 && (
          <div className="fpl-league-chips">
            {leagues.list.map(l => (
              <button key={l.id} type="button" className={`fpl-chip-btn${l.id === leagueId && !h2hId ? ' active' : ''}`} aria-pressed={l.id === leagueId && !h2hId} onClick={() => { setLeagueId(l.id); setH2hId(null); }}>
                {l.name}<LeagueRank rank={isLive && liveRanks[l.id] ? liveRanks[l.id] : l.rank} live={isLive} />
              </button>
            ))}
          </div>
        )}
        {h2hList.length > 0 && (
          <>
            <h3 className="fpl-h2h-sub">{t('Head-to-head leagues')}</h3>
            <div className="fpl-league-chips">
              {h2hList.map(l => (
                <button key={l.id} type="button" className={`fpl-chip-btn${l.id === h2hId ? ' active' : ''}`} aria-pressed={l.id === h2hId} onClick={() => setH2hId(l.id)}>
                  {l.name}<LeagueRank rank={l.rank} live={false} />
                </button>
              ))}
            </div>
          </>
        )}
        <form className="fpl-home-tid" onSubmit={submitLeagueId}>
          <input
            className="fpl-input"
            inputMode="numeric"
            placeholder={t('Another league ID')}
            aria-label={t('League ID')}
            value={idInput}
            onChange={e => setIdInput(parseLeagueId(e.target.value))}
          />
          <button type="submit" className="fpl-btn fpl-btn-solid" disabled={!idInput}>{t('Show')}</button>
        </form>
        <p className="fpl-home-hint">{tr("A league's ID is the number after <m>/leagues/</m> in its address on the FPL site.", undefined, { m: s => <span className="fpl-mono">{s}</span> })}</p>
      </section>

      {h2hId ? (
        <H2hLeague key={h2hId} leagueId={h2hId} homeTeamId={homeTeamId} matchGw={liveGwId} nextGw={targetGwId} fetchJson={fetchJson} />
      ) : null}
      {leagueId && !h2hId && (
        // Mounted afresh for each league and gameweek.
        <LeagueTable key={`${leagueId}-${gwId}`} homeTeamId={homeTeamId} leagueId={leagueId} gwId={gwId} targetGwId={targetGwId} gwName={gwName} liveGwId={liveGwId} liveGwFinished={liveGwFinished} teamsById={teamsById} playersById={playersById} fetchJson={fetchJson} loadTeam={loadTeam} onOpenTeam={onOpenTeam} onViewLive={onViewLive} onLiveRank={onLiveRank} />
      )}
    </div>
  );
}

