import { get } from '@vercel/blob';
import { SNAPSHOT_PATHNAME } from './refresh-optimal.js';

export default async function handler(req, res) {
  try {
    const result = await get(SNAPSHOT_PATHNAME, { access: 'public', useCache: false });
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
    // its own local cache, or build fresh on the spot).
    res.status(404).json({ error: 'not_built_yet', detail: String((e && e.message) || e) });
  }
}
