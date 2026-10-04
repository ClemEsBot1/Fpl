import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCareerBaselineByCode, buildLastSeasonStatsByCode, compactPlayerHistory, computeCareerBaseline } from '../src/lib/playerHistory.js';

const SEASONS = ['2023-24', '2024-25', '2025-26'];

test("a squad player's past rate is scaled by how much they played", () => {
  const regular = { seasons: { '2025-26': { minutes: 3000, total_points: 150 } } };
  assert.equal(computeCareerBaseline(regular, SEASONS), 150 / 3000 * 90, 'a regular starter keeps their full rate');

  // 40 points in 900 minutes is 4.0 per 90, but they only played about a
  // third of the minutes a regular starter does.
  const squadPlayer = { seasons: { '2025-26': { minutes: 900, total_points: 40 } } };
  const baseline = computeCareerBaseline(squadPlayer, SEASONS);
  assert.ok(baseline > 1 && baseline < 1.5, `baseline ${baseline}`);
  assert.equal(computeCareerBaseline({ seasons: { '2025-26': { minutes: 200, total_points: 10 } } }, SEASONS), null, 'too few minutes to judge');
});

test('the compact history gives the same numbers as the full one', () => {
  const full = {
    seasons: SEASONS,
    players: {
      100: { seasons: { '2024-25': { minutes: 2800, total_points: 160, points_per_game: 5.3 }, '2025-26': { minutes: 3100, total_points: 190, points_per_game: 5.6 } } },
      200: { seasons: { '2025-26': { minutes: 100, total_points: 3 } } },
    },
  };
  const compact = compactPlayerHistory(full);
  const fullBaselines = buildCareerBaselineByCode(full);
  assert.equal(compact.careerBaselineByCode[100], Math.round(fullBaselines[100] * 100) / 100);
  assert.equal(compact.careerBaselineByCode[200], undefined);
  assert.deepEqual(compact.lastSeasonStatsByCode[100], { season: '2025-26', totalPoints: 190, pointsPerGame: 5.6 });
  // The app reads the compact form through the same functions.
  assert.equal(buildCareerBaselineByCode(compact), compact.careerBaselineByCode);
  assert.equal(buildLastSeasonStatsByCode(compact), compact.lastSeasonStatsByCode);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(full).length);
});
