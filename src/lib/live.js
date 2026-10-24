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

// The live bonus-points race: across every started match whose bonus FPL
// hasn't confirmed yet, the players earning the most BPS right now and the
// bonus (3/2/1) they'd get if the match ended now, highest BPS first.
// `ownedIds` flags the players in your team. Confirmed matches are left out
// — their bonus is already settled. Returns [{ element, bps, bonus, owned }].
export function liveBonusRace(fixtures, { limit = 10, ownedIds = [] } = {}) {
  const owned = new Set((ownedIds || []).map(Number));
  const rows = [];
  (fixtures || []).forEach(f => {
    if (!f.started || f.finished || f.finished_provisional) return;
    if (statList(f, 'bonus').length) return; // already confirmed
    const bps = statList(f, 'bps');
    if (!bps.length) return;
    const bonus = bonusFromBps(bps);
    bps.forEach(e => {
      rows.push({ element: e.element, bps: e.value, bonus: bonus[e.element] || 0, owned: owned.has(Number(e.element)) });
    });
  });
  return rows.sort((a, b) => b.bps - a.bps).slice(0, limit);
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
  // The week's points don't count a transfer hit (FPL takes it off the
  // season total), so it's returned on its own.
  const hit = (picks.entry_history && picks.entry_history.event_transfers_cost) || 0;
  const total = rows.reduce((s, r) => s + r.points, 0);
  return { total, hit, rows };
}

// One match in detail, for the live screen's match sheet: every player who
// has played in it, by side, with his points from this match alone (FPL's
// per-match breakdown, `explain`), BPS and bonus (confirmed, or projected
// from BPS while FPL hasn't added it), and the match's events by side.
// liveElements: event/{gw}/live/'s elements. Returns
// { home: [row], away: [row], events: { home: {...}, away: {...} }, bonusProjected }
// with row { element, player, minutes, points, goals, assists, cleanSheet,
// saves, yellow, red, bps, bonus } (points include projected bonus) and
// events[side][identifier] = [{ element, player, value }].
const EVENT_STATS = ['goals_scored', 'assists', 'own_goals', 'penalties_saved', 'penalties_missed', 'yellow_cards', 'red_cards', 'saves'];
export function matchDetail(fixture, liveElements, playersById = {}) {
  const sides = stat => {
    const s = (fixture.stats || []).find(x => x.identifier === stat);
    return { h: (s && s.h) || [], a: (s && s.a) || [] };
  };
  const bps = sides('bps');
  const confirmed = [...sides('bonus').h, ...sides('bonus').a];
  const projected = confirmed.length || !fixture.started ? {} : bonusFromBps([...bps.h, ...bps.a]);
  const bpsOf = new Map([...bps.h, ...bps.a].map(e => [e.element, e.value]));
  const homeIds = new Set(bps.h.map(e => e.element));
  const awayIds = new Set(bps.a.map(e => e.element));
  const home = [];
  const away = [];
  (liveElements || []).forEach(el => {
    const mine = (el.explain || []).find(x => x.fixture === fixture.id);
    if (!mine) return;
    const v = id => { const s = (mine.stats || []).find(x => x.identifier === id); return s ? s.value : 0; };
    const minutes = v('minutes');
    if (!(minutes > 0)) return;
    const player = playersById[el.id] || null;
    const extra = projected[el.id] || 0;
    const row = {
      element: el.id,
      player,
      minutes,
      points: (mine.stats || []).reduce((s, x) => s + (x.points || 0), 0) + extra,
      goals: v('goals_scored'),
      assists: v('assists'),
      cleanSheet: v('clean_sheets') > 0,
      saves: v('saves'),
      yellow: v('yellow_cards'),
      red: v('red_cards'),
      bps: bpsOf.get(el.id) ?? 0, // FPL leaves 0 BPS out of the list
      bonus: v('bonus') || extra,
    };
    const isHome = homeIds.has(el.id) || (!awayIds.has(el.id) && player && player.team === fixture.team_h);
    (isHome ? home : away).push(row);
  });
  const byPoints = (a, b) => b.points - a.points || (b.bps ?? 0) - (a.bps ?? 0) || b.minutes - a.minutes;
  const events = { home: {}, away: {} };
  EVENT_STATS.forEach(id => {
    const s = sides(id);
    events.home[id] = s.h.map(e => ({ element: e.element, player: playersById[e.element] || null, value: e.value }));
    events.away[id] = s.a.map(e => ({ element: e.element, player: playersById[e.element] || null, value: e.value }));
  });
  return { home: home.sort(byPoints), away: away.sort(byPoints), events, bonusProjected: !confirmed.length && fixture.started };
}
