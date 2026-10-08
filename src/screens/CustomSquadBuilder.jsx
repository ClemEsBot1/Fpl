// "Pick your own squad": build 15 players within budget and preview chips.
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, Crown, Layers, Search, Zap } from 'lucide-react';
import { EmptyCard, Pitch, PlayerCard } from '../components/Pitch.jsx';
import { POSITION_LABELS, fmtPrice, fmtPts, playerMatchesSearch, searchKey } from '../lib/format.js';
import { MAX_PER_REAL_TEAM, POSITION_ORDER, SQUAD_BUDGET } from '../lib/predictions.js';
import { CHIP_INFO, getValidFormations, pickFormationStarters } from '../lib/squadLogic.js';

// Starters' ids, best captain pick first.
function suggestCaptainOrder(starters, predictionsById) {
  return [...starters]
    .sort((a, b) => predictionsById[b.id].nextMatchPredicted - predictionsById[a.id].nextMatchPredicted)
    .map(p => p.id);
}

export function CustomSquadBuilder({ staticData, onSubmit, onBack }) {
  const { allPlayers, teamsById, predictionsById } = staticData;
  const [picks, setPicks] = useState({ 1: [null, null], 2: [null, null, null, null, null], 3: [null, null, null, null, null], 4: [null, null, null] });
  const [activeSlot, setActiveSlot] = useState(null); // { posId, idx }
  const [query, setQuery] = useState('');
  const formations = getValidFormations();
  const [formationKey, setFormationKey] = useState('4-4-2');
  const [captainId, setCaptainId] = useState(null);
  const [viceCaptainId, setViceCaptainId] = useState(null);
  const [chipPreview, setChipPreview] = useState(null);

  const squad15 = POSITION_ORDER.flatMap(pos => picks[pos].filter(Boolean));
  const filledCount = squad15.length;
  const allSelected = filledCount === 15;
  // Money in whole tenths of £1m, as FPL stores prices: adding up decimal
  // prices can come to 100.00000000000001 for a squad costing exactly £100m.
  const totalCostTenths = squad15.reduce((s, p) => s + Math.round(p.price * 10), 0);
  const remainingTenths = Math.round(SQUAD_BUDGET * 10) - totalCostTenths;
  const remaining = remainingTenths / 10;
  const teamCounts = {};
  squad15.forEach(p => { teamCounts[p.team] = (teamCounts[p.team] || 0) + 1; });
  const overCapTeam = Object.entries(teamCounts).find(([, c]) => c > MAX_PER_REAL_TEAM);

  const formation = formations.find(f => f.key === formationKey) || formations[0];
  const startersSet = allSelected ? pickFormationStarters(squad15, formation, predictionsById) : new Set();
  const starters = squad15.filter(p => startersSet.has(p.id));
  const bench = squad15.filter(p => !startersSet.has(p.id));

  // Keep the armbands on starters whenever the starting XI changes (a new
  // formation, a player changed or benched): anyone no longer starting
  // loses theirs, and an empty armband goes to the best starter. While the
  // squad is still being filled in there's no XI, so choices are left as
  // they are.
  const starterKey = starters.map(p => p.id).join(',');
  useEffect(() => {
    if (!allSelected || !starters.length) return;
    const startingIds = new Set(starters.map(p => p.id));
    const ranked = suggestCaptainOrder(starters, predictionsById);
    const captain = startingIds.has(captainId) ? captainId : ranked[0];
    const vice = startingIds.has(viceCaptainId) && viceCaptainId !== captain ? viceCaptainId : ranked.find(id => id !== captain);
    if (captain !== captainId) setCaptainId(captain);
    if (vice !== viceCaptainId) setViceCaptainId(vice ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSelected, starterKey]);

  const xiTotal = starters.reduce((s, p) => s + predictionsById[p.id].predicted * (p.id === captainId ? 2 : 1), 0);
  const benchTotal = bench.reduce((s, p) => s + predictionsById[p.id].predicted, 0);
  const captainPred = captainId ? predictionsById[captainId].predicted : 0;
  let previewTotal = xiTotal;
  if (chipPreview === 'bboost') previewTotal = xiTotal + benchTotal;
  if (chipPreview === '3xc') previewTotal = xiTotal + captainPred;

  // Each position's players, best first: sorted once, not per keystroke.
  const sortedByPosition = useMemo(() => {
    const byPos = { 1: [], 2: [], 3: [], 4: [] };
    allPlayers.forEach(p => byPos[p.positionId].push(p));
    POSITION_ORDER.forEach(pos => byPos[pos].sort((a, b) => predictionsById[b.id].predicted - predictionsById[a.id].predicted));
    return byPos;
  }, [allPlayers, predictionsById]);
  const squadIds = new Set(squad15.map(p => p.id));
  const searching = searchKey(query).length >= 2;
  const candidates = [];
  const current = activeSlot ? picks[activeSlot.posId][activeSlot.idx] : null;
  if (activeSlot) {
    for (const p of sortedByPosition[activeSlot.posId]) {
      if (squadIds.has(p.id) || (searching && !playerMatchesSearch(p, query))) continue;
      candidates.push(p);
      if (candidates.length === 12) break;
    }
  }
  // Why a player can't go in the open slot: the money left (with the
  // player in it now sold) or a fourth player from one club.
  function blockerFor(p) {
    const freed = current ? Math.round(current.price * 10) : 0;
    if (Math.round(p.price * 10) > remainingTenths + freed) return 'Over budget';
    const fromClub = squad15.filter(x => x.team === p.team && (!current || x.id !== current.id)).length;
    if (fromClub >= MAX_PER_REAL_TEAM) return `${MAX_PER_REAL_TEAM} from club already`;
    return null;
  }

  function pickPlayer(player) {
    if (!activeSlot) return;
    setPicks(prev => {
      const arr = [...prev[activeSlot.posId]];
      arr[activeSlot.idx] = player;
      return { ...prev, [activeSlot.posId]: arr };
    });
    setActiveSlot(null);
    setQuery('');
  }

  // Armbands are re-checked once the squad is full again (see above), so
  // removing the captain hands the armband on rather than leaving it on a
  // player who's gone.
  function removePlayer(posId, idx) {
    setPicks(prev => {
      const arr = [...prev[posId]];
      arr[idx] = null;
      return { ...prev, [posId]: arr };
    });
  }

  // The squad on the pitch: while it's being filled in, all 15 places by
  // position (empty ones to tap); once full, the XI in formation and the
  // bench. Each place knows where it sits in `picks`.
  const placeOf = {};
  POSITION_ORDER.forEach(pos => picks[pos].forEach((p, idx) => { if (p) placeOf[p.id] = { posId: pos, idx }; }));
  const slotRows = POSITION_ORDER.map(pos => picks[pos].map((p, idx) => ({ empty: !p, posId: pos, idx, player: p || { id: `${pos}-${idx}`, positionId: pos } })));
  const asSlot = p => ({ player: p, isCaptain: p.id === captainId, isViceCaptain: p.id === viceCaptainId, availNote: predictionsById[p.id] ? predictionsById[p.id].availNote : null, posId: placeOf[p.id].posId, idx: placeOf[p.id].idx });
  const starterSlots = allSelected ? starters.map(asSlot) : [];
  const benchSlots = allSelected ? [...bench].sort((a, b) => (a.positionId === 1 ? -1 : b.positionId === 1 ? 1 : 0)).map(asSlot) : [];
  const openPlace = (posId, idx) => {
    const isOpen = activeSlot && activeSlot.posId === posId && activeSlot.idx === idx;
    setActiveSlot(isOpen ? null : { posId, idx });
    setQuery('');
  };
  const slotCard = slot => {
    const isOpen = activeSlot && activeSlot.posId === slot.posId && activeSlot.idx === slot.idx;
    if (slot.empty) return <EmptyCard key={`${slot.posId}-${slot.idx}`} positionId={slot.posId} onClick={() => openPlace(slot.posId, slot.idx)} />;
    const p = slot.player;
    const pred = predictionsById[p.id];
    return (
      <PlayerCard
        key={p.id}
        slot={allSelected ? slot : { ...slot, isCaptain: false, isViceCaptain: false }}
        team={teamsById[p.team]}
        price={p.price}
        points={fmtPts(pred.predicted)}
        info={teamsById[p.team] ? teamsById[p.team].short_name : ''}
        state={isOpen ? 'selected' : null}
        onClick={() => openPlace(slot.posId, slot.idx)}
        onRemove={() => { removePlayer(slot.posId, slot.idx); if (isOpen) setActiveSlot(null); }}
        label={`${p.webName}, ${fmtPrice(p.price)}: change`}
      />
    );
  };

  function handleContinue() {
    const squad = squad15.map(p => {
      const pred = predictionsById[p.id];
      const isCaptain = p.id === captainId;
      return {
        player: p, predicted: pred.predicted, nextMatchPredicted: pred.nextMatchPredicted, availNote: pred.availNote, breakdown: pred.breakdown,
        isStarting: startersSet.has(p.id), isCaptain, isViceCaptain: p.id === viceCaptainId,
        multiplier: isCaptain ? 2 : 1,
      };
    });
    onSubmit(squad, remainingTenths);
  }

  const captainStarts = starters.some(p => p.id === captainId);
  const canContinue = allSelected && !overCapTeam && remainingTenths >= 0 && captainStarts;

  return (
    <div className="fpl-builder-page">
      <button onClick={onBack} className="fpl-mono fpl-back-btn">
        <ChevronLeft size={14} /> BACK
      </button>
      <h1 className="fpl-display fpl-screen-title">Pick your own squad</h1>
      <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: 14, lineHeight: 1.5 }}>
        Choose all 15 players, set your formation and captain, then preview what each chip would do.
      </p>

      <div className="fpl-block" style={{ padding: 10, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span className="fpl-mono" style={{ fontSize: '0.78rem' }}>{filledCount}/15 selected</span>
        <span className="fpl-mono" style={{ fontSize: '0.78rem', color: remainingTenths < 0 ? 'var(--red)' : 'var(--ink-dim)' }}>
          {remainingTenths < 0 ? `Over budget by ${fmtPrice(-remaining)}` : `${fmtPrice(remaining)} left of £${SQUAD_BUDGET.toFixed(1)}m`}
        </span>
      </div>
      {overCapTeam && (
        <div className="fpl-block" style={{ padding: 10, marginBottom: 16, borderLeft: '3px solid var(--red)', fontSize: '0.8rem', color: 'var(--red)' }}>
          Max {MAX_PER_REAL_TEAM} players per real club — you have {overCapTeam[1]} from {teamsById[overCapTeam[0]] ? teamsById[overCapTeam[0]].short_name : 'one club'}.
        </div>
      )}

      <div className="fpl-builder">
        <div className="fpl-builder-main">
          <Pitch
            rows={allSelected ? null : slotRows}
            starters={allSelected ? starterSlots : null}
            bench={allSelected ? benchSlots : null}
            card={slotCard}
            className={allSelected ? '' : 'is-squad'}
          />
          <p className="fpl-mono fpl-meta">{allSelected ? 'Tap a player to change them. The XI is picked by predicted points for the formation.' : 'Tap an empty shirt to pick a player.'}</p>
        </div>

        <div className="fpl-builder-side">
          {activeSlot ? (
            <div className="fpl-block fpl-builder-pick">
              <div className="fpl-builder-pick-head">
                <b className="fpl-display">{current ? `Replace ${current.webName}` : `Pick a ${POSITION_LABELS[activeSlot.posId]}`}</b>
                <button type="button" className="fpl-link" onClick={() => { setActiveSlot(null); setQuery(''); }}>Close</button>
              </div>
              <div style={{ position: 'relative' }}>
                <Search size={14} aria-hidden="true" style={{ position: 'absolute', left: 9, top: 11, color: 'var(--ink-dim)' }} />
                <input
                  className="fpl-input"
                  style={{ paddingLeft: 30, fontSize: '0.85rem' }}
                  placeholder={`Search ${POSITION_LABELS[activeSlot.posId]}…`}
                  aria-label={`Search ${POSITION_LABELS[activeSlot.posId]}`}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="fpl-mono fpl-meta">Budget for this place: {fmtPrice((remainingTenths + (current ? Math.round(current.price * 10) : 0)) / 10)}</div>
              {candidates.length === 0 && <div style={{ fontSize: '0.78rem', color: 'var(--ink-dim)' }}>No matching players.</div>}
              {candidates.map(p => {
                const team = teamsById[p.team];
                const blocker = blockerFor(p);
                return (
                  <button type="button" key={p.id} className="fpl-search-item" disabled={!!blocker}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, opacity: blocker ? 0.55 : 1, cursor: blocker ? 'not-allowed' : 'pointer' }}
                    onClick={() => { if (!blocker) pickPlayer(p); }}>
                    <span style={{ minWidth: 0, textAlign: 'left' }}>
                      <strong>{p.webName}</strong> <span className="fpl-dim">· {team ? team.short_name : '—'}</span>
                      {blocker ? <span className="fpl-mono" style={{ display: 'block', fontSize: '0.62rem', color: 'var(--amber)' }}>{blocker}</span> : null}
                    </span>
                    <span className="fpl-mono" style={{ fontSize: '0.72rem', display: 'flex', gap: 8, flexShrink: 0 }}>
                      <span style={{ color: 'var(--green)' }}>{fmtPts(predictionsById[p.id].predicted)}pts</span>
                      <span className="fpl-dim">{fmtPrice(p.price)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

      {allSelected && (
        <>
          <div className="fpl-section-title fpl-inline"><Layers size={14} /> Formation</div>
          <div className="fpl-block" style={{ padding: 12, marginBottom: 14 }}>
            <select className="fpl-input" style={{ fontSize: '0.85rem' }} aria-label="Formation" value={formationKey} onChange={e => setFormationKey(e.target.value)}>
              {formations.map(f => <option key={f.key} value={f.key}>{f.key}</option>)}
            </select>
          </div>

          <div className="fpl-section-title fpl-inline"><Crown size={14} /> Captaincy</div>
          <div className="fpl-block" style={{ padding: 12, marginBottom: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 140 }}>
              <div className="fpl-mono" style={{ fontSize: '0.65rem', color: 'var(--ink-dim)', marginBottom: 4 }}>CAPTAIN</div>
              <select className="fpl-input" style={{ fontSize: '0.82rem' }} value={captainId || ''} onChange={e => setCaptainId(Number(e.target.value) || null)}>
                <option value="">— none —</option>
                {starters.map(p => <option key={p.id} value={p.id} disabled={p.id === viceCaptainId}>{p.webName}</option>)}
              </select>
            </label>
            <label style={{ flex: 1, minWidth: 140 }}>
              <div className="fpl-mono" style={{ fontSize: '0.65rem', color: 'var(--ink-dim)', marginBottom: 4 }}>VICE-CAPTAIN</div>
              <select className="fpl-input" style={{ fontSize: '0.82rem' }} value={viceCaptainId || ''} onChange={e => setViceCaptainId(Number(e.target.value) || null)}>
                <option value="">— none —</option>
                {starters.map(p => <option key={p.id} value={p.id} disabled={p.id === captainId}>{p.webName}</option>)}
              </select>
            </label>
          </div>

          <div className="fpl-section-title fpl-inline"><Zap size={14} /> Preview a chip</div>
          <div className="fpl-block" style={{ padding: 12, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <button className={`fpl-chip-btn ${chipPreview === null ? 'active' : ''}`} onClick={() => setChipPreview(null)}>No chip</button>
              {Object.entries(CHIP_INFO).map(([key, info]) => (
                <button key={key} className={`fpl-chip-btn ${chipPreview === key ? 'active' : ''}`} onClick={() => setChipPreview(key)}>{info.label}</button>
              ))}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--ink-dim)', lineHeight: 1.5, marginBottom: 10 }}>
              {chipPreview ? CHIP_INFO[chipPreview].desc : 'No chip active — normal scoring (starting XI only, captain at 2x).'}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="fpl-mono" style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--blue)' }}>{fmtPts(previewTotal)}</span>
              <span className="fpl-mono" style={{ fontSize: '0.62rem', color: 'var(--ink-dim)' }}>PREDICTED PTS WITH THIS CHIP</span>
            </div>
            {(chipPreview === 'bboost' || chipPreview === '3xc') && (
              <div className="fpl-mono" style={{ fontSize: '0.65rem', color: 'var(--ink-dim)', marginTop: 4 }}>vs {fmtPts(xiTotal)}pts with no chip</div>
            )}
          </div>
        </>
      )}

      <button
        className="fpl-btn fpl-btn-solid"
        style={{ width: '100%', textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
        disabled={!canContinue}
        onClick={handleContinue}
      >
        {!allSelected ? `Pick ${15 - filledCount} more player${15 - filledCount === 1 ? '' : 's'}`
          : overCapTeam ? 'Fix club limit to continue'
          : remainingTenths < 0 ? 'Over budget — swap a player'
          : !captainStarts ? 'Pick a captain to continue'
          : 'See full results'} <ArrowRight size={16} />
      </button>
        </div>
      </div>
    </div>
  );
}
