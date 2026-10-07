// Changes made to a Team ID's squad on My team, kept on this device so the
// same team shows them everywhere it appears (Home, My team, Mini-league),
// with or without an account. One entry per Team ID, for the gameweek it
// was edited for; an edit for an earlier gameweek is ignored.

const KEY = 'fpl_team_edits';

function read(storage) {
  try { return JSON.parse(storage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function write(storage, all) {
  try { storage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode or full */ }
}
const defaultStorage = () => (typeof localStorage === 'undefined' ? null : localStorage);

// The edited squad snapshot for this Team ID and gameweek, or null.
export function teamEditFor(teamId, gwId, storage = defaultStorage()) {
  if (!storage) return null;
  const edit = read(storage)[String(teamId)];
  return edit && edit.gwId === gwId && edit.squad ? edit.squad : null;
}

export function saveTeamEdit(teamId, gwId, squad, storage = defaultStorage()) {
  if (!storage) return;
  const all = read(storage);
  all[String(teamId)] = { gwId, squad, savedAt: Date.now() };
  write(storage, all);
}

export function clearTeamEdit(teamId, storage = defaultStorage()) {
  if (!storage) return;
  const all = read(storage);
  delete all[String(teamId)];
  write(storage, all);
}
