import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeReport } from '../api/screenshot-report.js';

test('reports keep only known fields, bounded in size', () => {
  const r = sanitizeReport({
    slots: Array.from({ length: 50 }, (_, i) => ({ read: 'x'.repeat(500), matchedId: i, matchedName: 'Saka', corrected: 1, extra: 'dropped' })),
    note: 'n'.repeat(5000),
    password: 'should not be stored',
  });
  assert.equal(r.slots.length, 20);
  assert.equal(r.slots[0].read.length, 60);
  assert.equal(r.slots[0].corrected, true);
  assert.equal(r.slots[0].extra, undefined);
  assert.equal(r.note.length, 500);
  assert.equal(r.password, undefined);
});

test('non-integer ids are dropped', () => {
  const r = sanitizeReport({ slots: [{ matchedId: '12; DROP' }, { matchedId: 3.5 }, { matchedId: 7 }] });
  assert.deepEqual(r.slots.map(s => s.matchedId), [null, null, 7]);
});
