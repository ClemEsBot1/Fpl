// Which gameweek is which, from the static data's list of events.
import { getDefaultEvent, isEventLocked } from './predictions.js';
import { lastFinishedGw } from './recap.js';

// The gameweek being planned.
export function currentGwId(staticData) {
  return staticData.targetEvent ? staticData.targetEvent.id : 1;
}

// The latest gameweek whose deadline has passed: the one being played, or
// the last one played. null before the season starts.
export function liveGwIdFor(staticData) {
  const started = (staticData.allEvents || []).filter(e => isEventLocked(e));
  return started.length ? Math.max(...started.map(e => e.id)) : null;
}

// The gameweek to show when none was picked: the one being played, until
// all of its matches are over, and then the next one (getDefaultEvent).
export function defaultGwId(staticData) {
  return (getDefaultEvent(staticData.allEvents) || staticData.targetEvent || { id: 1 }).id;
}

export function isGwFinished(staticData, gwId) {
  return !!(staticData.allEvents || []).find(e => e.id === gwId && e.finished);
}

// The gameweek Home's recap button opens: the one picked in the header if
// it's over, else the latest to finish. null before any has.
export function recapGwFor(staticData, selectedGw) {
  if (!staticData) return null;
  const picked = (staticData.allEvents || []).find(e => e.id === selectedGw);
  return picked && picked.finished ? picked.id : lastFinishedGw(staticData.allEvents);
}
