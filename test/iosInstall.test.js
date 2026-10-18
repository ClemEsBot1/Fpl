import { test } from 'node:test';
import assert from 'node:assert/strict';
import { showIosInstallTip } from '../src/lib/iosInstall.js';

const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36';

test('the add-to-home-screen tip shows in iPhone and iPad Safari only', () => {
  assert.equal(showIosInstallTip({ userAgent: SAFARI }), true);
  assert.equal(showIosInstallTip({ userAgent: IPAD, maxTouchPoints: 5 }), true);
  assert.equal(showIosInstallTip({ userAgent: IPAD, maxTouchPoints: 0 }), false, 'a real Mac');
  assert.equal(showIosInstallTip({ userAgent: CHROME_IOS }), false);
  assert.equal(showIosInstallTip({ userAgent: ANDROID }), false);
  assert.equal(showIosInstallTip({ userAgent: SAFARI, standalone: true }), false, 'already added');
  assert.equal(showIosInstallTip({ userAgent: SAFARI, dismissed: true }), false);
});
