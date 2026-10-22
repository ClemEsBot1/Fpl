// Your squad against the template: the players most managers own (FPL's
// overall "selected by"), which of them you're missing and your
// differentials. A rank moves on the players you don't share with the
// field: a template player you don't own costs you ground when he scores,
// and a differential gains it.

export const TEMPLATE_AT = 20;      // % selected by: counts as template
export const DIFFERENTIAL_BELOW = 10; // % selected by: counts as a differential

const round1 = v => Math.round(v * 10) / 10;
const ptsOf = pred => (typeof pred.nextMatchPredicted === 'number' ? pred.nextMatchPredicted : pred.predicted) || 0;

// squadPlayers: your 15. Returns { template, templateOwned, missing,
// differentials, missingPoints, differentialPoints }. Each entry is
// { player, selectedBy, points }: `missing` adds atStake (the points this
// gameweek the field gets from him and you don't: ownership × points), most
// first; `differentials` adds edge (what he gains you on the field:
// points × the share who don't own him), most first.
export function templateReport(squadPlayers, allPlayers, predictionsById) {
  const owned = new Set(squadPlayers.map(p => p.id));
  const row = p => ({ player: p, selectedBy: p.selectedBy || 0, points: round1(ptsOf(predictionsById[p.id])) });
  const template = allPlayers
    .filter(p => (p.selectedBy || 0) >= TEMPLATE_AT && predictionsById[p.id])
    .sort((a, b) => b.selectedBy - a.selectedBy)
    .map(row);
  const missing = template
    .filter(t => !owned.has(t.player.id))
    .map(t => ({ ...t, raw: (t.selectedBy * ptsOf(predictionsById[t.player.id])) / 100 }))
    .sort((a, b) => b.raw - a.raw);
  const differentials = squadPlayers
    .filter(p => (p.selectedBy || 0) < DIFFERENTIAL_BELOW && predictionsById[p.id])
    .map(p => ({ ...row(p), raw: (ptsOf(predictionsById[p.id]) * (100 - (p.selectedBy || 0))) / 100 }))
    .sort((a, b) => b.raw - a.raw);
  return {
    template,
    templateOwned: template.filter(t => owned.has(t.player.id)).length,
    missing: missing.map(({ raw, ...m }) => ({ ...m, atStake: round1(raw) })),
    differentials: differentials.map(({ raw, ...d }) => ({ ...d, edge: round1(raw) })),
    missingPoints: round1(missing.reduce((s, m) => s + m.raw, 0)),
    differentialPoints: round1(differentials.reduce((s, d) => s + d.raw, 0)),
  };
}
