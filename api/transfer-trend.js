import { getRedis, getJSON, setJSON } from '../src/lib/redis.js';
import { KEEP_SNAPSHOTS, SNAPSHOT_EVERY_MS, pickBaseline, transferDeltas, transferSnapshot } from '../src/lib/transferTrends.js';

const KEY = 'transfer-snapshots';

// GET /api/transfer-trend — each player's transfers in and out over about
// the last hour: { minutes, byId: { [id]: [in, out] } }. Every call keeps a
// snapshot of FPL's transfer counts (at most one per SNAPSHOT_EVERY_MS),
// and the answer is the change since the one about an hour old. A
// scheduled ping (.github/workflows/transfer-snapshots.yml) keeps
// snapshots coming when nobody has the app open. Cached for five minutes.
export default async function handler(req, res) {
  try {
    const r = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`FPL ${r.status}`);
    const current = transferSnapshot(await r.json(), Date.now());
    const redis = getRedis();
    const saved = (await getJSON(redis, KEY)) || [];
    const base = pickBaseline(saved, current);
    const last = saved[saved.length - 1];
    if (!last || last.gw !== current.gw || current.at - last.at >= SNAPSHOT_EVERY_MS) {
      await setJSON(redis, KEY, [...saved.filter(s => s.gw === current.gw), current].slice(-KEEP_SNAPSHOTS));
    }
    const deltas = transferDeltas(current, base);
    res
      .status(200)
      .setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600')
      .json(deltas ? { gw: current.gw, ...deltas } : { gw: current.gw, minutes: 0, byId: null });
  } catch (e) {
    res.status(503).setHeader('Cache-Control', 'no-store').json({ error: 'transfer_trend_unavailable', detail: String((e && e.message) || e) });
  }
}
