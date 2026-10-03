import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStaticDataFromRaw, buildOptimalTeam, SQUAD_BUDGET, MAX_PER_REAL_TEAM } from '../src/lib/predictions.js';

// A deterministic synthetic league: 20 clubs × 25 players, with prices and
// FPL expected points that vary so the optimiser has real choices to make.
function league() {
  const teams = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1, code: i + 1, name: `Team ${i + 1}`, short_name: `T${String(i + 1).padStart(2, '0')}`,
    strength: 3, strength_overall_home: 1200, strength_overall_away: 1200,
    strength_attack_home: 1200, strength_attack_away: 1200, strength_defence_home: 1200, strength_defence_away: 1200,
  }));
  const shape = [1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4];
  let id = 0;
  const elements = [];
  teams.forEach(t => shape.forEach((pos, k) => {
    id++;
    const quality = ((id * 37) % 100) / 100; // pseudo-random but fixed
    elements.push({
      id, code: id, web_name: `P${id}`, first_name: 'X', second_name: `P${id}`, team: t.id, element_type: pos,
      now_cost: 40 + Math.round(quality * 90) + (pos === 4 ? 10 : 0), form: (quality * 8).toFixed(1),
      points_per_game: (quality * 7).toFixed(1), total_points: Math.round(quality * 60), ep_next: (1 + quality * 6).toFixed(1),
      status: k % 13 === 0 ? 'i' : 'a', chance_of_playing_next_round: k % 13 === 0 ? 0 : null, minutes: 450,
      news: '', selected_by_percent: '5', expected_goals: '1.0', expected_assists: '1.0', goals_scored: 1, assists: 1,
      penalties_order: null, direct_freekicks_order: null, corners_and_indirect_freekicks_order: null,
    });
  }));
  const now = Date.now();
  const events = Array.from({ length: 38 }, (_, i) => ({ id: i + 1, name: `Gameweek ${i + 1}`, deadline_time: new Date(now + (i - 5.5) * 7 * 864e5).toISOString(), finished: i < 5 }));
  const fixtures = [];
  for (let gw = 1; gw <= 38; gw++) {
    for (let t = 1; t <= 20; t += 2) {
      fixtures.push({ id: gw * 100 + t, event: gw, team_h: t, team_a: t + 1, team_h_difficulty: 3, team_a_difficulty: 3, kickoff_time: new Date(now + (gw - 6) * 7 * 864e5).toISOString(), finished: gw < 6 });
    }
  }
  return { bootstrap: { teams, elements, events, element_types: [1, 2, 3, 4].map(id => ({ id })) }, fixtures };
}

test('optimal squad follows FPL squad rules', () => {
  const { bootstrap, fixtures } = league();
  const staticData = buildStaticDataFromRaw(bootstrap, fixtures);
  const { squad, captainId, viceCaptainId } = buildOptimalTeam(staticData, SQUAD_BUDGET);

  assert.equal(squad.length, 15);
  const byPos = [1, 2, 3, 4].map(p => squad.filter(s => s.player.positionId === p).length);
  assert.deepEqual(byPos, [2, 5, 5, 3]);

  const cost = squad.reduce((sum, s) => sum + s.player.price, 0);
  assert.ok(cost <= SQUAD_BUDGET + 1e-9, `squad costs £${cost.toFixed(1)}m`);

  const perClub = {};
  squad.forEach(s => { perClub[s.player.team] = (perClub[s.player.team] || 0) + 1; });
  assert.ok(Object.values(perClub).every(n => n <= MAX_PER_REAL_TEAM));

  const starters = squad.filter(s => s.isStarting);
  assert.equal(starters.length, 11);
  assert.equal(starters.filter(s => s.player.positionId === 1).length, 1);
  assert.ok(starters.filter(s => s.player.positionId === 2).length >= 3);
  assert.ok(starters.filter(s => s.player.positionId === 4).length >= 1);

  assert.ok(starters.some(s => s.player.id === captainId), 'captain starts');
  assert.notEqual(captainId, viceCaptainId);
});

test('injured players are predicted near zero and never start', () => {
  // The model keeps a 5% sliver for injured/suspended players (FPL's status
  // can lag a recovery), so "near zero" rather than exactly zero.
  const { bootstrap, fixtures } = league();
  const staticData = buildStaticDataFromRaw(bootstrap, fixtures);
  const injuredIds = new Set(bootstrap.elements.filter(e => e.status === 'i').map(e => e.id));
  assert.ok(injuredIds.size > 0);
  injuredIds.forEach(id => assert.ok(staticData.predictionsById[id].nextMatchPredicted < 0.5, `player ${id}`));
  const { squad } = buildOptimalTeam(staticData, SQUAD_BUDGET);
  assert.ok(!squad.some(s => s.isStarting && injuredIds.has(s.player.id)));
});
