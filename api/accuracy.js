import { get } from '@vercel/blob';
import { predictionsPathnameFor, summariseAccuracy, latestFinishedEvent } from '../src/lib/accuracy.js';

const FPL_BASE = 'https://fantasy.premierleague.com/api/';

async function fplJson(path) {
  const r = await fetch(FPL_BASE + path);
  if (!r.ok) throw new Error(`FPL ${path}: ${r.status}`);
  return r.json();
}

// GET /api/accuracy[?gw=N] — how last gameweek's (or gameweek N's)
// predictions compared with what players actually scored. 404 when there
// are no saved predictions for it (e.g. gameweeks before this existed).
export default async function handler(req, res) {
  try {
    let gwId = Number(req.query && req.query.gw);
    let gwName = null;
    if (!Number.isInteger(gwId) || gwId < 1) {
      const bootstrap = await fplJson('bootstrap-static/');
      const event = latestFinishedEvent(bootstrap.events);
      if (!event) { res.status(404).json({ error: 'no_finished_gameweek' }); return; }
      gwId = event.id;
      gwName = event.name;
    }

    const saved = await get(predictionsPathnameFor(gwId), { access: 'public', useCache: false }).catch(() => null);
    if (!saved) { res.status(404).json({ error: 'no_saved_predictions', gwId }); return; }
    const { predictedById } = JSON.parse(await new Response(saved.stream).text());

    const live = await fplJson(`event/${gwId}/live/`);
    const summary = summariseAccuracy(predictedById, live.elements || []);
    if (!summary) { res.status(404).json({ error: 'not_enough_data', gwId }); return; }

    res
      .status(200)
      .setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
      .json({ gwId, gwName: gwName || `Gameweek ${gwId}`, ...summary });
  } catch (e) {
    res.status(502).setHeader('Cache-Control', 'no-store').json({ error: 'accuracy_failed', detail: String((e && e.message) || e) });
  }
}
