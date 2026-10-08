// Two planning tools: the full fixture ticker, and players side by side.
import { Fragment, useMemo, useState } from 'react';
import { ArrowDownAZ, CalendarRange, ChevronDown, GitCompareArrows, Plus, Signal, X } from 'lucide-react';
import { PlayerSearchPicker } from '../components/common.jsx';
import { Shirt } from '../components/Pitch.jsx';
import { DIFF_COLORS, POSITION_LABELS, fmtPrice, fmtPts } from '../lib/format.js';
import { buildFixtureTicker } from '../lib/fixtureTicker.js';
import { haulChance } from '../lib/captaincy.js';

export const MAX_COMPARE = 3;

function FixtureChip({ f, small }) {
  const c = DIFF_COLORS[f.difficulty] || DIFF_COLORS[3];
  const name = f.opponent ? f.opponent.short_name : '?';
  return (
    <span className={`fpl-ticker-fx${small ? ' is-small' : ''}`} style={{ background: c.bg, color: c.text }} title={`${f.opponent ? f.opponent.name : name} (${f.isHome ? 'home' : 'away'}), difficulty ${f.difficulty}`}>
      {f.isHome ? name.toUpperCase() : name.toLowerCase()}
    </span>
  );
}

function CompareToggle({ player, compareIds, onToggleCompare }) {
  const on = compareIds.includes(player.id);
  const full = !on && compareIds.length >= MAX_COMPARE;
  return (
    <button
      type="button"
      className={`fpl-chip-btn fpl-compare-toggle${on ? ' active' : ''}`}
      aria-pressed={on}
      disabled={full}
      title={full ? `Up to ${MAX_COMPARE} players` : undefined}
      onClick={() => onToggleCompare(player.id)}
    >
      {on ? <X size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />} Compare
    </button>
  );
}

// A club's players, best predicted first, under its row in the ticker.
function ClubPlayers({ team, staticData, compareIds, onToggleCompare }) {
  const players = staticData.allPlayers
    .filter(p => p.team === team.id && p.status !== 'u' && p.status !== 'n')
    .sort((a, b) => staticData.predictionsById[b.id].predicted - staticData.predictionsById[a.id].predicted)
    .slice(0, 10);
  return (
    <div className="fpl-club-players">
      <table className="fpl-club-table">
        <thead>
          <tr><th scope="col">Player</th><th scope="col">Pos</th><th scope="col">Price</th><th scope="col">Pts/wk</th><th scope="col">Owned</th><th scope="col"><span className="fpl-sr-only">Compare</span></th></tr>
        </thead>
        <tbody>
          {players.map(p => {
            const pred = staticData.predictionsById[p.id];
            return (
              <tr key={p.id}>
                <th scope="row">{p.webName}{pred.availNote ? <span className="fpl-club-flag" title={pred.availNote}> !</span> : null}</th>
                <td>{POSITION_LABELS[p.positionId]}</td>
                <td>{fmtPrice(p.price)}</td>
                <td className="fpl-club-pts">{fmtPts(pred.predicted)}</td>
                <td>{p.selectedBy.toFixed(1)}%</td>
                <td><CompareToggle player={p} compareIds={compareIds} onToggleCompare={onToggleCompare} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const WEEK_CHOICES = [4, 6, 8];

export function FixturesScreen({ staticData, compareIds, onToggleCompare, onOpenCompare }) {
  const [weeks, setWeeks] = useState(6);
  const [sort, setSort] = useState('ease');
  const [openTeam, setOpenTeam] = useState(null);
  const fromGw = staticData && staticData.targetEvent ? staticData.targetEvent.id : null;
  const ticker = useMemo(
    () => (staticData && fromGw ? buildFixtureTicker(staticData.fixturesByTeam, staticData.teamsById, fromGw, weeks) : null),
    [staticData, fromGw, weeks],
  );
  if (!ticker) return null;
  const rows = sort === 'ease' ? ticker.rows : [...ticker.rows].sort((a, b) => a.team.name.localeCompare(b.team.name));
  const doubles = ticker.gws.filter(gw => ticker.rows.some(r => r.weeks.find(w => w.gw === gw).fixtures.length > 1));
  const blanks = ticker.gws.filter(gw => ticker.rows.some(r => r.weeks.find(w => w.gw === gw).fixtures.length === 0));

  return (
    <div className="fpl-tool">
      <header className="fpl-tool-head">
        <h1 className="fpl-tool-h"><CalendarRange size={22} aria-hidden="true" /> Fixtures</h1>
        <p className="fpl-tool-sub">Every club's next {weeks} gameweeks, coloured by FPL's difficulty. Tap a club to see its best players.</p>
      </header>
      <div className="fpl-tool-bar">
        <div className="fpl-seg" role="group" aria-label="Gameweeks shown">
          {WEEK_CHOICES.map(n => (
            <button key={n} type="button" className={weeks === n ? 'is-on' : ''} aria-pressed={weeks === n} onClick={() => setWeeks(n)}>{n} GWs</button>
          ))}
        </div>
        <div className="fpl-seg" role="group" aria-label="Sort clubs">
          <button type="button" className={sort === 'ease' ? 'is-on' : ''} aria-pressed={sort === 'ease'} onClick={() => setSort('ease')}><Signal size={14} aria-hidden="true" /> Easiest</button>
          <button type="button" className={sort === 'name' ? 'is-on' : ''} aria-pressed={sort === 'name'} onClick={() => setSort('name')}><ArrowDownAZ size={14} aria-hidden="true" /> A–Z</button>
        </div>
        {compareIds.length ? (
          <button type="button" className="fpl-btn fpl-btn-solid" onClick={onOpenCompare}><GitCompareArrows size={15} aria-hidden="true" /> Compare {compareIds.length}</button>
        ) : null}
      </div>
      {doubles.length || blanks.length ? (
        <p className="fpl-tool-note">
          {doubles.length ? <>Double gameweek{doubles.length > 1 ? 's' : ''}: <b>{doubles.map(g => `GW${g}`).join(', ')}</b>. </> : null}
          {blanks.length ? <>Blank gameweek{blanks.length > 1 ? 's' : ''}: <b>{blanks.map(g => `GW${g}`).join(', ')}</b>.</> : null}
        </p>
      ) : null}
      <div className="fpl-glass fpl-tool-card">
        <div className="fpl-ticker-wrap">
          <table className="fpl-ticker fpl-ticker-full">
            <thead>
              <tr>
                <th scope="col">Club</th>
                {ticker.gws.map(gw => <th key={gw} scope="col" className={doubles.includes(gw) ? 'is-double' : blanks.includes(gw) ? 'is-blank' : ''}>GW{gw}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ team, weeks: ws }) => {
                const open = openTeam === team.id;
                return (
                  <Fragment key={team.id}>
                    <tr className={open ? 'is-open' : ''}>
                      <th scope="row">
                        <button type="button" className="fpl-ticker-club" aria-expanded={open} onClick={() => setOpenTeam(open ? null : team.id)}>
                          <span className="fpl-ticker-shirt"><Shirt team={team} /></span>
                          {team.short_name}
                          <ChevronDown size={14} aria-hidden="true" className="fpl-ticker-chev" />
                        </button>
                      </th>
                      {ws.map(w => (
                        <td key={w.gw}>
                          {w.fixtures.length ? (
                            <span className="fpl-ticker-cell">{w.fixtures.map((f, k) => <FixtureChip key={k} f={f} small={w.fixtures.length > 1} />)}</span>
                          ) : <span className="fpl-ticker-blank" title="No match this gameweek">–</span>}
                        </td>
                      ))}
                    </tr>
                    {open ? (
                      <tr className="fpl-ticker-detail">
                        <td colSpan={ws.length + 1}>
                          <ClubPlayers team={team} staticData={staticData} compareIds={compareIds} onToggleCompare={onToggleCompare} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="fpl-ticker-legend" aria-hidden="true">
          <span>Easier</span>
          {[1, 2, 3, 4, 5].map(d => <i key={d} style={{ background: DIFF_COLORS[d].bg }} />)}
          <span>Harder</span>
          <span className="fpl-ticker-legend-note">CAPITALS home, lower case away</span>
        </div>
      </div>
    </div>
  );
}

// One row of the comparison: label, a value per player, and which is best
// ('max', 'min' or null for none).
function compareRows(players, staticData) {
  const pred = p => staticData.predictionsById[p.id];
  const fixturesFor = p => {
    const byGw = pred(p).byGw || [];
    return byGw.map(w => ({
      ...w,
      fixtures: (staticData.fixturesByTeam[p.team] || []).filter(f => f.event === w.event).map(f => ({ ...f, opponent: staticData.teamsById[f.opponent] })),
    }));
  };
  const gws = (pred(players[0]).byGw || []).map(w => w.event);
  return [
    { label: 'This gameweek', best: 'max', values: players.map(p => pred(p).nextMatchPredicted), fmt: fmtPts },
    { label: 'Points a week (next 4)', best: 'max', values: players.map(p => pred(p).predicted), fmt: fmtPts },
    ...gws.map((gw, k) => ({
      label: `GW${gw}`,
      best: 'max',
      values: players.map(p => fixturesFor(p)[k]?.points ?? 0),
      fmt: fmtPts,
      extra: players.map(p => fixturesFor(p)[k]?.fixtures || []),
    })),
    { label: 'Chance of 10+ this week', best: 'max', values: players.map(p => haulChance(p.positionId, pred(p).nextMatchPredicted)), fmt: v => `${Math.round(v * 100)}%` },
    { label: 'Price', best: 'min', values: players.map(p => p.price), fmt: fmtPrice },
    { label: 'Points a week per £m', best: 'max', values: players.map(p => pred(p).predicted / p.price), fmt: v => v.toFixed(2) },
    { label: 'Season points', best: 'max', values: players.map(p => p.totalPoints), fmt: v => String(v) },
    { label: 'Points per match', best: 'max', values: players.map(p => p.pointsPerGame), fmt: v => v.toFixed(1) },
    { label: 'Minutes', best: 'max', values: players.map(p => p.minutes), fmt: v => v.toLocaleString('en-GB') },
    { label: 'Goals + assists', best: 'max', values: players.map(p => p.goalsScored + p.assists), fmt: v => String(v) },
    { label: 'xG + xA', best: 'max', values: players.map(p => p.expectedGoals + p.expectedAssists), fmt: v => v.toFixed(1) },
    { label: 'Owned by', best: null, values: players.map(p => p.selectedBy), fmt: v => `${v.toFixed(1)}%` },
  ];
}

export function CompareScreen({ staticData, compareIds, onToggleCompare, onClear }) {
  const players = compareIds.map(id => staticData && staticData.playersById[id]).filter(Boolean);
  const exclude = useMemo(() => new Set(compareIds), [compareIds]);
  const rows = players.length ? compareRows(players, staticData) : [];
  return (
    <div className="fpl-tool">
      <header className="fpl-tool-head">
        <h1 className="fpl-tool-h"><GitCompareArrows size={22} aria-hidden="true" /> Compare players</h1>
        <p className="fpl-tool-sub">Up to {MAX_COMPARE} players side by side: predictions for each of the next gameweeks, price and the season so far. The best in each row is highlighted.</p>
      </header>
      {staticData && players.length < MAX_COMPARE ? (
        <div className="fpl-compare-add">
          <PlayerSearchPicker allPlayers={staticData.allPlayers} excludeIds={exclude} onPick={p => onToggleCompare(p.id)} />
        </div>
      ) : null}
      {players.length ? (
        <div className="fpl-glass fpl-tool-card">
          <div className="fpl-compare-wrap">
            <table className="fpl-compare" style={{ '--cols': players.length }}>
              <thead>
                <tr>
                  <td />
                  {players.map(p => {
                    const pred = staticData.predictionsById[p.id];
                    return (
                      <th key={p.id} scope="col">
                        <span className="fpl-compare-shirt"><Shirt team={staticData.teamsById[p.team]} isKeeper={p.positionId === 1} /></span>
                        <span className="fpl-compare-name">{p.webName}</span>
                        <span className="fpl-mono fpl-meta">{staticData.teamsById[p.team]?.short_name} · {POSITION_LABELS[p.positionId]}</span>
                        {pred.availNote ? <span className="fpl-compare-flag">{pred.availNote}</span> : null}
                        <button type="button" className="fpl-link fpl-compare-remove" onClick={() => onToggleCompare(p.id)}>Remove</button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => {
                  const target = row.best === 'max' ? Math.max(...row.values) : row.best === 'min' ? Math.min(...row.values) : null;
                  const leads = target !== null && players.length > 1 && row.values.filter(v => v === target).length < players.length;
                  return (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      {row.values.map((v, i) => (
                        <td key={players[i].id} className={leads && v === target ? 'is-best' : ''}>
                          <span className="fpl-mono">{row.fmt(v)}</span>
                          {row.extra ? (
                            <span className="fpl-compare-fx">
                              {row.extra[i].length ? row.extra[i].map((f, k) => <FixtureChip key={k} f={f} small />) : <span className="fpl-meta">blank</span>}
                            </span>
                          ) : null}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" className="fpl-link" onClick={onClear}>Clear all</button>
        </div>
      ) : (
        <p className="fpl-tool-note">Search for a player above, or add them from Fixtures (tap a club).</p>
      )}
    </div>
  );
}
