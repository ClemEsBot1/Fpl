// The gameweek recap: a run of slides on how your team did, opened by
// itself once a gameweek is over and from the button on Home. Full screen
// on a phone; on a computer a wide card whose slides show more (the teams
// side by side, the season's rank, every player's prediction).
// A native <dialog> opened with showModal(), for focus trapping,
// Escape-to-close and an inert page behind it.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Copy, Download, RotateCcw, Share2, Star, X } from 'lucide-react';
import { DIFF_COLORS, fmtPrice, fmtPts } from '../lib/format.js';
import { recapText } from '../lib/recap.js';

const n = v => v.toLocaleString('en-GB');
const signed = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${n(Math.abs(v))}`;
const signed1 = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtPts(Math.abs(v))}`;
const ordinal = v => {
  const t = v % 100;
  return `${v}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] || 'th'}`;
};
const tone = v => (v > 0 ? 'is-up' : v < 0 ? 'is-down' : '');
const round1 = v => Math.round(v * 10) / 10;

// The wide layout: a computer-sized window.
const WIDE = '(min-width: 1000px) and (min-height: 620px)';
function useWide() {
  return useSyncExternalStore(
    cb => {
      const mq = window.matchMedia(WIDE);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

function Chips({ list }) {
  if (!list || !list.length) return null;
  return <div className="fpl-recap-chips">{list.map(c => <span key={c}>{c}</span>)}</div>;
}

function Bar({ label, value, max, color }) {
  return (
    <div className="fpl-recap-bar">
      <span>{label}</span>
      <span className="fpl-recap-track"><span style={{ '--v': max > 0 ? Math.min(1, Math.max(0, value) / max) : 0, background: color }} /></span>
      <b className="fpl-mono">{n(value)}</b>
    </div>
  );
}

function Stat({ label, children, className = '' }) {
  return <div className={`fpl-recap-stat ${className}`}><span>{label}</span><b className="fpl-mono">{children}</b></div>;
}

// A team's XI as a list: position, name, armband, points.
function XiList({ title, sub, total, rows, accent }) {
  if (!rows || !rows.length) return null;
  return (
    <div className={`fpl-recap-card fpl-recap-xi${accent ? ` has-${accent}` : ''}`}>
      <p className="fpl-recap-xi-head"><span>{title}</span><b className="fpl-mono">{n(total)}</b></p>
      {sub ? <small>{sub}</small> : null}
      <ol>
        {rows.map(r => (
          <li key={r.id}>
            <span className="fpl-recap-pos">{r.pos}</span>
            <b>{r.name}{r.isCaptain ? <span className="fpl-recap-c" aria-label="captain">C</span> : null}</b>
            <span className="fpl-mono">{r.points}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Fixtures({ list, label = 'Next 3' }) {
  if (!list || !list.length) return null;
  return (
    <p className="fpl-recap-fx">
      <span>{label}</span>
      {list.map((f, i) => {
        const c = DIFF_COLORS[f.difficulty] || DIFF_COLORS[3];
        return <span key={i} className="fpl-mono" style={{ background: c.bg, color: c.text }} title={`${f.opponent} (${f.isHome ? 'home' : 'away'})`}>{f.isHome ? f.opponent.toUpperCase() : f.opponent.toLowerCase()}</span>;
      })}
    </p>
  );
}

function Headline({ recap, wide }) {
  const h = recap.headline;
  const max = Math.max(h.points, h.highest || 0, h.average || 0);
  const main = (
    <>
      <h2 className="fpl-recap-title">{recap.teamName} scored</h2>
      <p className="fpl-recap-big"><b className="fpl-mono">{h.points}</b> points</p>
      {h.vsAverage !== null && (
        <span className={`fpl-recap-pill ${h.vsAverage >= 0 ? 'is-lime' : 'is-red'}`}>
          {h.vsAverage === 0 ? 'Exactly the average' : `${signed(h.vsAverage)} ${h.vsAverage > 0 ? 'above' : 'below'} average`}
        </span>
      )}
      {h.average !== null && (
        <div className="fpl-recap-card">
          <Bar label="You" value={h.points} max={max} color="var(--lime)" />
          <Bar label="Average" value={h.average} max={max} color="var(--blue)" />
          {h.highest ? <Bar label="Highest" value={h.highest} max={max} color="var(--ink)" /> : null}
        </div>
      )}
    </>
  );
  if (!wide) return main;
  const { you, template, top } = h.teams;
  return (
    <div className="fpl-recap-wide" style={{ '--cols': '300px minmax(0, 1fr)' }}>
      <div className="fpl-recap-col">
        {main}
        {template ? <p className="fpl-recap-note is-small">The average is every FPL team's score. Most-owned XI is the 11 players picked by the most managers, with the most-captained player as captain.</p> : null}
      </div>
      <div className="fpl-recap-teams">
        <XiList title="Your XI" total={you.total} rows={you.rows} accent="lime" />
        {template ? <XiList title="Most-owned XI" sub="Stands in for the average team" total={template.total} rows={template.rows} /> : null}
        {top ? <XiList title={`Highest: ${top.name}`} sub="Top score this gameweek" total={top.total} rows={top.rows} /> : null}
      </div>
    </div>
  );
}

// The season's overall rank as a line (higher is better) and points per
// gameweek as bars. Hovering (or touching) either shows the exact value.
function RankCharts({ r }) {
  const [lineAt, setLineAt] = useState(null);
  const [barAt, setBarAt] = useState(null);
  const ranked = r.series.filter(s => s.overallRank);
  const W = 560;
  const H = 150;
  let line = null;
  if (ranked.length >= 2) {
    const ranks = ranked.map(s => s.overallRank);
    const lo = Math.min(...ranks);
    const hi = Math.max(...ranks);
    const y = v => (hi === lo ? H / 2 : ((v - lo) / (hi - lo)) * H);
    const x = i => (i / (ranked.length - 1)) * W;
    const pts = ranked.map((s, i) => `${Math.round(x(i))},${Math.round(y(s.overallRank))}`).join(' ');
    const last = ranked[ranked.length - 1];
    // The point nearest the pointer, across the chart's width.
    const pick = e => {
      const box = e.currentTarget.getBoundingClientRect();
      const rel = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
      setLineAt(Math.round(rel * (ranked.length - 1)));
    };
    const at = lineAt !== null ? ranked[lineAt] : null;
    line = (
      <div className="fpl-recap-card">
        <p className="fpl-recap-h3"><span>Overall rank this season</span><span>Best {n(lo)}</span></p>
        <div className="fpl-recap-plot" onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setLineAt(null)}>
          <svg viewBox={`-8 -8 ${W + 16} ${H + 16}`} className="fpl-recap-chart" role="img" aria-label={`Overall rank by gameweek: ${ranked.map(s => `GW${s.event} ${n(s.overallRank)}`).join(', ')}`}>
            <line x1="0" x2={W} y1={H} y2={H} stroke="rgba(255,255,255,0.15)" />
            <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="rgba(255,255,255,0.08)" />
            {at ? <line x1={x(lineAt)} x2={x(lineAt)} y1="0" y2={H} stroke="rgba(255,255,255,0.3)" strokeDasharray="3 4" /> : null}
            <polyline points={pts} fill="none" stroke="var(--blue)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={W} cy={Math.round(y(last.overallRank))} r="6" fill="var(--lime)" />
            {at ? <circle cx={x(lineAt)} cy={y(at.overallRank)} r="6" fill="var(--ink)" stroke="var(--blue)" strokeWidth="3" /> : null}
          </svg>
          {at ? (
            <span className="fpl-recap-tip fpl-mono" style={{ left: `${(lineAt / (ranked.length - 1)) * 100}%`, top: `${(y(at.overallRank) / H) * 100}%` }}>
              GW{at.event} · {n(at.overallRank)}
            </span>
          ) : null}
        </div>
        <p className="fpl-recap-axis fpl-mono"><span>GW{ranked[0].event}</span><span>GW{last.event}</span></p>
      </div>
    );
  }
  const most = Math.max(1, ...r.series.map(s => s.points || 0));
  const bar = barAt !== null ? r.series[barAt] : null;
  return (
    <>
      {line}
      {r.series.length >= 2 ? (
        <div className="fpl-recap-card">
          <p className="fpl-recap-h3"><span>Points each gameweek</span>{r.averagePoints ? <span>Average {r.averagePoints}</span> : null}</p>
          <div className="fpl-recap-cols" role="img" aria-label={`Points by gameweek: ${r.series.map(s => `GW${s.event} ${s.points}`).join(', ')}`} onPointerLeave={() => setBarAt(null)}>
            {r.series.map((s, i) => (
              <span key={s.event} className={`${i === r.series.length - 1 ? 'is-now' : ''}${i === barAt ? ' is-hover' : ''}`} style={{ '--v': (s.points || 0) / most }}
                onPointerEnter={() => setBarAt(i)} onPointerDown={() => setBarAt(i)} />
            ))}
            {bar ? (
              <span className="fpl-recap-tip fpl-mono" style={{ left: `${((barAt + 0.5) / r.series.length) * 100}%`, top: `${(1 - (bar.points || 0) / most) * 100}%` }}>
                GW{bar.event} · {bar.points} pts
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function Rank({ recap, wide }) {
  const r = recap.rank;
  const main = (
    <>
      <h2 className="fpl-recap-title">Your overall rank</h2>
      <div className="fpl-recap-stack">
        {r.before ? <s className="fpl-mono fpl-recap-was">{n(r.before)}</s> : null}
        <b className="fpl-mono fpl-recap-now">{n(r.now)}</b>
      </div>
      {r.move ? (
        <span className={`fpl-recap-pill ${r.move > 0 ? 'is-green' : 'is-red'}`}>
          {r.move > 0 ? <ArrowUp size={16} aria-hidden="true" /> : <ArrowDown size={16} aria-hidden="true" />}
          {n(Math.abs(r.move))} place{Math.abs(r.move) === 1 ? '' : 's'}
        </span>
      ) : null}
      {wide ? (
        <div className="fpl-recap-grid2">
          {r.gwRank ? <Stat label="Gameweek rank">{n(r.gwRank)}</Stat> : null}
          {r.topPercent ? <Stat label="Top">{r.topPercent}%</Stat> : null}
          {r.totalPoints ? <Stat label="Total points">{n(r.totalPoints)}</Stat> : null}
          {r.value ? <Stat label="Team value">{fmtPrice(r.value)}</Stat> : null}
        </div>
      ) : r.gwRank ? (
        <div className="fpl-recap-card fpl-recap-grid2">
          <div><span>Gameweek rank</span><b className="fpl-mono">{n(r.gwRank)}</b></div>
          {r.topPercent ? <div><span>Top</span><b className="fpl-mono">{r.topPercent}%</b></div> : null}
        </div>
      ) : null}
      {r.bestSince ? <p className="fpl-recap-note">{r.bestSince === 'season' ? 'Your best week of the season.' : `Your best week since Gameweek ${r.bestSince}.`}</p> : null}
    </>
  );
  if (!wide || r.series.length < 2) return main;
  return (
    <div className="fpl-recap-wide" style={{ '--cols': '340px minmax(0, 1fr)' }}>
      <div className="fpl-recap-col">{main}</div>
      <div className="fpl-recap-col"><RankCharts r={r} /></div>
    </div>
  );
}

function Captain({ recap, wide }) {
  const c = recap.captain;
  const main = (
    <>
      <h2 className="fpl-recap-title">Captain call</h2>
      <div className="fpl-recap-card">
        <div className="fpl-recap-cap">
          <span className="fpl-recap-badge" aria-hidden="true">C</span>
          <div><b>{c.name}</b>{c.chips.length ? <small>{c.chips.join(', ')}</small> : null}</div>
        </div>
        <p className="fpl-recap-capline"><b className="fpl-mono">{c.points}</b><span className="fpl-mono">{c.base} × {c.multiplier}</span></p>
        {c.viceTookOver ? <p className="fpl-recap-note">{c.viceTookOver} didn't play, so the armband passed to {c.name}.</p> : null}
      </div>
      {wide ? (
        <div className="fpl-recap-grid2">
          {c.vice ? <Stat label="Vice-captain">{c.vice.name} {c.vice.points}</Stat> : null}
          <Stat label="Predicted as captain">{fmtPts(c.predicted)}</Stat>
        </div>
      ) : (
        <div className="fpl-recap-grid2">
          {c.vice ? <div className="fpl-recap-card fpl-recap-mini"><span>Vice-captain</span><b>{c.vice.name}</b><b className="fpl-mono">{c.vice.points} pts</b></div> : null}
          <div className="fpl-recap-card fpl-recap-mini"><span>Best in your XI</span><b>{c.best.name}</b><b className="fpl-mono">{c.best.points} pts</b></div>
        </div>
      )}
      <span className={`fpl-recap-pill ${c.missed ? 'is-yellow' : 'is-green'}`}>
        {c.missed ? `${c.best.name} would have added ${c.missed} more` : 'You picked the right captain'}
      </span>
    </>
  );
  if (!wide) return main;
  const most = Math.max(1, ...c.options.map(o => o.points));
  return (
    <div className="fpl-recap-wide" style={{ '--cols': '380px minmax(0, 1fr)' }}>
      <div className="fpl-recap-col">{main}</div>
      <div className="fpl-recap-col">
        <div className="fpl-recap-card">
          <p className="fpl-recap-h3"><span>If you'd captained…</span><span>Points × {c.multiplier}</span></p>
          {c.options.map(o => (
            <Bar key={o.id} label={o.isYours ? `${o.name} (C)` : o.name} value={o.points} max={most}
              color={o.isYours ? 'var(--lime)' : o.name === c.best.name && c.missed ? 'var(--yellow)' : 'rgba(255,255,255,0.45)'} />
          ))}
        </div>
        <div className="fpl-recap-grid2">
          {c.league ? (
            <div className="fpl-recap-card fpl-recap-mini">
              <p className="fpl-recap-h3"><span>In {c.league.leagueName}</span></p>
              <b>{c.league.top[0].name} captained by {c.league.top[0].count} of {c.league.counted}</b>
              {c.league.top.length > 1 ? <small>{c.league.top.slice(1).map(t => `${t.name} by ${t.count}`).join(' · ')}</small> : null}
            </div>
          ) : null}
          {c.fplCaptain || c.topPlayer ? (
            <div className="fpl-recap-card fpl-recap-mini">
              <p className="fpl-recap-h3"><span>Across FPL</span></p>
              {c.fplCaptain ? <b>Most captained: {c.fplCaptain}</b> : null}
              {c.topPlayer ? <small>Top scorer this week: {c.topPlayer.name}, {c.topPlayer.points} pts</small> : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PlayerCard({ p, kind, wide }) {
  const isStar = kind === 'star';
  return (
    <div className={`fpl-recap-card fpl-recap-sf ${isStar ? 'is-star' : 'is-flop'}`}>
      <span className="fpl-recap-kicker">{isStar ? <Star size={15} aria-hidden="true" /> : <ArrowDown size={15} aria-hidden="true" />}{isStar ? 'Star' : 'Flop'}</span>
      <p className="fpl-recap-sf-head"><b>{p.name}{wide && p.club ? <small className="fpl-recap-club"> {p.club}</small> : null}</b><b className="fpl-mono">{p.points}</b></p>
      <div className={wide ? 'fpl-recap-grid3' : 'fpl-recap-grid2 fpl-recap-facts'}>
        {wide ? (
          <>
            <Stat label="Predicted">{fmtPts(p.predicted)} <small className={tone(p.diff)}>{signed1(p.diff)}</small></Stat>
            <Stat label="Value">{typeof p.price === 'number' ? fmtPrice(p.price) : '–'}</Stat>
            <Stat label="Owned by">{p.ownership !== null ? `${p.ownership}%` : '–'}</Stat>
          </>
        ) : (
          <>
            <div><span>Predicted</span><b className="fpl-mono">{fmtPts(p.predicted)} <small className={tone(p.diff)}>{signed1(p.diff)}</small></b></div>
            <div><span>Value</span><b className="fpl-mono">{typeof p.price === 'number' ? fmtPrice(p.price) : '–'}</b></div>
          </>
        )}
      </div>
      {wide ? (
        <>
          <div className="fpl-recap-grid4">{p.stats.map(([label, v]) => <Stat key={label} label={label}>{v}</Stat>)}</div>
          <Fixtures list={p.next} />
        </>
      ) : <Chips list={p.chips} />}
    </div>
  );
}

function StarFlop({ recap, wide }) {
  const sf = recap.starFlop;
  if (!wide) {
    return (
      <>
        <h2 className="fpl-recap-title">Star and flop</h2>
        <PlayerCard p={sf.star} kind="star" />
        <PlayerCard p={sf.flop} kind="flop" />
      </>
    );
  }
  return (
    <>
      <h2 className="fpl-recap-title">Star and flop</h2>
      <div className="fpl-recap-wide" style={{ '--cols': '1fr 1fr' }}>
        <PlayerCard p={sf.star} kind="star" wide />
        <PlayerCard p={sf.flop} kind="flop" wide />
      </div>
      {sf.rest.length ? (
        <div className="fpl-recap-card fpl-recap-rest">
          <span className="fpl-recap-h3">Rest of your XI</span>
          {sf.rest.map(r => <span key={r.id} className="fpl-recap-tag"><b>{r.name}</b> <span className="fpl-mono">{r.points}</span></span>)}
        </div>
      ) : null}
    </>
  );
}

const MAX_MOVES = 4;
function Transfers({ recap, wide }) {
  const t = recap.transfers;
  if (!t.moves.length) {
    return (
      <>
        <h2 className="fpl-recap-title">Transfers verdict</h2>
        <div className="fpl-recap-card"><p className="fpl-recap-note">No transfers this week: you rolled your free transfer.</p></div>
        {wide && t.seasonTransfers !== null ? (
          <div className="fpl-recap-grid2 fpl-recap-narrow">
            <Stat label="Transfers this season">{t.seasonTransfers}</Stat>
            {t.seasonHits ? <Stat label="Hits taken">{t.seasonHits.count}{t.seasonHits.points ? ` (−${t.seasonHits.points})` : ''}</Stat> : null}
          </div>
        ) : null}
      </>
    );
  }
  const shown = t.moves.slice(0, MAX_MOVES);
  const list = (
    <ul className="fpl-recap-card fpl-recap-moves">
      {shown.map(m => (
        <li key={`${m.out.id}-${m.in.id}`}>
          <span><small className="is-down">Out</small><b>{m.out.name}</b><span className="fpl-mono">{m.out.points} pts{wide && m.out.price ? <i> · {fmtPrice(m.out.price)}</i> : null}</span></span>
          <ArrowRight size={20} aria-hidden="true" />
          <span><small className="is-up">In</small><b>{m.in.name}</b><span className="fpl-mono">{m.in.points} pts{wide && m.in.price ? <i> · {fmtPrice(m.in.price)}</i> : null}</span>{wide ? <Fixtures list={m.in.next} label="" /> : null}</span>
        </li>
      ))}
      {t.moves.length > shown.length ? <li className="fpl-recap-more">and {t.moves.length - shown.length} more</li> : null}
    </ul>
  );
  const sum = (
    <dl className="fpl-recap-card fpl-recap-sum">
      <div><dt>Players in</dt><dd className="fpl-mono">{t.pointsIn}</dd></div>
      <div><dt>Players out</dt><dd className="fpl-mono">−{t.pointsOut}</dd></div>
      {t.hit ? <div><dt>Hit</dt><dd className="fpl-mono">−{t.hit}</dd></div> : null}
      <div className="fpl-recap-net"><dt>Net</dt><dd className={`fpl-mono ${tone(t.net)}`}>{signed(t.net)}</dd></div>
    </dl>
  );
  if (!wide) {
    return (
      <>
        <h2 className="fpl-recap-title">Transfers verdict</h2>
        {t.chip ? <p className="fpl-recap-note">{t.chip === 'wildcard' ? 'Wildcard week.' : 'Free Hit week.'}</p> : null}
        {list}
        {sum}
      </>
    );
  }
  const ahead = t.nextIn !== null && t.nextOut !== null ? round1(t.nextIn - t.nextOut) : null;
  return (
    <div className="fpl-recap-wide" style={{ '--cols': 'minmax(0, 1.15fr) minmax(0, 1fr)' }}>
      <div className="fpl-recap-col">
        <h2 className="fpl-recap-title">Transfers verdict</h2>
        {t.chip ? <p className="fpl-recap-note">{t.chip === 'wildcard' ? 'Wildcard week.' : 'Free Hit week.'}</p> : null}
        {list}
        <p className="fpl-recap-note is-small">Prices now, and the next 3 fixtures for each player you brought in.</p>
      </div>
      <div className="fpl-recap-col">
        {sum}
        {ahead !== null ? (
          <div className="fpl-recap-card">
            <p className="fpl-recap-h3"><span>Next 3 gameweeks, predicted</span></p>
            <Bar label="Players in" value={t.nextIn} max={Math.max(t.nextIn, t.nextOut, 1)} color="var(--green)" />
            <Bar label="Players out" value={t.nextOut} max={Math.max(t.nextIn, t.nextOut, 1)} color="#FF8A8A" />
            <p className={`fpl-recap-note is-small ${tone(ahead)}`}>{ahead > 0 ? `${fmtPts(ahead)} pts ahead of the players you sold.` : ahead < 0 ? `${fmtPts(-ahead)} pts behind the players you sold.` : 'Level with the players you sold.'}</p>
          </div>
        ) : null}
        {t.seasonTransfers !== null ? (
          <div className="fpl-recap-grid2">
            <Stat label="Transfers this season">{t.seasonTransfers}</Stat>
            {t.seasonHits ? <Stat label="Hits taken">{t.seasonHits.count}{t.seasonHits.points ? ` (−${t.seasonHits.points})` : ''}</Stat> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
// The league picker: one button per mini-league, with your rank.
function LeagueTabs({ leagues, selected, onSelect }) {
  if (!leagues || leagues.length < 2) return null;
  return (
    <div className="fpl-recap-tabs" role="group" aria-label="League">
      {leagues.map(l => (
        <button key={l.id} type="button" className={l.id === selected ? 'is-on' : ''} aria-pressed={l.id === selected} onClick={() => onSelect(l.id)}>
          {l.name}{l.rank ? <small className="fpl-mono">{ordinal(l.rank)}</small> : null}
        </button>
      ))}
    </div>
  );
}

// The tabs stay in one place while the league below them changes, so the
// one just pressed keeps focus.
function League({ recap, wide, league }) {
  return (
    <>
      <LeagueTabs leagues={league.leagues} selected={league.selected} onSelect={league.onSelect} />
      <LeagueBody recap={recap} wide={wide} state={league.state} />
    </>
  );
}

function LeagueBody({ recap, wide, state }) {
  if (!state || state.status !== 'ready' || !state.data) {
    return (
      <>
        <div className="fpl-recap-card" role={state && state.status === 'loading' ? 'status' : undefined}>
          {state && state.status === 'loading'
            ? <><span className="fpl-skel" aria-hidden="true" /><span className="fpl-skel" aria-hidden="true" /><span className="fpl-sr-only">Loading the league…</span></>
            : <p className="fpl-recap-note" role="alert">Couldn't load that league. Try another, or try again later.</p>}
        </div>
      </>
    );
  }
  const l = state.data;
  const move = l.was ? l.was - l.now : 0;
  const head = (
    <div className="fpl-recap-move">
      {l.was ? <div><span>Was</span><b className="fpl-mono fpl-recap-was">{ordinal(l.was)}</b></div> : null}
      {l.was ? <ArrowRight size={24} aria-hidden="true" className={tone(move)} /> : null}
      <div><span>Now</span><b className="fpl-mono fpl-recap-now is-lime">{ordinal(l.now)}</b></div>
    </div>
  );
  const rival = l.rival.margin > 0 ? `You beat ${l.rival.teamName}, your nearest rival, by ${l.rival.margin}.`
    : l.rival.margin < 0 ? `${l.rival.teamName}, your nearest rival, beat you by ${-l.rival.margin}.`
      : `You and ${l.rival.teamName}, your nearest rival, scored the same.`;
  if (!wide) {
    return (
      <>
        <h2 className="fpl-recap-title">{l.name}<small>{l.size}{l.hasMore ? '+' : ''} managers</small></h2>
        {head}
        <ol className="fpl-recap-card fpl-recap-table">
          <li className="fpl-recap-th" aria-hidden="true"><span>#</span><span>Team</span><span>GW</span><span>Total</span></li>
          {l.rows.map(r => (
            <li key={r.entry} className={r.isYou ? 'is-you' : ''}>
              <span className="fpl-mono">{r.rank}</span><b>{r.isYou ? `${r.teamName} (you)` : r.teamName}</b>
              <span className="fpl-mono">{r.eventTotal}</span><span className="fpl-mono">{n(r.total)}</span>
            </li>
          ))}
        </ol>
        <div className="fpl-recap-grid2">
          <div className="fpl-recap-card fpl-recap-mini"><span>Week winner</span><b>{l.winners.slice(0, 2).join(', ')}{l.winners.length > 2 ? ` +${l.winners.length - 2}` : ''}</b><b className="fpl-mono">{l.winnerPoints} pts</b></div>
          <div className="fpl-recap-card fpl-recap-mini">{l.gapToFirst ? <><span>Gap to 1st</span><b>{l.leaderName}</b><b className="fpl-mono">{l.gapToFirst} pts</b></> : <><span>Top of the league</span><b>You</b></>}</div>
        </div>
        <p className="fpl-recap-note">{rival}</p>
      </>
    );
  }
  return (
    <div className="fpl-recap-wide" style={{ '--cols': 'minmax(0, 1.35fr) minmax(0, 1fr)' }}>
      <div className="fpl-recap-col">
        <div className="fpl-recap-card fpl-recap-tablecard">
          <table className="fpl-recap-ltable">
            <caption className="fpl-sr-only">{l.name}</caption>
            <thead><tr><th scope="col">Team</th><th scope="col">GW{recap.gwId}</th><th scope="col">Total</th><th scope="col">Move</th></tr></thead>
            <tbody>
              {l.table.map(r => (
                <tr key={r.entry} className={r.isYou ? 'is-you' : ''}>
                  <th scope="row"><span className="fpl-mono">{r.rank}</span>{r.isYou ? `${r.teamName} (you)` : r.teamName}</th>
                  <td className={r.isYou ? 'is-lime' : ''}>{r.eventTotal}</td>
                  <td>{n(r.total)}</td>
                  <td className={tone(r.move)}>{r.move > 0 ? `▲${r.move}` : r.move < 0 ? `▼${-r.move}` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fpl-recap-note is-small">{l.name} · {l.size}{l.hasMore ? '+' : ''} managers{l.size > l.table.length ? `, showing ${l.table.length} around you` : ''}</p>
        </div>
      </div>
      <div className="fpl-recap-col">
        {head}
        <div className="fpl-recap-grid2">
          <Stat label="Week winner">{l.winners.slice(0, 1).join('')}{l.winners.length > 1 ? ` +${l.winners.length - 1}` : ''} · {l.winnerPoints}</Stat>
          <Stat label="Gap to 1st">{l.gapToFirst ? `${l.gapToFirst} pts` : 'You lead'}</Stat>
          {l.riser ? <Stat label="Biggest riser">{l.riser.teamName} ▲{l.riser.move}</Stat> : null}
          {l.topCaptain ? <Stat label="Most captained">{l.topCaptain.name} {l.topCaptain.count}/{l.captainsCounted}</Stat> : null}
        </div>
        <div className="fpl-recap-card fpl-recap-mini">
          <p className="fpl-recap-h3"><span>Nearest rival</span></p>
          <b>{l.rival.teamName}</b>
          <small>{rival} {l.rival.totalGap > 0 ? `You're ${l.rival.totalGap} pts ahead.` : l.rival.totalGap < 0 ? `You're ${-l.rival.totalGap} pts behind.` : 'You\'re level on points.'}</small>
        </div>
      </div>
    </div>
  );
}

function VsModel({ recap, wide }) {
  const v = recap.vsModel;
  const main = (
    <>
      <h2 className="fpl-recap-title">You vs the model</h2>
      <p className="fpl-recap-big"><b className="fpl-mono">{v.percent}%</b> of perfect</p>
      <div className="fpl-recap-card">
        <Bar label="You" value={v.you} max={v.best} color="var(--lime)" />
        {v.model !== null ? <Bar label="Best squad" value={v.model} max={v.best} color="var(--blue)" /> : null}
        <Bar label="Best XI" value={v.best} max={v.best} color="var(--ink)" />
      </div>
      {v.model !== null ? (
        <span className={`fpl-recap-pill ${v.you >= v.model ? 'is-green' : 'is-yellow'}`}>
          {v.you > v.model ? `You beat the app's best squad by ${v.you - v.model}` : v.you < v.model ? `The app's best squad beat you by ${v.model - v.you}` : 'You tied with the app\'s best squad'}
        </span>
      ) : null}
      <p className="fpl-recap-note is-small">The best XI is hindsight: the top-scoring 11 anyone could have picked within £100m.</p>
    </>
  );
  if (!wide) return main;
  return (
    <div className="fpl-recap-wide" style={{ '--cols': '300px minmax(0, 1fr)' }}>
      <div className="fpl-recap-col">{main}</div>
      <div className="fpl-recap-teams">
        <XiList title="Your XI" total={v.you} rows={v.teams.you} accent="lime" />
        {v.teams.model ? <XiList title="App's best squad" sub="Picked before the deadline" total={v.model} rows={v.teams.model} accent="blue" /> : null}
        {v.teams.best ? <XiList title="Best possible XI" sub="Hindsight" total={v.best} rows={v.teams.best} /> : null}
      </div>
    </div>
  );
}

const VERDICTS = { close: 'Close', usual: 'Usual', off: 'Off', 'way-off': 'Way off', dnp: "Didn't play" };
const COMPARED = { smaller: 'smaller than usual', usual: 'about usual', bigger: 'bigger than usual', 'much-bigger': 'much bigger than usual' };

function Verdict({ v }) {
  return v ? <span className={`fpl-recap-verdict is-${v}`}>{VERDICTS[v]}</span> : null;
}

function PredRow({ r, bench, withRange }) {
  return (
    <tr className={bench ? 'is-bench' : ''}>
      <th scope="row">{r.name}{r.isCaptain ? ' (C)' : ''}</th>
      <td className="fpl-mono is-dim">{r.pos}</td>
      <td className="fpl-mono">{fmtPts(r.predicted)}</td><td className="fpl-mono">{r.actual}</td>
      <td className={`fpl-mono ${tone(r.diff)}`}>{r.diff === 0 ? '0.0' : signed1(r.diff)}</td>
      <td className="fpl-mono is-dim">{r.minutes ?? '–'}</td>
      {withRange ? <td><Verdict v={r.verdict} /></td> : null}
    </tr>
  );
}

// Where misses usually fall this week, from every player's: the bands a
// player's miss is judged against.
function MissRange({ p }) {
  if (!p.range) return null;
  const { p50, p80, p90 } = p.range;
  return (
    <div className="fpl-recap-card fpl-recap-range">
      <p className="fpl-recap-h3"><span>Usual range of a miss</span><span>Half within ±{fmtPts(p50)}, 8 in 10 within ±{fmtPts(p80)}</span></p>
      <div className="fpl-recap-bands" aria-hidden="true">
        <span className="is-close" /><span className="is-usual" /><span className="is-off" /><span className="is-way-off" />
      </div>
      <dl className="fpl-recap-bandkey">
        <div><dt><Verdict v="close" /></dt><dd className="fpl-mono">±{fmtPts(p50)}</dd></div>
        <div><dt><Verdict v="usual" /></dt><dd className="fpl-mono">±{fmtPts(p80)}</dd></div>
        <div><dt><Verdict v="off" /></dt><dd className="fpl-mono">±{fmtPts(p90)}</dd></div>
        <div><dt><Verdict v="way-off" /></dt><dd className="fpl-mono">&gt;{fmtPts(p90)}</dd></div>
      </dl>
    </div>
  );
}

function Predictions({ recap, wide }) {
  const p = recap.predictions;
  const totals = (
    <div className="fpl-recap-grid2">
      <div className="fpl-recap-card fpl-recap-mini"><span>Predicted</span><b className="fpl-mono fpl-recap-mid">{fmtPts(p.predictedTotal)}</b></div>
      <div className="fpl-recap-card fpl-recap-mini"><span>Actual</span><b className="fpl-mono fpl-recap-mid is-lime">{p.actualTotal}</b></div>
    </div>
  );
  const verdictLine = p.range ? (
    <p className="fpl-recap-note">
      <b className="fpl-mono">{p.withinUsual} of {p.judged}</b> of your players were within the usual range (±{fmtPts(p.range.p80)}).
      {p.wayOff.length ? <> Way off: {p.wayOff.join(', ')}.</> : ' None were way off.'}
    </p>
  ) : null;
  if (!wide) {
    return (
      <>
        <h2 className="fpl-recap-title">Prediction check</h2>
        {totals}
        {verdictLine}
        <table className="fpl-recap-card fpl-recap-preds">
          <thead><tr><th scope="col">Player</th><th scope="col">Pred</th><th scope="col">Got</th><th scope="col">Diff</th></tr></thead>
          <tbody>
            {p.rows.map(r => (
              <tr key={r.id} className={r.verdict === 'way-off' ? 'is-way-off' : ''}>
                <th scope="row">{r.name}{r.isCaptain ? ' (C)' : ''}</th>
                <td className="fpl-mono">{fmtPts(r.predicted)}</td><td className="fpl-mono">{r.actual}</td>
                <td className={`fpl-mono ${tone(r.diff)}`}>{r.diff === 0 ? '0.0' : signed1(r.diff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="fpl-recap-note is-small">Points before the captain's armband; the totals include it.{p.range ? ' Highlighted rows were way off.' : ''}</p>
      </>
    );
  }
  return (
    <div className="fpl-recap-wide" style={{ '--cols': '360px minmax(0, 1fr)' }}>
      <div className="fpl-recap-col">
        <h2 className="fpl-recap-title">Prediction check</h2>
        {totals}
        <div className="fpl-recap-grid2">
          <Stat label="Typical miss, your XI" className={p.missCompared === 'bigger' || p.missCompared === 'much-bigger' ? 'is-down' : p.missCompared ? 'is-up' : ''}>±{fmtPts(p.typicalMiss)}</Stat>
          {p.allPlayers ? <Stat label="Typical miss, all players">±{fmtPts(p.allPlayers.typicalMiss)}</Stat> : null}
        </div>
        {p.missCompared ? <p className="fpl-recap-note is-small">Your XI's misses were {COMPARED[p.missCompared]} this week.</p> : null}
        <MissRange p={p} />
        {verdictLine}
      </div>
      <div className="fpl-recap-card fpl-recap-tablecard">
        <table className="fpl-recap-ltable fpl-recap-ptable">
          <thead><tr><th scope="col">Player</th><th scope="col">Pos</th><th scope="col">Pred</th><th scope="col">Got</th><th scope="col">Diff</th><th scope="col">Mins</th>{p.range ? <th scope="col">Range</th> : null}</tr></thead>
          <tbody>
            {p.rows.map(r => <PredRow key={r.id} r={r} withRange={!!p.range} />)}
            {p.bench.length ? <tr className="fpl-recap-benchrow"><th scope="rowgroup" colSpan={p.range ? 7 : 6}>Bench</th></tr> : null}
            {p.bench.map(r => <PredRow key={r.id} r={r} bench withRange={!!p.range} />)}
          </tbody>
        </table>
        {p.allPlayers ? <p className="fpl-recap-note is-small">The app's top 10 picks scored {fmtPts(p.allPlayers.topTen)} each this week; the average player scored {fmtPts(p.allPlayers.average)}.</p> : null}
      </div>
    </div>
  );
}

function ShareSlide({ recap, wide }) {
  const [status, setStatus] = useState('');
  const h = recap.headline;
  async function run(mode) {
    setStatus('Making the image…');
    try {
      const { drawRecapCard, shareCard, downloadCard } = await import('../lib/shareCard.js');
      const canvas = await drawRecapCard({ recap, siteUrl: window.location.host });
      const fileName = `fpl-gw${recap.gwId}-recap.png`;
      const result = mode === 'share' ? await shareCard(canvas, { title: `${recap.teamName}: ${recap.gwName}`, fileName }) : await downloadCard(canvas, fileName);
      setStatus(result === 'shared' ? 'Shared.' : result === 'downloaded' ? 'Image saved.' : '');
    } catch {
      setStatus("Couldn't make the image. Try again.");
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(recapText(recap));
      setStatus('Copied.');
    } catch {
      setStatus("Couldn't copy. Select the text and copy it instead.");
    }
  }
  const card = (
    <div className="fpl-recap-share">
      <div className="fpl-recap-share-in">
        <p className="fpl-recap-share-top"><b>{recap.teamName}</b><span className="fpl-mono">{recap.gwName.toUpperCase()}</span></p>
        <p className="fpl-recap-share-pts">
          <b className="fpl-mono">{h.points}</b><span>pts</span>
          {h.vsAverage !== null ? <span className={`fpl-recap-pill ${h.vsAverage >= 0 ? 'is-lime' : 'is-red'}`}>{signed(h.vsAverage)} vs avg</span> : null}
        </p>
        <dl className="fpl-recap-grid2 fpl-recap-share-facts">
          {recap.rank ? <div><dt>Overall rank</dt><dd className="fpl-mono">{n(recap.rank.now)}{recap.rank.move ? <span className={tone(recap.rank.move)}>{recap.rank.move > 0 ? ' ▲' : ' ▼'}</span> : null}</dd></div> : null}
          {recap.captain ? <div><dt>Captain</dt><dd className="fpl-mono">{recap.captain.name} {recap.captain.points}</dd></div> : null}
          {recap.starFlop ? <div><dt>Star</dt><dd className="fpl-mono">{recap.starFlop.star.name} {recap.starFlop.star.points}</dd></div> : null}
          {recap.league ? <div><dt>Mini-league</dt><dd className="fpl-mono">{recap.league.was ? `${ordinal(recap.league.was)} → ` : ''}{ordinal(recap.league.now)}</dd></div> : null}
        </dl>
        {recap.rank && recap.rank.topPercent ? <p className="fpl-recap-share-foot fpl-mono">Top {recap.rank.topPercent}% this week</p> : null}
      </div>
    </div>
  );
  const buttons = (
    <div className="fpl-recap-grid2">
      <button type="button" className="fpl-recap-btn" onClick={() => run('share')}><Share2 size={18} aria-hidden="true" /> Share</button>
      <button type="button" className="fpl-recap-btn" onClick={() => run('save')}><Download size={18} aria-hidden="true" /> Save image</button>
    </div>
  );
  if (!wide) {
    return (
      <>
        {card}
        {buttons}
        <p className="fpl-recap-note" role="status">{status}</p>
      </>
    );
  }
  return (
    <div className="fpl-recap-wide" style={{ '--cols': '1fr 1fr' }}>
      <div className="fpl-recap-sharewrap">{card}</div>
      <div className="fpl-recap-col">
        <h2 className="fpl-recap-title">Share your week</h2>
        <p className="fpl-recap-note is-small">Saved as a 1080 × 1350 image, the size Instagram, WhatsApp and Discord show best.</p>
        {buttons}
        <div className="fpl-recap-card">
          <p className="fpl-recap-h3"><span>Or copy as text</span></p>
          <p className="fpl-recap-copytext fpl-mono">{recapText(recap)}</p>
          <button type="button" className="fpl-recap-btn" onClick={copy}><Copy size={16} aria-hidden="true" /> Copy text</button>
        </div>
        <p className="fpl-recap-note" role="status">{status}</p>
      </div>
    </div>
  );
}

const SLIDES = [
  { key: 'headline', Slide: Headline },
  { key: 'rank', Slide: Rank },
  { key: 'captain', Slide: Captain },
  { key: 'starFlop', Slide: StarFlop },
  { key: 'transfers', Slide: Transfers },
  { key: 'league', Slide: League },
  { key: 'vsModel', Slide: VsModel },
  { key: 'predictions', Slide: Predictions },
  { key: 'share', Slide: ShareSlide },
];

const LEAGUE_KEY = 'fpl_league_id';

export function GwRecap({ gwId, state, onClose, onRetry, onLoadLeague }) {
  const dialogRef = useRef(null);
  const bodyRef = useRef(null);
  const wide = useWide();
  const [index, setIndex] = useState(0);
  const recap = state.status === 'ready' ? state.data : null;
  const slides = recap ? SLIDES.filter(s => s.key === 'share' || recap[s.key]) : [];
  const at = Math.min(index, Math.max(0, slides.length - 1));
  const Current = slides[at] ? slides[at].Slide : null;

  // The league picked on the mini-league slide, and each one loaded so far.
  const [leaguePick, setLeaguePick] = useState(null);
  const [leagueData, setLeagueData] = useState({});
  const firstLeague = recap && recap.league ? recap.league : null;
  const selectedLeague = leaguePick || (firstLeague ? firstLeague.id : null);
  const leagueState = firstLeague && selectedLeague === firstLeague.id && !leagueData[selectedLeague]
    ? { status: 'ready', data: firstLeague } : leagueData[selectedLeague];
  function selectLeague(id) {
    setLeaguePick(id);
    try { localStorage.setItem(LEAGUE_KEY, String(id)); } catch { /* private mode */ }
    if (leagueData[id] || (firstLeague && id === firstLeague.id)) return;
    setLeagueData(d => ({ ...d, [id]: { status: 'loading', data: null } }));
    onLoadLeague(id)
      .then(data => setLeagueData(d => ({ ...d, [id]: { status: data ? 'ready' : 'error', data } })))
      .catch(() => setLeagueData(d => ({ ...d, [id]: { status: 'error', data: null } })));
  }
  const league = { leagues: recap ? recap.leagues : [], selected: selectedLeague, onSelect: selectLeague, state: leagueState };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog && dialog.open) dialog.close(); };
  }, []);

  // Each slide starts at its top. A control on the old slide that had
  // focus is gone, so focus goes back to the recap for the arrow keys.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
  }, [at]);

  const go = step => setIndex(Math.max(0, Math.min(slides.length - 1, at + step)));
  function onKeyDown(e) {
    if (!recap) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
  }

  const last = at === slides.length - 1;
  return (
    <dialog
      ref={dialogRef}
      className={`fpl-recap${wide ? ' is-wide' : ''}`}
      tabIndex={-1}
      aria-labelledby="recap-h"
      onCancel={e => { e.preventDefault(); onClose(); }}
      onKeyDown={onKeyDown}
    >
      <div className="fpl-recap-frame">
        <div className="fpl-recap-segs" aria-hidden="true">
          {(slides.length ? slides : SLIDES).map((s, i) => <span key={s.key} className={recap && i <= at ? 'on' : ''} />)}
        </div>
        <div className="fpl-recap-head">
          <p id="recap-h" className="fpl-mono">GW{gwId} recap{slides.length ? ` · ${at + 1}/${slides.length}` : ''}</p>
          <button type="button" className="fpl-recap-close" aria-label="Close recap" onClick={onClose}><X size={18} aria-hidden="true" /></button>
        </div>
        <div ref={bodyRef} className="fpl-recap-body" aria-live="polite">
          {state.status === 'loading' && (
            <div className="fpl-recap-slide" role="status">
              <span className="fpl-skel fpl-skel-lg" aria-hidden="true" />
              <span className="fpl-skel" aria-hidden="true" />
              <span className="fpl-skel" aria-hidden="true" />
              <span className="fpl-sr-only">Loading your Gameweek {gwId} recap…</span>
            </div>
          )}
          {state.status === 'error' && (
            <div className="fpl-recap-slide">
              <p className="fpl-recap-note" role="alert">{state.error}</p>
              <button type="button" className="fpl-recap-btn" onClick={onRetry}><RotateCcw size={16} aria-hidden="true" /> Try again</button>
            </div>
          )}
          {Current && <div key={slides[at].key} className="fpl-recap-slide"><Current recap={recap} wide={wide} league={league} /></div>}
        </div>
        <div className="fpl-recap-nav">
          {wide ? <span className="fpl-recap-keys fpl-mono" aria-hidden="true">← → to move · Esc to close</span> : null}
          {at === 0
            ? <button type="button" className="fpl-recap-btn" onClick={onClose}>Skip</button>
            : <button type="button" className="fpl-recap-btn" onClick={() => go(-1)}>Back</button>}
          <button type="button" className="fpl-recap-btn fpl-recap-next" onClick={() => (last || !recap ? onClose() : go(1))} disabled={state.status === 'loading'}>
            {last || !recap ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
