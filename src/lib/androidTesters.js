// The Android app's closed test on Google Play. Testers join the Google
// Group first (Play lets the group in), then opt in on the testing page.
export const TESTER_GROUP_URL = 'https://groups.google.com/g/fpl-checker';
export const TESTER_OPT_IN_URL = 'https://play.google.com/apps/testing/uk.co.fplchecker.app';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=uk.co.fplchecker.app';
const APP_REFERRER = 'android-app://uk.co.fplchecker.app';

// Show the "help test the app" bar to Android phone browsers only: not
// iPhones or desktops (they can't test), and not inside the app itself
// (it opens the site with the app as referrer, in standalone mode).
export function showTesterBar({ userAgent = '', referrer = '', standalone = false, inApp = false, dismissed = false } = {}) {
  if (dismissed || inApp || standalone) return false;
  if (String(referrer).startsWith(APP_REFERRER)) return false;
  return /Android/i.test(userAgent) && /Mobile/i.test(userAgent);
}

export function isAppLaunch(referrer = '') {
  return String(referrer).startsWith(APP_REFERRER);
}
