// The screens that load on demand (see src/lib/chunks.js).
import { createElement, lazy, useState } from 'react';
import { accountChunk, adminChunk, profileChunk, builderChunk, hindsightChunk, leagueChunk, liveChunk, recapChunk, resultsChunk, screenshotChunk, toolsChunk, welcomeChunk } from '../lib/chunks.js';

// A screen from one of those chunks. Once its code is here it renders
// straight away: going through Suspense would still hold it behind the
// loading placeholder for a few hundred milliseconds. Which of the two is
// used is fixed per mount, so a screen never remounts and loses its state.
function lazyScreen(source, name) {
  const Lazy = lazy(() => source.load().then(m => ({ default: m[name] })));
  function Screen(props) {
    const [Loaded] = useState(() => (source.loaded() ? source.loaded()[name] : Lazy));
    return createElement(Loaded, props);
  }
  Screen.displayName = name;
  return Screen;
}

export const ResultsScreen = lazyScreen(resultsChunk, 'ResultsScreen');
export const ScreenshotForm = lazyScreen(screenshotChunk, 'ScreenshotForm');
export const ReviewScreen = lazyScreen(screenshotChunk, 'ReviewScreen');
export const CustomSquadBuilder = lazyScreen(builderChunk, 'CustomSquadBuilder');
export const HindsightScreen = lazyScreen(hindsightChunk, 'HindsightScreen');
export const WelcomeScreen = lazyScreen(welcomeChunk, 'WelcomeScreen');
export const MiniLeagueScreen = lazyScreen(leagueChunk, 'MiniLeagueScreen');
export const MyTeamsScreen = lazyScreen(accountChunk, 'MyTeamsScreen');
export const ProfileScreen = lazyScreen(accountChunk, 'ProfileScreen');
export const AuthDialog = lazyScreen(accountChunk, 'AuthDialog');
export const GwRecap = lazyScreen(recapChunk, 'GwRecap');
export const FixturesScreen = lazyScreen(toolsChunk, 'FixturesScreen');
export const CompareScreen = lazyScreen(toolsChunk, 'CompareScreen');
export const ExploreScreen = lazyScreen(toolsChunk, 'ExploreScreen');
export const LiveScreen = lazyScreen(liveChunk, 'LiveScreen');
export const AdminScreen = lazyScreen(adminChunk, 'AdminScreen');
export const PlayerProfile = lazyScreen(profileChunk, 'PlayerProfile');
