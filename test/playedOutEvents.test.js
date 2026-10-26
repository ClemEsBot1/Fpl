import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPlayedOutEvents } from '../src/lib/predictions.js';

// FPL leaves a gameweek's `finished` (and each match's) false until it has
// confirmed the bonus and checked the data, often a day after the last
// match; each match's finished_provisional is set at the final whistle.
test('a gameweek counts as over once all its matches have had the final whistle', () => {
  const events = [{ id: 8, finished: false }, { id: 9, finished: false }];
  const over = withPlayedOutEvents(events, [
    { event: 8, finished: false, finished_provisional: true },
    { event: 8, finished: true, finished_provisional: true },
    { event: 9, finished: false, finished_provisional: false },
  ]);
  assert.deepEqual(over[0], { id: 8, finished: true, bonusPending: true });
  assert.deepEqual(over[1], { id: 9, finished: false });
  const settled = withPlayedOutEvents(events, [{ event: 8, finished: true, finished_provisional: true }]);
  assert.deepEqual(settled[0], { id: 8, finished: true, bonusPending: false });
  // A match still being played keeps the gameweek live.
  const playing = withPlayedOutEvents(events, [{ event: 8, finished: false, finished_provisional: true }, { event: 8, started: true, finished: false, finished_provisional: false }]);
  assert.equal(playing[0].finished, false);
});

test('a gameweek is settled once FPL has processed it, not at the last final whistle', async () => {
  const { isGwSettled, isGwFinished } = await import('../src/lib/gameweeks.js');
  const staticData = { allEvents: [{ id: 7, finished: true }, { id: 8, finished: true, bonusPending: true }, { id: 9, finished: false }] };
  assert.equal(isGwSettled(staticData, 7), true);
  assert.equal(isGwFinished(staticData, 8), true);
  assert.equal(isGwSettled(staticData, 8), false);
  assert.equal(isGwSettled(staticData, 9), false);
});
