// Fixed-window counters in Redis, used to slow down password guessing and
// sign-up spam. Works with anything that has get/incr/expire/del (ioredis,
// or the in-memory fake in tests).

export function clientIp(req) {
  const fwd = req.headers && req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Current count for a key (0 when unset).
export async function getCount(redis, key) {
  const raw = await redis.get(key);
  return raw ? Number(raw) || 0 : 0;
}

// Adds one to a key, starting its window on the first hit.
export async function bump(redis, key, windowSeconds) {
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count;
}

export async function reset(redis, key) {
  await redis.del(key);
}
