// Bench order. FPL brings substitutes on in bench order: for each starter
// who doesn't play, the first outfield substitute (in order) who played and
// keeps a legal formation (3+ DEF, 2+ MID, 1+ FWD) comes on; the keeper only
// covers the keeper. So the order is worth getting right when a starter is
// a doubt: the substitute most likely to score should be first, unless he
// can't cover the positions most likely to need him.
//
// Expected bench points are estimated by simulation: each player plays with
// playProbability(), and a player who plays scores his prediction divided
// by that chance (the prediction already allows for not playing). The same
// draws are reused for every order, so orders are compared fairly.

const MIN_BY_POS = { 2: 3, 3: 2, 4: 1 };
const DRAWS = 3000;

// Chance a player plays this gameweek: availability (injury and doubt
// flags), how often he has played this season, and whether he has lost his
// place lately.
export function playProbability(slot) {
  const b = slot.breakdown || {};
  const avail = typeof b.availMult === 'number' ? b.availMult : 1;
  const share = typeof slot.player.appearanceShare === 'number' ? Math.max(0.2, slot.player.appearanceShare) : 1;
  const recent = typeof b.minutesMult === 'number' ? b.minutesMult : 1;
  return Math.max(0, Math.min(1, avail * share * recent));
}

// A small seeded generator, so the same squad always gets the same answer.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function prepare(squad) {
  const starters = squad.filter(s => s.isStarting);
  const outfieldBench = squad.filter(s => !s.isStarting && s.player.positionId !== 1);
  const rows = [...starters, ...outfieldBench].map(s => {
    const q = playProbability(s);
    const pts = s.nextMatchPredicted ?? s.predicted ?? 0;
    return { id: s.player.id, pos: s.player.positionId, q, ifPlays: q > 0 ? pts / Math.max(q, 0.3) : 0 };
  });
  const random = rng(rows.reduce((h, r) => (h * 31 + r.id) >>> 0, 7));
  const draws = Array.from({ length: DRAWS }, () => rows.map(r => random() < r.q));
  return { starters: rows.slice(0, starters.length), bench: rows.slice(starters.length), draws };
}

// Points the outfield bench is expected to add, for bench `order` (ids).
function benchPoints(prep, order) {
  const { starters, bench, draws } = prep;
  const index = new Map([...starters, ...bench].map((r, i) => [r.id, i]));
  const benchRows = order.map(id => bench.find(r => r.id === id)).filter(Boolean);
  let total = 0;
  for (const played of draws) {
    const count = { 2: 0, 3: 0, 4: 0 };
    starters.forEach(r => { if (r.pos !== 1) count[r.pos]++; });
    const used = new Set();
    for (const out of starters) {
      if (out.pos === 1 || played[index.get(out.id)]) continue;
      for (const sub of benchRows) {
        if (used.has(sub.id) || !played[index.get(sub.id)]) continue;
        const after = { ...count, [out.pos]: count[out.pos] - 1, [sub.pos]: count[sub.pos] + 1 };
        if (after[out.pos] < MIN_BY_POS[out.pos]) continue;
        used.add(sub.id);
        count[out.pos]--; count[sub.pos]++;
        total += sub.ifPlays;
        break;
      }
    }
  }
  return total / draws.length;
}

function permutations(list) {
  if (list.length <= 1) return [list];
  return list.flatMap((x, i) => permutations([...list.slice(0, i), ...list.slice(i + 1)]).map(rest => [x, ...rest]));
}

// The best order for the outfield substitutes, against the current one:
// { order: ids, expected, current: { order, expected }, gain }.
export function suggestBenchOrder(squad) {
  const current = squad.filter(s => !s.isStarting && s.player.positionId !== 1).map(s => s.player.id);
  if (current.length < 2) return null;
  const prep = prepare(squad);
  const currentPts = benchPoints(prep, current);
  let best = { order: current, expected: currentPts };
  for (const order of permutations(current)) {
    const pts = benchPoints(prep, order);
    if (pts > best.expected + 1e-9) best = { order, expected: pts };
  }
  const round = v => Math.round(v * 100) / 100;
  return { order: best.order, expected: round(best.expected), current: { order: current, expected: round(currentPts) }, gain: round(best.expected - currentPts) };
}

// The squad with its outfield substitutes in `order` (ids), in the places
// they already hold in the squad's order (the keeper keeps his).
export function applyBenchOrder(squad, order) {
  const places = squad.map((s, i) => (!s.isStarting && s.player.positionId !== 1 ? i : -1)).filter(i => i >= 0);
  const byId = new Map(squad.map(s => [s.player.id, s]));
  const next = [...squad];
  places.forEach((place, k) => { if (byId.has(order[k])) next[place] = byId.get(order[k]); });
  return next;
}
