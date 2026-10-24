// Home: a summary of your own team for the coming deadline and the
// fixture ticker, with transfer trends beside them (below on a phone).
// Everything else is in the menu (sidebar on a computer,
// footer on a phone).
import { useEffect, useMemo, useState } from 'react';
import { AlarmClock, ArrowRight, Bell, BellOff, BellRing, BrainCircuit, CalendarRange, Crown, Plus, RotateCcw, Shirt, Sparkles, Star, Target, TrendingDown, TrendingUp, TriangleAlert, X } from 'lucide-react';
import { DIFF_COLORS, POSITION_LABELS, fmtPrice, fmtPts, formatCountdown, isDeadlineSoon, officialGwPoints } from '../lib/format.js';
import { buildFixtureTicker } from '../lib/fixtureTicker.js';
import { buildAlerts, predictionBaseline } from '../lib/alerts.js';
import { GUIDES } from '../lib/seoPage.js';
import { weeklyPicks } from '../lib/weeklyPicks.js';
import { Shirt as ShirtKit } from '../components/Pitch.jsx';
import { notificationState, notifyNewAlerts, setNotifications, stopPush, syncPush } from '../lib/notify.js';
import { TransferTrends } from '../components/TransferTrends.jsx';
import { DifficultyChips, PlayerSearchPicker, SkeletonRows } from '../components/common.jsx';
import { PriceChip } from '../components/PriceChip.jsx';
import { predictPriceChange } from '../lib/transferTrends.js';
import { MAX_WATCHED, watchRows } from '../lib/watchlist.js';
import { openPlayerProfile } from '../lib/playerProfile.js';
import { useWatchlist } from '../hooks/useWatchlist.js';
import { parseTeamId } from '../lib/teamIdInput.js';
import { fmtDate, fmtNumber, plural, t } from '../lib/i18n.js';
import { tr } from '../lib/i18nRich.jsx';

function ScoreRing({ score }) {
  return (
    <div className="fpl-home-ring" style={{ '--v': Math.max(0, Math.min(100, score)) }} role="img" aria-label={t('Squad score {n} out of 100', { n: score })}>
      <span>{score}</span>
    </div>
  );
}

function TeamIdEntry({ onCheck, initial = '' }) {
  const [value, setValue] = useState(initial);
  return (
    <form className="fpl-home-tid" onSubmit={e => { e.preventDefault(); if (value) onCheck(value); }}>
      <input
        id="home-team-id"
        className="fpl-input"
        inputMode="numeric"
        placeholder={t('e.g. 1234567')}
        aria-label={t('FPL Team ID')}
        value={value}
        onChange={e => setValue(parseTeamId(e.target.value))}
      />
      <button type="submit" className="fpl-btn fpl-btn-solid" disabled={!value}>{t('Check')}</button>
    </form>
  );
}

function YourGameweek({ homeTeam, onCheckTeam, onOpenTeam, onChangeTeam, onRetry }) {
  const { teamId, status, data, error } = homeTeam;

  if (!teamId) {
    return (
      <section className="fpl-glass fpl-home-card fpl-home-team" aria-labelledby="your-gw">
        <h2 id="your-gw" className="fpl-home-h"><Shirt size={18} aria-hidden="true" /> {t('Your gameweek')}</h2>
        <p className="fpl-home-text">{t('Add your FPL Team ID to see your predicted points, captain and best transfer here every time you open the app.')}</p>
        <TeamIdEntry onCheck={onCheckTeam} />
        <p className="fpl-home-hint">{tr("It's the number after <m>/entry/</m> in the address of your FPL points page. It's remembered on this device.", undefined, { m: s => <span className="fpl-mono">{s}</span> })}</p>
      </section>
    );
  }

  if (status !== 'ready' || !data) {
    return (
      <section className="fpl-glass fpl-home-card fpl-home-team" aria-labelledby="your-gw" aria-busy={status !== 'error'}>
        <h2 id="your-gw" className="fpl-home-h"><Shirt size={18} aria-hidden="true" /> {t('Your gameweek')}</h2>
        {status === 'error' ? (
          <>
            <p className="fpl-home-text" role="alert">{error}</p>
            <div className="fpl-home-actions">
              <button type="button" className="fpl-btn" onClick={onRetry}><RotateCcw size={15} /> {t('Try again')}</button>
              <button type="button" className="fpl-link" onClick={onChangeTeam}>{t('Use a different Team ID')}</button>
            </div>
          </>
        ) : (
          <>
            <span className="fpl-skel fpl-skel-lg" aria-hidden="true" />
            <SkeletonRows rows={4} label={t('Loading team {id}…', { id: teamId })} />
          </>
        )}
      </section>
    );
  }

  const { entryMeta, xiTotal, squadScore, starters, suggestions, bankTenths, entry, isPastGw, gwId, entryHistory } = data;
  // A gameweek that has started is about what each player scored; the
  // upcoming one about what they're predicted to.
  const shown = s => (isPastGw ? (s.actualPoints || 0) * (s.multiplier || 1) : s.predicted);
  const top = [...starters].sort((a, b) => shown(b) - shown(a)).slice(0, 4);
  const worries = starters.filter(s => s.availNote).slice(0, 3);
  // The best move, or both halves of a pair where one pays for the other.
  const best = suggestions && suggestions[0];
  const bestMoves = best ? suggestions.filter(s => s === best || (best.group !== undefined && s.group === best.group)) : [];
  const bestGain = bestMoves.reduce((sum, s) => sum + s.gain, 0);
  const bestCost = bestMoves.reduce((sum, s) => sum + s.costDelta, 0);
  const gwPoints = isPastGw ? officialGwPoints(data) : null;

  return (
    <section className="fpl-glass fpl-home-card fpl-home-team" aria-labelledby="your-gw">
      <div className="fpl-home-team-head">
        <h2 id="your-gw" className="fpl-home-h"><Shirt size={18} aria-hidden="true" /> {entryMeta.teamName || t('Team {id}', { id: teamId })}</h2>
        <button type="button" className="fpl-link" onClick={onChangeTeam}>{t('Change team')}</button>
      </div>
      <div className="fpl-home-team-grid">
        <div className="fpl-home-col">
          <div className="fpl-home-stat-row">
            {isPastGw ? (
              <div className="fpl-home-stat">{gwPoints ?? '–'}<small>{t('points in GW{gw} · predicted {pts}', { gw: gwId, pts: fmtPts(xiTotal) })}</small></div>
            ) : (
              <div className="fpl-home-stat">{fmtPts(xiTotal)}<small>{t('predicted XI points')}</small></div>
            )}
            <div className="fpl-home-ring-wrap"><ScoreRing score={squadScore} /><span>{t('Squad score')}</span></div>
          </div>
          {entryMeta.savedChanges && (
            <p className="fpl-home-hint">{t('Showing your changes, not your team on FPL.')}</p>
          )}
          {entryMeta.picksFromGwId && (
            <p className="fpl-home-hint">{t("Using your Gameweek {gw} squad: this week's picks stay hidden until the deadline.", { gw: entryMeta.picksFromGwId })}</p>
          )}
          <div className="fpl-home-players">
            {top.map(s => (
              <div key={s.player.id} className="fpl-home-player">
                <span className="fpl-row-pos">{POSITION_LABELS[s.player.positionId]}</span>
                <span className="fpl-home-player-name">{s.player.webName}{s.isCaptain && <span className="fpl-armband">{t('C')}</span>}{s.isViceCaptain && <span className="fpl-armband fpl-armband-vc">{t('V')}</span>}</span>
                <span className="fpl-home-player-pts">{isPastGw ? shown(s) : fmtPts(s.predicted)}</span>
              </div>
            ))}
          </div>
          <button type="button" className="fpl-link" onClick={onOpenTeam}>{t('See all 15 players')} <ArrowRight size={14} /></button>
        </div>

        <div className="fpl-home-col">
          <div>
            <h3 className="fpl-home-sub"><TriangleAlert size={15} aria-hidden="true" /> {t('Needs a look')}</h3>
            {worries.length ? worries.map(s => (
              <p key={s.player.id} className="fpl-home-worry"><b>{s.player.webName}</b> · {s.availNote}</p>
            )) : <p className="fpl-home-hint">{t('No injury or suspension worries in your starting XI.')}</p>}
          </div>
          <div>
            <h3 className="fpl-home-sub"><ArrowRight size={15} aria-hidden="true" /> {isPastGw ? t('Transfers') : t('Best transfer')}</h3>
            {isPastGw ? (
              <p className="fpl-home-hint">{entryHistory && entryHistory.event_transfers
                ? `${plural(entryHistory.event_transfers, t('1 transfer made this gameweek'), t('{n} transfers made this gameweek'))}${entryHistory.event_transfers_cost ? ` ${t('(−{n} hit)', { n: entryHistory.event_transfers_cost })}` : ''}.`
                : t('Transfers are only suggested for the upcoming gameweek.')}</p>
            ) : best ? (
              <p className="fpl-home-transfer">
                <span>{bestMoves.map((s, k) => (
                  <span key={s.out.player.id}>{k > 0 ? ', ' : ''}{tr('<b>{out}</b> out, <b>{in}</b> in', { out: s.out.player.webName, in: s.inPlayer.webName }, { b: x => <b>{x}</b> })}</span>
                ))}</span>
                <span className="fpl-mono">{t('+{n} pts/wk', { n: fmtPts(bestGain) })} · {bestCost >= 0 ? '+' : '−'}{fmtPrice(Math.abs(bestCost))}</span>
              </p>
            ) : <p className="fpl-home-hint">{t('No transfer clearly beats your current XI.')}</p>}
          </div>
          {isPastGw ? (
            <div className="fpl-home-facts">
              <div><b>{fmtPrice((bankTenths || 0) / 10)}</b><span>{t('in the bank')}</span></div>
              {entryHistory && entryHistory.rank ? <div><b>{fmtNumber(entryHistory.rank)}</b><span>{t('GW{n} rank', { n: gwId })}</span></div> : null}
              {entryHistory && entryHistory.overall_rank ? <div><b>{fmtNumber(entryHistory.overall_rank)}</b><span>{t('overall rank after')}</span></div> : null}
            </div>
          ) : (
            <div className="fpl-home-facts">
              <div><b>{fmtPrice((bankTenths || 0) / 10)}</b><span>{t('in the bank')}</span></div>
              {entry && entry.summary_overall_rank ? <div><b>{fmtNumber(entry.summary_overall_rank)}</b><span>{t('overall rank')}</span></div> : null}
              {entry && entry.current_event ? <div><b>{entry.summary_event_points ?? '–'}</b><span>{t('points in GW{n}', { n: entry.current_event })}</span></div> : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// How last gameweek's predictions (or the picked gameweek's, once it's
// over) compared with what players scored. Hidden when there's nothing
// saved for it.
const ALERT_ICONS = { deadline: AlarmClock, rise: TrendingUp, fall: TrendingDown, news: TriangleAlert, drop: TrendingDown };
// This device's record of the squad's predictions as first seen this
// gameweek (src/lib/alerts.js, predictionBaseline).
const BASELINE_KEY = 'fpl_pred_baseline';

// Alerts for your team (src/lib/alerts.js), with a switch for sending them
// as notifications. Rechecked every minute.
function Alerts({ staticData, homeTeam, watchIds }) {
  const [now, setNow] = useState(() => Date.now());
  const [notify, setNotify] = useState(notificationState);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(id);
  }, []);
  const squad = homeTeam.status === 'ready' && homeTeam.data ? homeTeam.data.squad : null;
  // Predictions as first seen this gameweek, for flagging a drop.
  const baseline = useMemo(() => {
    if (!staticData || !squad) return null;
    let previous = null;
    try { previous = JSON.parse(localStorage.getItem(BASELINE_KEY) || 'null'); } catch { /* none */ }
    const next = predictionBaseline(previous, staticData, squad.map(s => s.player.id));
    try { localStorage.setItem(BASELINE_KEY, JSON.stringify(next)); } catch { /* not saved */ }
    return previous && previous.gwId === next.gwId ? previous : null;
  }, [staticData, squad]);
  const alerts = useMemo(() => buildAlerts(staticData, squad ? squad.map(s => s.player.id) : [], now, { baseline, watchIds }), [staticData, squad, now, baseline, watchIds]);
  useEffect(() => { notifyNewAlerts(alerts); }, [alerts]);
  // With notifications on, the server is told this squad, so it can push
  // its alerts with the app closed.
  useEffect(() => { if (notify === 'on' && squad) syncPush(squad.map(s => s.player.id), homeTeam.teamId, watchIds); }, [notify, squad, homeTeam.teamId, watchIds]);
  if (!staticData || !homeTeam.teamId) return null;
  const toggle = async () => {
    const next = await setNotifications(notify !== 'on');
    if (next === 'on') await notifyNewAlerts(alerts, { markOnly: true });
    else stopPush();
    setNotify(next);
  };
  return (
    <section className="fpl-glass fpl-home-card" aria-labelledby="alerts-h">
      <div className="fpl-home-team-head">
        <h2 id="alerts-h" className="fpl-home-h"><Bell size={18} aria-hidden="true" /> {t('Alerts')}</h2>
        {notify !== 'unsupported' ? (
          <button type="button" className="fpl-link" onClick={toggle} disabled={notify === 'blocked'} aria-pressed={notify === 'on'}>
            {notify === 'on' ? <><BellOff size={14} aria-hidden="true" /> {t('Stop notifications')}</> : notify === 'blocked' ? t('Notifications blocked') : <><BellRing size={14} aria-hidden="true" /> {t('Notify me')}</>}
          </button>
        ) : null}
      </div>
      {alerts.length ? (
        <ul className="fpl-alerts">
          {(showAll ? alerts : alerts.slice(0, 4)).map(a => {
            const Icon = ALERT_ICONS[a.kind] || Bell;
            return (
              <li key={a.id} className={`fpl-alert is-${a.level}`}>
                <Icon size={16} aria-hidden="true" />
                <span><b>{a.title}</b><span className="fpl-meta">{a.body}</span></span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="fpl-home-text" style={{ margin: 0 }}>{squad ? t('All clear: no injury news or price moves for your players, and no deadline in the next day.') : t('Alerts for your players show here once your team has loaded.')}</p>
      )}
      {alerts.length > 4 ? (
        <button type="button" className="fpl-link" style={{ justifySelf: 'start' }} onClick={() => setShowAll(v => !v)}>{showAll ? t('Show fewer') : t('Show all {n}', { n: alerts.length })}</button>
      ) : null}
      {notify === 'on' ? <p className="fpl-home-hint">{t('Notifications come to this device.')}</p> : null}
      {notify === 'blocked' ? <p className="fpl-home-hint">{t('Your browser is blocking notifications for this site; allow them in its site settings.')}</p> : null}
    </section>
  );
}

// Players you might buy (src/lib/watchlist.js): price move, next fixtures
// and predicted points, with a search to add more.
function Watchlist({ staticData, watchIds, onToggle }) {
  const [adding, setAdding] = useState(false);
  if (!staticData) return null;
  const rows = watchRows(staticData, watchIds);
  const full = watchIds.length >= MAX_WATCHED;
  return (
    <section className="fpl-glass fpl-home-card" aria-labelledby="watch-h">
      <div className="fpl-home-team-head">
        <h2 id="watch-h" className="fpl-home-h"><Star size={18} aria-hidden="true" /> {t('Watchlist')}</h2>
        {adding || !full ? (
          <button type="button" className="fpl-link" aria-expanded={adding} onClick={() => setAdding(v => !v)}>
            {adding ? t('Done') : <><Plus size={14} aria-hidden="true" /> {t('Add player')}</>}
          </button>
        ) : null}
      </div>
      {adding ? (
        full
          ? <p className="fpl-home-hint">{t('Your watchlist is full ({n} players). Remove one to add another.', { n: MAX_WATCHED })}</p>
          : <PlayerSearchPicker allPlayers={staticData.allPlayers} excludeIds={new Set(watchIds)} onPick={p => onToggle(p.id)} />
      ) : null}
      {rows.length ? (
        <ul className="fpl-watch">
          {rows.map(({ player, prediction, fixtures }) => {
            const team = staticData.teamsById[player.team];
            return (
              <li key={player.id} className="fpl-watch-row">
                <span className="fpl-watch-who">
                  <b><button type="button" className="fpl-namebtn" onClick={() => openPlayerProfile(player.id)}>{player.webName}</button></b>
                  <span className="fpl-meta">
                    {POSITION_LABELS[player.positionId]} · {team ? team.short_name : '—'} · {fmtPrice(player.price)}
                    {' '}<PriceChip change={predictPriceChange(player, staticData.totalPlayers)} />
                  </span>
                  {prediction && prediction.availNote ? <span className="fpl-availnote">{prediction.availNote}</span> : null}
                </span>
                <span className="fpl-watch-fix"><DifficultyChips fixtures={fixtures} teamsById={staticData.teamsById} max={3} /></span>
                <span className="fpl-watch-pts fpl-mono">{prediction ? fmtPts(prediction.predicted) : '–'}<small>{t('pts/wk')}</small></span>
                <button type="button" className="fpl-watch-x" aria-label={t('Remove {name} from your watchlist', { name: player.webName })} onClick={() => onToggle(player.id)}>
                  <X size={16} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="fpl-home-text" style={{ margin: 0 }}>{t('Add players you might buy to follow their price, fixtures and predicted points here. Their injury news and price moves join your alerts.')}</p>
      )}
    </section>
  );
}

// The model's walk-forward test, from scripts/ml/evaluate.py's docstring.
const BACKTEST = { mlXi: 64.4, formulaXi: 54.8, mlCorr: 0.54, formulaCorr: 0.44 };

// The machine-learning model (scripts/ml/): when it was last retrained, how
// its predictions did each finished gameweek (newest last) and its biggest
// misses the last one, and how it did when tested on past seasons.
function ModelLearning({ playersById }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const get = path => fetch(path).then(r => (r.ok ? r.json() : null)).catch(() => null);
    Promise.all([get('/ml/predictions.json'), get('/ml/history.json')]).then(([pred, history]) => {
      if (!cancelled) setState({ pred, weeks: (history && history.weeks) || [] });
    });
    return () => { cancelled = true; };
  }, []);
  if (!state || !state.pred) return null;
  const { pred } = state;
  const weeks = state.weeks.filter(w => w.season === pred.season).slice(-8);
  const worst = Math.max(1, ...weeks.map(w => w.meanAbsError));
  const last = weeks[weeks.length - 1] || null;
  return (
    <section className="fpl-glass fpl-home-card" aria-labelledby="ml-h">
      <div className="fpl-home-team-head">
        <h2 id="ml-h" className="fpl-home-h"><BrainCircuit size={18} aria-hidden="true" /> {t('How the model is learning')}</h2>
        <span className="fpl-mono fpl-home-meta">GW{pred.gwId}</span>
      </div>
      <p className="fpl-home-text" style={{ margin: 0 }}>
        {t("The app's predictions blend its formula with a machine-learning model, retrained every day on {rows} player-gameweeks, last on {date}, and again every 2 hours before a deadline. Each finished gameweek is added, so it keeps learning, and the blend leans toward whichever of the two has been nearer lately.", { rows: fmtNumber(Number(pred.trainedRows || 0)), date: fmtDate(pred.builtAt, { day: 'numeric', month: 'short' }) })}
      </p>
      {weeks.length ? (
        <ol className="fpl-ml-weeks" aria-label={t('Typical miss per player, each gameweek')}>
          {weeks.map(w => (
            <li key={w.gwId}>
              <span className="fpl-mono fpl-ml-gw">GW{w.gwId}</span>
              <span className="fpl-ml-bar"><i style={{ width: `${(w.meanAbsError / worst) * 100}%` }} /></span>
              <span className="fpl-mono">±{fmtPts(w.meanAbsError)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="fpl-home-hint">{t('Its first scored week shows here once Gameweek {n} is over.', { n: pred.gwId })}</p>
      )}
      {weeks.length ? <p className="fpl-home-hint">{t('Typical miss per player who played, from predictions made before each deadline. Shorter is better.')}</p> : null}
      {last && Array.isArray(last.misses) && last.misses.length ? (
        <details className="fpl-ml-misses">
          <summary>{t('GW{n}: biggest misses', { n: last.gwId })}{typeof last.correlation === 'number' ? ` ${t('(correlation {r})', { r: last.correlation.toFixed(2) })}` : ''}</summary>
          <table className="fpl-mini-table">
            <caption className="fpl-sr-only">{t('Gameweek {n}: predicted and actual points, biggest misses', { n: last.gwId })}</caption>
            <thead><tr><th scope="col">{t('Player')}</th><th scope="col">{t('Predicted')}</th><th scope="col">{t('Scored')}</th></tr></thead>
            <tbody>
              {last.misses.map(([id, predicted, actual]) => (
                <tr key={id}>
                  <th scope="row">{(playersById && playersById[id] && playersById[id].webName) || t('Player {id}', { id })}</th>
                  <td className="fpl-mono">{fmtPts(predicted)}</td>
                  <td className={`fpl-mono ${actual > predicted ? 'is-up' : 'is-down'}`}>{actual}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
      <p className="fpl-home-hint">
        {t('Tested on 2022-23 to 2025-26, predicting each week from earlier ones only: the best XI the model picks scored {ml} pts a gameweek, against {formula} for the formula (correlation with points {mlCorr} vs {formulaCorr}).', { ml: BACKTEST.mlXi, formula: BACKTEST.formulaXi, mlCorr: BACKTEST.mlCorr, formulaCorr: BACKTEST.formulaCorr })}
      </p>
    </section>
  );
}

function PredictionCheck({ gwId, playersById }) {
  // The answer and which gameweek it was for: still loading while that
  // isn't the one asked for.
  const [result, setResult] = useState({ gwId: undefined, data: null });
  useEffect(() => {
    let cancelled = false;
    fetch(gwId ? `/api/accuracy?gw=${gwId}` : '/api/accuracy')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled) setResult({ gwId, data: d && typeof d.meanAbsError === 'number' ? d : null }); })
      .catch(() => { if (!cancelled) setResult({ gwId, data: null }); });
    return () => { cancelled = true; };
  }, [gwId]);
  const loading = result.gwId !== gwId;
  if (!loading && !result.data) return null;
  const d = loading ? null : result.data;
  const topPick = d && d.topPick && playersById ? playersById[d.topPick.id] : null;
  return (
    <section className="fpl-glass fpl-home-card" aria-labelledby="accuracy-h" aria-busy={loading}>
      <div className="fpl-home-team-head">
        <h2 id="accuracy-h" className="fpl-home-h"><Target size={18} aria-hidden="true" /> {t('How accurate were we?')}</h2>
        {d && <span className="fpl-mono fpl-home-meta">GW{d.gwId}</span>}
      </div>
      {!d ? <SkeletonRows rows={3} label={t('Loading how accurate the predictions were…')} /> : (
        <>
          <div className="fpl-home-facts">
            <div><b>{fmtPts(d.topTenAverageActual)}</b><span>{t('pts each for our top 10 picks')}</span></div>
            <div><b>{fmtPts(d.averageActual)}</b><span>{t('pts for the average player')}</span></div>
            <div><b>±{fmtPts(d.meanAbsError)}</b><span>{t('typical miss per player')}</span></div>
          </div>
          {d.byPosition && Object.keys(d.byPosition).length > 1 ? (
            <div className="fpl-acc-pos" aria-label={t('Typical miss by position')}>
              {Object.entries(d.byPosition).map(([pos, v]) => (
                <span key={pos} className="fpl-mono"><b>{t(pos)}</b> ±{fmtPts(v.meanAbsError)}</span>
              ))}
            </div>
          ) : null}
          {topPick && (
            <p className="fpl-home-text">{tr('Our top pick, <b>{name}</b>, was predicted {pred} and scored {actual}.', { name: topPick.webName, pred: fmtPts(d.topPick.predicted), actual: d.topPick.actual }, { b: s => <b>{s}</b> })}</p>
          )}
          <p className="fpl-home-hint">{t('Across {n} players who played, using predictions saved before the deadline.', { n: d.playersCompared })}</p>
        </>
      )}
    </section>
  );
}

function FixtureTicker({ staticData, fromGw }) {
  const [showAll, setShowAll] = useState(false);
  if (!staticData) {
    return (
      <section className="fpl-glass fpl-home-card" aria-labelledby="ticker-h" aria-busy="true">
        <h2 id="ticker-h" className="fpl-home-h"><CalendarRange size={18} aria-hidden="true" /> {t('Easiest fixtures')}</h2>
        <SkeletonRows rows={6} label={t('Loading fixtures…')} />
      </section>
    );
  }
  if (!fromGw) return null;
  const { gws, rows } = buildFixtureTicker(staticData.fixturesByTeam, staticData.teamsById, fromGw);
  if (!gws.length) return null;
  const shown = showAll ? rows : rows.slice(0, 8);
  return (
    <section className="fpl-glass fpl-home-card" aria-labelledby="ticker-h">
      <div className="fpl-home-team-head">
        <h2 id="ticker-h" className="fpl-home-h"><CalendarRange size={18} aria-hidden="true" /> {t('Easiest fixtures')}</h2>
        <span className="fpl-mono fpl-home-meta">GW{gws[0]}{gws.length > 1 ? `–${gws[gws.length - 1]}` : ''}</span>
      </div>
      <div className="fpl-ticker-wrap">
        <table className="fpl-ticker">
          <thead>
            <tr><th scope="col">{t('Club')}</th>{gws.map(gw => <th key={gw} scope="col">GW{gw}</th>)}</tr>
          </thead>
          <tbody>
            {shown.map(({ team, weeks }) => (
              <tr key={team.id}>
                <th scope="row">{team.short_name}</th>
                {weeks.map(w => (
                  <td key={w.gw}>
                    {w.fixtures.length ? (
                      <span className="fpl-ticker-cell">
                        {w.fixtures.map((f, k) => {
                          const c = DIFF_COLORS[f.difficulty] || DIFF_COLORS[3];
                          const name = f.opponent ? f.opponent.short_name : '?';
                          return (
                            <span key={k} className="fpl-ticker-fx" style={{ background: c.bg, color: c.text }} title={f.isHome ? t('{team} (home), difficulty {n}', { team: f.opponent ? f.opponent.name : name, n: f.difficulty }) : t('{team} (away), difficulty {n}', { team: f.opponent ? f.opponent.name : name, n: f.difficulty })}>
                              {f.isHome ? name.toUpperCase() : name.toLowerCase()}
                            </span>
                          );
                        })}
                      </span>
                    ) : <span className="fpl-ticker-blank" title={t('No match this gameweek')}>–</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="fpl-ticker-foot">
        <span className="fpl-home-hint">{t('Easiest run first. CAPITALS are home games, lower case away.')}</span>
        {rows.length > 8 && (
          <button type="button" className="fpl-link" onClick={() => setShowAll(v => !v)}>{showAll ? t('Show fewer') : t('Show all {n}', { n: rows.length })}</button>
        )}
      </div>
    </section>
  );
}

// One pick row (captain or differential).
function WeeklyPick({ icon: Icon, label, entry, meta, teamsById }) {
  return (
    <div className="fpl-pick">
      <span className="fpl-pick-label"><Icon size={13} aria-hidden="true" /> {label}</span>
      <span className="fpl-pick-kit"><ShirtKit team={teamsById[entry.player.team]} isKeeper={entry.player.positionId === 1} /></span>
      <span className="fpl-pick-name">{entry.player.webName}<span className="fpl-meta"> · {teamsById[entry.player.team]?.short_name} · {POSITION_LABELS[entry.player.positionId]}</span></span>
      <span className="fpl-pick-meta">{meta}</span>
    </div>
  );
}

// Captain and differential pick of the week, from every available player.
function WeeklyPicks({ staticData }) {
  const picks = useMemo(() => weeklyPicks(staticData), [staticData]);
  if (!staticData || !picks) return null;
  const { captain, differential } = picks;
  return (
    <section className="fpl-glass fpl-home-card" aria-labelledby="picks-h">
      <h2 id="picks-h" className="fpl-home-h"><Crown size={18} aria-hidden="true" /> {t('Picks of the week')}</h2>
      <div className="fpl-picks">
        <WeeklyPick icon={Crown} label={t('Captain')} entry={captain} meta={t('{n} pred', { n: fmtPts(captain.predicted) })} teamsById={staticData.teamsById} />
        {differential
          ? <WeeklyPick icon={Target} label={t('Differential')} entry={differential} meta={t('{n}% owned', { n: differential.owned.toFixed(1) })} teamsById={staticData.teamsById} />
          : <p className="fpl-home-text" style={{ margin: 0 }}>{t('No stand-out differential this week: the best picks are all widely owned.')}</p>}
      </div>
      <p className="fpl-meta" style={{ margin: 0 }}>{t("From this gameweek's predictions across every available player.")}</p>
    </section>
  );
}

export function HomeScreen({ staticData, selectedGw, live, homeTeam, onCheckTeam, onOpenTeam, onChangeTeam, onRetryTeam, recapGw, onOpenRecap }) {
  const target = staticData && staticData.targetEvent;
  // Everything on Home is for the gameweek picked in the header.
  const event = (staticData && staticData.allEvents.find(e => e.id === selectedGw)) || target;
  const isPast = !!(event && target && event.id < target.id);
  const [watchIds, toggleWatch] = useWatchlist();
  return (
    <div className="fpl-home">
      <div className="fpl-home-top">
        <h1 className="fpl-display">{event ? event.name : t('Home')}</h1>
        <div className="fpl-home-top-side">
          {/* The latest finished gameweek's recap, any time. */}
          {recapGw ? (
            <button type="button" className="fpl-recap-open" onClick={() => onOpenRecap(recapGw)}>
              <Sparkles size={16} aria-hidden="true" /> {t('GW{n} recap', { n: recapGw })}
            </button>
          ) : null}
          {event && (
            <span className={`fpl-mono fpl-home-deadline${!isPast && isDeadlineSoon(event.deadline_time) ? ' fpl-deadline-soon' : ''}`}>
              {isPast ? (event.finished ? t('Finished') : t('In progress')) : formatCountdown(event.deadline_time)}
            </span>
          )}
        </div>
      </div>
      <div className="fpl-home-layout">
        <div className="fpl-home-main">
          <YourGameweek homeTeam={homeTeam} onCheckTeam={onCheckTeam} onOpenTeam={onOpenTeam} onChangeTeam={onChangeTeam} onRetry={onRetryTeam} />
          <Alerts staticData={staticData} homeTeam={homeTeam} watchIds={watchIds} />
          <Watchlist staticData={staticData} watchIds={watchIds} onToggle={toggleWatch} />
          <WeeklyPicks staticData={staticData} />
          <FixtureTicker staticData={staticData} fromGw={event && event.id} />
          <PredictionCheck gwId={isPast && event.finished ? event.id : null} playersById={staticData && staticData.playersById} />
          <ModelLearning playersById={staticData && staticData.playersById} />
        </div>
        {/* Keyed by gameweek so a new one starts on its first panel. */}
        <TransferTrends
          key={event ? event.id : 0}
          staticData={staticData}
          event={event}
          isPast={isPast}
          live={live}
          team={homeTeam.status === 'ready' && homeTeam.data && event && homeTeam.data.gwId === event.id ? homeTeam.data : null}
          teamPending={!!homeTeam.teamId && homeTeam.status !== 'error'}
        />
      </div>
      <nav className="fpl-home-guides" aria-label={t('FPL guides')}>
        {GUIDES.map(g => <a key={g.path} href={g.path}>{g.label}</a>)}
      </nav>
    </div>
  );
}
