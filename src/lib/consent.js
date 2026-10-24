// Cookie and analytics consent. The login cookie and the settings kept in
// this browser are needed for the site to work, so they don't ask. Visit
// counts and page-speed measurement (Vercel Analytics and Speed Insights)
// are optional: they load only after "Accept", and "Reject" keeps them off.
// The choice is kept on this device; /?cookies asks again. The banner is
// for the website only: inside the Android app or an installed copy
// (isInstalledApp) it doesn't show and the measurement is on until turned
// off in Profile (UK PECR's statistics exemption: we say so in the privacy
// notice and turning it off is one tap), except for people in the EU, EEA
// and Switzerland (needsConsent), where the app asks too.

export const CONSENT_KEY = 'fpl_cookie_consent';
// Bump when what's optional changes, so everyone is asked again.
export const CONSENT_VERSION = 1;
const EVENT = 'fpl-consent';

// { analytics: boolean } once chosen (for this version), else null.
export function parseConsent(raw) {
  try {
    const value = JSON.parse(raw);
    return value && value.v === CONSENT_VERSION && typeof value.analytics === 'boolean' ? { analytics: value.analytics } : null;
  } catch { return null; }
}

export function readConsent() {
  try { return parseConsent(localStorage.getItem(CONSENT_KEY)); } catch { return null; }
}

export function writeConsent(analytics, now = Date.now()) {
  const choice = { analytics: !!analytics };
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: CONSENT_VERSION, analytics: choice.analytics, at: now })); } catch { /* private mode: asked again next visit */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: choice }));
  return choice;
}

// Calls `fn(choice)` when the choice changes here or in another tab.
export function onConsentChange(fn) {
  if (typeof window === 'undefined') return () => {};
  const local = e => fn(e.detail);
  const other = e => { if (e.key === CONSENT_KEY) fn(readConsent()); };
  window.addEventListener(EVENT, local);
  window.addEventListener('storage', other);
  return () => { window.removeEventListener(EVENT, local); window.removeEventListener('storage', other); };
}

// Whether this is the app rather than the website: the Android app opens the
// site with itself as referrer and runs it full screen (standalone), like a
// copy installed to the home screen.
export const ANDROID_APP_REFERRER = 'android-app://uk.co.fplchecker.app';
export function isInstalledApp({ standalone = false, referrer = '' } = {}) {
  return !!standalone || String(referrer).startsWith(ANDROID_APP_REFERRER);
}

// Whether this page is running as the app (see isInstalledApp).
export function runningAsApp() {
  if (typeof window === 'undefined') return false;
  const standalone = navigator.standalone === true || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  return isInstalledApp({ standalone, referrer: document.referrer });
}

// Whether visit counts and page speed run: the saved choice when there is
// one, else `byDefault` (on in the app outside the EU, off otherwise).
export function analyticsAllowed(consent, byDefault) {
  return consent ? !!consent.analytics : !!byDefault;
}

// Where analytics needs a yes first even in the app: the EU, the EEA
// (Iceland, Liechtenstein, Norway) and Switzerland, by ISO country code.
const CONSENT_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'CH',
]);
// The same places by device time zone, for when the country isn't known.
const CONSENT_ZONES = new Set([
  'Europe/Vienna', 'Europe/Brussels', 'Europe/Sofia', 'Europe/Zagreb', 'Europe/Nicosia', 'Asia/Nicosia', 'Asia/Famagusta',
  'Europe/Prague', 'Europe/Copenhagen', 'Europe/Tallinn', 'Europe/Helsinki', 'Europe/Mariehamn', 'Europe/Paris', 'Europe/Berlin',
  'Europe/Busingen', 'Europe/Athens', 'Europe/Budapest', 'Europe/Dublin', 'Europe/Rome', 'Europe/Riga', 'Europe/Vilnius',
  'Europe/Luxembourg', 'Europe/Malta', 'Europe/Amsterdam', 'Europe/Warsaw', 'Europe/Lisbon', 'Atlantic/Madeira', 'Atlantic/Azores',
  'Europe/Bucharest', 'Europe/Bratislava', 'Europe/Ljubljana', 'Europe/Madrid', 'Atlantic/Canary', 'Africa/Ceuta',
  'Europe/Stockholm', 'Atlantic/Reykjavik', 'Europe/Vaduz', 'Europe/Oslo', 'Arctic/Longyearbyen', 'Europe/Zurich',
]);

// Whether someone must be asked first: by country (from the server) when
// known, else by time zone.
export function needsConsent({ country = '', timeZone = '' } = {}) {
  const code = String(country || '').toUpperCase();
  if (/^[A-Z]{2}$/.test(code) && code !== 'XX') return CONSENT_COUNTRIES.has(code);
  return CONSENT_ZONES.has(String(timeZone || ''));
}

// The visitor's country as Vercel sees it (GET /api/auth?region=1), or ''.
export async function fetchCountry() {
  try {
    const res = await fetch('/api/auth?region=1');
    const data = res.ok ? await res.json() : null;
    return data && typeof data.country === 'string' ? data.country : '';
  } catch { return ''; }
}

// A country code from Vercel's x-vercel-ip-country header, or ''.
export function cleanCountry(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

// Whether the address asks to choose again (/?cookies, from the privacy
// notice and the profile).
export function wantsConsentPrompt(search) {
  return new URLSearchParams(search || '').has('cookies');
}
