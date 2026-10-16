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

test('the Android app’s Digital Asset Links file is served for the Play package', async () => {
  const fs = await import('node:fs');
  const links = JSON.parse(fs.readFileSync(new URL('../public/.well-known/assetlinks.json', import.meta.url), 'utf8'));
  assert.equal(links[0].target.package_name, 'uk.co.fplchecker.app');
  assert.match(links[0].target.sha256_cert_fingerprints[0], /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  const headers = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).headers;
  const rule = headers.find(h => h.source === '/.well-known/assetlinks.json');
  assert.ok(rule && rule.headers.some(h => h.key === 'Content-Type' && h.value === 'application/json'));
});
