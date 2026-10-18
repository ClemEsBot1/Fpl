// Posting to Bluesky as FPL Checker's bot account (see src/lib/social.js
// for what it posts and when). Needs BLUESKY_HANDLE and
// BLUESKY_APP_PASSWORD (an app password from Bluesky's settings).
import { SITE } from './seoPage.js';

export function blueskyConfigured(env = process.env) {
  return !!(env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD);
}

const graphemes = text => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length;
const bytes = text => new TextEncoder().encode(text).length;

// A Bluesky post record: links shown without https:// (Bluesky counts
// their full length), made clickable, and hashtags made into tags, both
// by facets with UTF-8 byte offsets. null when it's over Bluesky's 300.
export function blueskyRecord(text, createdAt = new Date().toISOString()) {
  let out = '';
  const facets = [];
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/\S+/g)) {
    out += text.slice(last, m.index);
    const shown = m[0].replace(/^https?:\/\//, '');
    facets.push({ index: { byteStart: bytes(out), byteEnd: bytes(out) + bytes(shown) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }] });
    out += shown;
    last = m.index + m[0].length;
  }
  out += text.slice(last);
  for (const m of out.matchAll(/(^|\s)#(\w+)/g)) {
    const start = bytes(out.slice(0, m.index + m[1].length));
    facets.push({ index: { byteStart: start, byteEnd: start + bytes(`#${m[2]}`) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[2] }] });
  }
  if (graphemes(out) > 300) return null;
  return { $type: 'app.bsky.feed.post', text: out, facets, langs: ['en-GB'], createdAt };
}

async function xrpc(service, method, { token, body, contentType = 'application/json', fetchImpl }) {
  const r = await fetchImpl(`${service}/xrpc/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: contentType === 'application/json' ? JSON.stringify(body) : body,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Bluesky ${method} ${r.status}: ${data.error || ''} ${data.message || ''}`.trim());
  return data;
}

// Posts `text` as the bot account, with a link card for its first link
// (the site's preview image as the picture, when it can be fetched), or
// the picture given ({ png, alt }), then likes and reposts it.
export async function postBluesky(text, env = process.env, fetchImpl = fetch, { image = null } = {}) {
  const record = blueskyRecord(text);
  if (!record) throw new Error('too long for Bluesky');
  const service = (env.BLUESKY_SERVICE || 'https://bsky.social').replace(/\/+$/, '');
  const session = await xrpc(service, 'com.atproto.server.createSession', { body: { identifier: env.BLUESKY_HANDLE, password: env.BLUESKY_APP_PASSWORD }, fetchImpl });
  const link = record.facets.find(f => f.features[0].uri);
  if (image && image.png) {
    // A picture ({ png, alt }) instead of a link card: the link in the
    // text stays clickable.
    const blob = (await xrpc(service, 'com.atproto.repo.uploadBlob', { token: session.accessJwt, body: image.png, contentType: 'image/png', fetchImpl })).blob;
    record.embed = { $type: 'app.bsky.embed.images', images: [{ image: blob, alt: image.alt || '', aspectRatio: { width: 1200, height: 675 } }] };
  } else if (link) {
    const external = { uri: link.features[0].uri, title: 'FPL Checker', description: 'Free FPL points predictor: predicted points for every player, your best XI, captain and transfers.' };
    try {
      const img = await fetchImpl(`${SITE}/og-image.png`, { signal: AbortSignal.timeout(10_000) });
      if (img.ok) external.thumb = (await xrpc(service, 'com.atproto.repo.uploadBlob', { token: session.accessJwt, body: Buffer.from(await img.arrayBuffer()), contentType: 'image/png', fetchImpl })).blob;
    } catch { /* the card just has no picture */ }
    record.embed = { $type: 'app.bsky.embed.external', external };
  }
  const out = await xrpc(service, 'com.atproto.repo.createRecord', { token: session.accessJwt, body: { repo: session.did, collection: 'app.bsky.feed.post', record }, fetchImpl });
  // The bot's own like and repost of it. Best-effort: the post is out
  // either way, so a failure here doesn't count it as unsent.
  const subject = { uri: out.uri, cid: out.cid };
  for (const collection of ['app.bsky.feed.like', 'app.bsky.feed.repost']) {
    try {
      await xrpc(service, 'com.atproto.repo.createRecord', { token: session.accessJwt, body: { repo: session.did, collection, record: { $type: collection, subject, createdAt: new Date().toISOString() } }, fetchImpl });
    } catch { /* still posted */ }
  }
  return out.uri;
}
