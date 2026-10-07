import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fplPathRule, fplCacheControl } from '../src/lib/fplProxy.js';

test('allows exactly the FPL endpoints the app uses', () => {
  for (const path of ['bootstrap-static/', 'fixtures/', 'entry/1234567/', 'entry/1234567/event/8/picks/', 'event/8/live/', 'leagues-classic/314/standings/']) {
    assert.ok(fplPathRule(path), path);
  }
});

test('refuses anything else', () => {
  for (const path of ['', 'me/', 'entry/abc/', 'entry/1/history/', 'leagues-classic/x/standings/', 'leagues-classic/1/standings/?page_standings=2', 'leagues-h2h/1/standings/', '../bootstrap-static/', 'bootstrap-static/?x=1', 'event/8/live', 'entry/1/event/8/picks/../../../', undefined, null]) {
    assert.equal(fplPathRule(path), null, String(path));
  }
});

test('caches successful responses at the edge, never errors', () => {
  const rule = fplPathRule('bootstrap-static/');
  assert.match(fplCacheControl(rule, 200), /s-maxage=300/);
  assert.match(fplCacheControl(rule, 200), /stale-while-revalidate/);
  assert.equal(fplCacheControl(rule, 404), 'no-store');
  assert.equal(fplCacheControl(rule, 503), 'no-store');
  assert.equal(fplCacheControl(null, 200), 'no-store');
});
