// Fetches FPL Checker's predictions for the content script and popup, and
// keeps them for 30 minutes (they change once a day and before deadlines).
const FEED_URL = 'https://fplchecker.co.uk/ext/predictions.json';
const FEED_VERSION = 1;
const KEEP_MS = 30 * 60_000;

async function getFeed() {
  const { feed, feedAt } = await chrome.storage.local.get(['feed', 'feedAt']);
  if (feed && Date.now() - feedAt < KEEP_MS) return feed;
  try {
    const r = await fetch(FEED_URL);
    if (!r.ok) throw new Error(`predictions: ${r.status}`);
    const fresh = await r.json();
    if (fresh.v !== FEED_VERSION || !Array.isArray(fresh.players)) throw new Error('predictions: unexpected format');
    await chrome.storage.local.set({ feed: fresh, feedAt: Date.now() });
    return fresh;
  } catch (e) {
    // Older predictions beat none.
    if (feed) return feed;
    throw e;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (!message || message.type !== 'feed') return false;
  getFeed().then(feed => reply({ feed }), e => reply({ error: String((e && e.message) || e) }));
  return true;
});
