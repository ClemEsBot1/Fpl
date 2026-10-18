// Which social posts have gone to which channel, kept in Redis so a post
// is never sent twice (see src/lib/social.js for the posts themselves).

const SENT_TTL_SECONDS = 60 * 24 * 3600;

// The Redis key that marks `post` as sent to `channel`, shared by the
// scheduled run and the admin page's buttons so neither repeats the other.
export const sentKey = (channel, post) => `social:${channel}:${post.key}`;

// Which channels each post has gone to: { [post.key]: ['bluesky', …] }.
export async function sentTo(redis, posts, channels) {
  const out = {};
  for (const post of posts) {
    out[post.key] = [];
    for (const name of channels) if (await redis.get(sentKey(name, post))) out[post.key].push(name);
  }
  return out;
}

// X posts go out by hand from the admin page (the API is paid), so the
// page ticks them off itself: the 'x' channel's key, set or cleared.
export const POST_KEY = /^\d{4}-\d{2}:((results|differential|preview|captain):gw\d{1,2}|prices:\d{4}-\d{2}-\d{2})$/;
export async function markSent(redis, channel, key, done) {
  if (!POST_KEY.test(key)) return false;
  if (done) await redis.set(sentKey(channel, { key }), '1', 'EX', SENT_TTL_SECONDS);
  else await redis.del(sentKey(channel, { key }));
  return true;
}

// Sends each channel ({ name, send(post) }) the first due post it hasn't
// had. The Redis key is taken first so two overlapping runs can't both
// send it; a failed send gives it back for the next run.
export async function runSocial({ redis, posts, channels }) {
  const results = {};
  for (const channel of channels) {
    results[channel.name] = { sent: null };
    for (const post of posts) {
      const key = sentKey(channel.name, post);
      if ((await redis.set(key, '1', 'EX', SENT_TTL_SECONDS, 'NX')) !== 'OK') continue;
      try {
        results[channel.name] = { sent: post.type, id: (await channel.send(post)) || null };
      } catch (e) {
        await redis.del(key);
        results[channel.name] = { error: String((e && e.message) || e), type: post.type };
      }
      break;
    }
  }
  return results;
}
