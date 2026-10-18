// Messages sent with the in-app "Send feedback" button, newest first, for
// the admin page. Only the latest few hundred are kept.
const KEY = 'feedback';
const KEEP = 300;
export const MAX_FEEDBACK_LENGTH = 2000;

// Cleans what was sent; null when there's no message.
export function cleanFeedback({ text, email, page } = {}) {
  const message = typeof text === 'string' ? text.trim().slice(0, MAX_FEEDBACK_LENGTH) : '';
  if (!message) return null;
  const mail = typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? email.trim().slice(0, 254) : '';
  const where = typeof page === 'string' ? page.slice(0, 40) : '';
  return { text: message, email: mail, page: where };
}

export async function addFeedback(redis, entry, username = null, now = Date.now()) {
  await redis.lpush(KEY, JSON.stringify({ ...entry, username: username || null, at: new Date(now).toISOString() }));
  await redis.ltrim(KEY, 0, KEEP - 1);
}

export async function listFeedback(redis, limit = 100) {
  const raw = await redis.lrange(KEY, 0, limit - 1);
  return raw.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
}

export const clearFeedback = redis => redis.del(KEY);
