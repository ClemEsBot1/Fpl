// A Team ID from whatever was typed or pasted: the number itself, or a link
// to the team on the FPL site (…/entry/1234567/event/8, …/entry/1234567/
// history). Returns the digits, or '' when there's no ID in it.
export function parseTeamId(input) {
  const text = String(input ?? '').trim();
  const inLink = text.match(/entry\/(\d{1,10})(?:\/|$|\?|#)/i);
  if (inLink) return inLink[1];
  if (/^[\d\s]+$/.test(text)) return text.replace(/\s/g, '').slice(0, 10);
  return text.replace(/\D/g, '').slice(0, 10);
}

// A league ID from the number or a link to its standings
// (…/leagues/314/standings/c).
export function parseLeagueId(input) {
  const text = String(input ?? '').trim();
  const inLink = text.match(/leagues\/(\d{1,10})(?:\/|$|\?|#)/i);
  if (inLink) return inLink[1];
  return text.replace(/\D/g, '').slice(0, 10);
}
