// Translated text with markup inside it: tr('You own <b>{n}</b> of them', { n },
// { b: s => <b>{s}</b> }). The translation keeps the tags, so each language
// can put the bold part where its grammar needs it.
import { Fragment } from 'react';
import { t } from './i18n.js';

export function tr(text, vars, tags = {}) {
  const out = t(text, vars);
  const parts = [];
  const re = /<(\w+)>(.*?)<\/\1>/gs;
  let last = 0;
  let m;
  let k = 0;
  while ((m = re.exec(out))) {
    if (m.index > last) parts.push(out.slice(last, m.index));
    const render = tags[m[1]];
    parts.push(<Fragment key={k++}>{render ? render(m[2]) : m[2]}</Fragment>);
    last = re.lastIndex;
  }
  if (last < out.length) parts.push(out.slice(last));
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts;
}
