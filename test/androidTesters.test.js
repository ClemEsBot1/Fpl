import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TESTER_GROUP_URL, TESTER_OPT_IN_URL, isAppLaunch, showTesterBar } from '../src/lib/androidTesters.js';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';
const TABLET = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';

test('the tester bar shows to Android phone browsers only', () => {
  assert.equal(showTesterBar({ userAgent: ANDROID }), true);
  assert.equal(showTesterBar({ userAgent: TABLET }), false);
  assert.equal(showTesterBar({ userAgent: IPHONE }), false);
  assert.equal(showTesterBar({ userAgent: DESKTOP }), false);
});

test('it hides inside the app, once dismissed, and when installed', () => {
  assert.equal(showTesterBar({ userAgent: ANDROID, referrer: 'android-app://uk.co.fplchecker.app/' }), false);
  assert.equal(showTesterBar({ userAgent: ANDROID, inApp: true }), false);
  assert.equal(showTesterBar({ userAgent: ANDROID, standalone: true }), false);
  assert.equal(showTesterBar({ userAgent: ANDROID, dismissed: true }), false);
  assert.equal(isAppLaunch('android-app://uk.co.fplchecker.app'), true);
  assert.equal(isAppLaunch('https://www.google.com/'), false);
});

test('links go to the group and the Play opt-in page', () => {
  assert.equal(TESTER_GROUP_URL, 'https://groups.google.com/g/fpl-checking');
  assert.equal(TESTER_OPT_IN_URL, 'https://play.google.com/apps/testing/uk.co.fplchecker.app');
});
