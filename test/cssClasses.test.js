import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const classesIn = file => new Set([...readFileSync(file, 'utf8').matchAll(/fpl-[a-z0-9-]+/g)].map(m => m[0]));

// The account Profile screen's classes (fpl-profile-*) and the player
// profile's (fpl-pp-*) once shared names, so the player profile's styles
// broke the Profile screen's layout.
test('the player profile and the live match sheet use none of the Profile screen’s own classes', () => {
  const profileScreen = [...classesIn('src/screens/ProfileScreen.jsx')].filter(c => c.startsWith('fpl-profile'));
  for (const file of ['src/components/PlayerProfile.jsx', 'src/screens/LiveScreen.jsx']) {
    const mine = classesIn(file);
    assert.deepEqual(profileScreen.filter(c => mine.has(c)), [], file);
  }
});
