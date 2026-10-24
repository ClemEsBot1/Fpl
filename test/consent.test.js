import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONSENT_VERSION, parseConsent, wantsConsentPrompt } from '../src/lib/consent.js';

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
