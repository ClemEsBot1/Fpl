// The home screen's transfer trends: panels you swipe (or step through
// with the arrows) for the most bought and sold players this gameweek and
// the price changes to expect. Sits to the right of the home cards on a
// wide screen and below them on a phone.
import { useMemo, useRef, useState } from 'react';
import { ArrowDownRight, ArrowLeft, ArrowRight, ArrowUpRight, Repeat } from 'lucide-react';
import { fmtPrice } from '../lib/format.js';
import { buildTransferTrends } from '../lib/transferTrends.js';

const POS = ['', 'GKP', 'DEF', 'MID', 'FWD'];
const EMPTY = {
  in: 'No transfers yet this gameweek.',
  out: 'No transfers yet this gameweek.',
  rise: 'No player has enough buyers for a rise yet.',
  fall: 'No player has enough sellers for a fall yet.',
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

export function TransferTrends({ staticData }) {
  const trackRef = useRef(null);
  const [current, setCurrent] = useState(0);
  const panels = useMemo(
    () => (staticData ? buildTransferTrends(staticData.allPlayers, staticData.totalPlayers) : []),
    [staticData],
  );
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
        <h2 id="trends-h" className="fpl-home-h"><Repeat size={18} aria-hidden="true" /> Transfer trends</h2>
        {staticData.targetEvent && <span className="fpl-mono fpl-home-meta">GW{staticData.targetEvent.id} so far</span>}
      </div>
      <div className="fpl-trends-track" ref={trackRef} onScroll={onScroll} tabIndex={0} aria-label="Transfer trends panels">
        {panels.map((panel, k) => (
          <div key={panel.id} className="fpl-trends-panel" role="group" aria-roledescription="panel" aria-label={`${panel.title}, ${k + 1} of ${panels.length}`} aria-hidden={k !== current}>
            <h3 className="fpl-home-sub">{panel.title}</h3>
            {panel.rows.length ? (
              <ol className="fpl-trend-list">
                {panel.rows.map(row => <TrendRow key={row.player.id} row={row} stat={panel.stat} teamsById={staticData.teamsById} />)}
              </ol>
            ) : <p className="fpl-home-hint">{EMPTY[panel.id]}</p>}
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
      <p className="fpl-home-hint">Price changes are an estimate from net transfers and ownership; FPL doesn't publish its formula.</p>
    </section>
  );
}
