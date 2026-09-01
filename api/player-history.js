import { get } from '@vercel/blob';

// Serves the player-history.json blob written (once, or once a season) by
// scripts/import-player-history.mjs. This is a static, read-mostly resource
// — nothing about it changes between deploys — so a long
// stale-while-revalidate is fine; it only ever changes when someone reruns
// the import script.
export default async function handler(req, res) {
  try {
    const result = await get('player-history.json', { access: 'public', useCache: false });
    if (!result) {
      res.status(404).json({ error: 'not_imported_yet' });
      return;
    }
    const text = await new Response(result.stream).text();
    res
      .status(200)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
      .send(text);
  } catch (e) {
    // Covers "import script hasn't been run yet" as well as any transient
    // storage error — the frontend treats a non-200 here as "no historical
    // data available", and predictions simply fall back to the pre-existing
    // position-average shrinkage baseline (see buildStaticDataFromRaw).
    res.status(404).json({ error: 'not_imported_yet', detail: String((e && e.message) || e) });
  }
}
