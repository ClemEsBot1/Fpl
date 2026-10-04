import Redis from 'ioredis';

let client = null;

// Cached at module scope: on a warm Vercel serverless invocation this
// module is still in memory, so we reuse the existing connection instead
// of opening a fresh TCP connection to Redis on every request.
export function getRedis() {
  if (client) return client;
  if (!process.env.REDIS_URL) {
    throw new Error('REDIS_URL is not configured');
  }
  client = new Redis(process.env.REDIS_URL, {
    // Don't open the socket until the first real command — keeps a cold
    // start from paying a connection cost before it's actually needed.
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });
  // ioredis emits 'error' for any connection hiccup; without a listener
  // Node treats that as an uncaught exception and crashes the function.
  client.on('error', (err) => {
    console.error('Redis client error:', err && err.message);
  });
  return client;
}

// Thin wrappers matching the get/set-a-JS-value shape the API handlers
// already expect (mirrors how @vercel/kv auto-serialized values) — ioredis
// itself only speaks strings, so the JSON (de)serialization happens here,
// once, instead of at every call site.
export async function getJSON(redis, key) {
  const raw = await redis.get(key);
  if (raw === null || raw === undefined) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setJSON(redis, key, value) {
  await redis.set(key, JSON.stringify(value));
}

// Stores `value` only if nothing is stored under `key` yet. Returns whether
// it was stored (two sign-ups racing for the same username can't both win).
export async function createJSON(redis, key, value) {
  return (await redis.set(key, JSON.stringify(value), 'NX')) === 'OK';
}

// Replaces a value only if it still holds what we read, in one step on the
// Redis server.
export const COMPARE_AND_SET_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]) return 1 end return 0";

// Read-modify-write of a JSON record that can't lose a concurrent update
// (say, a team saved on one device while the password is reset on
// another): `change(current)` returns the new value, or null/undefined to
// leave it as it is, and is re-run against the fresh value if something
// else wrote in between. Keep it synchronous and quick — do slow work
// (hashing) before calling this. Returns the value now stored, or
// undefined when there's nothing stored under `key`.
export async function updateJSON(redis, key, change, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const raw = await redis.get(key);
    if (raw === null || raw === undefined) return undefined;
    const current = JSON.parse(raw);
    const next = change(current);
    if (next === null || next === undefined) return current;
    const nextRaw = JSON.stringify(next);
    if (Number(await redis.eval(COMPARE_AND_SET_SCRIPT, 1, key, raw, nextRaw)) === 1) return next;
    // Something else wrote in between. Wait a moment, a different one for
    // each writer, so writers that collided don't just collide again.
    if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, Math.random() * 20 * (i + 1)));
  }
  throw new Error('Too many simultaneous updates. Please try again.');
}
