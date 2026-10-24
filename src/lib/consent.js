// Cookie and analytics consent. The login cookie and the settings kept in
// this browser are needed for the site to work, so they don't ask. Visit
// counts and page-speed measurement (Vercel Analytics and Speed Insights)
// are optional: they load only after "Accept", and "Reject" keeps them off.
// The choice is kept on this device; /?cookies asks again. The banner is
// for the website only: inside the Android app or an installed copy
// (isInstalledApp) it doesn't show, and the measurement stays off unless
// turned on in Profile.

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

// Whether the address asks to choose again (/?cookies, from the privacy
// notice and the profile).
export function wantsConsentPrompt(search) {
  return new URLSearchParams(search || '').has('cookies');
}
