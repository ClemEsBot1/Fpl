import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAlerts } from '../src/lib/alerts.js';

const NOW = Date.parse('2026-10-08T12:00:00Z');
const data = (deadlineInHours, players) => ({
  targetEvent: { id: 8, name: 'Gameweek 8', deadline_time: new Date(NOW + deadlineInHours * 3600e3).toISOString() },
  playersById: Object.fromEntries(players.map(p => [p.id, p])),
  predictionsById: Object.fromEntries(players.map(p => [p.id, { availNote: p.note || null }])),
});

test('the deadline is flagged inside a day, and again inside two hours', () => {
  assert.deepEqual(buildAlerts(data(30, []), [], NOW), []);
  const day = buildAlerts(data(5.5, []), [], NOW);
  assert.equal(day[0].id, 'deadline-8-24h');
  assert.equal(day[0].title, 'Gameweek 8 deadline in 5h 30m');
  const close = buildAlerts(data(0.5, []), [], NOW);
  assert.equal(close[0].id, 'deadline-8-2h');
  assert.equal(close[0].level, 'warn');
});

test('your flagged players and price moves, injuries first', () => {
  const players = [
    { id: 1, webName: 'Saka', status: 'd', news: 'Knock - 75% chance of playing', note: '75% chance of playing', priceChangePercent: 10 },
    { id: 2, webName: 'Palmer', status: 'a', priceChangePercent: 96 },
    { id: 3, webName: 'Isak', status: 'i', news: 'Hamstring injury', note: 'Injured', priceChangePercent: -92 },
    { id: 4, webName: 'Rice', status: 'i', news: 'Out', note: 'Injured' },
  ];
  const alerts = buildAlerts(data(48, players), [1, 2, 3], NOW);
  assert.deepEqual(alerts.map(a => a.kind), ['news', 'fall', 'news', 'rise']);
  assert.equal(buildAlerts(data(5, players), [1, 2, 3], NOW)[0].kind, 'deadline');
  assert.equal(alerts[0].title, 'Isak: Injured');
  assert.equal(alerts.find(a => a.kind === 'rise').id, 'rise-2-2026-10-08');
  // 12:00 UTC is 13:00 in London (BST): prices change in 11 hours.
  assert.match(alerts.find(a => a.kind === 'fall').body, /^Prices change at midnight UK time, in 11h 0m\. If you plan to sell him/);
  // New news is a new alert; the same news keeps its id.
  const again = buildAlerts(data(48, players), [1], NOW)[0].id;
  assert.equal(again, alerts.find(a => a.title.startsWith('Saka')).id);
  const changed = buildAlerts(data(48, [{ ...players[0], news: 'Knock - 50% chance of playing' }]), [1], NOW)[0].id;
  assert.notEqual(changed, again);
});
