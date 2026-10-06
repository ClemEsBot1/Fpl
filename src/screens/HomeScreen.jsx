// Home: a summary of your own team for the coming deadline and the
// fixture ticker, with transfer trends beside them (below on a phone).
// Everything else is in the menu (sidebar on a computer,
// footer on a phone).
import { useState } from 'react';
import { ArrowRight, CalendarRange, RotateCcw, Shirt, TriangleAlert } from 'lucide-react';
import { DIFF_COLORS, fmtPrice, fmtPts, formatCountdown, officialGwPoints } from '../lib/format.js';
import { buildFixtureTicker } from '../lib/fixtureTicker.js';
import { TransferTrends } from '../components/TransferTrends.jsx';

function ScoreRing({ score }) {
  return (
    <div className="fpl-home-ring" style={{ '--v': Math.max(0, Math.min(100, score)) }} role="img" aria-label={`Squad score ${score} out of 100`}>
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
        placeholder="e.g. 1234567"
        aria-label="FPL Team ID"
        value={value}
        onChange={e => setValue(e.target.value.replace(/[^0-9]/g, ''))}
      />
      <button type="submit" className="fpl-btn fpl-btn-solid" disabled={!value}>Check</button>
    </form>
  );
}

function YourGameweek({ homeTeam, onCheckTeam, onOpenTeam, onChangeTeam, onRetry }) {
  const { teamId, status, data, error } = homeTeam;

  if (!teamId) {
    return (
      <section className="fpl-glass fpl-home-card fpl-home-team" aria-labelledby="your-gw">
        <h2 id="your-gw" className="fpl-home-h"><Shirt size={18} aria-hidden="true" /> Your gameweek</h2>
        <p className="fpl-home-text">Add your FPL Team ID to see your predicted points, captain and best transfer here every time you open the app.</p>
        <TeamIdEntry onCheck={onCheckTeam} />
        <p className="fpl-home-hint">It's the number after <span className="fpl-mono">/entry/</span> in the address of your FPL points page. It's remembered on this device.</p>
      </section>
    );
  }

  if (status !== 'ready' || !data) {
    return (
      <section className="fpl-glass fpl-home-card fpl-home-team" aria-labelledby="your-gw" aria-busy={status !== 'error'}>
        <h2 id="your-gw" className="fpl-home-h"><Shirt size={18} aria-hidden="true" /> Your gameweek</h2>
        {status === 'error' ? (
          <>
            <p className="fpl-home-text" role="alert">{error}</p>
            <div className="fpl-home-actions">
              <button type="button" className="fpl-btn" onClick={onRetry}><RotateCcw size={15} /> Try again</button>
              <button type="button" className="fpl-link" onClick={onChangeTeam}>Use a different Team ID</button>
            </div>
          </>
        ) : (
          <p className="fpl-home-text" role="status">Loading team {teamId}…</p>
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
  const best = suggestions && suggestions[0];
  const gwPoints = isPastGw ? officialGwPoints(data) : null;

  return (
    <section className="fpl-glass fpl-home-card fpl-home-team" aria-labelledby="your-gw">
      <div className="fpl-home-team-head">
        <h2 id="your-gw" className="fpl-home-h"><Shirt size={18} aria-hidden="true" /> {entryMeta.teamName || `Team ${teamId}`}</h2>
        <button type="button" className="fpl-link" onClick={onChangeTeam}>Change team</button>
      </div>
      <div className="fpl-home-team-grid">
        <div className="fpl-home-col">
          <div className="fpl-home-stat-row">
            {isPastGw ? (
              <div className="fpl-home-stat">{gwPoints ?? '–'}<small>points in GW{gwId} · predicted {fmtPts(xiTotal)}</small></div>
            ) : (
              <div className="fpl-home-stat">{fmtPts(xiTotal)}<small>predicted XI points</small></div>
            )}
            <div className="fpl-home-ring-wrap"><ScoreRing score={squadScore} /><span>Squad<br />score</span></div>
          </div>
          {entryMeta.picksFromGwId && (
            <p className="fpl-home-hint">Using your Gameweek {entryMeta.picksFromGwId} squad: this week's picks stay hidden until the deadline.</p>
          )}
          <div className="fpl-home-players">
            {top.map(s => (
              <div key={s.player.id} className="fpl-home-player">
                <span className="fpl-row-pos">{['', 'GKP', 'DEF', 'MID', 'FWD'][s.player.positionId]}</span>
                <span className="fpl-home-player-name">{s.player.webName}{s.isCaptain && <span className="fpl-armband">C</span>}{s.isViceCaptain && <span className="fpl-armband fpl-armband-vc">V</span>}</span>
                <span className="fpl-home-player-pts">{isPastGw ? shown(s) : fmtPts(s.predicted)}</span>
              </div>
            ))}
          </div>
          <button type="button" className="fpl-link" onClick={onOpenTeam}>See all 15 players <ArrowRight size={14} /></button>
        </div>

        <div className="fpl-home-col">
          <div>
            <h3 className="fpl-home-sub"><TriangleAlert size={15} aria-hidden="true" /> Needs a look</h3>
            {worries.length ? worries.map(s => (
              <p key={s.player.id} className="fpl-home-worry"><b>{s.player.webName}</b> · {s.availNote}</p>
            )) : <p className="fpl-home-hint">No injury or suspension worries in your starting XI.</p>}
          </div>
          <div>
            <h3 className="fpl-home-sub"><ArrowRight size={15} aria-hidden="true" /> {isPastGw ? 'Transfers' : 'Best transfer'}</h3>
            {isPastGw ? (
              <p className="fpl-home-hint">{entryHistory && entryHistory.event_transfers
                ? `${entryHistory.event_transfers} transfer${entryHistory.event_transfers === 1 ? '' : 's'} made this gameweek${entryHistory.event_transfers_cost ? ` (−${entryHistory.event_transfers_cost} hit)` : ''}.`
                : 'Transfers are only suggested for the upcoming gameweek.'}</p>
            ) : best ? (
              <p className="fpl-home-transfer">
                <span><b>{best.out.player.webName}</b> out, <b>{best.inPlayer.webName}</b> in</span>
                <span className="fpl-mono">+{fmtPts(best.gain)} pts · {best.costDelta >= 0 ? '+' : '−'}{fmtPrice(Math.abs(best.costDelta))}</span>
              </p>
            ) : <p className="fpl-home-hint">No transfer clearly beats your current XI.</p>}
          </div>
          {isPastGw ? (
            <div className="fpl-home-facts">
              <div><b>{fmtPrice((bankTenths || 0) / 10)}</b><span>in the bank</span></div>
              {entryHistory && entryHistory.rank ? <div><b>{entryHistory.rank.toLocaleString('en-GB')}</b><span>GW{gwId} rank</span></div> : null}
              {entryHistory && entryHistory.overall_rank ? <div><b>{entryHistory.overall_rank.toLocaleString('en-GB')}</b><span>overall rank after</span></div> : null}
            </div>
          ) : (
            <div className="fpl-home-facts">
              <div><b>{fmtPrice((bankTenths || 0) / 10)}</b><span>in the bank</span></div>
              {entry && entry.summary_overall_rank ? <div><b>{entry.summary_overall_rank.toLocaleString('en-GB')}</b><span>overall rank</span></div> : null}
              {entry && entry.current_event ? <div><b>{entry.summary_event_points ?? '–'}</b><span>points in GW{entry.current_event}</span></div> : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function FixtureTicker({ staticData, fromGw }) {
  const [showAll, setShowAll] = useState(false);
  if (!staticData || !fromGw) return null;
  const { gws, rows } = buildFixtureTicker(staticData.fixturesByTeam, staticData.teamsById, fromGw);
  if (!gws.length) return null;
  const shown = showAll ? rows : rows.slice(0, 8);
  return (
    <section className="fpl-glass fpl-home-card" aria-labelledby="ticker-h">
      <div className="fpl-home-team-head">
        <h2 id="ticker-h" className="fpl-home-h"><CalendarRange size={18} aria-hidden="true" /> Easiest fixtures</h2>
        <span className="fpl-mono fpl-home-meta">GW{gws[0]}{gws.length > 1 ? `–${gws[gws.length - 1]}` : ''}</span>
      </div>
      <div className="fpl-ticker-wrap">
        <table className="fpl-ticker">
          <thead>
            <tr><th scope="col">Club</th>{gws.map(gw => <th key={gw} scope="col">GW{gw}</th>)}</tr>
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
                            <span key={k} className="fpl-ticker-fx" style={{ background: c.bg, color: c.text }} title={`${f.opponent ? f.opponent.name : name} (${f.isHome ? 'home' : 'away'}), difficulty ${f.difficulty}`}>
                              {f.isHome ? name.toUpperCase() : name.toLowerCase()}
                            </span>
                          );
                        })}
                      </span>
                    ) : <span className="fpl-ticker-blank" title="No match this gameweek">–</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="fpl-ticker-foot">
        <span className="fpl-home-hint">Easiest run first. CAPITALS are home games, lower case away.</span>
        {rows.length > 8 && (
          <button type="button" className="fpl-link" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show fewer' : `Show all ${rows.length}`}</button>
        )}
      </div>
    </section>
  );
}

export function HomeScreen({ staticData, selectedGw, live, homeTeam, onCheckTeam, onOpenTeam, onChangeTeam, onRetryTeam }) {
  const target = staticData && staticData.targetEvent;
  // Everything on Home is for the gameweek picked in the header.
  const event = (staticData && staticData.allEvents.find(e => e.id === selectedGw)) || target;
  const isPast = !!(event && target && event.id < target.id);
  return (
    <div className="fpl-home">
      <div className="fpl-home-top">
        <h1 className="fpl-display">{event ? event.name : 'Home'}</h1>
        {event && (
          <span className="fpl-mono fpl-home-deadline">
            {isPast ? (event.finished ? 'Finished' : 'In progress') : formatCountdown(event.deadline_time)}
          </span>
        )}
      </div>
      <div className="fpl-home-layout">
        <div className="fpl-home-main">
          <YourGameweek homeTeam={homeTeam} onCheckTeam={onCheckTeam} onOpenTeam={onOpenTeam} onChangeTeam={onChangeTeam} onRetry={onRetryTeam} />
          <FixtureTicker staticData={staticData} fromGw={event && event.id} />
        </div>
        {/* Keyed by gameweek so a new one starts on its first panel. */}
        <TransferTrends key={event ? event.id : 0} staticData={staticData} event={event} isPast={isPast} live={live} />
      </div>
    </div>
  );
}
