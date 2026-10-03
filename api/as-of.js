import { aggregateLiveStats } from '../src/lib/asOf.js';

const FPL_BASE = 'https://fantasy.premierleague.com/api/';

// GET /api/as-of?gw=N — every player's stats from gameweeks 1..N-1 only,
// so a past gameweek can be predicted with what was known before its
// deadline (see src/lib/asOf.js). Built from FPL's per-gameweek live data;
// those gameweeks are finished, so the result is cached for a day.
export default async function handler(req, res) {
  const gwId = Number(req.query && req.query.gw);
  if (!Number.isInteger(gwId) || gwId < 1 || gwId > 38) {
    res.status(400).json({ error: 'missing_or_invalid_gw' });
    return;
  }
  try {
    const gws = Array.from({ length: gwId - 1 }, (_, i) => i + 1);
    const lives = await Promise.all(gws.map(async gw => {
      const r = await fetch(`${FPL_BASE}event/${gw}/live/`);
      if (!r.ok) throw new Error(`event/${gw}/live: ${r.status}`);
      const data = await r.json();
      return [gw, data.elements || []];
    }));
    const result = aggregateLiveStats(Object.fromEntries(lives), gwId);
    res
      .status(200)
      .setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800')
      .json(result);
  } catch (e) {
    res.status(502).setHeader('Cache-Control', 'no-store').json({ error: 'as_of_failed', detail: String((e && e.message) || e) });
  }
}
