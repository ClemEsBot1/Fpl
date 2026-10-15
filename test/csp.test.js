import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)));
const sitePolicy = () => {
  const rule = vercel.headers.find(h => h.headers.some(x => x.key === 'Content-Security-Policy' && x.value.includes('frame-ancestors \'none\'')));
  return rule.headers.find(x => x.key === 'Content-Security-Policy').value;
};
const directive = (policy, name) => (policy.split(';').map(s => s.trim()).find(s => s.startsWith(`${name} `)) || '').split(/\s+/).slice(1);

test('the site lets the app show images from blob: URLs (the screenshot upload reads the file that way)', () => {
  assert.ok(directive(sitePolicy(), 'img-src').includes('blob:'));
});

test('the OCR worker still loads only from the site itself', () => {
  assert.deepEqual(directive(sitePolicy(), 'worker-src'), ["'self'"]);
});
