// Squads as they're saved (to the account, or on this device) and found
// again for a Team ID.
import { teamEditFor } from './teamEdits.js';

// A squad as a compact snapshot to save: players, armbands, the starting
// XI and the bank.
export function squadSnapshot(squad, bankTenths) {
  const captain = squad.find(s => s.isCaptain);
  const vice = squad.find(s => s.isViceCaptain);
  const starters = squad.filter(s => s.isStarting).map(s => s.player.id);
  return {
    playerIds: squad.map(s => s.player.id),
    captainId: captain ? captain.player.id : null,
    viceCaptainId: vice ? vice.player.id : null,
    ...(starters.length === 11 ? { startingIds: starters } : {}),
    ...(Number.isInteger(bankTenths) && bankTenths >= 0 ? { bankTenths } : {}),
  };
}

// The changes saved to the account for a Team ID in one gameweek, or null.
export function savedChangesFor(savedTeams, teamId, gwId) {
  const entry = savedTeams.find(t => t.type === 'teamId' && String(t.teamId) === String(teamId));
  return entry && entry.squad && entry.squad.gwId === gwId ? entry.squad : null;
}

// The changes to show for a Team ID in one gameweek: the latest edits made
// on this device, else the ones saved to the account, else null (the
// picks on FPL). Edits on this device are marked `onDevice`.
export function teamChangesFor(savedTeams, teamId, gwId) {
  const local = teamEditFor(teamId, gwId);
  return local ? { ...local, onDevice: true } : savedChangesFor(savedTeams, teamId, gwId);
}
