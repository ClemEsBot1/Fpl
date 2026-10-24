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

// The live match sheet uses the player profile's dialog (.fpl-pp), whose
// close button is dark for the profile's light header, so on the sheet's
// dark card it couldn't be seen.
test('the live match sheet’s close button has its own colour, not the player profile’s', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  const rule = css.match(/\.fpl-match-sheet \.fpl-dialog-close \{([^}]*)\}/);
  assert.ok(rule, 'no close-button rule for the match sheet');
  assert.match(rule[1], /color:\s*var\(--ink\)/);
  assert.ok(css.indexOf(rule[0]) > css.indexOf('.fpl-pp .fpl-dialog-close'), 'must come after the profile’s rule');
});

// Points badges sit on the green pitch in both themes, so they keep the
// dark theme's bright lime (the light theme's --lime is a dark green, which
// was unreadable on the badge's near-black).
test('pitch points badges don’t use the theme’s lime', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  for (const sel of ['.fpl-pc-pts {', '.fpl-pc-pts.is-high {']) {
    const rule = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
    assert.doesNotMatch(rule, /var\(--lime\)/, sel);
  }
});
