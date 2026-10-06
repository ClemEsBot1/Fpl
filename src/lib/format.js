// Small shared helpers: player-name matching, number/price formatting and
// countdowns.
export const POSITION_LABELS = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

// Previously matched availNote against a fixed list of exact strings
// ['Injured', 'Suspended', 'Unavailable'] to decide whether a player's
// availability alone should force them onto the transfer-suggestion
// candidate list. That missed two whole categories that predictions.js
// actually produces: the literal string 'Doubtful' (status === 'd' with no
// chanceNext data), and the dynamic `${chanceNext}% chance of playing`
// string used whenever chanceNext is a number <= 75. Neither of those ever
// equals one of the three fixed strings, so a doubtful player (say, 25%
// chance of playing) was never flagged this way — they'd only surface if
// their availability-suppressed predicted points happened to *also* land
// them in the bottom 5 of the starting XI, which isn't guaranteed in an
// 11-player squad with several other genuinely weak-but-healthy picks.
// See suggestTransfers below: isBad is now "has any availability note at
// all", which covers every case predictions.js can produce.

export const DIFF_COLORS = {
  1: { bg: '#1F9D55', text: '#06210F' },
  2: { bg: '#6FCB90', text: '#06210F' },
  3: { bg: '#E8C547', text: '#241D02' },
  4: { bg: '#E08A3C', text: '#2B1400' },
  5: { bg: '#E14545', text: '#2B0505' },
};

// Letters that Unicode doesn't split into a base letter plus an accent, so
// the accent-stripping below would otherwise delete them ("\u00d8degaard" ->
// "degaard", "Gro\u00df" -> "gro").
const LETTER_FOLDS = { '\u00f8': 'o', '\u00e6': 'ae', '\u0153': 'oe', '\u00df': 'ss', '\u0142': 'l', '\u0111': 'd', '\u00f0': 'd', '\u00fe': 'th', '\u0131': 'i' };

export function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[\u00f8\u00e6\u0153\u00df\u0142\u0111\u00f0\u00fe\u0131]/g, ch => LETTER_FOLDS[ch])
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

// For "does this name contain what was typed": also ignores spaces, so
// "alexander arnold" finds "Alexander-Arnold".
export function searchKey(str) {
  return normalize(str).replace(/ /g, '');
}

// Each player's names, normalised once and reused by every search and
// fuzzy match (instead of re-normalising ~800 players per keystroke).
const playerKeyCache = new WeakMap();
export function playerKeys(p) {
  let keys = playerKeyCache.get(p);
  if (!keys) {
    keys = {
      web: normalize(p.webName),
      second: normalize(p.secondName),
      full: normalize(`${p.firstName} ${p.secondName}`),
      webSearch: searchKey(p.webName),
      secondSearch: searchKey(p.secondName),
    };
    playerKeyCache.set(p, keys);
  }
  return keys;
}

// Whether a player's name matches a search box's text.
export function playerMatchesSearch(p, query) {
  const q = searchKey(query);
  if (!q) return true;
  const k = playerKeys(p);
  return k.webSearch.includes(q) || k.secondSearch.includes(q);
}

// Two rows instead of a full matrix: same result, far less allocation.
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      cur[j] = ai === b.charCodeAt(j - 1)
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

// Similarity of two already-normalised strings, 0..1.
function similarityOfNormalized(na, nb) {
  if (!na.length || !nb.length) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const dist = levenshtein(na, nb);
  return Math.max(0, 1 - dist / Math.max(na.length, nb.length));
}

export function similarity(a, b) {
  return similarityOfNormalized(normalize(a), normalize(b));
}

// `hints` (club abbreviation / price read off the screenshot) only nudge
// the score, so they break ties between same-named players (two "Gomes",
// a "Wilson" at two clubs) without overriding a clearly better name match.
export function findTopMatches(extractedName, candidates, topN = 3, hints = {}) {
  const { club, price, teamsById } = hints;
  const clubNorm = club ? normalize(club) : null;
  const name = normalize(extractedName);
  const scored = candidates.map(p => {
    const k = playerKeys(p);
    const s1 = similarityOfNormalized(name, k.web);
    const s2 = s1 === 1 ? 1 : similarityOfNormalized(name, k.second);
    const s3 = s2 === 1 ? 1 : similarityOfNormalized(name, k.full);
    let score = Math.max(s1, s2, s3);
    const team = teamsById && teamsById[p.team];
    if (clubNorm && team && normalize(team.short_name) === clubNorm) score += 0.06;
    // A screenshot shows the selling price, which can sit a little under
    // the current price after a rise — so allow some slack either way.
    if (typeof price === 'number' && Math.abs(price - p.price) <= 0.3) score += 0.04;
    return { player: p, score: Math.min(1, score) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

export function fmtPts(n) { return (Math.round(n * 10) / 10).toFixed(1); }

export function fmtPrice(n) { return `£${n.toFixed(1)}m`; }

// Must match the hour in vercel.json's cron schedule ("0 6 * * *" = 06:00 UTC).
export const DAILY_REFRESH_HOUR_UTC = 6;

// Next occurrence of the daily refresh, as a fixed point in time derived
// purely from the clock — deliberately NOT derived from any cached/loaded
// squad's builtAt, so it stays correct and stable no matter what device,
// browser, or cache state produced the squad currently on screen.
export function getNextDailyRefreshUTC(hourUTC = DAILY_REFRESH_HOUR_UTC) {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUTC, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

export function formatCountdown(targetISO, opts = {}) {
  const { suffix = 'to deadline', passedLabel = 'Deadline passed' } = opts;
  if (!targetISO) return '';
  const diff = new Date(targetISO).getTime() - Date.now();
  if (diff <= 0) return passedLabel;
  const totalMins = Math.floor(diff / 60000);
  const days = Math.floor(totalMins / 1440);
  const hours = Math.floor((totalMins % 1440) / 60);
  const mins = totalMins % 60;
  if (days > 0) return `${days}d ${hours}h ${suffix}`;
  return `${hours}h ${mins}m ${suffix}`;
}

// A team's points for a past gameweek: FPL's own figure when that week's
// picks were loaded (entryHistory), otherwise the starters' live points
// added up.
export function officialGwPoints(data) {
  const history = data && data.entryHistory;
  return history && typeof history.points === 'number' ? history.points : (data ? data.actualXiTotal : null);
}
