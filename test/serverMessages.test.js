import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { knownServerMessages, serverMessage } from '../src/lib/serverMessages.js';

test('every listed server message is still one the server sends', () => {
  const server = [
    ...readdirSync('api').map(f => `api/${f}`),
    'src/lib/auth.js', 'src/lib/teams.js', 'src/lib/feedback.js', 'src/lib/redis.js',
  ].map(f => readFileSync(f, 'utf8')).join('\n');
  const stale = knownServerMessages().filter(m => !server.includes(m));
  assert.deepEqual(stale, []);
  assert.equal(serverMessage('Password must be at least 6 characters and include a number.'), 'Password must be at least 6 characters and include a number.');
  assert.ok(server.includes('Password must be at least ${MIN_PASSWORD_LENGTH} characters and include a number.'));
  assert.ok(server.includes('Username must be ${MIN_USERNAME_LENGTH}-20 characters: letters, numbers, underscores only.'));
  assert.ok(server.includes('You can save up to ${MAX_SAVED_TEAMS} teams.'));
  assert.equal(serverMessage('Not a listed one'), 'Not a listed one');
  assert.equal(serverMessage('That username is already taken.'), 'That username is already taken.');
});
