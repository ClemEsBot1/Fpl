// Lists translation work: `node scripts/i18n-keys.mjs fr` prints, as JSON,
// every phrase French is missing (to translate and add to src/locales/fr.json);
// with no language, prints each language's missing and unused counts.
import { readFileSync, existsSync } from 'node:fs';
import { allKeys } from '../src/lib/i18nKeys.js';
import { LANGUAGES } from '../src/lib/i18n.js';

const keys = allKeys(process.cwd());
const load = code => (existsSync(`src/locales/${code}.json`) ? JSON.parse(readFileSync(`src/locales/${code}.json`, 'utf8')) : {});
const only = process.argv[2];
if (only) {
  const dict = load(only);
  console.log(JSON.stringify(keys.filter(k => !(k in dict)), null, 1));
} else {
  console.log(`${keys.length} phrases`);
  LANGUAGES.filter(l => l.code !== 'en').forEach(({ code }) => {
    const dict = load(code);
    console.log(code, 'missing', keys.filter(k => !(k in dict)).length, 'unused', Object.keys(dict).filter(k => !keys.includes(k)).length);
  });
}
