// The predictions the browser extension (extension/) shows on the official
// FPL site, served as JSON at /ext/predictions.json (api/optimal-squad.js).
// Kept small: one row per player with his predicted points for the
// gameweek being planned and the next four, and his fixtures that week.
import { AHEAD, fixtureText } from './seoDynamic.js';

export const FEED_VERSION = 1;

const round1 = n => Math.round(n * 10) / 10;

// model: seoModel(); snap: the best squad the refresh job saved, or null.
export function extensionFeed(model, snap, updatedAt = null) {
  const gw = model.event;
  const players = model.players
    .filter(p => p.predicted !== null)
    .map(p => {
      const row = {
        id: p.id,
        slug: p.slug,
        name: p.name,
        team: p.team,
        pos: p.positionId,
        price: p.price,
        own: p.selectedBy,
        pts: p.weeks.slice(0, AHEAD).map(w => round1(w.points)),
        fx: (p.teamRef ? p.teamRef.fixtures.filter(f => f.event === gw.id) : []).map(fixtureText).join(', '),
      };
      // Only for a player who might not play, to keep the file small.
      if (p.status !== 'a') {
        row.status = p.status;
        if (p.chance !== null && p.chance !== undefined) row.chance = p.chance;
        if (p.news) row.news = p.news;
      }
      return row;
    });
  const best = snap && snap.gwId === gw.id && Array.isArray(snap.startingIds)
    ? { xi: snap.startingIds, captainId: snap.captainId ?? null }
    : null;
  return { v: FEED_VERSION, gw: gw.id, gwName: gw.name, deadline: gw.deadline_time || null, updatedAt, players, best };
}
