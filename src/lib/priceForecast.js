// Who is likely to rise or fall in price at the next change (overnight UK
// time). FPL doesn't publish its exact formula, but it does publish, per
// player, how far along it thinks each player is towards a change:
// `priceChangePercent` (+ve heading for a rise, -ve for a fall; ±100 means
// a change is expected at the next update). We rank by that, and use this
// gameweek's net transfers only to break ties and to show momentum.
//
// This is a forecast from FPL's own signal, not a separate model, so it is
// about as good as the popular price-predictor sites and no better.

// A player counts as "on the edge" once FPL's progress passes this, so the
// list stays to the names that actually look close.
const EDGE = 60;

function netTransfers(p) {
  return (Number(p.transfersInEvent) || 0) - (Number(p.transfersOutEvent) || 0);
}

// { risers, fallers }: each a list of { id, webName, team, positionId,
// price, percent, net, alreadyMoved }, closest to a change first. `percent`
// is FPL's progress (absolute), `alreadyMoved` flags players whose price
// has already changed this gameweek (so a further move is less imminent).
// `limit` caps each list.
export function priceForecast(allPlayers, { edge = EDGE, limit = 20 } = {}) {
  const risers = [];
  const fallers = [];
  (allPlayers || []).forEach(p => {
    const pct = p.priceChangePercent;
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return;
    const row = {
      id: p.id,
      webName: p.webName,
      team: p.team,
      positionId: p.positionId,
      price: p.price,
      percent: Math.abs(pct),
      net: netTransfers(p),
      alreadyMoved: (Number(p.costChangeEvent) || 0) !== 0,
    };
    if (pct >= edge) risers.push(row);
    else if (pct <= -edge) fallers.push(row);
  });

  // Closest to a change first; net transfers breaks ties.
  const byImminence = (a, b) => (b.percent - a.percent) || (Math.abs(b.net) - Math.abs(a.net));
  risers.sort(byImminence);
  fallers.sort(byImminence);
  return { risers: risers.slice(0, limit), fallers: fallers.slice(0, limit) };
}
