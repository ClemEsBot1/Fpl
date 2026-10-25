import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBackNav } from '../src/lib/backNav.js';

// A browser history: entries, the current one, and popstate fired after
// back() (asynchronously, as browsers do: call flush()).
function fakeWindow() {
  const entries = [{ state: null }];
  let at = 0;
  const listeners = [];
  const pending = [];
  const history = {
    get state() { return entries[at].state; },
    get length() { return entries.length; },
    pushState(state) { entries.splice(at + 1); entries.push({ state }); at += 1; },
    replaceState(state) { entries[at] = { state }; },
    back() { pending.push(() => { if (at > 0) { at -= 1; listeners.forEach(l => l({ state: entries[at].state })); } }); },
  };
  return {
    history,
    addEventListener: (type, fn) => { if (type === 'popstate') listeners.push(fn); },
    flush: () => { while (pending.length) pending.shift()(); },
    at: () => at,
  };
}

test('Back goes to the screen before, not out of the app', () => {
  const win = fakeWindow();
  const nav = createBackNav(win);
  const shown = [];
  nav.onScreenBack(s => shown.push(s.fplStage));
  nav.showScreen('home||', { fplStage: 'home' }, '/');
  nav.showScreen('home||', { fplStage: 'home' }, '/'); // the same screen again
  nav.showScreen('league|league|', { fplStage: 'league' }, '/?view=league');
  assert.equal(win.history.length, 2);
  win.history.back(); win.flush();
  assert.deepEqual(shown, ['home']);
});

test('Back closes an open dialog first, and its own close button takes its entry off', () => {
  const win = fakeWindow();
  const nav = createBackNav(win);
  const shown = [];
  nav.onScreenBack(s => shown.push(s.fplStage));
  nav.showScreen('home||', { fplStage: 'home' }, '/');
  nav.showScreen('live|live|', { fplStage: 'live' }, '/?view=live');
  let closed = 0;
  nav.openDialog(() => { closed += 1; });
  assert.equal(win.history.length, 3);
  win.history.back(); win.flush();
  assert.equal(closed, 1);
  assert.deepEqual(shown, [], 'the screen stays');

  // Closed with its X: the entry goes, and that pop isn't taken as Back.
  const id = nav.openDialog(() => { closed += 1; });
  nav.closeDialog(id); win.flush();
  assert.equal(closed, 1);
  assert.equal(win.at(), 1);
  assert.deepEqual(shown, []);
  win.history.back(); win.flush();
  assert.deepEqual(shown, ['home']);
});

test('a dialog opened while another closes waits for its entry to come off', () => {
  const win = fakeWindow();
  const nav = createBackNav(win);
  nav.onScreenBack(() => {});
  nav.showScreen('home||', { fplStage: 'home' }, '/');
  const first = nav.openDialog(() => {});
  nav.closeDialog(first);
  let closedSecond = 0;
  nav.openDialog(() => { closedSecond += 1; });
  win.flush();
  assert.equal(win.at(), 1, 'one entry for the open dialog');
  win.history.back(); win.flush();
  assert.equal(closedSecond, 1);
});
