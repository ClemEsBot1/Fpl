// The watchlist (src/lib/watchlist.js) as state: [ids, toggle(id)], kept
// in step with every other screen and tab that shows it.
import { useEffect, useState } from 'react';
import { onWatchlistChange, readWatchlist, saveWatchlist, toggleId } from '../lib/watchlist.js';

export function useWatchlist() {
  const [ids, setIds] = useState(readWatchlist);
  useEffect(() => onWatchlistChange(setIds), []);
  const toggle = id => setIds(saveWatchlist(toggleId(readWatchlist(), id)));
  return [ids, toggle];
}
