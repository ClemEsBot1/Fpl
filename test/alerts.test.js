import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAlerts, pickRival } from '../src/lib/alerts.js';

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

test("a squad player's prediction dropping since first seen this gameweek is flagged", async () => {
  const { predictionBaseline } = await import('../src/lib/alerts.js');
  const withPred = (pts, note = null) => ({
    ...data(48, [{ id: 7, webName: 'Watkins', status: 'a' }]),
    predictionsById: { 7: { nextMatchPredicted: pts, availNote: note } },
  });
  const first = predictionBaseline(null, withPred(6), [7]);
  assert.deepEqual(first, { gwId: 8, byId: { 7: 6 } });
  // Seen again later: the first figure stays.
  assert.deepEqual(predictionBaseline(first, withPred(3), [7]), first);
  assert.deepEqual(buildAlerts(withPred(5.5), [7], NOW, { baseline: first }), [], 'a small dip is not flagged');
  const [drop] = buildAlerts(withPred(2.4, '50% chance of playing'), [7], NOW, { baseline: first });
  assert.equal(drop.kind, 'drop');
  assert.equal(drop.title, "Watkins's prediction is down to 2.4 pts");
  assert.match(drop.body, /^He was predicted 6\.0 pts for Gameweek 8 when you first looked\. 50% chance of playing\./);
  // A new gameweek starts afresh.
  assert.deepEqual(buildAlerts(withPred(2.4), [7], NOW, { baseline: { gwId: 7, byId: { 7: 6 } } }), []);
});

test('an injured or dropped player comes with a swap idea for the same money', () => {
  const players = [
    { id: 1, webName: 'Isak', positionId: 4, team: 1, price: 8.5, status: 'i', news: 'Hamstring', note: 'Injured' },
    { id: 2, webName: 'Wood', positionId: 4, team: 2, price: 7.0, status: 'a' },
    { id: 3, webName: 'Haaland', positionId: 4, team: 3, price: 14.5, status: 'a' },
    { id: 4, webName: 'Wissa', positionId: 4, team: 4, price: 6.5, status: 'd' },
    { id: 5, webName: 'Saka', positionId: 3, team: 5, price: 8.0, status: 'a' },
  ];
  const d = data(48, players);
  d.allPlayers = players;
  d.predictionsById[2].predicted = 5.2;
  d.predictionsById[3].predicted = 8;
  d.predictionsById[4].predicted = 6;
  d.predictionsById[5].predicted = 7;
  const news = buildAlerts(d, [1], NOW).find(a => a.kind === 'news');
  // Haaland costs too much, Wissa is doubtful, Saka plays elsewhere.
  assert.match(news.body, /Swap idea: Wood \(£7\.0m, 5\.2 pts a week\)\.$/);
  // No swap from a player you already own.
  assert.doesNotMatch(buildAlerts(d, [1, 2], NOW).find(a => a.kind === 'news').body, /Swap idea/);
});

test('a swap idea keeps to three a club', () => {
  const squad = [1, 10, 11, 12].map((id, i) => ({ id, webName: `P${id}`, positionId: i ? 3 : 4, team: i ? 9 : 1, price: 8, status: i ? 'a' : 'i', note: i ? null : 'Injured', news: 'x' }));
  const pool = [{ id: 2, webName: 'Clubmate', positionId: 4, team: 9, price: 7, status: 'a' }, { id: 3, webName: 'Other', positionId: 4, team: 8, price: 7, status: 'a' }];
  const d = data(48, [...squad, ...pool]);
  d.allPlayers = [...squad, ...pool];
  d.predictionsById[2].predicted = 9;
  d.predictionsById[3].predicted = 4;
  assert.match(buildAlerts(d, [1, 10, 11, 12], NOW).find(a => a.kind === 'news').body, /Swap idea: Other/);
});

test('two hours out with no transfer made, the deadline alert says so', () => {
  const alerts = buildAlerts(data(1, []), [], NOW, { noTransferYet: true });
  assert.match(alerts[0].body, /^You haven't made a transfer for Gameweek 8 yet\. /);
  assert.doesNotMatch(buildAlerts(data(5, []), [], NOW, { noTransferYet: true })[0].body, /haven't made/, 'only in the last two hours');
});

test('watched players: their news and price moves, as info, not your own twice', () => {
  const players = [
    { id: 1, webName: 'Saka', status: 'a', priceChangePercent: 95 },
    { id: 2, webName: 'Isak', status: 'i', news: 'Hamstring injury', note: 'Injured', priceChangePercent: -93 },
    { id: 3, webName: 'Rice', status: 'a', priceChangePercent: 99 },
  ];
  const alerts = buildAlerts(data(48, players), [3], NOW, { watchIds: [1, 2, 3, 99] });
  const watched = alerts.filter(a => a.watched);
  assert.deepEqual(watched.map(a => `${a.kind}-${a.title.split(/[: ]/)[0]}`).sort(), ['fall-Isak', 'news-Isak', 'rise-Saka']);
  assert.ok(watched.every(a => a.id.startsWith('watch-')), 'ids of their own, so buying him later alerts afresh');
  assert.ok(watched.every(a => a.level === 'info'));
  assert.match(watched.find(a => a.kind === 'rise').body, /buying before the change gets today's price/);
  assert.equal(alerts.filter(a => a.id.includes('-3-')).length, 1, 'a watched player you own alerts once, as yours');
  assert.deepEqual(buildAlerts(data(48, players), [], NOW).filter(a => a.watched), [], 'no watchlist, no watched alerts');
});

test('your mini-league rival: the one just above you, or below if you lead', () => {
  const members = [{ entry: 5, teamName: 'B', rank: 2 }, { entry: 9, teamName: 'A', rank: 1 }, { entry: 7, teamName: 'C', rank: 3 }];
  assert.deepEqual(pickRival(members, 7), { entry: 5, teamName: 'B', ahead: true });
  assert.deepEqual(pickRival(members, '9'), { entry: 5, teamName: 'B', ahead: false });
  assert.equal(pickRival(members, 4), null, 'not in the league');
  assert.equal(pickRival([members[0]], 5), null);
});

test('before the deadline, your rival’s likely captain and the players they have that you don’t', () => {
  const players = [
    { id: 1, webName: 'Haaland' }, { id: 2, webName: 'Saka' }, { id: 3, webName: 'Palmer' }, { id: 4, webName: 'Raya' }, { id: 5, webName: 'Bench' },
  ];
  const d = data(20, players);
  d.predictionsById = { 1: { nextMatchPredicted: 8 }, 2: { nextMatchPredicted: 6 }, 3: { nextMatchPredicted: 5 }, 4: { nextMatchPredicted: 4 }, 5: { nextMatchPredicted: 9 } };
  const picks = [
    { element: 1, position: 1, is_captain: true }, { element: 2, position: 2 }, { element: 3, position: 3 }, { element: 4, position: 4 }, { element: 5, position: 12 },
  ];
  const rival = { entry: 5, teamName: 'Rivals FC', ahead: true, picks, fromGw: 7, now: NOW };
  const alert = buildAlerts(d, [1, 4], NOW, { rival }).find(a => a.kind === 'rival');
  assert.equal(alert.id, 'rival-8-5');
  assert.equal(alert.title, 'Rivals FC (just above you) will likely captain Haaland');
  assert.match(alert.body, /^They have Saka and Palmer, who you don't: 11\.0 predicted points between them\. From their Gameweek 7 team/);
  assert.doesNotMatch(alert.body, /captain\./, 'you own their captain');
  // Not more than two days before the deadline.
  assert.equal(buildAlerts(data(60, players), [1], NOW, { rival }).find(a => a.kind === 'rival'), undefined);
});
