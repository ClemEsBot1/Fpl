// Finds every translatable phrase in the source: the first argument of each
// t('…') / tr('…') call. Used by the locale test (every language must have
// every phrase, with the same placeholders and tags) and by
// scripts/i18n-keys.mjs, which lists what a language is missing. Keys must
// be plain string literals so they can be found this way.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CALL = /(?<![\w.$])(?:t|tr)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/gs;

function unescape(body, quote) {
  return body.replace(/\\(.)/gs, (m, c) => (c === 'n' ? '\n' : c === quote || c === '\\' || c === "'" || c === '"' || c === '`' ? c : m));
}

export function keysInSource(code) {
  const keys = [];
  let m;
  CALL.lastIndex = 0;
  while ((m = CALL.exec(code))) {
    if (m[1] === '`' && m[2].includes('${')) continue;
    keys.push(unescape(m[2], m[1]));
  }
  return keys;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
  }
  return out;
}

export function allKeys(root) {
  const set = new Set();
  walk(join(root, 'src')).forEach(f => keysInSource(readFileSync(f, 'utf8')).forEach(k => set.add(k)));
  return [...set].sort();
}

// The {placeholders} and <tags> in a phrase, so a translation can be checked
// to keep them all.
export function markers(text) {
  return [...String(text).matchAll(/\{\w+\}|<\/?\w+>/g)].map(m => m[0]).sort();
}
