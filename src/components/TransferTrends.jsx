// The home screen's trends panel: slides you swipe (or step through with
// the arrows). For the upcoming gameweek: the most bought and sold
// players (with the price change to expect), then the highest predicted
// points of all players and of your own team. For a gameweek that has
// started: the highest actual points of all players and of your team,
// then FPL's numbers for the week (FPL only publishes transfer counts for
// the upcoming gameweek). Sits to the right of the home cards on a wide
// screen and below them on a phone.
import { useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Repeat } from 'lucide-react';
import { fmtPrice, fmtPts } from '../lib/format.js';
import { buildTransferTrends, topByPoints } from '../lib/transferTrends.js';
import { SkeletonRows } from './common.jsx';

const POS = ['', 'GKP', 'DEF', 'MID', 'FWD'];
const EMPTY = {
  in: 'No transfers yet this gameweek.',
  out: 'No transfers yet this gameweek.',
};

function fmtCount(n) {
  const abs = Math.abs(n);
  const text = abs >= 1e6 ? `${(abs / 1e6).toFixed(1)}m` : abs >= 1e3 ? `${Math.round(abs / 1e3)}k` : String(abs);
  return `${n < 0 ? '−' : n > 0 ? '+' : ''}${text}`;
}

function PriceChip({ change }) {
  if (!change) return <span className="fpl-trend-chip">No change</span>;
  const rise = change.dir === 'rise';
  const Icon = rise ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`fpl-trend-chip ${rise ? 'is-rise' : 'is-fall'}${change.confidence === 'likely' ? ' is-likely' : ''}`}>
      <Icon size={12} aria-hidden="true" />
      {rise ? '+' : '−'}£0.1m {change.confidence}
    </span>
  );
}

function TrendRow({ row, stat, teamsById }) {
  const { player, net, change } = row;
  const team = teamsById[player.team];
  const value = stat === 'in' ? player.transfersInEvent : stat === 'out' ? -player.transfersOutEvent : net;
  return (
    <li className="fpl-trend-row">
      <span className="fpl-row-pos">{POS[player.positionId]}</span>
      <span className="fpl-trend-who">
        <b>{player.webName}</b>
        <small>{team ? team.short_name : ''} · {fmtPrice(player.price)}</small>
      </span>
      <span className="fpl-trend-side">
        <span className={`fpl-trend-count${value < 0 ? ' is-out' : ''}`}>{fmtCount(value)}</span>
        <PriceChip change={change} />
      </span>
    </li>
  );
}

function ScorerRow({ player, points, teamsById }) {
  const team = teamsById[player.team];
  return (
    <li className="fpl-trend-row">
      <span className="fpl-row-pos">{POS[player.positionId]}</span>
      <span className="fpl-trend-who">
        <b>{player.webName}</b>
        <small>{team ? team.short_name : ''} · {fmtPrice(player.price)}</small>
      </span>
      <span className="fpl-trend-count">{points}<small> pts</small></span>
    </li>
  );
}

function pointsPanel(id, title, entries, format, teamsById, empty) {
  const rows = entries && topByPoints(entries);
  return {
    id, title,
    body: !rows ? (empty.waiting ? <SkeletonRows rows={5} label={empty.loading} /> : <p className="fpl-home-hint">{empty.loading}</p>)
      : rows.length ? (
        <ol className="fpl-trend-list">
          {rows.map(r => <ScorerRow key={r.player.id} player={r.player} points={format(r.points)} teamsById={teamsById} />)}
        </ol>
      ) : <p className="fpl-home-hint">{empty.none}</p>,
  };
}

// Your team's players with their points, or null without a team loaded.
const teamEntries = (team, pointsFor) => (team ? team.squad.map(s => ({ player: s.player, points: pointsFor(s) })) : null);
const noTeam = teamPending => (teamPending
  ? { loading: 'Loading your team…', waiting: true }
  : { loading: 'Add your FPL Team ID on Home to see your own players here.' });

// The panels for a gameweek that has started: the highest scorers of all
// players and on your team, then FPL's own numbers for the week.
function recapPanels(staticData, event, live, team, teamPending) {
  const { playersById, teamsById } = staticData;
  const name = id => (playersById[id] ? playersById[id].webName : '–');
  const all = live ? Object.entries(live).map(([id, l]) => ({ player: playersById[id], points: l.totalPoints })) : null;
  const facts = [
    ['Average score', event.average_entry_score],
    ['Highest score', event.highest_score],
    ['Top player', event.top_element_info ? `${name(event.top_element_info.id)} · ${event.top_element_info.points} pts` : null],
    ['Most captained', event.most_captained ? name(event.most_captained) : null],
    ['Most transferred in', event.most_transferred_in ? name(event.most_transferred_in) : null],
    ['Transfers made', event.transfers_made ? event.transfers_made.toLocaleString('en-GB') : null],
  ].filter(([, v]) => v !== null && v !== undefined && v !== 0);
  return [
    pointsPanel('scorers', `Top scorers in GW${event.id}`, all, String, teamsById,
      { loading: 'Loading points…', waiting: true, none: 'No points scored yet this gameweek.' }),
    pointsPanel('team-scorers', 'Top scorers on your team', teamEntries(team, s => s.actualPoints || 0), String, teamsById,
      { ...noTeam(teamPending), none: 'None of your players has scored yet this gameweek.' }),
    {
      id: 'numbers', title: `Gameweek ${event.id} in numbers`,
      body: facts.length ? (
        <dl className="fpl-trend-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      ) : <p className="fpl-home-hint">FPL hasn't published this gameweek's numbers yet.</p>,
    },
  ];
}

// The panels for the upcoming gameweek: transfers in and out, then the
// highest predicted points of all players and on your team.
function upcomingPanels(staticData, team, teamPending) {
  const { allPlayers, predictionsById, teamsById } = staticData;
  const transfers = buildTransferTrends(allPlayers, staticData.totalPlayers).map(panel => ({
    id: panel.id, title: panel.title,
    body: panel.rows.length ? (
      <ol className="fpl-trend-list">
        {panel.rows.map(row => <TrendRow key={row.player.id} row={row} stat={panel.stat} teamsById={teamsById} />)}
      </ol>
    ) : <p className="fpl-home-hint">{EMPTY[panel.id]}</p>,
  }));
  const all = allPlayers.map(p => ({ player: p, points: predictionsById[p.id] ? predictionsById[p.id].predicted : 0 }));
  return [
    ...transfers,
    pointsPanel('predicted', 'Highest predicted points', all, fmtPts, teamsById,
      { loading: '', none: 'No predictions yet.' }),
    pointsPanel('team-predicted', 'Highest predicted on your team', teamEntries(team, s => s.predicted), fmtPts, teamsById,
      { ...noTeam(teamPending), none: 'No predictions for your players yet.' }),
  ];
}

// team: the remembered team's results data for this gameweek, or null
// (teamPending while it loads).
export function TransferTrends({ staticData, event, isPast, live, team, teamPending }) {
  const trackRef = useRef(null);
  const [current, setCurrent] = useState(0);
  const panels = useMemo(() => {
    if (!staticData || !event) return [];
    return isPast ? recapPanels(staticData, event, live, team, teamPending) : upcomingPanels(staticData, team, teamPending);
  }, [staticData, event, isPast, live, team, teamPending]);
  if (!staticData) {
    return (
      <section className="fpl-glass fpl-home-card fpl-trends" aria-labelledby="trends-h" aria-busy="true">
        <h2 id="trends-h" className="fpl-home-h"><Repeat size={18} aria-hidden="true" /> Transfer trends</h2>
        <SkeletonRows rows={6} label="Loading transfer trends…" />
      </section>
    );
  }
  if (!panels.length) return null;

  function onScroll() {
    const el = trackRef.current;
    if (el && el.clientWidth) setCurrent(Math.round(el.scrollLeft / el.clientWidth));
  }
  function go(k) {
    const el = trackRef.current;
    const next = Math.max(0, Math.min(panels.length - 1, k));
    if (el) el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    setCurrent(next);
  }

  return (
    <section className="fpl-glass fpl-home-card fpl-trends" aria-labelledby="trends-h">
      <div className="fpl-home-team-head">
        <h2 id="trends-h" className="fpl-home-h"><Repeat size={18} aria-hidden="true" /> {isPast ? `Gameweek ${event.id} recap` : 'Transfer trends'}</h2>
        <span className="fpl-mono fpl-home-meta">{isPast ? (event.finished ? 'Final' : 'Live') : `GW${event.id} so far`}</span>
      </div>
      <div className="fpl-trends-track" ref={trackRef} onScroll={onScroll} tabIndex={0} aria-label="Transfer trends panels">
        {panels.map((panel, k) => (
          <div key={panel.id} className="fpl-trends-panel" role="group" aria-roledescription="panel" aria-label={`${panel.title}, ${k + 1} of ${panels.length}`} aria-hidden={k !== current}>
            <h3 className="fpl-home-sub">{panel.title}</h3>
            {panel.body}
          </div>
        ))}
      </div>
      <div className="fpl-carousel-nav">
        <div className="fpl-dots">
          {panels.map((panel, k) => (
            <button key={panel.id} type="button" aria-label={`Show: ${panel.title}`} aria-current={k === current} onClick={() => go(k)} />
          ))}
        </div>
        <div className="fpl-arrows">
          <button type="button" aria-label="Previous panel" disabled={current === 0} onClick={() => go(current - 1)}><ArrowLeft size={18} /></button>
          <button type="button" aria-label="Next panel" disabled={current === panels.length - 1} onClick={() => go(current + 1)}><ArrowRight size={18} /></button>
        </div>
      </div>
      <p className="fpl-home-hint">{isPast
        ? "FPL only publishes transfer counts for the upcoming gameweek, so a past one shows its points instead."
        : "Price changes are an estimate from net transfers and ownership; FPL doesn't publish its formula."}</p>
    </section>
  );
}
