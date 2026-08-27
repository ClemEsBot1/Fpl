export const MAX_SAVED_TEAMS = 20;
const MAX_LABEL_LENGTH = 40;

function sanitizeLabel(label, fallback) {
  if (typeof label !== 'string' || !label.trim()) return fallback;
  return label.trim().slice(0, MAX_LABEL_LENGTH);
}

// Validates the two shapes of saveable entry — an FPL Team ID, or a
// compact custom-squad snapshot (playerIds/captainId/viceCaptainId, the
// same shape hydrateSquadSnapshot already knows how to rebuild against
// live data). Returns { ok, error } or { ok: true, entry } — entry is
// missing id/savedAt, which the caller fills in.
export function buildEntryFromBody(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'A request body is required.' };

  if (body.type === 'teamId') {
    const teamId = Number(body.teamId);
    if (!Number.isInteger(teamId) || teamId < 1) {
      return { ok: false, error: 'A valid numeric FPL Team ID is required.' };
    }
    return { ok: true, entry: { type: 'teamId', teamId, label: sanitizeLabel(body.label, `Team ${teamId}`) } };
  }

  if (body.type === 'custom') {
    const squad = body.squad;
    const playerIds = squad && Array.isArray(squad.playerIds) ? squad.playerIds.map(Number) : null;
    if (!playerIds || playerIds.length !== 15 || playerIds.some(id => !Number.isInteger(id))) {
      return { ok: false, error: 'A custom squad needs exactly 15 valid player ids.' };
    }
    const captainId = Number(squad.captainId);
    const viceCaptainId = Number(squad.viceCaptainId);
    if (!playerIds.includes(captainId) || !playerIds.includes(viceCaptainId)) {
      return { ok: false, error: 'Captain and vice-captain must be part of the squad.' };
    }
    return {
      ok: true,
      entry: {
        type: 'custom',
        squad: { playerIds, captainId, viceCaptainId },
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
  const timestamp = (now ? now() : new Date()).toISOString ? (now ? now() : new Date()).toISOString() : new Date().toISOString();

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