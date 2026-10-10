// A small ring buffer of recent server-side errors, kept in Redis so the
// admin page can show what has been failing without anyone digging through
// Vercel logs. Best-effort throughout: recording an error must never throw
// or get in the way of the request that hit the error in the first place.

const KEY = 'admin:errors';
const MAX = 50;

// Record one failure. `where` is a short tag for the call site
// (e.g. 'auth.login'); `err` is the caught error. Never rejects.
export async function recordError(redis, where, err) {
  if (!redis) return;
  const entry = JSON.stringify({
    at: new Date().toISOString(),
    where: String(where || 'unknown').slice(0, 60),
    message: String((err && err.message) || err || '').slice(0, 300),
  });
  try {
    await redis.lpush(KEY, entry);
    await redis.ltrim(KEY, 0, MAX - 1);
  } catch {
    // The error log itself is down — nothing more we can do here.
  }
}

// The most recent errors, newest first: [{ at, where, message }]. Returns
// [] when there are none or the store is unavailable.
export async function recentErrors(redis, limit = MAX) {
  if (!redis) return [];
  try {
    const raw = await redis.lrange(KEY, 0, limit - 1);
    return (Array.isArray(raw) ? raw : []).map(r => {
      try { return JSON.parse(r); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// Clear the log (the admin page's "clear" button).
export async function clearErrors(redis) {
  if (!redis) return;
  try { await redis.del(KEY); } catch { /* best-effort */ }
}
