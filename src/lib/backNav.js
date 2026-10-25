// The phone's (or the browser's) Back button: it closes an open dialog
// (player profile, gameweek recap, match sheet), then goes back through
// the screens visited, rather than leaving the app.
//
// Each screen is a history entry (App.jsx pushes one per screen) and each
// open dialog one more on top. This owns the one popstate listener so the
// two never both act on a single press.

export function createBackNav(win) {
  const history = win.history;
  let seq = 0;
  const dialogs = []; // open dialogs, newest last: { id, onBack }
  let onScreenBack = null;
  // Pops we caused ourselves (a dialog closed by its own button takes its
  // entry off), and dialogs opened meanwhile, whose entries go on once
  // those pops have landed (history.back() is asynchronous).
  let ownPops = 0;
  let waiting = [];

  const pushDialog = id => history.pushState({ ...(history.state || {}), fplDialog: id }, '');

  function onPop(e) {
    if (ownPops > 0) {
      ownPops -= 1;
      if (!ownPops) waiting.splice(0).forEach(pushDialog);
      return;
    }
    const top = dialogs.pop();
    if (top) { top.onBack(); return; }
    if (onScreenBack) onScreenBack(e.state);
  }
  win.addEventListener('popstate', onPop);

  return {
    // A dialog opened: Back closes it (onBack) before anything else.
    openDialog(onBack) {
      seq += 1;
      const id = seq;
      dialogs.push({ id, onBack });
      if (ownPops) waiting.push(id); else pushDialog(id);
      return id;
    },
    // A dialog closed some other way: take its entry off again.
    closeDialog(id) {
      const at = dialogs.findIndex(d => d.id === id);
      if (at < 0) return; // closed by Back: its entry is gone already
      dialogs.splice(at, 1);
      const queued = waiting.indexOf(id);
      if (queued >= 0) { waiting.splice(queued, 1); return; }
      if (history.state && history.state.fplDialog === id) {
        ownPops += 1;
        history.back();
      }
    },
    // Back with no dialog open: `fn(state)` reopens that entry's screen.
    onScreenBack(fn) { onScreenBack = fn; },
    // One history entry per screen: a new screen pushes one, the same
    // screen (or the first one shown) replaces it. `state` describes the
    // screen for onScreenBack.
    showScreen(key, state, url) {
      const current = history.state;
      const next = { ...state, fplKey: key };
      if (current && current.fplKey && current.fplKey !== key) history.pushState(next, '', url);
      else history.replaceState({ ...(current || {}), ...next }, '', url);
    },
  };
}

export const backNav = typeof window !== 'undefined' ? createBackNav(window) : null;
