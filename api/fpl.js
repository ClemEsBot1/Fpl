import { fplPathRule, fplCacheControl } from '../src/lib/fplProxy.js';

export default async function handler(req, res) {
  const path = (req.query && req.query.path) || '';
  const rule = fplPathRule(path);
  if (!rule) {
    res.status(400).json({ error: 'path_not_allowed' });
    return;
  }
  try {
    const r = await fetch('https://fantasy.premierleague.com/api/' + path);
    const text = await r.text();
    res
      .status(r.status)
      .setHeader('Content-Type', 'application/json')
      .setHeader('Cache-Control', fplCacheControl(rule, r.status))
      .send(text);
  } catch (e) {
    res.status(502).setHeader('Cache-Control', 'no-store').json({ error: 'FPL fetch failed', detail: String(e) });
  }
}
