// The gameweek as it happens: your live points (projected bonus, automatic
// substitutions and the vice-captain's armband counted the way FPL will
// settle them, see src/lib/live.js) and every match's score and bonus.
import { useCallback, useEffect, useState } from 'react';
import { Radio, RefreshCw, Users } from 'lucide-react';
import { Pitch, PlayerCard } from '../components/Pitch.jsx';
import { SkeletonRows } from '../components/common.jsx';
import { liveTeamScore, projectedBonus, teamStates, bonusFromBps, liveBonusRace } from '../lib/live.js';
import './liveBonus.css';

const REFRESH_MS = 60 * 1000;

const kickoffLabel = iso => (iso ? new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'TBC');

function fixtureStatus(f) {
  if (f.finished || f.finished_provisional) return 'FT';
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

function MatchCard({ f, teamsById, playersById }) {
  const home = teamsById[f.team_h];
  const away = teamsById[f.team_a];
  const bonus = fixtureBonus(f);
  const live = f.started && !(f.finished || f.finished_provisional);
  return (
    <li className={`fpl-live-match${live ? ' is-live' : ''}`}>
      <div className="fpl-live-score">
        <span className="fpl-live-team">{home ? home.short_name : '?'}</span>
        <span className="fpl-mono fpl-live-goals">{f.started ? `${f.team_h_score ?? 0}–${f.team_a_score ?? 0}` : 'v'}</span>
        <span className="fpl-live-team">{away ? away.short_name : '?'}</span>
      </div>
      <span className={`fpl-mono fpl-live-status${live ? ' is-live' : ''}`}>{fixtureStatus(f)}</span>
      {bonus && bonus.rows.length ? (
        <p className="fpl-live-bonus">
          <span className="fpl-meta">{!bonus.projected ? 'Bonus:' : f.started && !(f.finished || f.finished_provisional) ? 'Bonus if it ended now:' : 'Bonus (not yet confirmed):'}</span>{' '}
          {bonus.rows.sort((a, b) => b.bonus - a.bonus).map(r => `${(playersById[r.element] || {}).webName || '?'} ${r.bonus}`).join(', ')}
        </p>
      ) : null}
    </li>
  );
}

export function LiveScreen({ staticData, gwId, teamId, fetchJson, onOpenLeague, onAddTeam }) {
  const [state, setState] = useState({ status: 'loading' });
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
    setState({ status: 'ready', liveById, fixtures, picks, at: new Date() });
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
      <h1 className="fpl-tool-h"><Radio size={22} aria-hidden="true" /> Live{event ? ` · ${event.name}` : ''}</h1>
      <p className="fpl-tool-sub">Points as FPL will settle them: bonus from the bonus points system until it's confirmed, automatic substitutions and the vice-captain's armband. Updates every minute while matches are on.</p>
    </header>
  );
  if (state.status === 'loading') return <div className="fpl-tool">{head}<div className="fpl-glass fpl-tool-card"><SkeletonRows rows={6} label="Loading live scores…" /></div></div>;
  if (state.status === 'error') {
    return (
      <div className="fpl-tool">{head}
        <div className="fpl-glass fpl-tool-card" role="alert">
          <p style={{ margin: 0 }}>Couldn't load live scores from FPL.</p>
          <button type="button" className="fpl-btn" onClick={() => { setState({ status: 'loading' }); load(); }}><RefreshCw size={15} aria-hidden="true" /> Try again</button>
        </div>
      </div>
    );
  }

  const { liveById, fixtures, picks, at } = state;
  const states = teamStates(fixtures);
  const score = picks ? liveTeamScore({ picks, liveById, bonus: projectedBonus(fixtures), states, playersById: staticData.playersById }) : null;
  const ownedIds = picks && Array.isArray(picks.picks) ? picks.picks.map(p => p.element) : [];
  const bonusRace = liveBonusRace(fixtures, { ownedIds, limit: 10 });
  const sortedFixtures = [...fixtures].sort((a, b) => {
    const rank = f => (f.started && !(f.finished || f.finished_provisional) ? 0 : !f.started ? 1 : 2);
    return rank(a) - rank(b) || new Date(a.kickoff_time) - new Date(b.kickoff_time);
  });
  const fixturesByTeam = {};
  fixtures.forEach(f => { [f.team_h, f.team_a].forEach(t => { (fixturesByTeam[t] || (fixturesByTeam[t] = [])).push(f); }); });

  const card = row => {
    const info = row.state === 'waiting'
      ? kickoffLabel((fixturesByTeam[row.player?.team] || []).find(f => !f.started)?.kickoff_time)
      : row.state === 'playing' ? (row.minutes > 0 ? `${row.minutes}'` : 'Not on yet') : `FT · ${row.minutes}'`;
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
        tag={row.subIn ? 'IN' : row.subOut ? 'OUT' : row.bonus ? `+${row.bonus}` : null}
        state={row.subOut ? 'dim' : row.subIn ? 'in' : null}
        label={`${row.player.webName}, ${row.points} points${row.bonus ? ` with ${row.bonus} projected bonus` : ''}, ${info}`}
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
        <span className="fpl-mono fpl-meta">{playing ? 'Matches on' : sortedFixtures.every(f => f.finished || f.finished_provisional) ? 'All matches over' : 'Between matches'} · updated {at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}{state.stale ? ' (couldn\'t refresh)' : ''}</span>
        <button type="button" className="fpl-btn" onClick={load}><RefreshCw size={15} aria-hidden="true" /> Refresh</button>
        <button type="button" className="fpl-btn" onClick={onOpenLeague}><Users size={15} aria-hidden="true" /> Mini-league live</button>
      </div>
      <div className="fpl-live-grid">
        <section className="fpl-glass fpl-tool-card" aria-labelledby="live-you">
          <h2 id="live-you" className="fpl-home-h">Your points</h2>
          {score ? (
            <>
              <div className="fpl-live-total">
                <b className="fpl-mono">{score.total}</b>
                <span className="fpl-meta">
                  {projectedTotal ? <>includes <b>+{projectedTotal}</b> projected bonus. </> : null}
                  {score.hit ? <>−{score.hit} for transfers. </> : null}
                  {average ? <>Average {average}.</> : null}
                  {picks.active_chip ? <> Chip: {picks.active_chip === 'bboost' ? 'Bench Boost' : picks.active_chip === '3xc' ? 'Triple Captain' : picks.active_chip === 'freehit' ? 'Free Hit' : 'Wildcard'}.</> : null}
                </span>
              </div>
              <Pitch starters={rows.filter(r => r.slot <= 11)} bench={rows.filter(r => r.slot > 11)} card={card} compact benchTitle="Substitutes" />
            </>
          ) : teamId ? (
            <p className="fpl-meta" style={{ margin: 0 }}>Couldn't load your team for this gameweek.</p>
          ) : (
            <>
              <p className="fpl-meta" style={{ margin: 0 }}>Add your FPL Team ID on Home to follow your points live.</p>
              <button type="button" className="fpl-btn fpl-btn-solid" onClick={onAddTeam}>Add my team</button>
            </>
          )}
        </section>
        {bonusRace.length ? (
          <section className="fpl-glass fpl-tool-card" aria-labelledby="live-bonus">
            <h2 id="live-bonus" className="fpl-home-h">Bonus race</h2>
            <p className="fpl-meta" style={{ margin: 0 }}>If live matches ended now. Your players highlighted.</p>
            <ul className="fpl-bonusrace">
              {bonusRace.map(r => (
                <li key={r.element} className={r.owned ? 'is-owned' : ''}>
                  <span className="fpl-bonusrace-b">{r.bonus ? `+${r.bonus}` : '–'}</span>
                  <span className="fpl-bonusrace-name">{(staticData.playersById[r.element] || {}).webName || '?'}</span>
                  <span className="fpl-mono fpl-meta">{r.bps} BPS</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className="fpl-glass fpl-tool-card" aria-labelledby="live-matches">
          <h2 id="live-matches" className="fpl-home-h">Matches</h2>
          <ul className="fpl-live-matches">
            {sortedFixtures.map(f => <MatchCard key={f.id} f={f} teamsById={staticData.teamsById} playersById={staticData.playersById} />)}
          </ul>
        </section>
      </div>
    </div>
  );
}
