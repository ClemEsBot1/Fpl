import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanTeamId, digestDue, sendDigests, teamPicks, tokenMatches, unsubscribeToken } from '../src/lib/digest.js';
import { deadlineDigestEmail } from '../src/lib/emails.js';
import { fakeRedis } from './helpers/fakeRedis.js';

const el = (id, name, team, pos, cost, status = 'a') => ({ id, web_name: name, team, element_type: pos, now_cost: cost, status });
// A full squad, plus players to buy.
const squadEls = [
  el(1, 'GK1', 1, 1, 45), el(2, 'GK2', 2, 1, 40),
  el(3, 'D1', 3, 2, 50), el(4, 'D2', 4, 2, 45), el(5, 'D3', 5, 2, 45), el(6, 'D4', 6, 2, 40), el(7, 'D5', 7, 2, 40),
  el(8, 'Salah', 8, 3, 130), el(9, 'M2', 9, 3, 80), el(10, 'M3', 10, 3, 60), el(11, 'Weak', 1, 3, 55), el(12, 'M5', 2, 3, 50),
  el(13, 'Haaland', 11, 4, 150), el(14, 'F2', 12, 4, 70), el(15, 'F3', 13, 4, 60, 'i'),
];
const market = [
  el(20, 'TooDear', 14, 3, 90), el(21, 'Bargain', 15, 3, 60), el(22, 'ClubFull', 8, 3, 55), el(23, 'Injured', 16, 3, 50, 'i'),
];
const elements = [...squadEls, ...market];
const picks = { picks: squadEls.map((e, i) => ({ element: e.id, position: i + 1 })), entry_history: { bank: 5 } };
const predicted = Object.fromEntries(elements.map(e => [e.id, 3]));
Object.assign(predicted, { 8: 8.4, 13: 7.9, 15: 9.9 });
const ahead = Object.fromEntries(elements.map(e => [e.id, 15]));
Object.assign(ahead, { 11: 6, 15: 30, 21: 24, 20: 40, 22: 35, 23: 50 });

test('the team’s captain and best affordable transfer', () => {
  const r = teamPicks({ picks, elements, predicted, ahead });
  assert.deepEqual(r.captain, { name: 'Salah', points: 8.4 }, 'F3 is injured, so not captain');
  // Weak (5.5m, 6 pts) out; budget 5.5 + 0.5 bank = 6.0: TooDear is too
  // dear, Injured isn't available; ClubFull (35) beats Bargain (24).
  assert.equal(r.transfer.out.name, 'Weak');
  assert.equal(r.transfer.in.name, 'ClubFull');
  assert.equal(r.transfer.gain, 29);
});

test('no transfer when nothing is worth a point', () => {
  const flat = Object.fromEntries(elements.map(e => [e.id, 10]));
  assert.equal(teamPicks({ picks, elements, predicted, ahead: flat }).transfer, null);
});

test('due a day before the deadline, not in the last hours', () => {
  const event = { id: 9, deadline_time: '2026-10-24T10:00:00Z' };
  const at = h => Date.parse(event.deadline_time) - h * 3600_000;
  assert.equal(digestDue(event, at(30)), false);
  assert.equal(digestDue(event, at(25)), true);
  assert.equal(digestDue(event, at(4)), true);
  assert.equal(digestDue(event, at(2)), false);
  assert.equal(cleanTeamId('1234'), 1234);
  assert.equal(cleanTeamId('x'), null);
});

test('unsubscribe tokens are tied to the user and the secret', () => {
  const t = unsubscribeToken('Clem', 's1');
  assert.equal(tokenMatches('clem', t, 's1'), true);
  assert.equal(tokenMatches('sam', t, 's1'), false);
  assert.equal(tokenMatches('clem', t, 's2'), false);
  assert.equal(tokenMatches('clem', undefined, 's1'), false);
});

test('each user gets one email a gameweek; a failure is retried', async () => {
  const redis = fakeRedis();
  const sent = [];
  let fail = true;
  const users = [{ username: 'clem', email: 'c@example.com', digest: { teamId: 1 } }, { username: 'noemail', digest: { teamId: 2 } }, { username: 'off', email: 'o@example.com' }];
  const event = { id: 9, name: 'Gameweek 9', deadline_time: '2026-10-24T10:00:00Z' };
  const run = () => sendDigests({
    redis, users, event, season: '2026-27', elements, predicted, ahead,
    loadPicks: async () => { if (fail) { fail = false; throw new Error('FPL down'); } return picks; },
    send: async m => { sent.push(m); },
    email: data => deadlineDigestEmail({ ...data, appUrl: 'https://fplchecker.co.uk', unsubscribeUrl: 'https://fplchecker.co.uk/api/auth?digest=off' }),
  });
  assert.deepEqual(await run(), { sent: 0, skipped: 1 });
  assert.deepEqual(await run(), { sent: 1, skipped: 0 });
  assert.deepEqual(await run(), { sent: 0, skipped: 0 }, 'not twice');
  assert.equal(sent[0].to, 'c@example.com');
  assert.equal(sent[0].subject, 'Gameweek 9: captain Salah, bring in ClubFull');
  assert.match(sent[0].text, /Weak out, ClubFull \(£5\.5m\) in, \+29\.0 pts/);
  assert.match(sent[0].html, /Stop these emails/);
});
