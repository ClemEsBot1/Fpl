export const MAX_SAVED_TEAMS = 20;
const MAX_LABEL_LENGTH = 40;

function sanitizeLabel(label, fallback) {
  if (typeof label !== 'string' || !label.trim()) return fallback;
  return label.trim().slice(0, MAX_LABEL_LENGTH);
}

function sanitizeGwId(gwId) {
  const n = Number(gwId);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

// Checks a compact squad snapshot (playerIds/captainId/viceCaptainId, plus
// optional startingIds and bankTenths) and returns { ok, squad } with only
// those fields, or { ok: false, error }.
function validateSquad(squad) {
  const playerIds = squad && Array.isArray(squad.playerIds) ? squad.playerIds.map(Number) : null;
  if (!playerIds || playerIds.length !== 15 || playerIds.some(id => !Number.isInteger(id))) {
    return { ok: false, error: 'A custom squad needs exactly 15 valid player ids.' };
  }
  if (new Set(playerIds).size !== 15) {
    return { ok: false, error: 'A custom squad needs 15 different players.' };
  }
  const captainId = Number(squad.captainId);
  if (!playerIds.includes(captainId)) {
    return { ok: false, error: 'The captain must be part of the squad.' };
  }
  // The vice-captain is optional (a squad can be saved without one).
  const viceCaptainId = squad.viceCaptainId == null ? null : Number(squad.viceCaptainId);
  if (viceCaptainId !== null && (!playerIds.includes(viceCaptainId) || viceCaptainId === captainId)) {
    return { ok: false, error: 'The vice-captain must be another player in the squad.' };
  }
  const saved = { playerIds, captainId, viceCaptainId };
  // Optional: the XI and bank the squad was saved with, so loading it
  // back keeps the person's own formation and money in the bank.
  if (Array.isArray(squad.startingIds)) {
    const startingIds = squad.startingIds.map(Number);
    if (startingIds.length !== 11 || new Set(startingIds).size !== 11 || startingIds.some(id => !playerIds.includes(id))) {
      return { ok: false, error: 'The starting XI must be 11 players from the squad.' };
    }
    saved.startingIds = startingIds;
  }
  if (squad.bankTenths != null) {
    const bankTenths = Number(squad.bankTenths);
    if (!Number.isInteger(bankTenths) || bankTenths < 0 || bankTenths > 1000) {
      return { ok: false, error: 'The bank must be between £0.0m and £100.0m.' };
    }
    saved.bankTenths = bankTenths;
  }
  return { ok: true, squad: saved };
}

// Validates the two shapes of saveable entry — an FPL Team ID, or a
// compact custom-squad snapshot (playerIds/captainId/viceCaptainId, the
// same shape hydrateSquadSnapshot already knows how to rebuild against
// live data). Both shapes also carry an optional `gwId` — the gameweek
// that was current/being viewed when the squad was saved, purely
// informational (rehydration always uses live current data regardless).
// Returns { ok, error } or { ok: true, entry } — entry is missing
// id/savedAt, which the caller fills in.
export function buildEntryFromBody(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'A request body is required.' };
  const gwId = sanitizeGwId(body.gwId);

  if (body.type === 'teamId') {
    const teamId = Number(body.teamId);
    if (!Number.isInteger(teamId) || teamId < 1) {
      return { ok: false, error: 'A valid numeric FPL Team ID is required.' };
    }
    const entry = { type: 'teamId', teamId, gwId, label: sanitizeLabel(body.label, `Team ${teamId}`) };
    // Optional: changes made to the team in the app, saved as a squad for
    // the gameweek they were made for (squad.gwId). Loading the Team ID for
    // that gameweek shows them instead of the picks on FPL. `null` clears
    // them; leaving `squad` out keeps whatever was saved before.
    if (body.squad === null) {
      entry.squad = null;
    } else if (body.squad !== undefined) {
      const checked = validateSquad(body.squad);
      if (!checked.ok) return checked;
      const squadGwId = sanitizeGwId(body.squad.gwId);
      if (!squadGwId) return { ok: false, error: 'Saved changes need the gameweek they were made for.' };
      entry.squad = { ...checked.squad, gwId: squadGwId };
    }
    return { ok: true, entry };
  }

  if (body.type === 'custom') {
    const checked = validateSquad(body.squad);
    if (!checked.ok) return checked;
    return {
      ok: true,
      entry: {
        type: 'custom',
        squad: checked.squad,
        gwId,
        label: sanitizeLabel(body.label, 'My squad'),
      },
    };
  }

  return { ok: false, error: 'Unknown entry type — expected "teamId" or "custom".' };
}

// Merges a validated entry into an existing teams list: re-saving the same
// FPL Team ID updates that entry's label/timestamp in place rather than
// creating a duplicate; custom squads have no natural dedupe key, so they
// always append. Returns { ok: true, teams } or { ok: false, error } (cap
// reached). `makeId`/`now` are injectable so tests get deterministic
// output; real callers omit them and get generateEntryId()/Date.now().
export function mergeEntry(existingTeams, entry, { makeId, now } = {}) {
  const teams = Array.isArray(existingTeams) ? existingTeams : [];
  const timestamp = (now ? now() : new Date()).toISOString();

  const existingIdx = entry.type === 'teamId'
    ? teams.findIndex(t => t.type === 'teamId' && t.teamId === entry.teamId)
    : -1;

  if (existingIdx !== -1) {
    const updated = teams.slice();
    updated[existingIdx] = { ...updated[existingIdx], ...entry, savedAt: timestamp };
    return { ok: true, teams: updated };
  }

  if (teams.length >= MAX_SAVED_TEAMS) {
    return { ok: false, error: `You can save up to ${MAX_SAVED_TEAMS} teams.` };
  }

  const id = makeId ? makeId() : undefined;
  const newEntry = { id, ...entry, savedAt: timestamp };
  return { ok: true, teams: [...teams, newEntry] };
}