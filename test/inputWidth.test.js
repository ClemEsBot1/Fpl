import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// A full-width input with padding needs box-sizing: border-box, or its
// padding pushes it past its container and the page scrolls sideways on a
// phone (the "Name this squad" box did, by 6px).
test('full-width padded inputs keep inside their container', () => {
  const bad = [];
  for (const dir of ['src/screens', 'src/components']) {
    for (const f of readdirSync(dir).filter(n => n.endsWith('.jsx'))) {
      const src = readFileSync(`${dir}/${f}`, 'utf8');
      for (const m of src.matchAll(/<(?:input|textarea)\b(.*?)\/>/gs)) {
        const style = (m[1].match(/style=\{\{([^}]*)\}\}/) || [])[1] || '';
        if (/width:\s*'100%'/.test(style) && /padding/.test(style) && !/boxSizing/.test(style)) bad.push(`${f}: ${style.trim().slice(0, 60)}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
