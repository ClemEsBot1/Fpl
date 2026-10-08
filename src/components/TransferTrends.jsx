// The home screen's trends panel: slides you swipe (or step through with
// the arrows). For the upcoming gameweek: the most bought and sold
// players (with the price change to expect), then the highest predicted
// points of all players and of your own team. For a gameweek that has
// started: the highest actual points of all players and of your team,
// then FPL's numbers for the week (FPL only publishes transfer counts for
// the upcoming gameweek). Sits to the right of the home cards on a wide
// screen and below them on a phone.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Clock, Repeat } from 'lucide-react';
import { fmtPrice, fmtPts } from '../lib/format.js';
import { buildPriceWatch, buildTransferTrends, hasOfficialPriceData, nextPriceChangeAt, topByPoints } from '../lib/transferTrends.js';
import { SkeletonRows } from './common.jsx';

const POS = ['', 'GKP', 'DEF', 'MID', 'FWD'];
const EMPTY = {
  in: 'No transfers yet this gameweek.',
  out: 'No transfers yet this gameweek.',
  rises: 'Nobody is close to a price rise.',
  drops: 'Nobody is close to a price drop.',
};

function fmtCount(n) {
  const abs = Math.abs(n);
  const text = abs >= 1e6 ? `${(abs / 1e6).toFixed(1)}m` : abs >= 1e3 ? `${Math.round(abs / 1e3)}k` : String(abs);
  return `${n < 0 ? '−' : n > 0 ? '+' : ''}${text}`;
}

// FPL's own status ("Very likely to rise"), or for an estimate the
// change it would make ("+£0.1m likely").
function PriceChip({ change }) {
  if (!change) return null;
  const rise = change.dir === 'rise';
  const Icon = rise ? ArrowUpRight : ArrowDownRight;
  const official = typeof change.percent === 'number';
  const strong = official ? change.confidence === 'very likely' : change.confidence === 'likely';
  const label = official
    ? `${change.confidence[0].toUpperCase()}${change.confidence.slice(1)} to ${rise ? 'rise' : 'drop'}`
    : `${rise ? '+' : '−'}£0.1m ${change.confidence}`;
  return (
    <span className={`fpl-trend-chip ${rise ? 'is-rise' : 'is-fall'}${strong ? ' is-likely' : ''}`}>
      <Icon size={12} aria-hidden="true" />
      {label}
    </span>
  );
}

// Time left until FPL's next price changes at 00:00 UK, ticking each
// minute.
function PriceChangeTimer() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const mins = Math.max(0, Math.ceil((nextPriceChangeAt(new Date(now)).getTime() - now) / 60000));
  const text = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  return (
    <p className="fpl-price-timer">
      <Clock size={14} aria-hidden="true" />
      <span>Price changes in <b className="fpl-mono">{text}</b></span>
      <small>00:00 UK</small>
    </p>
  );
}

// Transfers in (or out) over about the last hour, from
// /api/transfer-trend; nothing until there's a snapshot to compare with.
function HourChip({ hourly, player, stat }) {
  if (!hourly || !hourly.byId || !hourly.minutes || (stat !== 'in' && stat !== 'out')) return null;
  const d = hourly.byId[player.id];
  const value = d ? (stat === 'in' ? d[0] : d[1]) : 0;
  const span = hourly.minutes >= 50 && hourly.minutes <= 75 ? 'last hour' : `last ${hourly.minutes >= 60 ? `${Math.round(hourly.minutes / 60)}h` : `${hourly.minutes}m`}`;
  return (
    <span className={`fpl-trend-chip fpl-trend-hour${value ? ` is-${stat}` : ''}`} title={`Transfers ${stat} in the last ${hourly.minutes} minutes`}>
      {value ? fmtCount(stat === 'in' ? value : -value) : 'None'} {span}
    </span>
  );
}

function TrendRow({ row, stat, teamsById, hourly }) {
  const { player, net, change } = row;
  const team = teamsById[player.team];
  const value = stat === 'in' ? player.transfersInEvent : stat === 'out' ? -player.transfersOutEvent : net;
  const count = stat === 'pct' ? `${player.priceChangePercent > 0 ? '+' : '−'}${Math.round(Math.abs(player.priceChangePercent))}%` : fmtCount(value);
  const negative = stat === 'pct' ? player.priceChangePercent < 0 : value < 0;
  return (
    <li className="fpl-trend-row">
      <span className="fpl-row-pos">{POS[player.positionId]}</span>
      <span className="fpl-trend-who">
        <b>{player.webName}</b>
        <small>{team ? team.short_name : ''} · {fmtPrice(player.price)}</small>
      </span>
      <span className="fpl-trend-side">
        <span className={`fpl-trend-count${negative ? ' is-out' : ''}`}>{count}</span>
        <HourChip hourly={hourly} player={player} stat={stat} />
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
function upcomingPanels(staticData, team, teamPending, hourly) {
  const { allPlayers, predictionsById, teamsById } = staticData;
  const lists = [...buildPriceWatch(allPlayers, staticData.totalPlayers), ...buildTransferTrends(allPlayers, staticData.totalPlayers)];
  const transfers = lists.map(panel => ({
    id: panel.id, title: panel.title,
    body: panel.rows.length ? (
      <ol className="fpl-trend-list">
        {panel.rows.map(row => <TrendRow key={row.player.id} row={row} stat={panel.stat} teamsById={teamsById} hourly={hourly} />)}
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
  // Transfers over the last hour, refreshed every five minutes.
  const [hourly, setHourly] = useState(null);
  useEffect(() => {
    if (isPast) return undefined;
    let cancelled = false;
    const load = () => fetch('/api/transfer-trend')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setHourly(d && d.byId ? d : null); })
      .catch(() => {});
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isPast]);
  const panels = useMemo(() => {
    if (!staticData || !event) return [];
    return isPast ? recapPanels(staticData, event, live, team, teamPending) : upcomingPanels(staticData, team, teamPending, hourly);
  }, [staticData, event, isPast, live, team, teamPending, hourly]);
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
      <PriceChangeTimer />
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
        : hasOfficialPriceData(staticData.allPlayers)
          ? "Price status is FPL's own Price Change Predictor: 100% means FPL expects the change at 00:00 UK. It's a guide, not a promise."
          : "Price changes are an estimate from net transfers and ownership; FPL doesn't publish its formula."}
        {!isPast && hourly ? ' "Last hour" is how many more transfers there have been since FPL\'s figures an hour ago.' : ''}</p>
    </section>
  );
}
