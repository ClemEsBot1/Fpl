// Ready-made posts for sharing your team's rating: one message, and a link
// that opens each app with it filled in. Every one links the site, so a
// share is an invite.

export const SHARE_URL = 'https://fplchecker.co.uk/';

const fmt = n => (Math.round(n * 10) / 10).toFixed(1);
const gwShort = name => (name || '').replace(/^Gameweek (\d+)$/, 'GW$1');

// "My team's rated 78/100 and predicted 54.3 pts for GW9 on FPL Checker."
export function shareMessage({ gwName, total, score }) {
  const rated = typeof score === 'number' ? `rated ${Math.round(score)}/100` : null;
  const pts = typeof total === 'number' ? `predicted ${fmt(total)} pts` : null;
  const what = [rated, pts].filter(Boolean).join(' and ');
  return `My FPL team's ${what || 'checked'}${gwName ? ` for ${gwShort(gwName)}` : ''} 👀 What's yours?`;
}

// { whatsapp, x, reddit } links, each opening that app with the message
// and the site's address.
export function shareLinks(message, url = SHARE_URL) {
  const both = `${message} ${url}`;
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(both)}`,
    x: `https://x.com/intent/post?text=${encodeURIComponent(both)}`,
    reddit: `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(message)}`,
  };
}
