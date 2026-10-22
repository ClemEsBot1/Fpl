import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clubSetPieces, setPieceTags } from '../src/lib/setPieces.js';

test('a player\'s set-piece duties, first choice only bar a second penalty taker', () => {
  assert.deepEqual(setPieceTags({ penaltiesOrder: 1, directFreekicksOrder: 1, cornersOrder: 2 }), ['Pens', 'FKs']);
  assert.deepEqual(setPieceTags({ penaltiesOrder: 2, cornersOrder: 1 }), ['Pens (2nd)', 'Corners']);
  assert.deepEqual(setPieceTags({ penaltiesOrder: null }), []);
  assert.deepEqual(setPieceTags({}), []);
});

test('each club\'s takers in FPL\'s order', () => {
  const players = [
    { id: 1, team: 1, webName: 'Saka', penaltiesOrder: 1, cornersOrder: 2, directFreekicksOrder: 2 },
    { id: 2, team: 1, webName: 'Ødegaard', penaltiesOrder: 2, cornersOrder: 1, directFreekicksOrder: 1 },
    { id: 3, team: 1, webName: 'Rice', cornersOrder: 3 },
    { id: 4, team: 2, webName: 'Salah', penaltiesOrder: 1 },
  ];
  const clubs = clubSetPieces(players, { 1: { id: 1, name: 'Arsenal', short_name: 'ARS' }, 2: { id: 2, name: 'Liverpool', short_name: 'LIV' } });
  assert.deepEqual(clubs.map(c => c.team.short_name), ['ARS', 'LIV']);
  assert.deepEqual(clubs[0].penalties.map(p => p.webName), ['Saka', 'Ødegaard']);
  assert.deepEqual(clubs[0].corners.map(p => p.webName), ['Ødegaard', 'Saka', 'Rice']);
  assert.deepEqual(clubs[0].freekicks.map(p => p.webName), ['Ødegaard', 'Saka']);
  assert.deepEqual(clubs[1].corners, []);
});
