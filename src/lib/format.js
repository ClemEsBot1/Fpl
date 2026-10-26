// Small shared helpers: player-name matching, number/price formatting and
// countdowns.
import { t } from './i18n.js';
export const POSITION_LABELS = { 1: t('GKP'), 2: t('DEF'), 3: t('MID'), 4: t('FWD') };

// How likely a player is to miss the next match, coloured as in the FPL
// app: 'c75' (75% chance of playing, yellow), 'c50' (orange), 'c25' (dark
// orange) and 'out' (injured, suspended or unavailable, red); null when
// there's no worry (the same players availabilityNote in predictions.js
// notes). A doubt with no chance given counts as 50%.
export function availLevel(player) {
  if (!player) return null;
  const chance = typeof player.chanceNext === 'number' ? player.chanceNext : null;
  if (player.status === 'u' || player.status === 'n') return 'out';
  if (chance === null) {
    if (player.status === 'i' || player.status === 's') return 'out';
    return player.status === 'd' ? 'c50' : null;
  }
  if (chance > 75 && player.status !== 'i' && player.status !== 's') return null;
  if (chance <= 0) return 'out';
  if (chance <= 25) return 'c25';
  if (chance <= 50) return 'c50';
  return 'c75';
}
// What a player's prediction counts for in a predicted total: the
// captain's armband (2, or 3 under Triple Captain), 1 for the rest of the
// XI, and 0 on the bench (1 under Bench Boost). The vice-captain only ever
// counts once: FPL hands him the armband when the captain doesn't play,
// but a prediction is for the captain you picked. activeChip, when known,
// settles the armband; otherwise a captain's own multiplier of 3 shows it.
export function predictedMultiplier(slot, activeChip = null) {
  if (!slot.isStarting) return activeChip === 'bboost' ? 1 : 0;
  if (slot.isCaptain) return activeChip === '3xc' ? 3 : Math.max(2, Math.min(3, slot.multiplier || 0));
  return 1;
}

// " is-<level>" for a class list, or ''.
export const availClass = player => { const level = availLevel(player); return level ? ` is-${level}` : ''; };

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

// Whether a deadline is less than a day away (and hasn't passed).
export function isDeadlineSoon(targetISO, now = Date.now()) {
  if (!targetISO) return false;
  const diff = new Date(targetISO).getTime() - now;
  return diff > 0 && diff < 864e5;
}

// "2d 4h to deadline"; `bare` leaves off "to deadline".
export function formatCountdown(targetISO, opts = {}) {
  const { bare = false, passedLabel = t('Deadline passed') } = opts;
  if (!targetISO) return '';
  const diff = new Date(targetISO).getTime() - Date.now();
  if (diff <= 0) return passedLabel;
  const totalMins = Math.floor(diff / 60000);
  const d = Math.floor(totalMins / 1440);
  const h = Math.floor((totalMins % 1440) / 60);
  const m = totalMins % 60;
  if (d > 0) return bare ? t('{d}d {h}h', { d, h }) : t('{d}d {h}h to deadline', { d, h });
  return bare ? t('{h}h {m}m', { h, m }) : t('{h}h {m}m to deadline', { h, m });
}

// A team's points for a gameweek that has started: FPL's own figure once
// the week is over and its picks were loaded (entryHistory). While the week
// is on FPL's figure lags behind, so it's the live score as FPL will settle
// it (liveTotal: projected bonus, automatic subs, the vice-captain), or the
// starters' live points added up. Neither takes off a transfer hit: FPL
// counts that against the season total, not the week's points.
export function officialGwPoints(data) {
  if (!data) return null;
  const history = data.entryHistory;
  const event = Array.isArray(data.allEvents) ? data.allEvents.find(e => e.id === data.gwId) : null;
  // Still being played, or over but not yet processed by FPL (its history
  // doesn't count the automatic subs yet): the live total.
  const live = event && (!event.finished || event.bonusPending);
  if (live && typeof data.liveTotal === 'number') return data.liveTotal;
  return !live && history && typeof history.points === 'number' ? history.points : data.actualXiTotal;
}

// A gameweek's points for a player who has none to show: "DNP" once his
// matches are over without him playing (slot.dnp), else a dash.
export const noPointsLabel = slot => (slot && slot.dnp ? t('DNP') : '–');
