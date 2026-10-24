import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTheme, resolveTheme } from '../src/lib/theme.js';

test('a theme choice resolves to light or dark, the device deciding for "system"', () => {
  assert.equal(resolveTheme('light', false), 'light');
  assert.equal(resolveTheme('dark', true), 'dark');
  assert.equal(resolveTheme('system', true), 'light');
  assert.equal(resolveTheme('system', false), 'dark');
  assert.equal(resolveTheme('nonsense', false), 'dark');
  // Without storage (here, Node), the device decides.
  assert.equal(readTheme(), 'system');
});
