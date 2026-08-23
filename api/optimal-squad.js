import { get } from '@vercel/blob';
import { snapshotPathnameFor } from './refresh-optimal.js';

export default async function handler(req, res) {
  const gwId = Number(req.query && req.query.gw);
  if (!gwId || !Number.isInteger(gwId) || gwId < 1) {
    res.status(400).json({ error: 'missing_or_invalid_gw' });
    return;
  }

  try {
    const result = await get(snapshotPathnameFor(gwId), { access: 'public', useCache: false });
    if (!result) {
      res.status(404).json({ error: 'not_built_yet' });
      return;
    }
    const text = await new Response(result.stream).text();
    res
      .status(200)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300')
      .send(text);
  } catch (e) {
    // Covers "never built yet" as well as any transient storage error — the
    // frontend treats a non-200 here the same way either way (fall back to
    // its own local cache/fresh build for the current gameweek, or show
    // "no saved data" for a past one).
    res.status(404).json({ error: 'not_built_yet', detail: String((e && e.message) || e) });
  }
}