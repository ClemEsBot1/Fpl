// The toolbar popup: this gameweek's top captains, a player search and the
// two switches for what shows on the FPL site.
(() => {
  const { topPicks, searchPlayers, playerLink, next, ahead, fmt, doubtful, POS } = globalThis.fplc;
  const DEFAULTS = { badges: true, panel: true, collapsed: false };
  const $ = id => document.getElementById(id);
  let feed = null;

  function row(p) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = playerLink(p);
    a.target = '_blank';
    a.rel = 'noopener';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = p.name;
    if (doubtful(p)) {
      const d = document.createElement('span');
      d.className = 'doubt';
      d.textContent = p.chance !== undefined ? `${p.chance}%` : '!';
      d.title = p.news || 'Doubtful';
      name.append(d);
    }
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${p.team} ${POS[p.pos]} · £${p.price.toFixed(1)}m · ${p.fx || 'Blank'}`;
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = fmt(next(p));
    pts.title = `${fmt(ahead(p))} over the next ${p.pts.length} gameweeks`;
    a.append(name, meta, pts);
    li.append(a);
    return li;
  }

  function show() {
    if (!feed) return;
    const q = $('q').value;
    const players = q.trim() ? searchPlayers(feed, q) : topPicks(feed, 8);
    $('list-title').textContent = q.trim() ? (players.length ? 'Players' : 'No player found') : 'Top captains this gameweek';
    $('list').replaceChildren(...players.map(row));
  }

  async function start() {
    const stored = await chrome.storage.local.get('settings');
    const settings = { ...DEFAULTS, ...(stored.settings || {}) };
    for (const key of ['badges', 'panel']) {
      $(key).checked = settings[key];
      $(key).addEventListener('change', async () => {
        const now = await chrome.storage.local.get('settings');
        chrome.storage.local.set({ settings: { ...DEFAULTS, ...(now.settings || {}), [key]: $(key).checked } });
      });
    }
    $('q').addEventListener('input', show);
    const res = await chrome.runtime.sendMessage({ type: 'feed' }).catch(() => null);
    if (!res || !res.feed) {
      $('gw').textContent = 'Predictions unavailable';
      $('error').hidden = false;
      return;
    }
    feed = res.feed;
    const deadline = feed.deadline ? new Date(feed.deadline).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
    $('gw').textContent = deadline ? `${feed.gwName} · deadline ${deadline}` : feed.gwName;
    show();
  }

  start();
})();
