// Fixed-window counters in Redis, used to slow down password guessing and
// sign-up spam. Works with ioredis (or the in-memory fake in tests).
//
// Callers count an attempt *before* doing the slow part (bcrypt, sending an
// email) and decide on the count that comes back, so a burst of parallel
// requests can't all slip in under the limit; an attempt that shouldn't
// count (a successful login) is handed back with release().

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

// Adds one to a key and returns the new count. One round trip, and atomic:
// the window's expiry is set as the key is created (SET NX EX), so a
// counter can never be left behind without one.
export async function bump(redis, key, windowSeconds) {
  const results = await redis.multi().set(key, 0, 'EX', windowSeconds, 'NX').incr(key).exec();
  const [err, count] = results[1];
  if (err) throw err;
  return Number(count);
}

// Takes one back off a key (an attempt that turned out not to count). If
// the window has already expired, this starts a fresh one at -1, which
// still expires on time.
export async function release(redis, key, windowSeconds) {
  await redis.multi().set(key, 0, 'EX', windowSeconds, 'NX').decr(key).exec();
}

export async function reset(redis, key) {
  await redis.del(key);
}
