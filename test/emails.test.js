import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeEmail } from '../src/lib/emails.js';

test('code emails put the code in the subject, HTML and text, and say what it is for', () => {
  const reset = codeEmail({ username: 'Clem', code: '042137', purpose: 'reset', appUrl: 'https://fplchecker.co.uk' });
  assert.equal(reset.subject, '042137 is your FPL Checker password reset code');
  assert.ok(reset.html.includes('042137') && reset.text.includes('042137'));
  assert.match(reset.text, /expires in 15 minutes/);
  assert.match(reset.text, /your password won’t change/);
  assert.match(reset.html, /icons\/icon-192\.png/);
  const verify = codeEmail({ username: 'Clem', code: '000001', purpose: 'verify', appUrl: 'https://fplchecker.co.uk' });
  assert.equal(verify.subject, '000001 is your FPL Checker verification code');
  assert.match(verify.text, /Confirm your email/);
});

test('code emails escape what they put into HTML', () => {
  const mail = codeEmail({ username: '<b>x</b>', code: '123456', purpose: 'verify', appUrl: 'https://example.com' });
  assert.ok(!mail.html.includes('<b>x</b>'));
  assert.ok(mail.html.includes('&lt;b&gt;x&lt;/b&gt;'));
});
