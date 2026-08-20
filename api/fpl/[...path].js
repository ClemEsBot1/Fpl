export default async function handler(req, res) {
  try {
    const segments = req.query.path || [];
    const restOfUrl = req.url.split('/api/fpl/')[1] || '';
    const [, queryString] = restOfUrl.split('?');
    const target =
      'https://fantasy.premierleague.com/api/' +
      segments.join('/') +
      '/' +
      (queryString ? '?' + queryString : '');

    const r = await fetch(target);
    const text = await r.text();
    res.status(r.status).setHeader('Content-Type', 'application/json').send(text);
  } catch (e) {
    res.status(502).json({ error: 'FPL fetch failed', detail: String(e) });
  }
}
