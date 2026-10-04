import { get } from '@vercel/blob';
import { compactPlayerHistory } from '../src/lib/playerHistory.js';

// Serves what the app needs from the player-history.json blob written (once,
// or once a season) by scripts/import-player-history.mjs: each player's
// career baseline and last-season totals, worked out here once rather than
// in every browser. The full archive is ~2 MB; this is about a tenth of
// that. It only changes when someone reruns the import script, so it's
// cached for an hour (in browsers, the CDN and this function instance's
// memory), after which a re-import shows up.
const MEMORY_CACHE_MS = 60 * 60 * 1000;
let compactCache = null; // { body, at }

function send(res, body) {
  res
    .status(200)
    .setHeader('Content-Type', 'application/json')
    .setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400')
    .send(body);
}

export default async function handler(req, res) {
  try {
    if (!compactCache || Date.now() - compactCache.at > MEMORY_CACHE_MS) {
      const result = await get('player-history.json', { access: 'public', useCache: false });
      if (!result) {
        res.status(404).json({ error: 'not_imported_yet' });
        return;
      }
      const compact = compactPlayerHistory(JSON.parse(await new Response(result.stream).text()));
      if (!compact) {
        res.status(404).json({ error: 'not_imported_yet' });
        return;
      }
      compactCache = { body: JSON.stringify(compact), at: Date.now() };
    }
    send(res, compactCache.body);
  } catch (e) {
    // A storage hiccup while refreshing: the copy already here still works.
    if (compactCache) { send(res, compactCache.body); return; }
    // Covers "import script hasn't been run yet" as well as any transient
    // storage error — the frontend treats a non-200 here as "no historical
    // data available", and predictions simply fall back to the pre-existing
    // position-average shrinkage baseline (see buildStaticDataFromRaw).
    res.status(404).json({ error: 'not_imported_yet', detail: String((e && e.message) || e) });
  }
}
