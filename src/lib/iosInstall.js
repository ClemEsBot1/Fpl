// iPhones can't install from a prompt like Android: the person has to tap
// Share, then "Add to Home Screen". A one-line tip says so, in Safari on
// an iPhone or iPad only, until it's added or closed.
export function showIosInstallTip({ userAgent = '', maxTouchPoints = 0, standalone = false, dismissed = false } = {}) {
  if (dismissed || standalone) return false;
  const ua = String(userAgent);
  // iPadOS reports itself as a Mac with a touch screen.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (!ios) return false;
  // Other browsers on iOS can't add to the home screen in the same way.
  return /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
}
