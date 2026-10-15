// IndexNow (https://www.indexnow.org): tells Bing, Yandex and the other
// engines that take it which pages changed, so they're re-read in minutes
// rather than whenever a crawler next comes by. The key is INDEXNOW_KEY
// (8–128 letters, digits or dashes, chosen by whoever sets the site up);
// it's served at /indexnow-key.txt to prove the site is ours. Without it
// nothing is sent.

import { SITE } from './seoPage.js';

export const KEY_PATH = '/indexnow-key.txt';
const ENDPOINT = 'https://api.indexnow.org/indexnow';

export function indexNowKey(env = process.env) {
  const key = (env.INDEXNOW_KEY || '').trim();
  return /^[A-Za-z0-9-]{8,128}$/.test(key) ? key : null;
}

// Only production says the live site changed; previews would point the
// engines at pages that aren't live.
export function indexNowEnabled(env = process.env) {
  return !!indexNowKey(env) && env.VERCEL_ENV === 'production';
}

// { sent: n } or { error }; never throws.
export async function pingIndexNow(urls, { env = process.env, fetchImpl = fetch } = {}) {
  const key = indexNowKey(env);
  if (!key || !urls.length) return { sent: 0 };
  try {
    const r = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: new URL(SITE).host, key, keyLocation: SITE + KEY_PATH, urlList: urls }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.ok ? { sent: urls.length } : { error: `indexnow_${r.status}` };
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}
