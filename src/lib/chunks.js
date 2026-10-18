// Everything but the home screen loads on demand, so the first visit only
// downloads what the first screen needs. The rest is fetched once the page
// is idle (see the effect in FPLSquadChecker), so screens still open
// instantly and work offline.
function chunk(importer) {
  let module = null;
  let promise = null;
  return {
    load() {
      if (!promise) {
        promise = importer().then(m => { module = m; return m; }, err => { promise = null; throw err; });
      }
      return promise;
    },
    loaded: () => module,
  };
}

export const resultsChunk = chunk(() => import('../screens/ResultsScreen.jsx'));
export const screenshotChunk = chunk(() => import('../screens/ScreenshotScreens.jsx'));
export const accountChunk = chunk(() => import('../screens/AccountScreens.jsx'));
export const builderChunk = chunk(() => import('../screens/CustomSquadBuilder.jsx'));
export const hindsightChunk = chunk(() => import('../screens/HindsightScreen.jsx'));
export const welcomeChunk = chunk(() => import('../screens/WelcomeScreen.jsx'));
export const leagueChunk = chunk(() => import('../screens/MiniLeagueScreen.jsx'));
export const recapChunk = chunk(() => import('../components/GwRecap.jsx'));
export const toolsChunk = chunk(() => import('../screens/ToolScreens.jsx'));
export const liveChunk = chunk(() => import('../screens/LiveScreen.jsx'));
export const adminChunk = chunk(() => import('../screens/AdminScreen.jsx'));
export const ALL_CHUNKS = [resultsChunk, screenshotChunk, accountChunk, builderChunk, hindsightChunk, welcomeChunk, leagueChunk, recapChunk, toolsChunk, liveChunk];
// For fetching a screen ahead of time; a failure shows up when it's opened.
export const preload = source => () => { source.load().catch(() => {}); };
export const loadResultsScreen = preload(resultsChunk);
export const loadCustomSquadBuilder = preload(builderChunk);
export const loadHindsightScreen = preload(hindsightChunk);
