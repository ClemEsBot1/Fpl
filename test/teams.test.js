import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEntryFromBody, mergeEntry } from '../src/lib/teams.js';

const ids = Array.from({ length: 15 }, (_, k) => k + 1);
const squad = { playerIds: ids, captainId: 1, viceCaptainId: 2, startingIds: ids.slice(0, 11), bankTenths: 5, gwId: 8 };
const now = () => new Date('2026-10-06T00:00:00Z');

test('a saved Team ID can carry changes for one gameweek', () => {
  const built = buildEntryFromBody({ type: 'teamId', teamId: 123, squad });
  assert.equal(built.ok, true);
  assert.deepEqual(built.entry.squad, squad);
  assert.equal(buildEntryFromBody({ type: 'teamId', teamId: 123, squad: { ...squad, gwId: undefined } }).ok, false, 'needs its gameweek');
  assert.equal(buildEntryFromBody({ type: 'teamId', teamId: 123, squad: { ...squad, captainId: 99 } }).ok, false, 'squad is checked');
});

test('re-saving a Team ID keeps its changes unless they are cleared', () => {
  const first = mergeEntry([], buildEntryFromBody({ type: 'teamId', teamId: 123, squad }).entry, { makeId: () => 'a', now });
  const relabelled = mergeEntry(first.teams, buildEntryFromBody({ type: 'teamId', teamId: 123, label: 'Mine' }).entry, { now });
  assert.equal(relabelled.teams.length, 1);
  assert.deepEqual(relabelled.teams[0].squad, squad);
  assert.equal(relabelled.teams[0].label, 'Mine');
  const cleared = mergeEntry(relabelled.teams, buildEntryFromBody({ type: 'teamId', teamId: 123, squad: null }).entry, { now });
  assert.equal(cleared.teams[0].squad, null);
});
