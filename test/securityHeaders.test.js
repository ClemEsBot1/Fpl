import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const config = JSON.parse(readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'));

// The HSTS header must carry includeSubDomains and preload on every page
// block, not just max-age — so a plain-HTTP downgrade is refused across the
// whole domain, not only the exact host that was visited.
test('every page header block sends a full HSTS policy', () => {
  const pageBlocks = config.headers.filter(b => /\(\.\*\)|\(\?!embed/.test(b.source));
  assert.ok(pageBlocks.length >= 2, 'expected the catch-all and embed header blocks');
  for (const block of pageBlocks) {
    const hsts = block.headers.find(h => h.key === 'Strict-Transport-Security');
    assert.ok(hsts, `missing HSTS on ${block.source}`);
    assert.match(hsts.value, /max-age=\d+/, block.source);
    assert.match(hsts.value, /includeSubDomains/, block.source);
    assert.match(hsts.value, /preload/, block.source);
  }
});
