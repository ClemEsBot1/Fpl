// What the app remembers between visits and reloads: in this browser's
// storage, or in the address so a reload or a shared link opens the same
// thing.
import { TERMS_VERSION } from './terms.js';

// Where the Team ID shown on Home is remembered.
export const HOME_TEAM_KEY = 'fpl_home_team_id';
export function readHomeTeamId() {
  try { return localStorage.getItem(HOME_TEAM_KEY) || null; } catch { return null; }
}

// The gameweek picked in the header is kept in the address (?gw=7), so a
// reload or a shared link opens on the same gameweek.
export function readGwParam() {
  const gw = Number(new URLSearchParams(window.location.search).get('gw'));
  return Number.isInteger(gw) && gw >= 1 && gw <= 38 ? gw : null;
}
export function writeGwParam(gw) {
  writeParams({ gw: gw ? String(gw) : null });
}
// Sets (or, for null, removes) query parameters without a new history entry.
export function writeParams(values) {
  const params = new URLSearchParams(window.location.search);
  Object.entries(values).forEach(([key, value]) => { if (value) params.set(key, value); else params.delete(key); });
  const query = params.toString();
  const next = window.location.pathname + (query ? `?${query}` : '') + window.location.hash;
  if (next !== window.location.pathname + window.location.search + window.location.hash) window.history.replaceState(window.history.state, '', next);
}

// The screen open is kept in the address too (?view=team, and ?team=123
// for someone else's team), so a reload opens it again rather than Home.
export const RESTORABLE_VIEWS = ['team', 'league', 'screenshot', 'best', 'build', 'lookback', 'saved', 'fixtures', 'compare', 'explore', 'live', 'admin'];

// Players picked to compare (Compare players), kept on this device.
const COMPARE_KEY = 'fpl_compare';
export const MAX_COMPARE = 3;
export function readCompareIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(COMPARE_KEY) || '[]');
    return Array.isArray(ids) ? ids.filter(Number.isInteger).slice(0, MAX_COMPARE) : [];
  } catch { return []; }
}
export function writeCompareIds(ids) {
  try { localStorage.setItem(COMPARE_KEY, JSON.stringify(ids)); } catch { /* storage unavailable */ }
}
export function readViewParam() {
  const view = new URLSearchParams(window.location.search).get('view');
  return RESTORABLE_VIEWS.includes(view) ? view : null;
}
// Whether this tab was past the welcome page, so a reload of Home stays
// on Home. Kept for the tab only: a new visit still starts with welcome.
const IN_APP_KEY = 'fpl_in_app';
export function readInApp() {
  try { return sessionStorage.getItem(IN_APP_KEY) === '1'; } catch { return false; }
}
export function writeInApp(inApp) {
  try { if (inApp) sessionStorage.setItem(IN_APP_KEY, '1'); else sessionStorage.removeItem(IN_APP_KEY); } catch { /* storage unavailable */ }
}
// The Terms version this browser agreed to (asked again when it changes).
// Without storage it's remembered for the visit only.
const TERMS_KEY = 'fpl_terms_accepted';
let termsAcceptedThisVisit = false;
export function readTermsAccepted() {
  if (termsAcceptedThisVisit) return true;
  try { return localStorage.getItem(TERMS_KEY) === TERMS_VERSION; } catch { return false; }
}
export function writeTermsAccepted() {
  termsAcceptedThisVisit = true;
  try { localStorage.setItem(TERMS_KEY, TERMS_VERSION); } catch { /* storage unavailable */ }
}
export function readTeamParam() {
  const team = new URLSearchParams(window.location.search).get('team');
  return team && /^\d{1,10}$/.test(team) ? team : null;
}

// Admins only: whether squads are predicted with the blend everyone sees,
// or the formula or the ML model alone ('blend' | 'formula' | 'ml'), kept
// on this device. A new key, so a choice from before the blend doesn't
// carry over.
const MODEL_KEY = 'fpl_admin_predictions';
export const MODEL_CHOICES = ['blend', 'formula', 'ml'];
export function readModelChoice() {
  try {
    const choice = localStorage.getItem(MODEL_KEY);
    return MODEL_CHOICES.includes(choice) ? choice : 'blend';
  } catch { return 'blend'; }
}
export function writeModelChoice(choice) {
  try { localStorage.setItem(MODEL_KEY, choice); } catch { /* storage unavailable */ }
}
