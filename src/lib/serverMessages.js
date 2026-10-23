// The server's messages for people (a wrong password, a taken username) are
// written in English; this shows them in the chosen language. Each one the
// server can send is listed here as a t() call so it gets translated, and
// test/serverMessages.test.js checks the list still matches the server.
// Anything not listed is shown as the server sent it.
import { t } from './i18n.js';

let known = null;
function messages() {
  if (known) return known;
  known = new Map([
    ['A custom squad needs 15 different players.', t('A custom squad needs 15 different players.')],
    ['A custom squad needs exactly 15 valid player ids.', t('A custom squad needs exactly 15 valid player ids.')],
    ['A valid numeric FPL Team ID is required.', t('A valid numeric FPL Team ID is required.')],
    ['Add an email address to your account first.', t('Add an email address to your account first.')],
    ['Confirm your email address first: enter the code we emailed you.', t('Confirm your email address first: enter the code we emailed you.')],
    ['Enter a valid email address.', t('Enter a valid email address.')],
    ['Enter your password to delete your account.', t('Enter your password to delete your account.')],
    ['Enter your username or email.', t('Enter your username or email.')],
    ['Password is required.', t('Password is required.')],
    ['Password is too long.', t('Password is too long.')],
    ['Saved changes need the gameweek they were made for.', t('Saved changes need the gameweek they were made for.')],
    ['Set a username and password first.', t('Set a username and password first.')],
    ['Thanks! You’ve sent a few already. Try again in an hour.', t('Thanks! You’ve sent a few already. Try again in an hour.')],
    ['That isn’t an FPL team ID.', t('That isn’t an FPL team ID.')],
    ['That password isn’t right.', t('That password isn’t right.')],
    ['That username is already taken.', t('That username is already taken.')],
    ['The bank must be between £0.0m and £100.0m.', t('The bank must be between £0.0m and £100.0m.')],
    ['The captain must be part of the squad.', t('The captain must be part of the squad.')],
    ['The starting XI must be 11 players from the squad.', t('The starting XI must be 11 players from the squad.')],
    ['The vice-captain must be another player in the squad.', t('The vice-captain must be another player in the squad.')],
    ['This account already has a password. Change it from your profile.', t('This account already has a password. Change it from your profile.')],
    ['Too many new accounts from this network. Please try again later.', t('Too many new accounts from this network. Please try again later.')],
    ['Too many reset requests. Please try again in an hour.', t('Too many reset requests. Please try again in an hour.')],
    ['Too many simultaneous updates. Please try again.', t('Too many simultaneous updates. Please try again.')],
    ['Type DELETE to confirm.', t('Type DELETE to confirm.')],
    ['Username is required.', t('Username is required.')],
    ['Username or email and password are required.', t('Username or email and password are required.')],
    ['Write a message first.', t('Write a message first.')],
    ['Your current password isn’t right.', t('Your current password isn’t right.')],
    ["Couldn't send the email right now. Please try again later.", t("Couldn't send the email right now. Please try again later.")],
    ["Couldn't send the reset email right now. Please try again later.", t("Couldn't send the reset email right now. Please try again later.")],
    ["Emails aren't set up on this site yet.", t("Emails aren't set up on this site yet.")],
    ["Password reset by email isn't set up on this site yet.", t("Password reset by email isn't set up on this site yet.")],
    ["We've already sent several reset emails to this account. Check your inbox and spam folder, or try again in an hour.", t("We've already sent several reset emails to this account. Check your inbox and spam folder, or try again in an hour.")],
    ["We've sent several codes already. Check your inbox and spam folder, or try again in an hour.", t("We've sent several codes already. Check your inbox and spam folder, or try again in an hour.")],
    ['That email is already used by another account.', t('That email is already used by another account.')],
    ['That code is wrong or has expired. Check the latest email, or ask for a new code.', t('That code is wrong or has expired. Check the latest email, or ask for a new code.')],
    ['Incorrect username, email or password.', t('Incorrect username, email or password.')],
  ]);
  return known;
}

// Messages with a number in them.
const PATTERNS = [
  [/^Password must be at least (\d+) characters and include a number\.$/, n => t('Password must be at least {n} characters and include a number.', { n })],
  [/^Username must be (\d+)-20 characters: letters, numbers, underscores only\.$/, n => t('Username must be {n}-20 characters: letters, numbers, underscores only.', { n })],
  [/^You can save up to (\d+) teams\.$/, n => t('You can save up to {n} teams.', { n })],
];

export function serverMessage(text) {
  const exact = messages().get(text);
  if (exact) return exact;
  for (const [re, make] of PATTERNS) {
    const m = re.exec(text);
    if (m) return make(m[1]);
  }
  return text;
}

// For the test: the English the server sends.
export function knownServerMessages() {
  return [...messages().keys()];
}
