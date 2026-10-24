import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_VERSION, analyticsAllowed, cleanCountry, isInstalledApp, needsConsent, parseConsent, wantsConsentPrompt } from '../src/lib/consent.js';

test('a saved choice counts only for this version and with a yes or no', () => {
  assert.deepEqual(parseConsent(JSON.stringify({ v: CONSENT_VERSION, analytics: true })), { analytics: true });
  assert.deepEqual(parseConsent(JSON.stringify({ v: CONSENT_VERSION, analytics: false })), { analytics: false });
  assert.equal(parseConsent(JSON.stringify({ v: CONSENT_VERSION - 1, analytics: true })), null, 'an older choice asks again');
  assert.equal(parseConsent(JSON.stringify({ v: CONSENT_VERSION, analytics: 'yes' })), null);
  assert.equal(parseConsent(null), null);
  assert.equal(parseConsent('not json'), null);
});

test('/?cookies asks again', () => {
  assert.equal(wantsConsentPrompt('?cookies'), true);
  assert.equal(wantsConsentPrompt('?gw=8&cookies='), true);
  assert.equal(wantsConsentPrompt('?gw=8'), false);
  assert.equal(wantsConsentPrompt(''), false);
});

test('the banner is for the website: not the Android app or an installed copy', () => {
  assert.equal(isInstalledApp({ standalone: false, referrer: 'https://www.google.com/' }), false);
  assert.equal(isInstalledApp({}), false);
  assert.equal(isInstalledApp({ standalone: true }), true, 'installed to the home screen, or the app full screen');
  assert.equal(isInstalledApp({ referrer: 'android-app://uk.co.fplchecker.app/' }), true, 'opened by the Android app');
  assert.equal(isInstalledApp({ referrer: 'android-app://com.other.app/' }), false);
});

test('who is asked first: the EU, EEA and Switzerland, by country or else time zone', () => {
  assert.equal(needsConsent({ country: 'FR' }), true);
  assert.equal(needsConsent({ country: 'no' }), true, 'Norway (EEA), any case');
  assert.equal(needsConsent({ country: 'CH' }), true);
  assert.equal(needsConsent({ country: 'GB', timeZone: 'Europe/Paris' }), false, 'the country wins over the time zone');
  assert.equal(needsConsent({ country: 'US' }), false);
  assert.equal(needsConsent({ country: '', timeZone: 'Europe/Madrid' }), true);
  assert.equal(needsConsent({ country: 'XX', timeZone: 'Europe/Berlin' }), true, 'unknown country falls back to the zone');
  assert.equal(needsConsent({ timeZone: 'Europe/London' }), false);
  assert.equal(needsConsent({}), false);
});

test('analytics: a saved choice wins, else the default', () => {
  assert.equal(analyticsAllowed(null, true), true);
  assert.equal(analyticsAllowed(null, false), false);
  assert.equal(analyticsAllowed({ analytics: false }, true), false);
  assert.equal(analyticsAllowed({ analytics: true }, false), true);
});

test('country codes from the header are cleaned', () => {
  assert.equal(cleanCountry('de'), 'DE');
  assert.equal(cleanCountry(' GB '), 'GB');
  assert.equal(cleanCountry('<script>'), '');
  assert.equal(cleanCountry(undefined), '');
});
