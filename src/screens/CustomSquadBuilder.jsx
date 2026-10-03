// "Pick your own squad": build 15 players within budget and preview chips.
import { useEffect, useState } from 'react';
import { ArrowRight, ChevronLeft, Crown, Layers, Plus, Search, X, Zap } from 'lucide-react';
import { POSITION_LABELS, fmtPrice, fmtPts, normalize } from '../lib/format.js';
import { MAX_PER_REAL_TEAM, POSITION_ORDER, SQUAD_BUDGET, SQUAD_SLOTS } from '../lib/predictions.js';
import { CHIP_INFO, getValidFormations, pickFormationStarters, suggestCaptain } from '../lib/squadLogic.js';

export function SquadSlotRow({ posLabel, player, predictionsById, teamsById, isOpen, onOpenPicker, onRemove }) {
  if (!player) {
    return (
      <button className="fpl-btn" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', marginBottom: 6, borderStyle: 'dashed' }} onClick={onOpenPicker}>
        <Plus size={16} /> <span className="fpl-mono" style={{ fontSize: '0.78rem' }}>Add {posLabel}</span>
      </button>
    );
  }
  const team = teamsById[player.team];
  const pred = predictionsById[player.id];
  return (
    <div className="fpl-block" style={{ marginBottom: 6, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, borderColor: isOpen ? 'var(--blue)' : undefined }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="fpl-display" style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.webName}</div>
        <div className="fpl-mono" style={{ fontSize: '0.65rem', color: 'var(--ink-dim)' }}>
          {team ? team.short_name : '—'} · {fmtPrice(player.price)} · {fmtPts(pred.predicted)}pts/wk
        </div>
      </div>
      <button className="fpl-chip-btn" onClick={onOpenPicker}>Change</button>
      <button className="fpl-chip-btn" onClick={onRemove} title="Remove" style={{ color: 'var(--red)' }}><X size={12} /></button>
    </div>
  );
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
  const totalCost = squad15.reduce((s, p) => s + p.price, 0);
  const remaining = SQUAD_BUDGET - totalCost;
  const teamCounts = {};
  squad15.forEach(p => { teamCounts[p.team] = (teamCounts[p.team] || 0) + 1; });
  const overCapTeam = Object.entries(teamCounts).find(([, c]) => c > MAX_PER_REAL_TEAM);

  const formation = formations.find(f => f.key === formationKey) || formations[0];
  const startersSet = allSelected ? pickFormationStarters(squad15, formation, predictionsById) : new Set();
  const starters = squad15.filter(p => startersSet.has(p.id));
  const bench = squad15.filter(p => !startersSet.has(p.id));

  // Keep captain/vice pointed at valid starters as the formation/selection changes.
  useEffect(() => {
    if (captainId && !starters.some(p => p.id === captainId)) setCaptainId(null);
    if (viceCaptainId && !starters.some(p => p.id === viceCaptainId)) setViceCaptainId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formationKey, filledCount]);

  useEffect(() => {
    if (allSelected && !captainId && starters.length) {
      const top = suggestCaptain(starters.map(p => ({ player: p, nextMatchPredicted: predictionsById[p.id].nextMatchPredicted })));
      if (top) setCaptainId(top.player.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSelected, formationKey]);

  const xiTotal = starters.reduce((s, p) => s + predictionsById[p.id].predicted * (p.id === captainId ? 2 : 1), 0);
  const benchTotal = bench.reduce((s, p) => s + predictionsById[p.id].predicted, 0);
  const captainPred = captainId ? predictionsById[captainId].predicted : 0;
  let previewTotal = xiTotal;
  if (chipPreview === 'bboost') previewTotal = xiTotal + benchTotal;
  if (chipPreview === '3xc') previewTotal = xiTotal + captainPred;

  const squadIds = new Set(squad15.map(p => p.id));
  const nq = normalize(query);
  const candidates = activeSlot ? allPlayers
    .filter(p => p.positionId === activeSlot.posId && !squadIds.has(p.id))
    .filter(p => nq.length < 2 || normalize(p.webName).includes(nq) || normalize(p.secondName).includes(nq))
    .sort((a, b) => predictionsById[b.id].predicted - predictionsById[a.id].predicted)
    .slice(0, 8) : [];

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

  function removePlayer(posId, idx) {
    setPicks(prev => {
      const arr = [...prev[posId]];
      const removed = arr[idx];
      arr[idx] = null;
      if (removed) {
        if (removed.id === captainId) setCaptainId(null);
        if (removed.id === viceCaptainId) setViceCaptainId(null);
      }
      return { ...prev, [posId]: arr };
    });
  }

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
    const bankTenths = Math.round(remaining * 10);
    onSubmit(squad, bankTenths);
  }

  const canContinue = allSelected && !overCapTeam && remaining >= -1e-9 && captainId;

  return (
    <div style={{ padding: '20px 16px 100px' }}>
      <button onClick={onBack} className="fpl-mono fpl-back-btn">
        <ChevronLeft size={14} /> BACK
      </button>
      <h1 className="fpl-display fpl-screen-title">Pick your own squad</h1>
      <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: 14, lineHeight: 1.5 }}>
        Choose all 15 players, set your formation and captain, then preview what each chip would do.
      </p>

      <div className="fpl-block" style={{ padding: 10, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span className="fpl-mono" style={{ fontSize: '0.78rem' }}>{filledCount}/15 selected</span>
        <span className="fpl-mono" style={{ fontSize: '0.78rem', color: remaining < 0 ? 'var(--red)' : 'var(--ink-dim)' }}>
          {remaining < 0 ? `Over budget by ${fmtPrice(-remaining)}` : `${fmtPrice(remaining)} left of £${SQUAD_BUDGET.toFixed(1)}m`}
        </span>
      </div>
      {overCapTeam && (
        <div className="fpl-block" style={{ padding: 10, marginBottom: 16, borderLeft: '3px solid var(--red)', fontSize: '0.8rem', color: 'var(--red)' }}>
          Max {MAX_PER_REAL_TEAM} players per real club — you have {overCapTeam[1]} from {teamsById[overCapTeam[0]] ? teamsById[overCapTeam[0]].short_name : 'one club'}.
        </div>
      )}

      {POSITION_ORDER.map(posId => (
        <div key={posId} style={{ marginBottom: 14 }}>
          <div className="fpl-section-title">{POSITION_LABELS[posId]} ({picks[posId].filter(Boolean).length}/{SQUAD_SLOTS[posId]})</div>
          <div style={{ marginTop: 8 }}>
            {picks[posId].map((player, idx) => {
              const isOpen = activeSlot && activeSlot.posId === posId && activeSlot.idx === idx;
              return (
                <div key={idx}>
                  <SquadSlotRow
                    posLabel={POSITION_LABELS[posId]}
                    player={player}
                    predictionsById={predictionsById}
                    teamsById={teamsById}
                    isOpen={isOpen}
                    onOpenPicker={() => { setActiveSlot(isOpen ? null : { posId, idx }); setQuery(''); }}
                    onRemove={() => removePlayer(posId, idx)}
                  />
                  {isOpen && (
                    <div className="fpl-block" style={{ padding: 10, marginBottom: 10 }}>
                      <div style={{ position: 'relative', marginBottom: 8 }}>
                        <Search size={14} style={{ position: 'absolute', left: 9, top: 11, color: 'var(--ink-dim)' }} />
                        <input
                          className="fpl-input"
                          style={{ paddingLeft: 30, fontSize: '0.85rem' }}
                          placeholder={`Search ${POSITION_LABELS[posId]}…`}
                          value={query}
                          onChange={e => setQuery(e.target.value)}
                          autoFocus
                        />
                      </div>
                      {candidates.length === 0 && <div style={{ fontSize: '0.78rem', color: 'var(--ink-dim)' }}>No matching players.</div>}
                      {candidates.map(p => {
                        const team = teamsById[p.team];
                        return (
                          <button type="button" key={p.id} className="fpl-search-item" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }} onClick={() => pickPlayer(p)}>
                            <span><strong>{p.webName}</strong> <span className="fpl-dim">· {team ? team.short_name : '—'}</span></span>
                            <span className="fpl-mono" style={{ fontSize: '0.72rem', display: 'flex', gap: 8 }}>
                              <span style={{ color: 'var(--green)' }}>{fmtPts(predictionsById[p.id].predicted)}pts</span>
                              <span className="fpl-dim">{fmtPrice(p.price)}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {allSelected && (
        <>
          <div className="fpl-section-title fpl-inline"><Layers size={14} /> Formation</div>
          <div className="fpl-block" style={{ padding: 12, marginBottom: 14 }}>
            <select className="fpl-input" style={{ fontSize: '0.85rem', marginBottom: 12 }} value={formationKey} onChange={e => setFormationKey(e.target.value)}>
              {formations.map(f => <option key={f.key} value={f.key}>{f.key}</option>)}
            </select>
            <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', marginBottom: 6 }}>STARTING XI (auto-picked by predicted points for this formation)</div>
            {starters.map(p => (
              <div key={p.id} className="fpl-row" style={{ padding: '6px 0' }}>
                <div className="fpl-row-pos">{POSITION_LABELS[p.positionId]}</div>
                <div className="fpl-row-main fpl-row-name">
                  {p.webName}
                  {p.id === captainId && <span className="fpl-armband" title="Captain">C</span>}
                  {p.id === viceCaptainId && <span className="fpl-armband fpl-armband-vc" title="Vice-captain">V</span>}
                </div>
                <div className="fpl-mono fpl-meta-lg">{fmtPts(predictionsById[p.id].predicted)}pts</div>
              </div>
            ))}
            <div className="fpl-mono" style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', margin: '10px 0 6px' }}>BENCH</div>
            {bench.map(p => (
              <div key={p.id} className="fpl-row fpl-row-bench" style={{ padding: '6px 0' }}>
                <div className="fpl-row-pos">{POSITION_LABELS[p.positionId]}</div>
                <div className="fpl-row-main fpl-row-name">{p.webName}</div>
                <div className="fpl-mono fpl-meta-lg">{fmtPts(predictionsById[p.id].predicted)}pts</div>
              </div>
            ))}
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
          : remaining < 0 ? 'Over budget — swap a player'
          : !captainId ? 'Pick a captain to continue'
          : 'See full results'} <ArrowRight size={16} />
      </button>
    </div>
  );
}
