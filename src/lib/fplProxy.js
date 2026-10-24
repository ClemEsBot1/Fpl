// Rules for the /api/fpl proxy (api/fpl.js), kept separate so they can be
// tested without a server.

// Only the FPL endpoints the app actually calls. Anything else is refused,
// so the function can't be used as a general-purpose FPL proxy.
const ALLOWED_PATHS = [
  // `shared`: the same for everyone, so the last good copy is kept to fall
  // back on when FPL is down (src/lib/lastGood.js).
  { re: /^bootstrap-static\/$/, maxAge: 300, shared: true },
  { re: /^fixtures\/$/, maxAge: 300, shared: true },
  // One gameweek's matches, refreshed every minute for the live screen.
  { re: /^fixtures\/\?event=\d{1,2}$/, maxAge: 60, shared: true },
  { re: /^entry\/\d{1,10}\/$/, maxAge: 120 },
  { re: /^entry\/\d{1,10}\/event\/\d{1,2}\/picks\/$/, maxAge: 120 },
  { re: /^event\/\d{1,2}\/live\/$/, maxAge: 60, shared: true },
  { re: /^leagues-classic\/\d{1,10}\/standings\/$/, maxAge: 300 },
  { re: /^entry\/\d{1,10}\/transfers\/$/, maxAge: 300 },
  { re: /^entry\/\d{1,10}\/history\/$/, maxAge: 300 },
  // One player's matches and past seasons (the player profile).
  { re: /^element-summary\/\d{1,4}\/$/, maxAge: 600 },
];

// Returns the rule for an allowed path, or null.
export function fplPathRule(path) {
  if (typeof path !== 'string') return null;
  return ALLOWED_PATHS.find(rule => rule.re.test(path)) || null;
}

// Successful responses are cached at Vercel's edge, so most visitors get
// FPL data without a round trip to FPL's servers. bootstrap-static is
// several megabytes and only changes a few times a day (prices, news), so
// a few minutes of caching costs nothing in freshness. Stale copies are
// served for a while longer while a fresh one is fetched in the background.
// Errors are never cached, so a temporary FPL outage clears immediately.
// Browsers keep their own copy for up to a minute too, so moving between
// screens (or reopening the app) doesn't download the same data again.
export function fplCacheControl(rule, status) {
  if (!rule || status !== 200) return 'no-store';
  return `public, max-age=${Math.min(60, rule.maxAge)}, s-maxage=${rule.maxAge}, stale-while-revalidate=${rule.maxAge * 4}`;
}

// A saved copy served while FPL is down: cached briefly, so the real data
// is back within a minute of FPL recovering.
export const STALE_CACHE_CONTROL = 'public, max-age=30, s-maxage=60';
