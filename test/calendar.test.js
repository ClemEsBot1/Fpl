import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDeadlineIcs, squadWarnings } from '../src/lib/calendar.js';

test('deadline event with a 3-hour alert', () => {
  const ics = buildDeadlineIcs({ gwName: 'Gameweek 8', deadline: '2026-10-17T10:00:00Z', notes: ['Your captain Haaland is flagged: 75% chance of playing.'], url: 'https://fpl-virid-psi.vercel.app', now: new Date('2026-10-03T12:00:00Z') });
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261017T100000Z/);
  assert.match(ics, /TRIGGER:-PT3H/);
  assert.match(ics, /SUMMARY:FPL Gameweek 8 deadline/);
  assert.match(ics.replace(/\r\n /g, ''), /Haaland is flagged: 75% chance of playing\./);
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75), 'lines are folded');
});

test('text is escaped', () => {
  const ics = buildDeadlineIcs({ gwName: 'GW, 1; test', deadline: '2026-10-17T10:00:00Z' }).replace(/\r\n /g, '');
  assert.ok(ics.includes(String.raw`SUMMARY:FPL GW\, 1\; test deadline`));
});

test('warnings cover the captain and flagged starters only', () => {
  const p = (webName, extra) => ({ player: { webName }, isStarting: true, ...extra });
  const notes = squadWarnings([
    p('Haaland', { isCaptain: true, availNote: '75% chance of playing' }),
    p('Saka', { availNote: 'Injured' }),
    p('Raya', {}),
    p('Wood', { isStarting: false, availNote: 'Doubtful' }),
  ]);
  assert.deepEqual(notes, ['Your captain Haaland is flagged: 75% chance of playing.', 'Saka (starting): Injured.']);
});
