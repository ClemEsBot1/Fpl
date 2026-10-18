// A deterministic synthetic league: 20 clubs × 25 players, with prices and
// FPL expected points that vary so the optimiser has real choices to make.
export function league() {
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
