// Builds an .ics calendar event for an FPL deadline, with an alert a few
// hours before. Works in every calendar app (Google, Apple, Outlook)
// without notifications permissions, accounts or a push server. The text is
// in the app's language (src/lib/i18n.js).

import { t } from './i18n.js';

function icsDate(d) {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// RFC 5545 text escaping, then line folding at 75 octets.
function escapeText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function fold(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts = [];
  let current = '';
  let currentBytes = 0;
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length;
    if (currentBytes + size > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      currentBytes = 0;
    }
    current += ch;
    currentBytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

// gwName: "Gameweek 8"; deadline: ISO string; notes: lines for the
// description (e.g. availability warnings); alertHoursBefore: when the
// reminder pops up.
export function buildDeadlineIcs({ gwName, deadline, notes = [], url = '', alertHoursBefore = 3, now = new Date() }) {
  const start = new Date(deadline);
  const end = new Date(start.getTime() + 15 * 60 * 1000);
  const description = [
    t('{gw} deadline. Make your transfers and pick your captain before then.', { gw: gwName }),
    ...notes,
    url ? t('Check your squad: {url}', { url }) : '',
  ].filter(Boolean).join('\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FPL Checker//Deadline reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:fpl-deadline-${icsDate(start)}@fpl-squad-check`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${escapeText(t('FPL {gw} deadline', { gw: gwName }))}`,
    `DESCRIPTION:${escapeText(description)}`,
    ...(url ? [`URL:${url}`] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(t('FPL {gw} deadline in {hours} hours', { gw: gwName, hours: alertHoursBefore }))}`,
    `TRIGGER:-PT${alertHoursBefore}H`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

// Plain-language warnings for the reminder: anyone in the starting XI
// with an availability note, and the captain especially.
export function squadWarnings(squad) {
  const notes = [];
  const captain = squad.find(s => s.isCaptain);
  if (captain && captain.availNote) notes.push(t('Your captain {name} is flagged: {note}.', { name: captain.player.webName, note: captain.availNote }));
  squad
    .filter(s => s.isStarting && s.availNote && s !== captain)
    .forEach(s => notes.push(t('{name} (starting): {note}.', { name: s.player.webName, note: s.availNote })));
  return notes;
}
