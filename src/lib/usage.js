// What people do in the app, counted per day in Redis: no cookies, no
// personal data, just "N team checks today". Shown on the admin page.
// (Vercel's own custom events need its paid plan.)
import { bump, getCount } from './rateLimit.js';

// The only names counted, with how the admin page labels them.
export const EVENTS = {
  start: 'Pressed Start',
  team_check: 'Checked a Team ID',
  screenshot_check: 'Checked a screenshot',
  best_squad: 'Opened the best squad',
  build_squad: 'Built a squad',
  save_team: 'Saved a team',
  share: 'Shared a card',
  league: 'Opened a mini-league',
  live: 'Opened live points',
  signup: 'Created an account',
  signup_google: 'Signed up with Google',
  login: 'Logged in',
  feedback: 'Sent feedback',
  install: 'Installed the app',
};

const KEEP_SECONDS = 120 * 24 * 60 * 60;
const day = ms => new Date(ms).toISOString().slice(0, 10);
const keyFor = (name, ms) => `usage:${day(ms)}:${name}`;

// Adds one to today's count. False for a name that isn't counted.
export async function recordEvent(redis, name, now = Date.now()) {
  if (typeof name !== 'string' || !Object.hasOwn(EVENTS, name)) return false;
  await bump(redis, keyFor(name, now), KEEP_SECONDS);
  return true;
}

// The last `days` days: { days: ['2026-10-18', …] newest first,
// rows: [{ name, label, counts: [n per day], total }] } busiest first.
export async function usageReport(redis, days = 14, now = Date.now()) {
  const dates = Array.from({ length: days }, (_, i) => now - i * 86_400_000);
  const rows = [];
  for (const [name, label] of Object.entries(EVENTS)) {
    const counts = [];
    for (const d of dates) counts.push(await getCount(redis, keyFor(name, d)));
    rows.push({ name, label, counts, total: counts.reduce((a, b) => a + b, 0) });
  }
  rows.sort((a, b) => b.total - a.total);
  return { days: dates.map(day), rows };
}
