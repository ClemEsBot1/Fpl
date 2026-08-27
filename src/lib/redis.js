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
  } catch (e) {
    return null;
  }
}

export async function setJSON(redis, key, value) {
  await redis.set(key, JSON.stringify(value));
}
