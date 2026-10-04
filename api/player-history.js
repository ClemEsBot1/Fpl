import { get } from '@vercel/blob';
import { compactPlayerHistory } from '../src/lib/playerHistory.js';

// Serves what the app needs from the player-history.json blob written (once,
// or once a season) by scripts/import-player-history.mjs: each player's
// career baseline and last-season totals, worked out here once rather than
// in every browser. The full archive is ~2 MB; this is about a tenth of
// that. It only changes when someone reruns the import script, so it's
// cached hard (and in this function instance's memory between requests).
let compactCache = null;

export default async function handler(req, res) {
  try {
    if (!compactCache) {
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
      compactCache = JSON.stringify(compact);
    }
    res
      .status(200)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800')
      .send(compactCache);
  } catch (e) {
    // Covers "import script hasn't been run yet" as well as any transient
    // storage error — the frontend treats a non-200 here as "no historical
    // data available", and predictions simply fall back to the pre-existing
    // position-average shrinkage baseline (see buildStaticDataFromRaw).
    res.status(404).json({ error: 'not_imported_yet', detail: String((e && e.message) || e) });
  }
}
