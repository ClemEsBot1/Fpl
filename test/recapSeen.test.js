import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seenGwIn, seenValue } from '../src/lib/recapSeen.js';

test("last season's recap seen doesn't hide this season's first one", () => {
  assert.equal(seenGwIn(seenValue('2026-27', 38), '2027-28'), 0);
  assert.equal(seenGwIn(seenValue('2027-28', 3), '2027-28'), 3);
  // Saved before the season was kept: this season's.
  assert.equal(seenGwIn(8, '2026-27'), 8);
  assert.equal(seenGwIn('8', '2026-27'), 8);
  assert.equal(seenGwIn(38, '2027-28'), 0);
  assert.equal(seenGwIn(undefined, '2026-27'), 0);
  assert.equal(seenGwIn('rubbish', '2026-27'), 0);
});
