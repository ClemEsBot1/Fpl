import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetPasswordEmail } from '../src/lib/emails.js';

const link = 'https://fplchecker.vercel.app/?reset=abc123';

test('reset email has the link in both the HTML and plain-text versions', () => {
  const mail = resetPasswordEmail({ username: 'Clem', link, appUrl: 'https://fplchecker.vercel.app' });
  assert.equal(mail.subject, 'Reset your FPL Squad Check password');
  assert.ok(mail.html.includes(`href="${link}"`));
  assert.ok(mail.text.includes(link));
  assert.match(mail.text, /expires in 30 minutes/);
  assert.match(mail.html, /icons\/icon-192\.png/);
});

test('reset email escapes what it puts into HTML', () => {
  const mail = resetPasswordEmail({ username: '<b>x</b>', link: 'https://example.com/?a=1&b=2', appUrl: 'https://example.com' });
  assert.ok(!mail.html.includes('<b>x</b>'));
  assert.ok(mail.html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(mail.html.includes('?a=1&amp;b=2'));
});
