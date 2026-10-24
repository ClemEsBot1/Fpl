// The gameweek as it happens: your live points (projected bonus, automatic
// substitutions and the vice-captain's armband counted the way FPL will
// settle them, see src/lib/live.js) and every match's score and bonus.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Radio, RefreshCw, Users, X } from 'lucide-react';
import { Pitch, PlayerCard } from '../components/Pitch.jsx';
import { POSITION_LABELS } from '../lib/format.js';
import { SkeletonRows } from '../components/common.jsx';
import { liveTeamScore, projectedBonus, teamStates, bonusFromBps, lineup, liveBonusRace, matchDetail } from '../lib/live.js';
import { openPlayerProfile } from '../lib/playerProfile.js';
import './liveBonus.css';
import { fmtDateTime, fmtTime, t } from '../lib/i18n.js';
import { chipName } from '../lib/career.js';
import { tr } from '../lib/i18nRich.jsx';

const REFRESH_MS = 60 * 1000;

const kickoffLabel = iso => (iso ? fmtDateTime(iso, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : t('TBC'));

function fixtureStatus(f) {
  if (f.finished || f.finished_provisional) return t('FT');
  if (f.started) return `${f.minutes || 0}'`;
  return kickoffLabel(f.kickoff_time);
}

// The match's bonus: confirmed, or projected from BPS while it's live.
function fixtureBonus(f) {
  const list = id => {
    const s = (f.stats || []).find(x => x.identifier === id);
    return s ? [...(s.h || []), ...(s.a || [])] : [];
  };
  const confirmed = list('bonus');
  if (confirmed.length) return { projected: false, rows: confirmed.map(e => ({ element: e.element, bonus: e.value })) };
  if (!f.started) return null;
  const bonus = bonusFromBps(list('bps'));
  return { projected: true, rows: Object.entries(bonus).map(([element, b]) => ({ element: Number(element), bonus: b })) };
}

function MatchCard({ f, teamsById, playersById, onOpen }) {
  const home = teamsById[f.team_h];
  const away = teamsById[f.team_a];
  const bonus = fixtureBonus(f);
  const live = f.started && !(f.finished || f.finished_provisional);
  return (
    <li className={`fpl-live-match${live ? ' is-live' : ''}${f.started ? ' is-open' : ''}`}>
      {f.started ? <button type="button" className="fpl-live-match-btn" onClick={() => onOpen(f.id)} aria-label={t('{home} v {away}: players and stats', { home: home ? home.name : '?', away: away ? away.name : '?' })}><ChevronRight size={16} aria-hidden="true" /></button> : null}
      <div className="fpl-live-score">
        <span className="fpl-live-team">{home ? home.short_name : '?'}</span>
        <span className="fpl-mono fpl-live-goals">{f.started ? `${f.team_h_score ?? 0}–${f.team_a_score ?? 0}` : t('v')}</span>
        <span className="fpl-live-team">{away ? away.short_name : '?'}</span>
      </div>
      <span className={`fpl-mono fpl-live-status${live ? ' is-live' : ''}`}>{fixtureStatus(f)}</span>
      {bonus && bonus.rows.length ? (
        <p className="fpl-live-bonus">
          <span className="fpl-meta">{!bonus.projected ? t('Bonus:') : f.started && !(f.finished || f.finished_provisional) ? t('Bonus if it ended now:') : t('Bonus (not yet confirmed):')}</span>{' '}
          {bonus.rows.sort((a, b) => b.bonus - a.bonus).map(r => `${(playersById[r.element] || {}).webName || '?'} ${r.bonus}`).join(', ')}
        </p>
      ) : null}
    </li>
  );
}

// The match's events for one side: goals, assists and so on, as
// "Saka 2, Rice".
const EVENT_LABELS = () => [
  ['goals_scored', t('Goals')], ['assists', t('Assists')], ['own_goals', t('Own goals')],
  ['penalties_saved', t('Penalties saved')], ['penalties_missed', t('Penalties missed')],
  ['yellow_cards', t('Yellow cards')], ['red_cards', t('Red cards')], ['saves', t('Saves')],
];
const named = list => list.map(e => `${e.player ? e.player.webName : '?'}${e.value > 1 ? ` ${e.value}` : ''}`).join(', ');

function SideTable({ team, rows, ownedIds, projected }) {
  return (
    <div className="fpl-compare-wrap">
      <table className="fpl-pp-table fpl-match-table">
        <caption>{team ? team.name : '?'}</caption>
        <thead>
          <tr>
            <th scope="col">{t('Player')}</th>
            <th scope="col">{t('Mins')}</th>
            <th scope="col">{t('G')}</th>
            <th scope="col">{t('A')}</th>
            <th scope="col">{t('BPS')}</th>
            <th scope="col">{t('Bonus')}{projected ? '*' : ''}</th>
            <th scope="col">{t('Pts')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.element} className={ownedIds.has(r.element) ? 'is-owned' : ''}>
              <td>
                {r.player ? <button type="button" className="fpl-namebtn" onClick={() => openPlayerProfile(r.element)}>{r.player.webName}</button> : '?'}
                {r.yellow ? <span className="fpl-card is-yellow" title={t('Yellow cards')} /> : null}
                {r.red ? <span className="fpl-card is-red" title={t('Red cards')} /> : null}
              </td>
              <td>{r.minutes}</td>
              <td>{r.goals || ''}</td>
              <td>{r.assists || ''}</td>
              <td>{r.bps ?? '–'}</td>
              <td>{r.bonus ? `+${r.bonus}` : ''}</td>
              <td className="fpl-pp-pts">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// One side's players on a pitch, as My team shows a squad: the eleven who
// started in formation, then those who came on, each with his points from
// this match, minutes and bonus. Tapping one opens his profile.
function SidePitch({ team, rows, ownedIds }) {
  const { starters, subs } = lineup(rows);
  const card = r => (
    <PlayerCard
      key={r.element}
      slot={{ player: r.player || { webName: '?', positionId: 3 }, availNote: null }}
      team={team}
      points={r.points}
      pointsTone={ownedIds.has(r.element) ? 'high' : null}
      info={`${r.minutes}'${r.goals ? ` · ${r.goals}${t('G')}` : ''}${r.assists ? ` · ${r.assists}${t('A')}` : ''}`}
      tag={r.bonus ? `+${r.bonus}` : null}
      onClick={r.player ? () => openPlayerProfile(r.element) : undefined}
      label={t('{name}, {n} points, {info}', { name: r.player ? r.player.webName : '?', n: r.points, info: `${r.minutes}'` })}
    />
  );
  return (
    <Pitch
      starters={starters.filter(r => r.player)}
      bench={subs.filter(r => r.player)}
      card={card}
      compact
      benchTitle={t('Came on')}
      benchLabel={r => POSITION_LABELS[r.player.positionId]}
    />
  );
}

// One match: its events and every player's points, BPS and bonus, kept up
// to date with the screen's refresh.
function MatchSheet({ f, elements, teamsById, playersById, ownedIds, onClose }) {
  const dialogRef = useRef(null);
  const [side, setSide] = useState('home');
  const [view, setView] = useState('pitch');
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog && dialog.open) dialog.close(); };
  }, []);
  const home = teamsById[f.team_h];
  const away = teamsById[f.team_a];
  const d = matchDetail(f, elements, playersById);
  const live = f.started && !(f.finished || f.finished_provisional);
  const events = EVENT_LABELS().filter(([id]) => d.events.home[id].length || d.events.away[id].length);
  return (
    <dialog
      ref={dialogRef}
      className="fpl-dialog fpl-pp fpl-match-sheet"
      aria-labelledby="match-h"
      onCancel={e => { e.preventDefault(); onClose(); }}
      onClick={e => { if (e.target === dialogRef.current) onClose(); }}
    >
      <div className="fpl-dialog-card">
        <button type="button" onClick={onClose} aria-label={t('Close')} className="fpl-dialog-close"><X size={18} /></button>
        <h2 id="match-h" className="fpl-match-head">
          <span>{home ? home.name : '?'}</span>
          <b className="fpl-mono">{f.team_h_score ?? 0}–{f.team_a_score ?? 0}</b>
          <span>{away ? away.name : '?'}</span>
        </h2>
        <p className={`fpl-mono fpl-live-status fpl-match-status${live ? ' is-live' : ''}`}>{fixtureStatus(f)}</p>
        {events.length ? (
          <table className="fpl-match-events">
            <tbody>
              {events.map(([id, label]) => (
                <tr key={id}>
                  <td>{named(d.events.home[id])}</td>
                  <th scope="row">{label}</th>
                  <td>{named(d.events.away[id])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <div className="fpl-match-switch">
          <div className="fpl-seg" role="group" aria-label={t('Team')}>
            <button type="button" className={side === 'home' ? 'is-on' : ''} aria-pressed={side === 'home'} onClick={() => setSide('home')}>{home ? home.short_name : '?'}</button>
            <button type="button" className={side === 'away' ? 'is-on' : ''} aria-pressed={side === 'away'} onClick={() => setSide('away')}>{away ? away.short_name : '?'}</button>
          </div>
          <div className="fpl-seg" role="group" aria-label={t('Show')}>
            <button type="button" className={view === 'pitch' ? 'is-on' : ''} aria-pressed={view === 'pitch'} onClick={() => setView('pitch')}>{t('Pitch')}</button>
            <button type="button" className={view === 'table' ? 'is-on' : ''} aria-pressed={view === 'table'} onClick={() => setView('table')}>{t('List')}</button>
          </div>
        </div>
        {view === 'pitch'
          ? <SidePitch key={side} team={side === 'home' ? home : away} rows={side === 'home' ? d.home : d.away} ownedIds={ownedIds} />
          : <SideTable team={side === 'home' ? home : away} rows={side === 'home' ? d.home : d.away} ownedIds={ownedIds} projected={d.bonusProjected} />}
        {d.bonusProjected ? <p className="fpl-meta fpl-pp-note">{t('* Bonus from the bonus points system: FPL confirms it after the match. Points include it.')}</p> : null}
      </div>
    </dialog>
  );
}

export function LiveScreen({ staticData, gwId, teamId, fetchJson, onOpenLeague, onAddTeam }) {
  const [state, setState] = useState({ status: 'loading' });
  const [openMatch, setOpenMatch] = useState(null);
  // Fetches the gameweek and stores it; a failed refresh keeps what's shown.
  const load = useCallback(() => Promise.all([
    fetchJson(`event/${gwId}/live/`),
    fetchJson(`fixtures/?event=${gwId}`),
    teamId ? fetchJson(`entry/${teamId}/event/${gwId}/picks/`).catch(() => null) : Promise.resolve(null),
  ]).then(([live, fixtures, picks]) => {
    const liveById = {};
    (live.elements || []).forEach(el => {
      liveById[el.id] = { totalPoints: el.stats.total_points, minutes: el.stats.minutes, bonus: el.stats.bonus };
    });
    setState({ status: 'ready', liveById, elements: live.elements || [], fixtures, picks, at: new Date() });
  }, () => {
    setState(s => (s.status === 'ready' ? { ...s, stale: true } : { status: 'error' }));
  }), [fetchJson, gwId, teamId]);

  useEffect(() => { load(); }, [load]);
  const playing = state.status === 'ready' && state.fixtures.some(f => f.started && !(f.finished || f.finished_provisional));
  // Every minute while a match is on, and when the app comes back into view.
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(load, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [playing, load]);

  const event = staticData.allEvents.find(e => e.id === gwId);
  const head = (
    <header className="fpl-tool-head">
      <h1 className="fpl-tool-h"><Radio size={22} aria-hidden="true" /> {t('Live')}{event ? ` · ${event.name}` : ''}</h1>
      <p className="fpl-tool-sub">{t('Points as FPL will settle them: bonus from the bonus points system until it’s confirmed, automatic substitutions and the vice-captain’s armband. Updates every minute while matches are on.')}</p>
    </header>
  );
  if (state.status === 'loading') return <div className="fpl-tool">{head}<div className="fpl-glass fpl-tool-card"><SkeletonRows rows={6} label={t('Loading live scores…')} /></div></div>;
  if (state.status === 'error') {
    return (
      <div className="fpl-tool">{head}
        <div className="fpl-glass fpl-tool-card" role="alert">
          <p style={{ margin: 0 }}>{t('Couldn’t load live scores from FPL.')}</p>
          <button type="button" className="fpl-btn" onClick={() => { setState({ status: 'loading' }); load(); }}><RefreshCw size={15} aria-hidden="true" /> {t('Try again')}</button>
        </div>
      </div>
    );
  }

  const { liveById, elements, fixtures, picks, at } = state;
  const states = teamStates(fixtures);
  const score = picks ? liveTeamScore({ picks, liveById, bonus: projectedBonus(fixtures), states, playersById: staticData.playersById }) : null;
  const ownedIds = picks && Array.isArray(picks.picks) ? picks.picks.map(p => p.element) : [];
  const bonusRace = liveBonusRace(fixtures, { ownedIds, limit: 10 });
  const sortedFixtures = [...fixtures].sort((a, b) => {
    const rank = f => (f.started && !(f.finished || f.finished_provisional) ? 0 : !f.started ? 1 : 2);
    return rank(a) - rank(b) || new Date(a.kickoff_time) - new Date(b.kickoff_time);
  });
  const fixturesByTeam = {};
  fixtures.forEach(f => { [f.team_h, f.team_a].forEach(team => { (fixturesByTeam[team] || (fixturesByTeam[team] = [])).push(f); }); });

  const card = row => {
    const info = row.state === 'waiting'
      ? kickoffLabel((fixturesByTeam[row.player?.team] || []).find(f => !f.started)?.kickoff_time)
      : row.state === 'playing' ? (row.minutes > 0 ? `${row.minutes}'` : t('Not on yet')) : `${t('FT')} · ${row.minutes}'`;
    const slot = {
      player: row.player, availNote: null,
      isCaptain: row.multiplier >= 2 && (row.isCaptain || row.armband),
      isViceCaptain: row.isViceCaptain && !row.armband,
    };
    return (
      <PlayerCard
        key={row.id}
        slot={slot}
        team={staticData.teamsById[row.player.team]}
        points={row.subOut ? row.livePoints : row.points}
        pointsTone={row.state === 'playing' ? 'high' : null}
        info={info}
        tag={row.subIn ? t('IN') : row.subOut ? t('OUT') : row.bonus ? `+${row.bonus}` : null}
        state={row.subOut ? 'dim' : row.subIn ? 'in' : null}
        label={row.bonus ? t('{name}, {n} points with {bonus} projected bonus, {info}', { name: row.player.webName, n: row.points, bonus: row.bonus, info }) : t('{name}, {n} points, {info}', { name: row.player.webName, n: row.points, info })}
      />
    );
  };
  const rows = score ? score.rows.filter(r => r.player) : [];
  const projectedTotal = rows.reduce((s, r) => s + r.bonus * r.multiplier, 0);
  const average = event && event.average_entry_score > 0 ? event.average_entry_score : null;

  return (
    <div className="fpl-tool">
      {head}
      <div className="fpl-tool-bar">
        <span className="fpl-mono fpl-meta">{playing ? t('Matches on') : sortedFixtures.every(f => f.finished || f.finished_provisional) ? t('All matches over') : t('Between matches')} · {t('updated {time}', { time: fmtTime(at, { hour: '2-digit', minute: '2-digit' }) })}{state.stale ? ` (${t('couldn’t refresh')})` : ''}</span>
        <button type="button" className="fpl-btn" onClick={load}><RefreshCw size={15} aria-hidden="true" /> {t('Refresh')}</button>
        <button type="button" className="fpl-btn" onClick={onOpenLeague}><Users size={15} aria-hidden="true" /> {t('Mini-league live')}</button>
      </div>
      <div className="fpl-live-grid">
        <section className="fpl-glass fpl-tool-card" aria-labelledby="live-you">
          <h2 id="live-you" className="fpl-home-h">{t('Your points')}</h2>
          {score ? (
            <>
              <div className="fpl-live-total">
                <b className="fpl-mono">{score.total}</b>
                <span className="fpl-meta">
                  {projectedTotal ? <>{tr('Includes <b>+{n}</b> projected bonus.', { n: projectedTotal }, { b: s => <b>{s}</b> })} </> : null}
                  {score.hit ? <>{t('Transfer hit −{n}, taken off your season total.', { n: score.hit })} </> : null}
                  {average ? <>{t('Average {n}.', { n: average })}</> : null}
                  {picks.active_chip ? <> {t('Chip: {chip}.', { chip: chipName(picks.active_chip) })}</> : null}
                </span>
              </div>
              <Pitch starters={rows.filter(r => r.slot <= 11)} bench={rows.filter(r => r.slot > 11)} card={card} compact benchTitle={t('Substitutes')} />
            </>
          ) : teamId ? (
            <p className="fpl-meta" style={{ margin: 0 }}>{t('Couldn’t load your team for this gameweek.')}</p>
          ) : (
            <>
              <p className="fpl-meta" style={{ margin: 0 }}>{t('Add your FPL Team ID on Home to follow your points live.')}</p>
              <button type="button" className="fpl-btn fpl-btn-solid" onClick={onAddTeam}>{t('Add my team')}</button>
            </>
          )}
        </section>
        {bonusRace.length ? (
          <section className="fpl-glass fpl-tool-card" aria-labelledby="live-bonus">
            <h2 id="live-bonus" className="fpl-home-h">{t('Bonus race')}</h2>
            <p className="fpl-meta" style={{ margin: 0 }}>{t('If live matches ended now. Your players highlighted.')}</p>
            <ul className="fpl-bonusrace">
              {bonusRace.map(r => (
                <li key={r.element} className={r.owned ? 'is-owned' : ''}>
                  <span className="fpl-bonusrace-b">{r.bonus ? `+${r.bonus}` : '–'}</span>
                  <span className="fpl-bonusrace-name">{(staticData.playersById[r.element] || {}).webName || '?'}</span>
                  <span className="fpl-mono fpl-meta">{t('{n} BPS', { n: r.bps })}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="fpl-glass fpl-tool-card" aria-labelledby="live-matches">
          <h2 id="live-matches" className="fpl-home-h">{t('Matches')}</h2>
          <ul className="fpl-live-matches">
            {sortedFixtures.map(f => <MatchCard key={f.id} f={f} teamsById={staticData.teamsById} playersById={staticData.playersById} onOpen={setOpenMatch} />)}
          </ul>
        </section>
        {openMatch && fixtures.find(f => f.id === openMatch) ? (
          <MatchSheet
            f={fixtures.find(f => f.id === openMatch)}
            elements={elements}
            teamsById={staticData.teamsById}
            playersById={staticData.playersById}
            ownedIds={new Set(ownedIds)}
            onClose={() => setOpenMatch(null)}
          />
        ) : null}
      </div>
    </div>
  );
}
