import { get } from '@vercel/blob';

// Serves the odds-latest.json blob written by api/refresh-optimal.js's daily
// cron run. Deliberately NOT a live proxy to the odds provider — that would
// mean every visitor's page load spends against your (likely rate-limited,
// possibly paid) odds API quota. The browser only ever reads what the cron
// already fetched and cached, same pattern as api/player-history.js.
export default async function handler(req, res) {
  try {
    const result = await get('odds-latest.json', { access: 'public', useCache: false });
    if (!result) {
      res.status(404).json({ error: 'no_odds_cached_yet' });
      return;
    }
    const text = await new Response(result.stream).text();
    res
      .status(200)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400')
      .send(text);
  } catch (e) {
    // Covers "cron hasn't run yet" as well as any transient storage error —
    // the frontend treats a non-200 here as "no odds signal", and
    // predictions simply fall back to oddsAdjustment=0 for everyone (see
    // buildStaticDataFromRaw), exactly as before this feature existed.
    res.status(404).json({ error: 'no_odds_cached_yet', detail: String((e && e.message) || e) });
  }
}
