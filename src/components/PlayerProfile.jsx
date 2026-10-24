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
import { pastSeasons, photoUrls, predictionError, profileRows, savedFor, signed } from '../lib/playerProfile.js';
import { t } from '../lib/i18n.js';

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

function Photo({ player, team }) {
  const [tried, setTried] = useState(0);
  const urls = player.code ? photoUrls(player.code) : [];
  if (tried >= urls.length) return <span className="fpl-profile-shirt"><Shirt team={team} isKeeper={player.positionId === 1} /></span>;
  return <img className="fpl-profile-photo" src={urls[tried]} alt="" width="110" height="140" decoding="async" onError={() => setTried(n => n + 1)} />;
}

function Matches({ matches }) {
  return (
    <span className="fpl-profile-opps">
      {matches.map((m, i) => (
        <span key={i} className="fpl-profile-opp">
          <span>{m.opponent} ({m.home ? t('H') : t('A')})</span>
          {m.score ? <span className={`fpl-profile-score is-${m.result}`}>{m.score[0]}-{m.score[1]}</span> : null}
        </span>
      ))}
    </span>
  );
}

function Diff({ value }) {
  if (value === null) return <td className="fpl-meta">–</td>;
  return <td className={`fpl-profile-diff${value > 0 ? ' is-up' : value < 0 ? ' is-down' : ''}`}>{signed(value)}</td>;
}

export function PlayerProfile({ playerId, staticData, onClose }) {
  const dialogRef = useRef(null);
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
      className="fpl-dialog fpl-profile"
      aria-labelledby="profile-h"
      onCancel={e => { e.preventDefault(); onClose(); }}
      onClick={e => { if (e.target === dialogRef.current) onClose(); }}
    >
      <div className="fpl-dialog-card">
        <button type="button" onClick={onClose} aria-label={t('Close')} className="fpl-dialog-close"><X size={18} /></button>
        <div className="fpl-profile-hero">
          <Photo player={player} team={team} />
          <div className="fpl-profile-who">
            <span className="fpl-profile-pos">{positionName(player.positionId)}</span>
            <h2 id="profile-h" className="fpl-display"><span>{player.firstName}</span> <b>{player.secondName}</b></h2>
            <span className="fpl-profile-club">{team ? team.name : '—'}</span>
          </div>
        </div>
        {prediction && prediction.availNote ? <p className={`fpl-availnote${availClass(player)}`}>{prediction.availNote}</p> : null}
        <div className="fpl-profile-stats">
          <div><b className="fpl-mono">{fmtPrice(player.price)}</b><span>{t('Price')}</span></div>
          <div><b className="fpl-mono">{player.form.toFixed(1)}</b><span>{t('Form')}</span></div>
          <div><b className="fpl-mono">{player.totalPoints}</b><span>{t('season points')}</span></div>
          <div><b className="fpl-mono">{player.selectedBy.toFixed(1)}%</b><span>{t('owned by')}</span></div>
          <div><b className="fpl-mono">{prediction ? fmtPts(prediction.nextMatchPredicted) : '–'}</b><span>{t('predicted this gameweek')}</span></div>
          <div><b className="fpl-mono">{prediction ? fmtPts(prediction.predicted) : '–'}</b><span>{t('predicted per week')}</span></div>
        </div>
        {error ? (
          <div className="fpl-profile-error">
            <span className="fpl-mono">±{error.meanMiss.toFixed(1)}</span>
            <p>
              {t('Average miss of the predictions over the {n} gameweeks played.', { n: error.n })}
              {' '}<b className={error.bias > 0 ? 'is-up' : error.bias < 0 ? 'is-down' : ''}>{signed(error.bias)}</b>
              {' '}{error.bias >= 0 ? t('points a week more than predicted, on average.') : t('points a week less than predicted, on average.')}
            </p>
          </div>
        ) : null}
        <div className="fpl-seg fpl-profile-tabs" role="group" aria-label={t('Show')}>
          <button type="button" className={tab === 'season' ? 'is-on' : ''} aria-pressed={tab === 'season'} onClick={() => setTab('season')}>{t('This season')}</button>
          <button type="button" className={tab === 'fixtures' ? 'is-on' : ''} aria-pressed={tab === 'fixtures'} onClick={() => setTab('fixtures')}>{t('Fixtures')}</button>
          <button type="button" className={tab === 'past' ? 'is-on' : ''} aria-pressed={tab === 'past'} onClick={() => setTab('past')}>{t('Past seasons')}</button>
        </div>
        {state.error ? <p className="fpl-meta">{t('Couldn’t load the matches. Try again in a minute.')}</p> : null}
        {!state.summary && !state.error ? <p className="fpl-meta">{t('Loading…')}</p> : null}
        {state.summary && tab === 'season' ? (
          played.length ? (
            <div className="fpl-compare-wrap">
              <table className="fpl-profile-table">
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
                      <td className="fpl-profile-pts">{r.points}</td>
                      <td>{r.predicted !== null ? `${fmtPts(r.predicted)}${r.workedOut ? '*' : ''}` : '–'}</td>
                      <Diff value={r.diff} />
                      <td>{r.minutes}</td>
                      <td>{r.goals}</td>
                      <td>{r.assists}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {played.some(r => r.workedOut) ? <p className="fpl-meta fpl-profile-note">{t('* Predicted afterwards from what was known before that deadline, as these gameweeks were played before predictions were saved.')}</p> : null}
            </div>
          ) : <p className="fpl-meta">{t('No matches played this season yet.')}</p>
        ) : null}
        {state.summary && tab === 'fixtures' ? (
          upcoming.length ? (
            <div className="fpl-compare-wrap">
              <table className="fpl-profile-table">
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
                        <span className="fpl-profile-opps">
                          {r.matches.map((m, i) => {
                            const c = DIFF_COLORS[m.difficulty] || DIFF_COLORS[3];
                            return <span key={i} className="fpl-fixchip" style={{ background: c.bg, color: c.text }}>{m.opponent} {m.home ? t('H') : t('A')}</span>;
                          })}
                        </span>
                      </td>
                      <td className="fpl-profile-pts">{r.predicted !== null ? fmtPts(r.predicted) : '–'}</td>
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
              <table className="fpl-profile-table">
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
                      <td className="fpl-profile-pts">{s.points}</td>
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
