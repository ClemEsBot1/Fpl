import { get } from '@vercel/blob';
import { snapshotPathnameFor } from './refresh-optimal.js';
import { predictionsPathnameFor } from '../src/lib/accuracy.js';
import { getTargetEvent } from '../src/lib/predictions.js';
import { predictionsPage } from '../src/lib/seoPage.js';

async function readBlobJson(pathname) {
  const result = await get(pathname, { access: 'public', useCache: false });
  if (!result) return null;
  return JSON.parse(await new Response(result.stream).text());
}

// /fpl-predictions (rewritten here with ?page=predictions, see vercel.json):
// the gameweek being planned as a plain HTML page for search engines, from
// the predictions and best squad the refresh job saved for it.
async function predictionsHtml(res) {
  try {
    const r = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`FPL ${r.status}`);
    const bootstrap = await r.json();
    const event = getTargetEvent(bootstrap.events);
    if (!event) throw new Error('no gameweek to plan');
    const [saved, snap] = await Promise.all([
      readBlobJson(predictionsPathnameFor(event.id)).catch(() => null),
      readBlobJson(snapshotPathnameFor(event.id)).catch(() => null),
    ]);
    if (!saved || !saved.predictedById) throw new Error('no saved predictions');
    const teams = Object.fromEntries(bootstrap.teams.map(t => [t.id, t.short_name]));
    const players = bootstrap.elements
      .filter(e => typeof saved.predictedById[e.id] === 'number')
      .map(e => ({ id: e.id, name: e.web_name, team: teams[e.team] || '', positionId: e.element_type, price: e.now_cost / 10, predicted: saved.predictedById[e.id] }));
    const byId = Object.fromEntries(players.map(p => [p.id, p]));
    const best = snap && Array.isArray(snap.startingIds) && snap.gwId === event.id
      ? { xi: snap.startingIds.map(id => byId[id]).filter(Boolean).sort((a, b) => a.positionId - b.positionId || b.predicted - a.predicted), captainId: snap.captainId }
      : null;
    const html = predictionsPage({ gwName: event.name, deadline: event.deadline_time, players, best, updatedAt: saved.savedAt });
    res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8')
      .setHeader('Cache-Control', 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400').send(html);
  } catch {
    res.status(503).setHeader('Content-Type', 'text/html; charset=utf-8').setHeader('Retry-After', '3600').setHeader('Cache-Control', 'no-store')
      .send('<!doctype html><meta charset="utf-8"><title>FPL predictions | FPL Checker</title><p>This gameweek’s predictions aren’t ready yet. <a href="/">Open FPL Checker</a></p>');
  }
}

export default async function handler(req, res) {
  if (req.query && req.query.page === 'predictions') return predictionsHtml(res);
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
      .setHeader('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300')
      .send(text);
  } catch (e) {
    // Covers "never built yet" as well as any transient storage error — the
    // frontend treats a non-200 here the same way either way (fall back to
    // its own local cache/fresh build for the current gameweek, or show
    // "no saved data" for a past one).
    res.status(404).json({ error: 'not_built_yet', detail: String((e && e.message) || e) });
  }
}
