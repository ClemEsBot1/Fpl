// Shared by the content script (content.js) and the popup (popup.js): no
// DOM or chrome.* here, so test/extension.test.js can load it in Node.
// Loaded as a plain script, so it hangs everything off globalThis.fplc.
(() => {
  const SITE = 'https://fplchecker.co.uk';

  // The feed (src/lib/extensionFeed.js) keyed for lookups. byName holds a
  // player's FPL short name only when no one else has it, so a badge never
  // goes on the wrong "Gabriel".
  function indexFeed(feed) {
    const byId = new Map();
    const byName = new Map();
    for (const p of feed.players || []) {
      byId.set(p.id, p);
      byName.set(p.name, byName.has(p.name) ? null : p);
    }
    return { byId, byName };
  }

  const next = p => (p && p.pts && p.pts.length ? p.pts[0] : 0);
  const ahead = p => (p && p.pts ? p.pts.reduce((a, b) => a + b, 0) : 0);
  const fmt = n => (Math.round(n * 10) / 10).toFixed(1);
  // A player FPL flags who may miss out (75% or less to play).
  const doubtful = p => !!p && p.status !== undefined && p.status !== 'a' && !(p.chance >= 75);

  // A squad from FPL's picks ([{ element, position, multiplier,
  // is_captain }], positions 1-11 starting) against the feed: each pick's
  // prediction, the XI's total with the captain counted twice (three
  // times on Triple Captain), and the starter who'd be the best captain.
  function squadSummary(index, picks) {
    const rows = [...picks]
      .sort((a, b) => a.position - b.position)
      .map(pick => ({ pick, player: index.byId.get(pick.element) || null, starting: pick.position <= 11, captain: !!pick.is_captain }));
    const starters = rows.filter(r => r.starting && r.player);
    const captainRow = rows.find(r => r.captain) || null;
    const multiplier = captainRow && captainRow.pick.multiplier > 1 ? captainRow.pick.multiplier : 2;
    const base = starters.reduce((sum, r) => sum + next(r.player), 0);
    const xiTotal = base + (captainRow && captainRow.starting && captainRow.player ? (multiplier - 1) * next(captainRow.player) : 0);
    const best = starters.filter(r => !doubtful(r.player)).sort((a, b) => next(b.player) - next(a.player))[0] || null;
    const captainGain = best && captainRow && captainRow.player && best !== captainRow
      ? (multiplier - 1) * (next(best.player) - next(captainRow.player))
      : 0;
    return { rows, xiTotal, bestCaptain: best ? best.player : null, captain: captainRow ? captainRow.player : null, captainGain };
  }

  // The best captains this gameweek across every player, for when there's
  // no squad to show.
  function topPicks(feed, n = 5) {
    return (feed.players || []).filter(p => !doubtful(p) && p.fx).sort((a, b) => next(b) - next(a)).slice(0, n);
  }

  function searchPlayers(feed, query, n = 8) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const sq = strip(q);
    return (feed.players || []).filter(p => strip(p.name).includes(sq) || p.team.toLowerCase() === sq).sort((a, b) => next(b) - next(a)).slice(0, n);
  }

  // FPL Checker's full check for a team, opened from the extension.
  function siteLink(teamId) {
    const id = /^\d{1,10}$/.test(String(teamId || '')) ? String(teamId) : null;
    return `${SITE}/${id ? `?team=${id}&` : '?'}utm_source=fpl-extension`;
  }

  // A player's page on FPL Checker.
  function playerLink(p) {
    const slug = p && /^[a-z0-9-]{1,80}$/.test(String(p.slug || '')) ? p.slug : null;
    return `${SITE}/${slug ? `player/${slug}` : 'fpl-players'}?utm_source=fpl-extension`;
  }

  // The FPL team in an FPL address (/entry/<id>/...), or null.
  function entryFromPath(path) {
    const m = /\/entry\/(\d{1,10})(?:\/|$)/.exec(String(path || ''));
    return m ? m[1] : null;
  }

  const POS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

  globalThis.fplc = { SITE, FEED_URL: `${SITE}/ext/predictions.json`, POS, indexFeed, squadSummary, topPicks, searchPlayers, siteLink, playerLink, entryFromPath, next, ahead, fmt, doubtful };
})();
