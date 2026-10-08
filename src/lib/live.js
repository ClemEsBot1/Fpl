// Live gameweek scoring, the way FPL will settle it: bonus points projected
// from the bonus points system (BPS) until FPL confirms them, automatic
// substitutions for starters whose matches are over without them playing,
// and the vice-captain taking the armband when the captain doesn't play.

// Bonus for one match from its BPS list ([{ element, value }]): the top
// three get 3, 2 and 1, and ties share, as FPL does (two tied first both
// get 3 and the next gets 1; two tied second both get 2 and nobody gets 1).
export function bonusFromBps(entries) {
  const out = {};
  (entries || []).forEach(e => {
    const rank = 1 + entries.filter(o => o.value > e.value).length;
    if (rank <= 3) out[e.element] = 4 - rank;
  });
  return out;
}

const statList = (fixture, identifier) => {
  const stat = (fixture.stats || []).find(s => s.identifier === identifier);
  return stat ? [...(stat.h || []), ...(stat.a || [])] : [];
};

// Projected bonus for players in matches that have started but whose bonus
// FPL hasn't added yet: { [playerId]: points }. A double gameweek adds up.
export function projectedBonus(fixtures) {
  const out = {};
  (fixtures || []).forEach(f => {
    if (!f.started || statList(f, 'bonus').length) return;
    Object.entries(bonusFromBps(statList(f, 'bps'))).forEach(([id, b]) => { out[id] = (out[id] || 0) + b; });
  });
  return out;
}

// Where each club is in the gameweek: 'waiting' (a match still to start),
// 'playing' or 'done' (every match over). A double gameweek is 'done' only
// once both are over.
export function teamStates(fixtures) {
  const byTeam = {};
  (fixtures || []).forEach(f => {
    const state = f.finished || f.finished_provisional ? 'done' : f.started ? 'playing' : 'waiting';
    [f.team_h, f.team_a].forEach(t => { (byTeam[t] || (byTeam[t] = [])).push(state); });
  });
  const out = {};
  Object.entries(byTeam).forEach(([t, states]) => {
    out[t] = states.includes('playing') ? 'playing' : states.every(s => s === 'done') ? 'done' : 'waiting';
  });
  return out;
}

const MIN = { 2: 3, 3: 2, 4: 1 };

// A team's live points. picks: FPL's picks payload ({ picks, active_chip,
// entry_history }). liveById: { [id]: { totalPoints, minutes, bonus } }.
// bonus: projectedBonus(). states: teamStates(). playersById for positions
// and clubs. A club with no match this gameweek counts as 'done'.
// Returns { total, hit, rows: [{ id, player, slot, multiplier, minutes,
// points, livePoints, bonus, state, subIn, subOut, isCaptain, isViceCaptain }] }.
export function liveTeamScore({ picks, liveById, bonus, states, playersById }) {
  const chip = picks.active_chip;
  const benchBoost = chip === 'bboost';
  const rows = [...picks.picks].sort((a, b) => a.position - b.position).map(p => {
    const player = playersById[p.element];
    const live = liveById[p.element] || {};
    const minutes = live.minutes || 0;
    // FPL's own total already has the bonus once it's confirmed.
    const projected = !live.bonus && bonus[p.element] ? bonus[p.element] : 0;
    return {
      id: p.element, player, slot: p.position,
      isStarting: benchBoost || p.position <= 11,
      isCaptain: p.is_captain, isViceCaptain: p.is_vice_captain,
      pickedMultiplier: p.multiplier,
      multiplier: benchBoost ? Math.max(1, p.multiplier) : p.multiplier,
      minutes,
      livePoints: live.totalPoints || 0,
      bonus: projected,
      state: player ? states[player.team] || 'done' : 'done',
      subIn: false, subOut: false,
    };
  });
  const didNotPlay = r => r.state === 'done' && r.minutes === 0;

  if (!benchBoost) {
    const xi = rows.filter(r => r.slot <= 11);
    const bench = rows.filter(r => r.slot > 11);
    const count = { 2: 0, 3: 0, 4: 0 };
    xi.forEach(r => { if (r.player && r.player.positionId !== 1) count[r.player.positionId]++; });
    xi.filter(didNotPlay).forEach(out => {
      const pos = out.player ? out.player.positionId : 0;
      const sub = bench.find(b => {
        if (b.subIn || !b.player || b.minutes === 0) return false;
        if (pos === 1) return b.player.positionId === 1;
        if (b.player.positionId === 1) return false;
        const after = { ...count, [pos]: count[pos] - 1, [b.player.positionId]: count[b.player.positionId] + 1 };
        return after[pos] >= MIN[pos];
      });
      if (!sub) return;
      sub.subIn = true;
      sub.multiplier = 1;
      out.subOut = true;
      out.multiplier = 0;
      if (pos !== 1) { count[pos]--; count[sub.player.positionId]++; }
    });
  }

  // The vice-captain takes the armband if the captain didn't play.
  const captain = rows.find(r => r.isCaptain);
  const vice = rows.find(r => r.isViceCaptain);
  if (captain && vice && didNotPlay(captain) && vice.multiplier > 0) {
    vice.multiplier = Math.max(vice.multiplier, captain.pickedMultiplier);
    captain.multiplier = 0;
    vice.armband = true;
  }

  rows.forEach(r => { r.points = (r.livePoints + r.bonus) * r.multiplier; });
  const hit = (picks.entry_history && picks.entry_history.event_transfers_cost) || 0;
  const total = rows.reduce((s, r) => s + r.points, 0) - hit;
  return { total, hit, rows };
}
