// A player's profile, opened from anywhere a player is listed
// (openPlayerProfile in src/lib/playerProfile.js): his photo, price and
// form, every match this season with what was predicted for it and how far
// off it was, his next fixtures with their predictions, and his past
// seasons.
import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Shirt } from './Pitch.jsx';
import { fetchFplJson } from '../lib/fplClient.js';
import { DIFF_COLORS, availClass, fmtPrice, fmtPts } from '../lib/format.js';
import { cheaperAlternatives, openPlayerProfile, pastSeasons, photoUrls, predictionError, priceSeries, profileRows, savedFor, signed } from '../lib/playerProfile.js';
import { t } from '../lib/i18n.js';
import { useBackClose } from '../hooks/useBackClose.js';

const positionName = id => ({ 1: t('Goalkeeper'), 2: t('Defender'), 3: t('Midfielder'), 4: t('Forward') })[id];

// Every gameweek's saved predictions, fetched once a visit.
let savedAll = null;
function loadSaved() {
  if (!savedAll) {
    savedAll = fetch('/api/accuracy?all=1')
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null)
      .then(data => { if (!data) savedAll = null; return data; });
  }
  return savedAll;
}

// Points against the prediction, gameweek by gameweek: two bars each,
// oldest on the left. rows: played gameweeks, newest first.
function PointsChart({ rows }) {
  const weeks = rows.filter(r => r.played).slice().reverse();
  if (weeks.length < 2) return null;
  const values = weeks.flatMap(r => [r.points || 0, r.predicted || 0]);
  const top = Math.max(4, Math.ceil(Math.max(...values) / 2) * 2);
  const bottom = Math.min(0, Math.floor(Math.min(...values)));
  const H = 120, PAD = 18, bar = 9, gap = 2, group = bar * 2 + gap + 8;
  const W = 24 + weeks.length * group;
  const y = v => PAD + ((top - v) / (top - bottom)) * (H - PAD * 2);
  const ticks = [top, top / 2, 0];
  return (
    <figure className="fpl-pp-chart">
      <figcaption>
        <span>{t('Points and predictions')}</span>
        <span className="fpl-pp-legend"><i className="is-actual" /> {t('Points')} <i className="is-pred" /> {t('Predicted')}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Points and predictions')}>
        {ticks.map(v => (
          <g key={v}>
            <line x1="22" x2={W} y1={y(v)} y2={y(v)} className="fpl-chart-grid" />
            <text x="18" y={y(v) + 3} className="fpl-chart-axis" textAnchor="end">{v}</text>
          </g>
        ))}
        {weeks.map((r, i) => {
          const x = 26 + i * group;
          const pts = r.points || 0;
          const pred = r.predicted;
          const barRect = (v, bx, cls) => <rect x={bx} width={bar} y={Math.min(y(v), y(0))} height={Math.max(1, Math.abs(y(v) - y(0)))} rx="2" className={cls} />;
          return (
            <g key={r.gw}>
              <title>{t('GW{gw}: {pts} points, {pred} predicted', { gw: r.gw, pts, pred: pred === null ? '–' : fmtPts(pred) })}</title>
              <rect x={x - 3} y="0" width={group - 2} height={H} fill="transparent" />
              {barRect(pts, x, 'fpl-chart-actual')}
              {pred !== null ? barRect(pred, x + bar + gap, 'fpl-chart-pred') : null}
              {weeks.length <= 14 || i % 2 === 0 ? <text x={x + bar + gap / 2} y={H - 3} className="fpl-chart-axis" textAnchor="middle">{r.gw}</text> : null}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

// His price through the season, one point a gameweek.
function PriceChart({ series }) {
  if (series.length < 2) return null;
  const prices = series.map(p => p.price);
  const lo = Math.min(...prices) - 0.2, hi = Math.max(...prices) + 0.2;
  const H = 80, W = 320, PAD = 12;
  const x = i => 30 + (i / (series.length - 1)) * (W - 50);
  const y = v => PAD + ((hi - v) / (hi - lo)) * (H - PAD * 2);
  const path = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  const first = series[0], last = series[series.length - 1];
  return (
    <figure className="fpl-pp-chart">
      <figcaption><span>{t('Price')}</span><span className="fpl-mono">{fmtPrice(first.price)} → {fmtPrice(last.price)}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('Price from {from} to {to}', { from: fmtPrice(first.price), to: fmtPrice(last.price) })}>
        <path d={path} className="fpl-chart-line" />
        {series.map((p, i) => (
          <g key={p.gw}>
            <title>{t('GW{gw}: {price}', { gw: p.gw, price: fmtPrice(p.price) })}</title>
            <circle cx={x(i)} cy={y(p.price)} r="8" fill="transparent" />
            {i === 0 || i === series.length - 1 ? <circle cx={x(i)} cy={y(p.price)} r="4" className="fpl-chart-dot" /> : null}
          </g>
        ))}
        <text x={x(0) - 6} y={y(first.price) + 4} className="fpl-chart-axis" textAnchor="end">{first.price.toFixed(1)}</text>
      </svg>
    </figure>
  );
}

// Cheaper players predicted nearly as well (cheaperAlternatives).
function Alternatives({ player, staticData }) {
  const alts = cheaperAlternatives(player, staticData.allPlayers, staticData.predictionsById);
  if (!alts.length) return null;
  const mine = ((staticData.predictionsById[player.id] || {}).byGw || []).reduce((s, w) => s + (w.points || 0), 0);
  const weeks = ((staticData.predictionsById[player.id] || {}).byGw || []).length;
  return (
    <section className="fpl-pp-alts" aria-labelledby="alts-h">
      <h3 id="alts-h">{t('Cheaper options')}</h3>
      <p className="fpl-meta">{t('Same position, £0.5m or more cheaper, and predicted at least 80% of {name}’s {mine} points over the next {n} gameweeks.', { name: player.webName, mine: fmtPts(mine), n: weeks })}</p>
      <ul>
        {alts.map(a => {
          const team = staticData.teamsById[a.player.team];
          return (
            <li key={a.player.id}>
              <span className="fpl-explore-shirt"><Shirt team={team} isKeeper={a.player.positionId === 1} /></span>
              <span className="fpl-pp-alt-who">
                <button type="button" className="fpl-namebtn" onClick={() => openPlayerProfile(a.player.id)}>{a.player.webName}</button>
                <span className="fpl-meta">{team ? team.short_name : '—'} · {fmtPrice(a.player.price)} · <b className="fpl-pp-save">−{fmtPrice(a.saving)}</b></span>
              </span>
              <span className="fpl-mono fpl-pp-alt-pts">{fmtPts(a.next)}<small>{t('pts')}</small></span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Photo({ player, team }) {
  const [tried, setTried] = useState(0);
  const urls = player.code ? photoUrls(player.code) : [];
  if (tried >= urls.length) return <span className="fpl-pp-shirt"><Shirt team={team} isKeeper={player.positionId === 1} /></span>;
  return <img className="fpl-pp-photo" src={urls[tried]} alt="" width="110" height="140" decoding="async" onError={() => setTried(n => n + 1)} />;
}

function Matches({ matches }) {
  return (
    <span className="fpl-pp-opps">
      {matches.map((m, i) => (
        <span key={i} className="fpl-pp-opp">
          <span>{m.opponent} ({m.home ? t('H') : t('A')})</span>
          {m.score ? <span className={`fpl-pp-score is-${m.result}`}>{m.score[0]}-{m.score[1]}</span> : null}
        </span>
      ))}
    </span>
  );
}

function Diff({ value }) {
  if (value === null) return <td className="fpl-meta">–</td>;
  return <td className={`fpl-pp-diff${value > 0 ? ' is-up' : value < 0 ? ' is-down' : ''}`}>{signed(value)}</td>;
}

export function PlayerProfile({ playerId, staticData, onClose }) {
  const dialogRef = useRef(null);
  useBackClose(onClose);
  const [tab, setTab] = useState('season');
  const [state, setState] = useState({ summary: null, saved: null, error: false });
  const player = staticData.playersById[playerId];
  const team = player ? staticData.teamsById[player.team] : null;
  const prediction = player ? staticData.predictionsById[player.id] : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog && dialog.open) dialog.close(); };
  }, []);

  useEffect(() => {
    // A new player opens a new profile (App.jsx keys it by id), so the
    // state starts empty.
    let live = true;
    Promise.all([fetchFplJson(`element-summary/${playerId}/`), loadSaved()])
      .then(([summary, saved]) => { if (live) setState({ summary, saved, error: false }); })
      .catch(() => { if (live) setState({ summary: null, saved: null, error: true }); });
    return () => { live = false; };
  }, [playerId]);

  const finishedGws = useMemo(() => new Set((staticData.allEvents || []).filter(e => e.finished).map(e => e.id)), [staticData]);
  const rows = useMemo(() => {
    if (!state.summary) return [];
    const upcomingByGw = Object.fromEntries(((prediction && prediction.byGw) || []).map(w => [w.event, w.points]));
    const workedOutGws = new Set((state.saved && state.saved.workedOut) || []);
    return profileRows(state.summary, { teamsById: staticData.teamsById, predictedByGw: savedFor(state.saved, playerId), upcomingByGw, finishedGws, workedOutGws });
  }, [state, staticData, prediction, playerId, finishedGws]);
  const played = rows.filter(r => r.played);
  const upcoming = rows.filter(r => !r.played).reverse();
  const error = predictionError(rows);
  const seasons = state.summary ? pastSeasons(state.summary) : [];

  if (!player) return null;
  return (
    <dialog
      ref={dialogRef}
      className="fpl-dialog fpl-pp"
      aria-labelledby="profile-h"
      onCancel={e => { e.preventDefault(); onClose(); }}
      onClick={e => { if (e.target === dialogRef.current) onClose(); }}
    >
      <div className="fpl-dialog-card">
        <button type="button" onClick={onClose} aria-label={t('Close')} className="fpl-dialog-close"><X size={18} /></button>
        <div className="fpl-pp-hero">
          <Photo player={player} team={team} />
          <div className="fpl-pp-who">
            <span className="fpl-pp-pos">{positionName(player.positionId)}</span>
            <h2 id="profile-h" className="fpl-display"><span>{player.firstName}</span> <b>{player.secondName}</b></h2>
            <span className="fpl-pp-club">{team ? team.name : '—'}</span>
          </div>
        </div>
        {prediction && prediction.availNote ? <p className={`fpl-availnote${availClass(player)}`}>{prediction.availNote}</p> : null}
        <div className="fpl-pp-stats">
          <div><b className="fpl-mono">{fmtPrice(player.price)}</b><span>{t('Price')}</span></div>
          <div><b className="fpl-mono">{player.form.toFixed(1)}</b><span>{t('Form')}</span></div>
          <div><b className="fpl-mono">{player.totalPoints}</b><span>{t('season points')}</span></div>
          <div><b className="fpl-mono">{player.selectedBy.toFixed(1)}%</b><span>{t('owned by')}</span></div>
          <div><b className="fpl-mono">{prediction ? fmtPts(prediction.nextMatchPredicted) : '–'}</b><span>{t('predicted this gameweek')}</span></div>
          <div><b className="fpl-mono">{prediction ? fmtPts(prediction.predicted) : '–'}</b><span>{t('predicted per week')}</span></div>
        </div>
        {error ? (
          <div className="fpl-pp-error">
            <span className="fpl-mono">±{error.meanMiss.toFixed(1)}</span>
            <p>
              {t('Average miss of the predictions over the {n} gameweeks played.', { n: error.n })}
              {' '}<b className={error.bias > 0 ? 'is-up' : error.bias < 0 ? 'is-down' : ''}>{signed(error.bias)}</b>
              {' '}{error.bias >= 0 ? t('points a week more than predicted, on average.') : t('points a week less than predicted, on average.')}
            </p>
          </div>
        ) : null}
        <Alternatives player={player} staticData={staticData} />
        <div className="fpl-seg fpl-pp-tabs" role="group" aria-label={t('Show')}>
          <button type="button" className={tab === 'season' ? 'is-on' : ''} aria-pressed={tab === 'season'} onClick={() => setTab('season')}>{t('This season')}</button>
          <button type="button" className={tab === 'fixtures' ? 'is-on' : ''} aria-pressed={tab === 'fixtures'} onClick={() => setTab('fixtures')}>{t('Fixtures')}</button>
          <button type="button" className={tab === 'past' ? 'is-on' : ''} aria-pressed={tab === 'past'} onClick={() => setTab('past')}>{t('Past seasons')}</button>
        </div>
        {state.error ? <p className="fpl-meta">{t('Couldn’t load the matches. Try again in a minute.')}</p> : null}
        {!state.summary && !state.error ? <p className="fpl-meta">{t('Loading…')}</p> : null}
        {state.summary && tab === 'season' && played.length ? (
          <>
            <PointsChart rows={rows} />
            <PriceChart series={priceSeries(state.summary)} />
          </>
        ) : null}
        {state.summary && tab === 'season' ? (
          played.length ? (
            <div className="fpl-compare-wrap">
              <table className="fpl-pp-table">
                <thead>
                  <tr>
                    <th scope="col">{t('GW')}</th>
                    <th scope="col">{t('Opponent')}</th>
                    <th scope="col">{t('Pts')}</th>
                    <th scope="col">{t('Pred')}</th>
                    <th scope="col">±</th>
                    <th scope="col">{t('Mins')}</th>
                    <th scope="col">{t('G')}</th>
                    <th scope="col">{t('A')}</th>
                  </tr>
                </thead>
                <tbody>
                  {played.map(r => (
                    <tr key={r.gw}>
                      <td>{r.gw}</td>
                      <td><Matches matches={r.matches} /></td>
                      <td className="fpl-pp-pts">{r.points}</td>
                      <td>{r.predicted !== null ? `${fmtPts(r.predicted)}${r.workedOut ? '*' : ''}` : '–'}</td>
                      <Diff value={r.diff} />
                      <td>{r.minutes}</td>
                      <td>{r.goals}</td>
                      <td>{r.assists}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {played.some(r => r.workedOut) ? <p className="fpl-meta fpl-pp-note">{t('* Predicted afterwards from what was known before that deadline, as these gameweeks were played before predictions were saved.')}</p> : null}
            </div>
          ) : <p className="fpl-meta">{t('No matches played this season yet.')}</p>
        ) : null}
        {state.summary && tab === 'fixtures' ? (
          upcoming.length ? (
            <div className="fpl-compare-wrap">
              <table className="fpl-pp-table">
                <thead>
                  <tr>
                    <th scope="col">{t('GW')}</th>
                    <th scope="col">{t('Opponent')}</th>
                    <th scope="col">{t('Pred')}</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map(r => (
                    <tr key={r.gw}>
                      <td>{r.gw}</td>
                      <td>
                        <span className="fpl-pp-opps">
                          {r.matches.map((m, i) => {
                            const c = DIFF_COLORS[m.difficulty] || DIFF_COLORS[3];
                            return <span key={i} className="fpl-fixchip" style={{ background: c.bg, color: c.text }}>{m.opponent} {m.home ? t('H') : t('A')}</span>;
                          })}
                        </span>
                      </td>
                      <td className="fpl-pp-pts">{r.predicted !== null ? fmtPts(r.predicted) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="fpl-meta">{t('No fixtures left this season.')}</p>
        ) : null}
        {state.summary && tab === 'past' ? (
          seasons.length ? (
            <div className="fpl-compare-wrap">
              <table className="fpl-pp-table">
                <thead>
                  <tr>
                    <th scope="col">{t('Season')}</th>
                    <th scope="col">{t('Pts')}</th>
                    <th scope="col">{t('Starts')}</th>
                    <th scope="col">{t('Mins')}</th>
                    <th scope="col">{t('G')}</th>
                    <th scope="col">{t('A')}</th>
                    <th scope="col">xGI</th>
                  </tr>
                </thead>
                <tbody>
                  {seasons.map(s => (
                    <tr key={s.season}>
                      <td>{s.season}</td>
                      <td className="fpl-pp-pts">{s.points}</td>
                      <td>{s.starts}</td>
                      <td>{s.minutes.toLocaleString()}</td>
                      <td>{s.goals}</td>
                      <td>{s.assists}</td>
                      <td>{s.xgi.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="fpl-meta">{t('No past Premier League seasons.')}</p>
        ) : null}
      </div>
    </dialog>
  );
}
