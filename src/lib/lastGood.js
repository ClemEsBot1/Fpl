// The last good answer from FPL, kept in Redis so a request made while FPL
// is down (it often is around deadlines and updates) can still be answered
// with data a few minutes old instead of an error. Stored gzipped: the
// bootstrap file is a couple of megabytes.
import { gzipSync, gunzipSync } from 'node:zlib';

const key = name => `lastgood:${name}`;
const atKey = name => `lastgood:${name}:at`;
// How often a fresh copy is written, at most.
export const SAVE_EVERY_MS = 10 * 60 * 1000;
// Older than this isn't worth showing.
export const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

// Saves `text` unless a copy under 10 minutes old is already there.
// Best-effort: a storage failure never breaks the request.
export async function saveLastGood(redis, name, text, now = Date.now()) {
  try {
    const at = Number(await redis.get(atKey(name)));
    if (at && now - at < SAVE_EVERY_MS) return false;
    const gz = gzipSync(Buffer.from(String(text))).toString('base64');
    await redis.set(key(name), gz, 'EX', Math.round(MAX_AGE_MS / 1000));
    await redis.set(atKey(name), String(now), 'EX', Math.round(MAX_AGE_MS / 1000));
    return true;
  } catch {
    return false;
  }
}

// { text, at } for the saved copy, or null.
export async function readLastGood(redis, name, now = Date.now()) {
  try {
    const [gz, at] = [await redis.get(key(name)), Number(await redis.get(atKey(name)))];
    if (!gz || !at || now - at > MAX_AGE_MS) return null;
    return { text: gunzipSync(Buffer.from(gz, 'base64')).toString('utf8'), at };
  } catch {
    return null;
  }
}
