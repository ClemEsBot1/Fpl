import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOME_TEAM_KEY, MAX_COMPARE, MODEL_CHOICES, readCompareIds, readGwParam, readHomeTeamId, readInApp, readModelChoice,
  readTeamParam, readTermsAccepted, readViewParam, writeCompareIds, writeGwParam, writeInApp, writeModelChoice,
  writeParams, writeTermsAccepted,
} from '../src/lib/appStorage.js';
import { TERMS_VERSION } from '../src/lib/terms.js';

function memoryStorage() {
  const data = {};
  return {
    data,
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: k => { delete data[k]; },
  };
}
const broken = {
  getItem: () => { throw new Error('denied'); },
  setItem: () => { throw new Error('denied'); },
  removeItem: () => { throw new Error('denied'); },
};

// appStorage reads the browser globals when called, so each test swaps in
// its own storage and address.
function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
function fakeWindow(url) {
  const replaced = [];
  const win = {
    location: null,
    history: {
      state: { s: 1 },
      replaceState(state, title, next) {
        replaced.push(next);
        const u = new URL(next, 'https://fplchecker.co.uk');
        win.location = { pathname: u.pathname, search: u.search, hash: u.hash };
      },
    },
    replaced,
  };
  const u = new URL(url, 'https://fplchecker.co.uk');
  win.location = { pathname: u.pathname, search: u.search, hash: u.hash };
  return win;
}

let local;
let session;
beforeEach(() => {
  local = memoryStorage();
  session = memoryStorage();
  setGlobal('localStorage', local);
  setGlobal('sessionStorage', session);
  setGlobal('window', fakeWindow('/'));
});

test('the gameweek in the address is read only when it is 1-38', () => {
  for (const [search, want] of [['?gw=7', 7], ['?gw=1', 1], ['?gw=38', 38], ['?gw=0', null], ['?gw=39', null], ['?gw=-3', null], ['?gw=2.5', null], ['?gw=abc', null], ['?gw=', null], ['', null]]) {
    setGlobal('window', fakeWindow(`/${search}`));
    assert.equal(readGwParam(), want, search);
  }
});

test('only known screens are restored from ?view=', () => {
  setGlobal('window', fakeWindow('/?view=team'));
  assert.equal(readViewParam(), 'team');
  setGlobal('window', fakeWindow('/?view=admin'));
  assert.equal(readViewParam(), 'admin');
  for (const search of ['?view=unknown', '?view=', '', '?view=Team']) {
    setGlobal('window', fakeWindow(`/${search}`));
    assert.equal(readViewParam(), null, search);
  }
});

test('?team= is read only as a 1-10 digit Team ID', () => {
  setGlobal('window', fakeWindow('/?team=1234567'));
  assert.equal(readTeamParam(), '1234567');
  for (const search of ['?team=12345678901', '?team=12a', '?team=-1', '?team=', '', '?team=1%0A']) {
    setGlobal('window', fakeWindow(`/${search}`));
    assert.equal(readTeamParam(), null, search);
  }
});

test('writing params replaces the address in place, keeps others and the hash', () => {
  const win = fakeWindow('/app?team=5#top');
  setGlobal('window', win);
  writeGwParam(7);
  assert.deepEqual(win.replaced, ['/app?team=5&gw=7#top']);
  assert.equal(readGwParam(), 7);
  writeParams({ team: null, view: 'team' });
  assert.equal(win.replaced.at(-1), '/app?gw=7&view=team#top');
  writeGwParam(null);
  writeParams({ view: null });
  assert.equal(win.replaced.at(-1), '/app#top', 'no stray "?" once every param is gone');
});

test('writing the same params again adds no history change', () => {
  const win = fakeWindow('/?gw=7');
  setGlobal('window', win);
  writeGwParam(7);
  writeParams({ view: null });
  assert.deepEqual(win.replaced, []);
});

test('the home Team ID is read from storage', () => {
  assert.equal(readHomeTeamId(), null);
  local.setItem(HOME_TEAM_KEY, '123');
  assert.equal(readHomeTeamId(), '123');
  local.setItem(HOME_TEAM_KEY, '');
  assert.equal(readHomeTeamId(), null);
});

test('compare ids keep only whole numbers, at most three', () => {
  assert.deepEqual(readCompareIds(), []);
  writeCompareIds([1, 2]);
  assert.deepEqual(readCompareIds(), [1, 2]);
  writeCompareIds([1, '2', 3.5, null, 4, 5, 6]);
  assert.deepEqual(readCompareIds(), [1, 4, 5]);
  assert.equal(readCompareIds().length <= MAX_COMPARE, true);
  local.setItem('fpl_compare', '{"a":1}');
  assert.deepEqual(readCompareIds(), [], 'not an array');
  local.setItem('fpl_compare', 'not json');
  assert.deepEqual(readCompareIds(), [], 'corrupt value');
});

test('the in-app flag lives in this tab only', () => {
  assert.equal(readInApp(), false);
  writeInApp(true);
  assert.equal(readInApp(), true);
  assert.equal(local.getItem('fpl_in_app'), null, 'never kept across visits');
  writeInApp(false);
  assert.equal(readInApp(), false);
});

test('the admin model choice falls back to blend', () => {
  assert.equal(readModelChoice(), 'blend');
  for (const choice of MODEL_CHOICES) {
    writeModelChoice(choice);
    assert.equal(readModelChoice(), choice);
  }
  local.setItem('fpl_admin_predictions', 'something-old');
  assert.equal(readModelChoice(), 'blend');
});

test('broken or missing storage never throws', () => {
  setGlobal('localStorage', broken);
  setGlobal('sessionStorage', broken);
  assert.equal(readHomeTeamId(), null);
  assert.deepEqual(readCompareIds(), []);
  assert.equal(readInApp(), false);
  assert.equal(readModelChoice(), 'blend');
  assert.doesNotThrow(() => writeCompareIds([1]));
  assert.doesNotThrow(() => writeInApp(true));
  assert.doesNotThrow(() => writeInApp(false));
  assert.doesNotThrow(() => writeModelChoice('ml'));
  setGlobal('localStorage', undefined);
  assert.equal(readHomeTeamId(), null, 'no storage at all');
});

// Last: once accepted, the terms stay accepted for the rest of the visit
// (module state), so this runs after every other test.
test('terms count as accepted only for the current version, and for the visit without storage', () => {
  assert.equal(readTermsAccepted(), false);
  local.setItem('fpl_terms_accepted', 'some-old-version');
  assert.equal(readTermsAccepted(), false, 'an older version is asked again');
  local.setItem('fpl_terms_accepted', TERMS_VERSION);
  assert.equal(readTermsAccepted(), true);
  setGlobal('localStorage', broken);
  assert.equal(readTermsAccepted(), false);
  writeTermsAccepted();
  assert.equal(readTermsAccepted(), true, 'remembered for the visit when storage fails');
});
