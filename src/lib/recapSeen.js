// The last gameweek recap seen for a team, kept per season ("2026-27:8"),
// so having seen last season's Gameweek 38 doesn't hide this season's
// first recap. Shared by the device's copy (src/lib/recap.js) and the
// account's (recap_seen in api/auth.js).

// Plain numbers were saved before the season was kept with them, all in
// this season.
const LEGACY_SEASON = '2026-27';

// The gameweek seen in `season` from a saved value; 0 for another season.
export function seenGwIn(value, season) {
  if (typeof value === 'number' || /^\d+$/.test(String(value || ''))) return season === LEGACY_SEASON ? Number(value) : 0;
  const m = /^(\d{4}-\d{2}):(\d+)$/.exec(String(value || ''));
  return m && m[1] === season ? Number(m[2]) : 0;
}

export const seenValue = (season, gwId) => `${season}:${gwId}`;
