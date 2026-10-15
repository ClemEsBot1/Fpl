// Runs on fantasy.premierleague.com: puts FPL Checker's predicted points
// next to player names, and a small panel with the squad on show (yours
// when logged in, or the team in the address) and its best captain.
// Everything is built with textContent; nothing from the feed or FPL is
// parsed as HTML.
(() => {
  const { indexFeed, squadSummary, topPicks, siteLink, entryFromPath, next, ahead, fmt, doubtful, POS } = globalThis.fplc;
  const DEFAULTS = { badges: true, panel: true, collapsed: false };
  let settings = { ...DEFAULTS };
  let feed = null;
  let index = null;
  let team = null; // { id, mine, picks }
  let teamPath = null;

  const h = (tag, props = {}, ...children) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    for (const c of children) if (c) el.append(c);
    return el;
  };

  async function fplJson(path) {
    const r = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }

  // The logged-in manager's saved team, else the team in the address with
  // its latest published picks.
  async function loadTeam() {
    const inPath = entryFromPath(location.pathname);
    const me = await fplJson('/api/me/').then(d => (d && d.player && d.player.entry ? String(d.player.entry) : null)).catch(() => null);
    if (me && (!inPath || inPath === me)) {
      const mine = await fplJson(`/api/my-team/${me}/`).catch(() => null);
      if (mine && Array.isArray(mine.picks)) return { id: me, mine: true, picks: mine.picks };
    }
    const id = inPath || me;
    if (!id) return null;
    const entry = await fplJson(`/api/entry/${id}/`).catch(() => null);
    const gw = (entry && entry.current_event) || null;
    if (!gw) return null;
    const picks = await fplJson(`/api/entry/${id}/event/${gw}/picks/`).catch(() => null);
    return picks && Array.isArray(picks.picks) ? { id, mine: id === me, picks: picks.picks } : null;
  }

  /* ------------------------------------------------------------ badges */

  const BADGE = 'fplc-badge';
  let squadIds = new Set();

  function playerFor(name) {
    // A name two players share is matched only when one is in the squad.
    const hit = index.byName.get(name);
    if (hit) return hit;
    if (hit === null && squadIds.size) {
      const mine = [...squadIds].map(id => index.byId.get(id)).filter(p => p && p.name === name);
      if (mine.length === 1) return mine[0];
    }
    return null;
  }

  function badgeFor(p) {
    const label = `FPL Checker: ${fmt(next(p))} predicted points in ${feed.gwName}, ${fmt(ahead(p))} over the next ${p.pts.length}`;
    return h('span', { class: `${BADGE}${doubtful(p) ? ` ${BADGE}--doubt` : ''}`, 'data-fplc-id': String(p.id), title: label, 'aria-label': label, role: 'note', text: fmt(next(p)) });
  }

  function scan() {
    if (!index || !settings.badges) return;
    // Drop badges whose name was changed under them.
    for (const b of document.querySelectorAll(`.${BADGE}`)) {
      const p = index.byId.get(Number(b.dataset.fplcId));
      const text = b.parentElement ? [...b.parentElement.childNodes].filter(n => n.nodeType === 3).map(n => n.nodeValue).join('').trim() : '';
      if (!p || text !== p.name) b.remove();
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = node.nodeValue.trim();
        if (text.length < 2 || text.length > 30) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || parent.closest('script, style, input, textarea, select, option, [contenteditable], #fplc-host')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const hits = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent.querySelector(`:scope > .${BADGE}`)) continue;
      const p = playerFor(node.nodeValue.trim());
      if (p) hits.push([parent, p]);
    }
    for (const [parent, p] of hits) parent.append(badgeFor(p));
  }

  function clearBadges() {
    for (const b of document.querySelectorAll(`.${BADGE}`)) b.remove();
  }

  /* ------------------------------------------------------------- panel */

  let host = null;
  let root = null;

  function ensureHost() {
    if (host && document.documentElement.contains(host)) return;
    host = h('div', { id: 'fplc-host' });
    root = host.attachShadow({ mode: 'open' });
    // Hidden until its styles load, so it never flashes unstyled.
    host.style.display = 'none';
    const style = h('link', { rel: 'stylesheet', href: chrome.runtime.getURL('panel.css') });
    style.addEventListener('load', () => { host.style.display = ''; });
    root.append(style, h('div', { class: 'wrap' }));
    document.documentElement.append(host);
  }

  function saveSettings(patch) {
    settings = { ...settings, ...patch };
    chrome.storage.local.set({ settings });
  }

  function squadView(summary) {
    const list = h('ol', { class: 'squad' });
    summary.rows.forEach((r, i) => {
      if (!r.starting && (i === 0 || summary.rows[i - 1].starting)) list.append(h('li', { class: 'bench', text: 'Bench' }));
      const p = r.player;
      list.append(h('li', { class: `row${r.starting ? '' : ' out'}` },
        h('span', { class: 'pos', text: p ? POS[p.pos] : '' }),
        h('span', { class: 'name' },
          h('span', { text: p ? p.name : 'Unknown' }),
          r.captain ? h('span', { class: 'cap', title: 'Captain', 'aria-label': 'Captain', text: 'C' }) : null,
          p && doubtful(p) ? h('span', { class: 'doubt', title: p.news || 'Doubtful', text: p.chance !== undefined ? `${p.chance}%` : '!' }) : null),
        h('span', { class: 'fx', text: p ? p.fx || 'Blank' : '' }),
        h('span', { class: 'pts', text: p ? fmt(next(p)) : '–' })));
    });
    return list;
  }

  function render() {
    if (!settings.panel || !feed) {
      if (host) host.remove();
      return;
    }
    ensureHost();
    const wrap = root.querySelector('.wrap');
    const summary = team ? squadSummary(index, team.picks) : null;
    const pillText = summary ? `${feed.gwName.replace('Gameweek', 'GW')} · ${fmt(summary.xiTotal)} pts` : `${feed.gwName.replace('Gameweek', 'GW')} predictions`;
    const toggle = h('button', { class: 'pill', type: 'button', 'aria-expanded': String(!settings.collapsed), 'aria-controls': 'fplc-card', onclick: () => { saveSettings({ collapsed: !settings.collapsed }); render(); } },
      h('span', { class: 'mark', 'aria-hidden': 'true' }), h('span', { text: settings.collapsed ? pillText : 'FPL Checker' }));

    const card = h('section', { id: 'fplc-card', class: 'card', 'aria-label': 'FPL Checker predictions' });
    card.hidden = settings.collapsed;
    if (summary) {
      card.append(h('header', {},
        h('p', { class: 'eyebrow', text: `${team.mine ? 'Your team' : 'This team'} · ${feed.gwName}` }),
        h('p', { class: 'total' }, h('strong', { text: fmt(summary.xiTotal) }), h('span', { text: ' predicted points' }))));
      if (summary.bestCaptain && summary.captainGain > 0.05) {
        card.append(h('p', { class: 'tip' }, h('span', { text: 'Captain ' }), h('strong', { text: summary.bestCaptain.name }), h('span', { text: ` instead of ${summary.captain ? summary.captain.name : 'your pick'}: +${fmt(summary.captainGain)} pts` })));
      } else if (summary.bestCaptain) {
        card.append(h('p', { class: 'tip ok', text: `${summary.bestCaptain.name} is your best captain.` }));
      }
      card.append(squadView(summary));
    } else {
      card.append(h('header', {}, h('p', { class: 'eyebrow', text: `${feed.gwName} · top captains` })));
      const list = h('ol', { class: 'squad' });
      for (const p of topPicks(feed)) list.append(h('li', { class: 'row' }, h('span', { class: 'pos', text: POS[p.pos] }), h('span', { class: 'name', text: p.name }), h('span', { class: 'fx', text: p.fx }), h('span', { class: 'pts', text: fmt(next(p)) })));
      card.append(list, h('p', { class: 'hint', text: 'Log in to FPL, or open a team’s Points page, to see that squad here.' }));
    }
    card.append(h('a', { class: 'cta', href: siteLink(team && team.id), target: '_blank', rel: 'noopener' }, h('span', { text: team ? 'Transfers, chips and full check' : 'Open FPL Checker' }), h('span', { 'aria-hidden': 'true', text: '→' })));
    wrap.replaceChildren(card, toggle);
  }

  /* -------------------------------------------------------------- wiring */

  async function refreshTeam() {
    teamPath = location.pathname;
    team = await loadTeam().catch(() => null);
    squadIds = new Set(team ? team.picks.map(p => p.element) : []);
    render();
    scan();
  }

  let queued = false;
  function queueScan() {
    if (queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      // FPL is a single-page app: a new address may show a new team.
      if (location.pathname !== teamPath && entryFromPath(location.pathname) !== (team && team.id)) refreshTeam();
      if (!host || !document.documentElement.contains(host)) render();
      scan();
    }, 400);
  }

  async function start() {
    const stored = await chrome.storage.local.get('settings');
    settings = { ...DEFAULTS, ...(stored.settings || {}) };
    const res = await chrome.runtime.sendMessage({ type: 'feed' }).catch(() => null);
    if (!res || !res.feed) return;
    feed = res.feed;
    index = indexFeed(feed);
    await refreshTeam();
    new MutationObserver(queueScan).observe(document.body, { childList: true, subtree: true, characterData: true });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
      if (!settings.badges) clearBadges();
      render();
      scan();
    });
  }

  start();
})();
