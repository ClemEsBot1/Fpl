// Transfer trends for the home screen: the players managers are buying
// and selling most this gameweek, and an estimate of whose price is about
// to move.
//
// FPL doesn't publish its price-change formula. What is known: a price
// moves once enough of a player's owners have bought (or sold) them since
// the last change, and falls trigger more easily than rises. So the
// estimate compares this gameweek's net transfers with how many managers
// own the player. It's a guide, not a promise, and is labelled that way.

// Net transfers as a share of owners needed for a move.
export const RISE_LIKELY = 0.1;
export const RISE_POSSIBLE = 0.05;
export const FALL_LIKELY = -0.05;
export const FALL_POSSIBLE = -0.025;
// Below this many net transfers nothing is predicted, however few owners.
const MIN_NET = 5000;

// 'rise' | 'fall' with 'likely' | 'possible', or null.
export function predictPriceChange(player, totalPlayers) {
  const net = player.transfersInEvent - player.transfersOutEvent;
  if (Math.abs(net) < MIN_NET) return null;
  const owners = Math.max((player.selectedBy / 100) * (totalPlayers || 0), 10000);
  const pressure = net / owners;
  if (pressure >= RISE_LIKELY) return { dir: 'rise', confidence: 'likely' };
  if (pressure >= RISE_POSSIBLE) return { dir: 'rise', confidence: 'possible' };
  if (pressure <= FALL_LIKELY) return { dir: 'fall', confidence: 'likely' };
  if (pressure <= FALL_POSSIBLE) return { dir: 'fall', confidence: 'possible' };
  return null;
}

function rowFor(player, totalPlayers) {
  return {
    player,
    net: player.transfersInEvent - player.transfersOutEvent,
    change: predictPriceChange(player, totalPlayers),
  };
}

// The most bought and sold players, each list up to `limit` long. Empty
// lists are kept so the panel can say so.
export function buildTransferTrends(allPlayers, totalPlayers, limit = 6) {
  const rows = allPlayers.map(p => rowFor(p, totalPlayers));
  const top = (list, key) => [...list].sort(key).slice(0, limit);
  return [
    { id: 'in', title: 'Most transferred in', rows: top(rows.filter(r => r.player.transfersInEvent > 0), (a, b) => b.player.transfersInEvent - a.player.transfersInEvent), stat: 'in' },
    { id: 'out', title: 'Most transferred out', rows: top(rows.filter(r => r.player.transfersOutEvent > 0), (a, b) => b.player.transfersOutEvent - a.player.transfersOutEvent), stat: 'out' },
  ];
}

// The `limit` highest of `entries` ([{ player, points }]) by points, for
// the predicted (or, for a past gameweek, actual) points panels.
export function topByPoints(entries, limit = 6) {
  return entries.filter(e => e.player && e.points > 0).sort((a, b) => b.points - a.points).slice(0, limit);
}
