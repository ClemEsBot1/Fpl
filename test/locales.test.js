import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { allKeys, keysInSource, markers } from '../src/lib/i18nKeys.js';
import { LANGUAGES } from '../src/lib/i18n.js';

test('phrases are found in t() and tr() calls, escapes undone, dynamic ones skipped', () => {
  const code = `t('It\\'s on') + tr("Say <b>{n}</b>", { n }) + t(\`Two\nlines\`) + t(\`\${x} no\`) + fmt('not this') + at('nor this')`;
  assert.deepEqual(keysInSource(code), ["It's on", 'Say <b>{n}</b>', 'Two\nlines']);
  assert.deepEqual(markers('Own <b>{n}</b> of {total}'), ['</b>', '<b>', '{n}', '{total}']);
});

const keys = allKeys(process.cwd());

for (const { code } of LANGUAGES.filter(l => l.code !== 'en')) {
  test(`${code}: every phrase translated, nothing stale, placeholders and tags kept`, () => {
    const file = `src/locales/${code}.json`;
    assert.ok(existsSync(file), `${file} is missing`);
    const dict = JSON.parse(readFileSync(file, 'utf8'));
    const missing = keys.filter(k => typeof dict[k] !== 'string' || !dict[k].trim());
    assert.deepEqual(missing, [], `${code} is missing ${missing.length} phrases: run node scripts/i18n-keys.mjs ${code}`);
    const stale = Object.keys(dict).filter(k => !keys.includes(k));
    assert.deepEqual(stale, [], `${code} has phrases no longer used`);
    const broken = keys.filter(k => markers(k).join() !== markers(dict[k]).join());
    assert.deepEqual(broken, [], `${code} changes the placeholders or tags of these phrases`);
  });
}
