export default async function handler(req, res) {
  try {
    const path = req.query.path || '';
    const target = 'https://fantasy.premierleague.com/api/' + path;
    const r = await fetch(target);
    const text = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (e) {
    res.status(502).json({ error: 'FPL fetch failed', detail: String(e) });
  }
}
