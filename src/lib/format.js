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

export function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = [];
  for (let i = 0; i <= m; i++) dp.push(new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

export function similarity(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na.length || !nb.length) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const dist = levenshtein(na, nb);
  return Math.max(0, 1 - dist / Math.max(na.length, nb.length));
}

// `hints` (club abbreviation / price read off the screenshot) only nudge
// the score, so they break ties between same-named players (two "Gomes",
// a "Wilson" at two clubs) without overriding a clearly better name match.
export function findTopMatches(extractedName, candidates, topN = 3, hints = {}) {
  const { club, price, teamsById } = hints;
  const clubNorm = club ? normalize(club) : null;
  const scored = candidates.map(p => {
    const s1 = similarity(extractedName, p.webName);
    const s2 = similarity(extractedName, p.secondName);
    const s3 = similarity(extractedName, `${p.firstName} ${p.secondName}`);
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
