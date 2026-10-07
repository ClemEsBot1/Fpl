// The gameweek recap: a run of full-screen slides on how your team did,
// opened by itself once a gameweek is over and from the button on Home.
// A native <dialog> opened with showModal(), for focus trapping,
// Escape-to-close and an inert page behind it.
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Download, RotateCcw, Share2, Star, X } from 'lucide-react';
import { fmtPrice, fmtPts } from '../lib/format.js';

const n = v => v.toLocaleString('en-GB');
const signed = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${n(Math.abs(v))}`;
const signed1 = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtPts(Math.abs(v))}`;
const ordinal = v => {
  const t = v % 100;
  return `${v}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] || 'th'}`;
};
const tone = v => (v > 0 ? 'is-up' : v < 0 ? 'is-down' : '');

function Chips({ list }) {
  if (!list || !list.length) return null;
  return <div className="fpl-recap-chips">{list.map(c => <span key={c}>{c}</span>)}</div>;
}

function Bar({ label, value, max, color }) {
  return (
    <div className="fpl-recap-bar">
      <span>{label}</span>
      <span className="fpl-recap-track"><span style={{ '--v': max > 0 ? Math.min(1, value / max) : 0, background: color }} /></span>
      <b className="fpl-mono">{n(value)}</b>
    </div>
  );
}

function Headline({ recap }) {
  const h = recap.headline;
  const max = Math.max(h.points, h.highest || 0, h.average || 0);
  return (
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
}

function Rank({ recap }) {
  const r = recap.rank;
  return (
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
      {r.gwRank ? (
        <div className="fpl-recap-card fpl-recap-grid2">
          <div><span>Gameweek rank</span><b className="fpl-mono">{n(r.gwRank)}</b></div>
          {r.topPercent ? <div><span>Top</span><b className="fpl-mono">{r.topPercent}%</b></div> : null}
        </div>
      ) : null}
      {r.bestSince ? <p className="fpl-recap-note">{r.bestSince === 'season' ? 'Your best week of the season.' : `Your best week since Gameweek ${r.bestSince}.`}</p> : null}
    </>
  );
}

function Captain({ recap }) {
  const c = recap.captain;
  return (
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
      <div className="fpl-recap-grid2">
        {c.vice ? <div className="fpl-recap-card fpl-recap-mini"><span>Vice-captain</span><b>{c.vice.name}</b><b className="fpl-mono">{c.vice.points} pts</b></div> : null}
        <div className="fpl-recap-card fpl-recap-mini"><span>Best in your XI</span><b>{c.best.name}</b><b className="fpl-mono">{c.best.points} pts</b></div>
      </div>
      <span className={`fpl-recap-pill ${c.missed ? 'is-yellow' : 'is-green'}`}>
        {c.missed ? `${c.best.name} would have added ${c.missed} more` : 'You picked the right captain'}
      </span>
    </>
  );
}

function PlayerCard({ p, kind }) {
  const isStar = kind === 'star';
  return (
    <div className={`fpl-recap-card fpl-recap-sf ${isStar ? 'is-star' : 'is-flop'}`}>
      <span className="fpl-recap-kicker">{isStar ? <Star size={15} aria-hidden="true" /> : <ArrowDown size={15} aria-hidden="true" />}{isStar ? 'Star' : 'Flop'}</span>
      <p className="fpl-recap-sf-head"><b>{p.name}</b><b className="fpl-mono">{p.points}</b></p>
      <div className="fpl-recap-grid2 fpl-recap-facts">
        <div><span>Predicted</span><b className="fpl-mono">{fmtPts(p.predicted)} <small className={tone(p.diff)}>{signed1(p.diff)}</small></b></div>
        <div><span>Value</span><b className="fpl-mono">{typeof p.price === 'number' ? fmtPrice(p.price) : '–'}</b></div>
      </div>
      <Chips list={p.chips} />
    </div>
  );
}

function StarFlop({ recap }) {
  return (
    <>
      <h2 className="fpl-recap-title">Star and flop</h2>
      <PlayerCard p={recap.starFlop.star} kind="star" />
      <PlayerCard p={recap.starFlop.flop} kind="flop" />
    </>
  );
}

const MAX_MOVES = 4;
function Transfers({ recap }) {
  const t = recap.transfers;
  if (!t.moves.length) {
    return (
      <>
        <h2 className="fpl-recap-title">Transfers verdict</h2>
        <div className="fpl-recap-card"><p className="fpl-recap-note">No transfers this week: you rolled your free transfer.</p></div>
      </>
    );
  }
  const shown = t.moves.slice(0, MAX_MOVES);
  return (
    <>
      <h2 className="fpl-recap-title">Transfers verdict</h2>
      {t.chip ? <p className="fpl-recap-note">{t.chip === 'wildcard' ? 'Wildcard week.' : 'Free Hit week.'}</p> : null}
      <ul className="fpl-recap-card fpl-recap-moves">
        {shown.map(m => (
          <li key={`${m.out.id}-${m.in.id}`}>
            <span><small className="is-down">Out</small><b>{m.out.name}</b><span className="fpl-mono">{m.out.points} pts</span></span>
            <ArrowRight size={20} aria-hidden="true" />
            <span><small className="is-up">In</small><b>{m.in.name}</b><span className="fpl-mono">{m.in.points} pts</span></span>
          </li>
        ))}
        {t.moves.length > shown.length ? <li className="fpl-recap-more">and {t.moves.length - shown.length} more</li> : null}
      </ul>
      <dl className="fpl-recap-card fpl-recap-sum">
        <div><dt>Players in</dt><dd className="fpl-mono">{t.pointsIn}</dd></div>
        <div><dt>Players out</dt><dd className="fpl-mono">−{t.pointsOut}</dd></div>
        {t.hit ? <div><dt>Hit</dt><dd className="fpl-mono">−{t.hit}</dd></div> : null}
        <div className="fpl-recap-net"><dt>Net</dt><dd className={`fpl-mono ${tone(t.net)}`}>{signed(t.net)}</dd></div>
      </dl>
    </>
  );
}

function League({ recap }) {
  const l = recap.league;
  const move = l.was ? l.was - l.now : 0;
  return (
    <>
      <h2 className="fpl-recap-title">{l.name}<small>{l.size}{l.hasMore ? '+' : ''} managers</small></h2>
      <div className="fpl-recap-move">
        {l.was ? <div><span>Was</span><b className="fpl-mono fpl-recap-was">{ordinal(l.was)}</b></div> : null}
        {l.was ? <ArrowRight size={24} aria-hidden="true" className={tone(move)} /> : null}
        <div><span>Now</span><b className="fpl-mono fpl-recap-now is-lime">{ordinal(l.now)}</b></div>
      </div>
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
      <p className="fpl-recap-note">
        {l.rival.margin > 0 ? `You beat ${l.rival.teamName}, your nearest rival, by ${l.rival.margin}.`
          : l.rival.margin < 0 ? `${l.rival.teamName}, your nearest rival, beat you by ${-l.rival.margin}.`
            : `You and ${l.rival.teamName}, your nearest rival, scored the same.`}
      </p>
    </>
  );
}

function VsModel({ recap }) {
  const v = recap.vsModel;
  return (
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
      <p className="fpl-recap-note">The best XI is hindsight: the top-scoring 11 anyone could have picked within £100m.</p>
    </>
  );
}

function Predictions({ recap }) {
  const p = recap.predictions;
  return (
    <>
      <h2 className="fpl-recap-title">Prediction check</h2>
      <div className="fpl-recap-grid2">
        <div className="fpl-recap-card fpl-recap-mini"><span>Predicted</span><b className="fpl-mono fpl-recap-mid">{fmtPts(p.predictedTotal)}</b></div>
        <div className="fpl-recap-card fpl-recap-mini"><span>Actual</span><b className="fpl-mono fpl-recap-mid is-lime">{p.actualTotal}</b></div>
      </div>
      <table className="fpl-recap-card fpl-recap-preds">
        <thead><tr><th scope="col">Player</th><th scope="col">Pred</th><th scope="col">Got</th><th scope="col">Diff</th></tr></thead>
        <tbody>
          {p.rows.map(r => (
            <tr key={r.id}>
              <th scope="row">{r.name}{r.isCaptain ? ' (C)' : ''}</th>
              <td className="fpl-mono">{fmtPts(r.predicted)}</td><td className="fpl-mono">{r.actual}</td>
              <td className={`fpl-mono ${tone(r.diff)}`}>{r.diff === 0 ? '0.0' : signed1(r.diff)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fpl-recap-note">Points before the captain's armband; the totals include it.</p>
    </>
  );
}

function ShareSlide({ recap }) {
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
  return (
    <>
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
      <div className="fpl-recap-grid2">
        <button type="button" className="fpl-recap-btn" onClick={() => run('share')}><Share2 size={18} aria-hidden="true" /> Share</button>
        <button type="button" className="fpl-recap-btn" onClick={() => run('save')}><Download size={18} aria-hidden="true" /> Save image</button>
      </div>
      <p className="fpl-recap-note" role="status">{status}</p>
    </>
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

export function GwRecap({ gwId, state, onClose, onRetry }) {
  const dialogRef = useRef(null);
  const bodyRef = useRef(null);
  const [index, setIndex] = useState(0);
  const recap = state.status === 'ready' ? state.data : null;
  const slides = recap ? SLIDES.filter(s => s.key === 'share' || recap[s.key]) : [];
  const at = Math.min(index, Math.max(0, slides.length - 1));
  const Current = slides[at] ? slides[at].Slide : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog && dialog.open) dialog.close(); };
  }, []);

  // Each slide starts at its top.
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [at]);

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
      className="fpl-recap"
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
          {Current && <div key={slides[at].key} className="fpl-recap-slide"><Current recap={recap} /></div>}
        </div>
        <div className="fpl-recap-nav">
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
