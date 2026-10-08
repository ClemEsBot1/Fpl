// A transfer plan over the next few gameweeks, not just this one: which
// moves to make in which week, when to roll a free transfer instead, and
// when a -4 hit pays for itself.
//
// Each gameweek is scored with that week's own predictions (byGw from
// computePlayerPrediction): the best legal XI plus the captain's points
// again. A beam search walks the weeks; in each, every plan kept so far can
// roll its transfer, make one of the best single moves, or a pair of them.
// Plans are compared on points so far plus what their squad would score in
// the remaining weeks with no more moves, so a hit whose payback comes
// later isn't thrown out early. Free transfers bank up to MAX_FREE_TRANSFERS;
// a second one left at the end is worth FREE_TRANSFER_VALUE.

import { MAX_PER_REAL_TEAM } from './predictions.js';
import { FREE_TRANSFER_VALUE, TRANSFER_HIT_COST } from './squadLogic.js';

export const MAX_FREE_TRANSFERS = 5;
const BEAM = 10;
const SINGLES = 8;
const PAIRS = 4;
const POOL_PER_POSITION = 40;

const MIN = { 1: 1, 2: 3, 3: 2, 4: 1 };
const MAX = { 1: 1, 2: 5, 3: 5, 4: 3 };

// The best XI's points for week k, captain counted twice.
export function xiPointsForWeek(players, pointsOf, k) {
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  players.forEach(p => byPos[p.positionId].push(pointsOf(p, k)));
  Object.values(byPos).forEach(list => list.sort((a, b) => b - a));
  const xi = [];
  const rest = [];
  [1, 2, 3, 4].forEach(pos => {
    xi.push(...byPos[pos].slice(0, MIN[pos]));
    if (pos !== 1) rest.push(...byPos[pos].slice(MIN[pos], MAX[pos]).map(v => ({ v, pos })));
  });
  rest.sort((a, b) => b.v - a.v);
  xi.push(...rest.slice(0, 11 - xi.length).map(r => r.v));
  return xi.reduce((s, v) => s + v, 0) + Math.max(0, ...xi);
}

// squadPlayers: the 15 player objects. pointsById: { [id]: [week 0, week 1, …] }.
// Returns { weeks: [{ event, moves: [{ out, in }], hits, freeBefore, points }],
// total, baseline, gain } — baseline being the squad with no moves at all.
export function planTransfers({ squadPlayers, bankTenths, freeTransfers, allPlayers, pointsById, events }) {
  const weeks = events.length;
  if (!weeks || squadPlayers.length !== 15) return null;
  const pts = (p, k) => (pointsById[p.id] && pointsById[p.id][k]) || 0;
  const tenths = p => Math.round(p.price * 10);
  const restOf = (players, from) => {
    let s = 0;
    for (let k = from; k < weeks; k++) s += xiPointsForWeek(players, pts, k);
    return s;
  };

  // Players worth buying: the best of each position over the whole plan.
  const owned = new Set(squadPlayers.map(p => p.id));
  const pool = { 1: [], 2: [], 3: [], 4: [] };
  allPlayers.forEach(p => { if (!owned.has(p.id) && pointsById[p.id]) pool[p.positionId].push(p); });
  const total = p => pointsById[p.id].reduce((s, v) => s + v, 0);
  Object.values(pool).forEach(list => { list.sort((a, b) => total(b) - total(a)); list.length = Math.min(list.length, POOL_PER_POSITION); });

  const clubCount = players => {
    const c = {};
    players.forEach(p => { c[p.team] = (c[p.team] || 0) + 1; });
    return c;
  };

  // The best single moves from `players` for weeks k.., by points gained.
  function singles(players, bank, k) {
    const ids = new Set(players.map(p => p.id));
    const clubs = clubCount(players);
    const gainOver = (inP, outP) => {
      let g = 0;
      for (let j = k; j < weeks; j++) g += pts(inP, j) - pts(outP, j);
      return g;
    };
    const moves = [];
    players.forEach(out => {
      pool[out.positionId].forEach(inP => {
        if (ids.has(inP.id)) return;
        if (tenths(inP) > bank + tenths(out)) return;
        if (inP.team !== out.team && (clubs[inP.team] || 0) >= MAX_PER_REAL_TEAM) return;
        const gain = gainOver(inP, out);
        if (gain > 0) moves.push({ out, in: inP, gain });
      });
    });
    moves.sort((a, b) => b.gain - a.gain);
    // Keep the best move per player out, so the list isn't one player's
    // eight replacements.
    const seen = new Set();
    return moves.filter(m => (seen.has(m.out.id) ? false : (seen.add(m.out.id), true))).slice(0, SINGLES);
  }

  function apply(state, moves) {
    let players = state.players;
    let bank = state.bank;
    for (const m of moves) {
      if (!players.some(p => p.id === m.out.id) || players.some(p => p.id === m.in.id)) return null;
      bank += tenths(m.out) - tenths(m.in);
      if (bank < 0) return null;
      players = players.map(p => (p.id === m.out.id ? m.in : p));
    }
    const clubs = clubCount(players);
    if (Object.values(clubs).some(n => n > MAX_PER_REAL_TEAM)) return null;
    return { players, bank };
  }

  const start = { players: squadPlayers, bank: bankTenths || 0, free: Math.max(0, Math.min(MAX_FREE_TRANSFERS, freeTransfers)), score: 0, weeks: [] };
  let beam = [start];
  for (let k = 0; k < weeks; k++) {
    const next = [];
    for (const st of beam) {
      const options = singles(st.players, st.bank, k);
      const actions = [[]];
      options.forEach(m => actions.push([m]));
      const pairs = [];
      for (let i = 0; i < options.length; i++) {
        for (let j = i + 1; j < options.length; j++) {
          if (options[i].in.id === options[j].in.id) continue;
          pairs.push({ moves: [options[i], options[j]], gain: options[i].gain + options[j].gain });
        }
      }
      pairs.sort((a, b) => b.gain - a.gain).slice(0, PAIRS).forEach(p => actions.push(p.moves));
      for (const moves of actions) {
        const after = moves.length ? apply(st, moves) : { players: st.players, bank: st.bank };
        if (!after) continue;
        const hits = Math.max(0, moves.length - st.free);
        const free = moves.length >= st.free ? 1 : Math.min(MAX_FREE_TRANSFERS, st.free - moves.length + 1);
        const points = xiPointsForWeek(after.players, pts, k);
        const score = st.score + points - hits * TRANSFER_HIT_COST;
        next.push({
          ...after, free, score,
          weeks: [...st.weeks, { event: events[k], moves: moves.map(m => ({ out: m.out, in: m.in })), hits, freeBefore: st.free, points: Math.round(points * 10) / 10 }],
          outlook: score + restOf(after.players, k + 1),
        });
      }
    }
    // One plan per squad: different routes to the same 15 keep the best.
    const bestBySquad = new Map();
    next.forEach(st => {
      const key = st.players.map(p => p.id).sort((a, b) => a - b).join(',') + `|${st.free}`;
      const had = bestBySquad.get(key);
      if (!had || st.outlook > had.outlook) bestBySquad.set(key, st);
    });
    beam = [...bestBySquad.values()].sort((a, b) => b.outlook - a.outlook).slice(0, BEAM);
  }
  // A second free transfer in hand at the end is worth having; more than
  // that rarely all gets used, so they aren't counted.
  const value = st => st.score + (Math.min(st.free, 2) - 1) * FREE_TRANSFER_VALUE;
  const best = beam.sort((a, b) => value(b) - value(a))[0];
  const baseline = restOf(squadPlayers, 0);
  const round = v => Math.round(v * 10) / 10;
  return { weeks: best.weeks, total: round(best.score), baseline: round(baseline), gain: round(best.score - baseline), freeAtEnd: best.free };
}
