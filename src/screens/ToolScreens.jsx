// Two planning tools: the full fixture ticker, and players side by side.
import { Fragment, useMemo, useState } from 'react';
import { ArrowDownAZ, CalendarRange, ChevronDown, Compass, GitCompareArrows, Plus, Signal, TrendingDown, TrendingUp, Ticket, X } from 'lucide-react';
import { PlayerSearchPicker } from '../components/common.jsx';
import { Shirt } from '../components/Pitch.jsx';
import { DIFF_COLORS, POSITION_LABELS, fmtPrice, fmtPts, playerMatchesSearch, searchKey } from '../lib/format.js';
import { buildFixtureTicker } from '../lib/fixtureTicker.js';
import { haulChance } from '../lib/captaincy.js';
import { priceForecast } from '../lib/priceForecast.js';
import { planChips } from '../lib/chipPlanner.js';

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

/* ------------------------------------------------------------------ */
/* Explore: a searchable, sortable player table, the price-change     */
/* forecast, and chip timing — all from the same live data.           */
/* ------------------------------------------------------------------ */

const EXPLORE_SORTS = {
  predicted: { label: 'Pts/wk', get: (p, pred) => pred.predicted, fmt: fmtPts },
  next: { label: 'This GW', get: (p, pred) => pred.nextMatchPredicted, fmt: fmtPts },
  form: { label: 'Form', get: p => p.form, fmt: n => n.toFixed(1) },
  price: { label: 'Price', get: p => p.price, fmt: fmtPrice },
  owned: { label: 'Owned', get: p => p.selectedBy, fmt: n => `${n.toFixed(1)}%` },
};
const POS_FILTERS = [{ id: 0, label: 'All' }, { id: 1, label: 'GKP' }, { id: 2, label: 'DEF' }, { id: 3, label: 'MID' }, { id: 4, label: 'FWD' }];

function PlayerExploreTable({ staticData, compareIds, onToggleCompare }) {
  const [pos, setPos] = useState(0);
  const [maxPrice, setMaxPrice] = useState(15);
  const [team, setTeam] = useState(0);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('predicted');

  const teams = useMemo(
    () => Object.values(staticData.teamsById).sort((a, b) => a.name.localeCompare(b.name)),
    [staticData],
  );
  const rows = useMemo(() => {
    const spec = EXPLORE_SORTS[sort];
    const query = searchKey(q);
    return staticData.allPlayers
      .filter(p => (pos === 0 || p.positionId === pos)
        && p.price <= maxPrice
        && (team === 0 || p.team === team)
        && p.status !== 'u' && p.status !== 'n'
        && (query.length < 2 || playerMatchesSearch(p, q)))
      .map(p => ({ p, pred: staticData.predictionsById[p.id] }))
      .sort((a, b) => spec.get(b.p, b.pred) - spec.get(a.p, a.pred))
      .slice(0, 60);
  }, [staticData, pos, maxPrice, team, q, sort]);

  return (
    <div className="fpl-glass fpl-tool-card">
      <div className="fpl-explore-filters">
        <div className="fpl-seg" role="group" aria-label="Position">
          {POS_FILTERS.map(f => (
            <button key={f.id} type="button" className={pos === f.id ? 'is-on' : ''} aria-pressed={pos === f.id} onClick={() => setPos(f.id)}>{f.label}</button>
          ))}
        </div>
        <label className="fpl-explore-field">
          <span className="fpl-meta">Club</span>
          <select className="fpl-input" value={team} onChange={e => setTeam(Number(e.target.value))}>
            <option value={0}>All clubs</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="fpl-explore-field">
          <span className="fpl-meta">Max price {fmtPrice(maxPrice)}</span>
          <input type="range" min="4" max="15" step="0.5" value={maxPrice} onChange={e => setMaxPrice(Number(e.target.value))} />
        </label>
        <label className="fpl-explore-field fpl-explore-search">
          <span className="fpl-meta">Name</span>
          <input className="fpl-input" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
        </label>
      </div>
      <div className="fpl-compare-wrap">
        <table className="fpl-explore-table">
          <thead>
            <tr>
              <th scope="col">Player</th>
              <th scope="col">Pos</th>
              {Object.entries(EXPLORE_SORTS).map(([key, spec]) => (
                <th key={key} scope="col">
                  <button type="button" className={`fpl-sortbtn${sort === key ? ' is-active' : ''}`} aria-pressed={sort === key} onClick={() => setSort(key)}>
                    {spec.label}{sort === key ? <ChevronDown size={12} aria-hidden="true" /> : null}
                  </button>
                </th>
              ))}
              <th scope="col"><span className="fpl-sr-only">Compare</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, pred }) => (
              <tr key={p.id}>
                <th scope="row">
                  <span className="fpl-explore-shirt"><Shirt team={staticData.teamsById[p.team]} isKeeper={p.positionId === 1} /></span>
                  {p.webName}{pred.availNote ? <span className="fpl-club-flag" title={pred.availNote}> !</span> : null}
                </th>
                <td>{POSITION_LABELS[p.positionId]}</td>
                <td className="fpl-club-pts">{fmtPts(pred.predicted)}</td>
                <td>{fmtPts(pred.nextMatchPredicted)}</td>
                <td>{p.form.toFixed(1)}</td>
                <td>{fmtPrice(p.price)}</td>
                <td>{p.selectedBy.toFixed(1)}%</td>
                <td><CompareToggle player={p} compareIds={compareIds} onToggleCompare={onToggleCompare} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <p className="fpl-tool-note">No players match those filters.</p> : <p className="fpl-meta fpl-explore-count">Showing {rows.length} players.</p>}
    </div>
  );
}

function PriceMoveList({ title, rows, teamsById, Icon, tone }) {
  return (
    <div className={`fpl-price-col is-${tone}`}>
      <h3 className="fpl-price-h"><Icon size={16} aria-hidden="true" /> {title}</h3>
      {rows.length ? (
        <ul className="fpl-price-list">
          {rows.map(r => (
            <li key={r.id}>
              <span className="fpl-price-name">{r.webName}<span className="fpl-meta"> · {teamsById[r.team]?.short_name} · {POSITION_LABELS[r.positionId]}</span></span>
              <span className="fpl-price-meta">
                <span className="fpl-mono">{Math.round(r.percent)}%</span>
                {r.alreadyMoved ? <span className="fpl-price-moved" title="Price already changed this gameweek">moved</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="fpl-tool-note">Nothing close right now.</p>}
    </div>
  );
}

function ChipCard({ suggestion }) {
  if (!suggestion) return null;
  return (
    <div className={`fpl-chip-card is-${suggestion.strength}`}>
      <div className="fpl-chip-top"><span className="fpl-chip-name">{suggestion.chip}</span><span className="fpl-chip-gw">GW{suggestion.event}</span></div>
      <p className="fpl-chip-reason">{suggestion.reason}</p>
    </div>
  );
}

export function ExploreScreen({ staticData, compareIds, onToggleCompare }) {
  const prices = useMemo(() => (staticData ? priceForecast(staticData.allPlayers, { limit: 12 }) : { risers: [], fallers: [] }), [staticData]);
  const chips = useMemo(() => (staticData ? planChips(staticData) : null), [staticData]);
  if (!staticData) return null;
  const anyChip = chips && (chips.benchBoost || chips.tripleCaptain || chips.freeHit || chips.wildcard);
  return (
    <div className="fpl-tool">
      <header className="fpl-tool-head">
        <h1 className="fpl-tool-h"><Compass size={22} aria-hidden="true" /> Explore</h1>
        <p className="fpl-tool-sub">Every player, filterable and sortable; who is close to a price change tonight; and the best gameweeks for your chips.</p>
      </header>

      <PlayerExploreTable staticData={staticData} compareIds={compareIds} onToggleCompare={onToggleCompare} />

      <section className="fpl-glass fpl-tool-card">
        <h2 className="fpl-tool-h2"><TrendingUp size={18} aria-hidden="true" /> Price changes tonight</h2>
        <p className="fpl-tool-sub">From FPL's own progress-to-change signal — a forecast, not a certainty.</p>
        <div className="fpl-price-grid">
          <PriceMoveList title="Likely risers" rows={prices.risers} teamsById={staticData.teamsById} Icon={TrendingUp} tone="up" />
          <PriceMoveList title="Likely fallers" rows={prices.fallers} teamsById={staticData.teamsById} Icon={TrendingDown} tone="down" />
        </div>
      </section>

      <section className="fpl-glass fpl-tool-card">
        <h2 className="fpl-tool-h2"><Ticket size={18} aria-hidden="true" /> Chip timing</h2>
        <p className="fpl-tool-sub">The strongest upcoming gameweek for each chip, from the fixture schedule (double and blank gameweeks).</p>
        {anyChip ? (
          <div className="fpl-chip-grid">
            <ChipCard suggestion={chips.benchBoost} />
            <ChipCard suggestion={chips.tripleCaptain} />
            <ChipCard suggestion={chips.freeHit} />
            <ChipCard suggestion={chips.wildcard} />
          </div>
        ) : <p className="fpl-tool-note">No clear double or blank gameweeks in the schedule yet — the fixture list this far out can still change.</p>}
      </section>
    </div>
  );
}
