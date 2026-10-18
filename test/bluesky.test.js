import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blueskyConfigured, blueskyRecord, postBluesky } from '../src/lib/bluesky.js';

test('Bluesky posts show links without https://, clickable, with tags, by UTF-8 byte offsets', () => {
  const text = '©️ GW8 £6.5m pick: https://fplchecker.co.uk/player/ødegaard-x\n\n#FPL #FPLCommunity';
  const rec = blueskyRecord(text, '2026-10-15T00:00:00Z');
  assert.equal(rec.text, '©️ GW8 £6.5m pick: fplchecker.co.uk/player/ødegaard-x\n\n#FPL #FPLCommunity');
  const bytes = new TextEncoder().encode(rec.text);
  const slice = f => new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd));
  const [link, tag1, tag2] = rec.facets;
  assert.equal(slice(link), 'fplchecker.co.uk/player/ødegaard-x');
  assert.equal(link.features[0].uri, 'https://fplchecker.co.uk/player/ødegaard-x');
  assert.deepEqual([slice(tag1), tag1.features[0].tag, slice(tag2), tag2.features[0].tag], ['#FPL', 'FPL', '#FPLCommunity', 'FPLCommunity']);
  assert.equal(blueskyRecord('x'.repeat(301)), null, 'over 300 characters');
});

test('posting to Bluesky signs in, attaches a link card, creates the post, then likes and reposts it', async () => {
  const env = { BLUESKY_HANDLE: 'fplchecker.bsky.social', BLUESKY_APP_PASSWORD: 'app-pass' };
  assert.ok(blueskyConfigured(env) && !blueskyConfigured({}));
  const calls = [];
  let failRepost = false;
  const fetchImpl = async (url, opts = {}) => {
    calls.push(url.split('/').pop());
    if (url.endsWith('og-image.png')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) };
    const reply = { 'com.atproto.server.createSession': { accessJwt: 'jwt', did: 'did:plc:bot' }, 'com.atproto.repo.uploadBlob': { blob: { ref: 'b' } }, 'com.atproto.repo.createRecord': { uri: 'at://post/1', cid: 'cid1' } }[url.split('/').pop()];
    if (url.endsWith('createRecord') && JSON.parse(opts.body).collection !== 'app.bsky.feed.post') {
      const body = JSON.parse(opts.body);
      calls[calls.length - 1] = body.collection;
      assert.deepEqual(body.record.subject, { uri: 'at://post/1', cid: 'cid1' });
      assert.equal(body.record.$type, body.collection);
      assert.equal(body.repo, 'did:plc:bot');
      if (body.collection === 'app.bsky.feed.repost' && failRepost) return { ok: false, status: 500, json: async () => ({ error: 'InternalServerError' }) };
    } else if (url.endsWith('createRecord')) {
      const body = JSON.parse(opts.body);
      assert.equal(opts.headers.Authorization, 'Bearer jwt');
      assert.equal(body.repo, 'did:plc:bot');
      assert.equal(body.record.embed.external.uri, 'https://fplchecker.co.uk/fpl-predictions');
      assert.deepEqual(body.record.embed.external.thumb, { ref: 'b' });
    }
    return { ok: true, json: async () => reply };
  };
  assert.equal(await postBluesky('Preview: https://fplchecker.co.uk/fpl-predictions #FPL', env, fetchImpl), 'at://post/1');
  assert.deepEqual(calls, ['com.atproto.server.createSession', 'og-image.png', 'com.atproto.repo.uploadBlob', 'com.atproto.repo.createRecord', 'app.bsky.feed.like', 'app.bsky.feed.repost']);
  failRepost = true;
  assert.equal(await postBluesky('Preview: https://fplchecker.co.uk/fpl-predictions #FPL', env, fetchImpl), 'at://post/1', 'a failed repost still counts as posted');
  const denied = async () => ({ ok: false, status: 401, json: async () => ({ error: 'AuthenticationRequired', message: 'Invalid identifier or password' }) });
  await assert.rejects(postBluesky('hi', env, denied), /Bluesky com\.atproto\.server\.createSession 401: AuthenticationRequired/);
});

test('a post with a picture attaches it instead of the link card', async () => {
  const env = { BLUESKY_HANDLE: 'h', BLUESKY_APP_PASSWORD: 'p' };
  const calls = [];
  let record = null;
  const fetchImpl = async (url, opts = {}) => {
    calls.push(url.split('/').pop());
    if (url.endsWith('uploadBlob')) assert.equal(opts.headers['Content-Type'], 'image/png');
    if (url.endsWith('createRecord') && JSON.parse(opts.body).collection === 'app.bsky.feed.post') record = JSON.parse(opts.body).record;
    const reply = { 'com.atproto.server.createSession': { accessJwt: 'jwt', did: 'did:plc:bot' }, 'com.atproto.repo.uploadBlob': { blob: { ref: 'img' } }, 'com.atproto.repo.createRecord': { uri: 'at://post/2', cid: 'c' } }[url.split('/').pop()];
    return { ok: true, json: async () => reply };
  };
  await postBluesky('GW8 preview https://fplchecker.co.uk/fpl-predictions', env, fetchImpl, { image: { png: Buffer.from('png'), alt: 'GW8 best XI' } });
  assert.ok(!calls.includes('og-image.png'));
  assert.deepEqual(record.embed, { $type: 'app.bsky.embed.images', images: [{ image: { ref: 'img' }, alt: 'GW8 best XI', aspectRatio: { width: 1200, height: 675 } }] });
  assert.ok(record.facets.some(f => f.features[0].uri === 'https://fplchecker.co.uk/fpl-predictions'), 'the link is still clickable');
});
