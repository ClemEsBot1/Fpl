import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { squadFromRaw, extractSquadFromOcrLines, compactKey } from '../src/lib/screenshotOcr.js';

// OCR output captured from a real FPL app Pitch View screenshot (1440×3120,
// Android): the squad below, Haaland (C), B.Fernandes (V). Replaying it
// tests everything after the browser-only OCR step.
const raw = JSON.parse(readFileSync(new URL('./fixtures/real-pitch-view.raw.json', import.meta.url)));
const pool = JSON.parse(readFileSync(new URL('./fixtures/players-and-fixtures.json', import.meta.url)));

const teamsById = Object.fromEntries(pool.teams.map(t => [t.id, t]));
const fixturesByTeam = {};
pool.teams.forEach(t => { fixturesByTeam[t.id] = []; });
pool.fixtures.forEach(f => {
  fixturesByTeam[f.team_h].push({ event: f.event, opponent: f.team_a, isHome: true });
  fixturesByTeam[f.team_a].push({ event: f.event, opponent: f.team_h, isHome: false });
});
const byId = Object.fromEntries(pool.players.map(p => [p.id, p]));
const club = id => teamsById[byId[id].team].short_name;
const names = entries => entries.map(e => `${byId[e.id].webName} ${club(e.id)}`);

test('real screenshot: every player, in position, with the right club', () => {
  const squad = squadFromRaw(raw, pool.players, { teamsById, fixturesByTeam });
  assert.deepEqual(names(squad.starting_xi.goalkeepers), ['A.Becker LIV']);
  assert.deepEqual(names(squad.starting_xi.defenders), ['Giles HUL', 'De Cuyper BHA', 'Virgil LIV']);
  assert.deepEqual(names(squad.starting_xi.midfielders), ['Gomez BHA', 'B.Fernandes MUN', 'Szoboszlai LIV', 'Ødegaard ARS', 'Scott BOU']);
  assert.deepEqual(names(squad.starting_xi.forwards), ['Haaland MCI', 'João Pedro CHE']);
  assert.deepEqual(names(squad.bench), ['Dubravka TOT', 'Barry EVE', 'Konsa ARS', 'Muñoz NFO']);
  const all = [...Object.values(squad.starting_xi).flat(), ...squad.bench];
  assert.ok(all.every(e => !e.ambiguous), 'with fixtures, no player should need confirming');
  assert.ok(all.every(e => e.club === club(e.id)), 'detected club is reported');
});

test('real screenshot: captain and vice-captain armbands', () => {
  const squad = squadFromRaw(raw, pool.players, { teamsById, fixturesByTeam });
  assert.equal(squad.captain, 'Haaland');
  assert.match(squad.vice_captain, /^B\.Fernan/);
});

test('real screenshot: shirt sponsor text is not taken for a player', () => {
  const squad = squadFromRaw(raw, pool.players, { teamsById, fixturesByTeam });
  const all = [...Object.values(squad.starting_xi).flat(), ...squad.bench];
  assert.equal(all.length, 15);
  assert.ok(!all.some(e => /MARKETS/i.test(e.name)));
});

test('real screenshot without fixtures: still 15, shared names flagged', () => {
  // E.g. the Points page, which shows points instead of fixtures.
  const squad = squadFromRaw(raw, pool.players, {});
  const all = [...Object.values(squad.starting_xi).flat(), ...squad.bench];
  assert.equal(all.length, 15);
  const munoz = all.find(e => byId[e.id].webName.startsWith('Mu'));
  assert.equal(byId[munoz.id].positionId, 2, 'the decoy midfielder Munoz must not take a midfield place');
  assert.ok(munoz.ambiguous);
  assert.ok(all.some(e => byId[e.id].webName === 'B.Fernandes'));
});

test('compactKey ignores accents, case, spacing and punctuation', () => {
  // OCR reads FPL's "Ø" as "@"; both drop out, so the keys still agree.
  assert.equal(compactKey('@degaard'), compactKey('Ødegaard'));
  assert.equal(compactKey('B. Fernandes'), 'bfernandes');
  assert.equal(compactKey('Muñoz'), 'munoz');
  assert.equal(compactKey('Mac Allister'), 'macallister');
});

// Minimal synthetic lines: one word per line, stacked vertically.
const line = (text, y, x = 100) => [{ text, confidence: 90, bbox: { x0: x, y0: y, x1: x + 120, y1: y + 30 } }];
const tiny = [
  { id: 1, webName: 'Saka', secondName: 'Saka', positionId: 3, price: 10, team: 1 },
  { id: 2, webName: 'Alexander-Arnold', secondName: 'Alexander-Arnold', positionId: 2, price: 7, team: 2 },
  { id: 3, webName: 'Son', secondName: 'Son', positionId: 3, price: 9, team: 3 },
];

test('names cut short with an ellipsis match by prefix', () => {
  const squad = extractSquadFromOcrLines([line('Alexander-Ar...', 0), line('Saka', 100), line('Son', 200)], tiny);
  assert.deepEqual(squad.starting_xi.defenders.map(e => e.id), [2]);
});

test('short names must match exactly', () => {
  const squad = extractSquadFromOcrLines([line('Sun', 0), line('Saka', 100), line('Soka', 200)], tiny);
  const ids = Object.values(squad.starting_xi).flat().map(e => e.id);
  assert.ok(!ids.includes(3), '"Sun" must not match "Son"');
  assert.ok(ids.includes(1));
});

test('not an FPL screenshot', () => {
  const squad = extractSquadFromOcrLines([line('Hello', 0), line('world', 100)], tiny);
  assert.equal(squad.not_fpl_screenshot, true);
});
