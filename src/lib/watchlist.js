// Players you're keeping an eye on (thinking of buying, usually): a list of
// FPL player ids kept on this device. Home shows them with their price
// move, fixtures and predicted points, and their news and price moves join
// your alerts (src/lib/alerts.js, watchIds). Every screen that shows a
// star stays in step through the 'fpl-watchlist' event.

export const WATCHLIST_KEY = 'fpl_watchlist';
export const MAX_WATCHED = 15;
const EVENT = 'fpl-watchlist';

const cleanIds = list => [...new Set((Array.isArray(list) ? list : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, MAX_WATCHED);

// The list with `id` added at the front, or taken out when it's already
// there. A full list stays as it is.
export function toggleId(list, id, max = MAX_WATCHED) {
  const ids = cleanIds(list);
  const n = Number(id);
  if (ids.includes(n)) return ids.filter(x => x !== n);
  return ids.length >= max ? ids : [n, ...ids];
}

export function readWatchlist() {
  try { return cleanIds(JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]')); } catch { return []; }
}

export function saveWatchlist(ids) {
  const clean = cleanIds(ids);
  try { localStorage.setItem(WATCHLIST_KEY, JSON.stringify(clean)); } catch { /* private mode: this visit only */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: clean }));
  return clean;
}

// Calls `fn(ids)` whenever the list changes here or in another tab;
// returns the unsubscribe.
export function onWatchlistChange(fn) {
  if (typeof window === 'undefined') return () => {};
  const local = e => fn(e.detail);
  const other = e => { if (e.key === WATCHLIST_KEY) fn(readWatchlist()); };
  window.addEventListener(EVENT, local);
  window.addEventListener('storage', other);
  return () => { window.removeEventListener(EVENT, local); window.removeEventListener('storage', other); };
}

// The rows for the Home card, in the order they were added: each player
// with their prediction and next fixtures. Players FPL no longer lists
// are left out.
export function watchRows(staticData, ids) {
  if (!staticData) return [];
  return cleanIds(ids)
    .map(id => staticData.playersById[id])
    .filter(Boolean)
    .map(player => ({
      player,
      prediction: staticData.predictionsById[player.id] || null,
      fixtures: (staticData.fixturesByTeam && staticData.fixturesByTeam[player.team]) || [],
    }));
}
