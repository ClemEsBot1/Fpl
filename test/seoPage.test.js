import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DYNAMIC_GUIDES, GUIDES, escapeHtml, predictionsPage, staticPages } from '../src/lib/seoPage.js';

const ldBlocks = html => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(m => JSON.parse(m[1]));

test('every guide page has its own title, description, canonical link and valid FAQ data', () => {
  const pages = staticPages();
  assert.equal(pages.length, GUIDES.length - DYNAMIC_GUIDES.length, 'all but the pages made from live data are static');
  const titles = new Set();
  for (const { path, html } of pages) {
    assert.match(html, new RegExp(`<link rel="canonical" href="https://fplchecker.co.uk${path}">`));
    const title = html.match(/<title>(.*?)<\/title>/)[1];
    assert.ok(!titles.has(title), `${path} has a title of its own`);
    titles.add(title);
    assert.match(html, /<meta name="description" content="[^"]{80,}">/);
    assert.equal((html.match(/<h1>/g) || []).length, 1);
    const faq = ldBlocks(html).find(d => d['@type'] === 'FAQPage');
    assert.ok(faq && faq.mainEntity.length >= 2);
    GUIDES.forEach(g => assert.ok(html.includes(`href="${g.path}"`), `${path} links to ${g.path}`));
  }
});

test('the weekly predictions page lists the best XI and the top players, safely escaped', () => {
  const p = (id, name, positionId, predicted) => ({ id, name, team: 'ARS', positionId, price: 6.5, predicted });
  const players = [p(1, 'Raya', 1, 4.1), p(2, 'Saliba', 2, 5.2), p(3, 'Saka <b>', 3, 7.9), p(4, 'Haaland', 4, 9.4)];
  const html = predictionsPage({ gwName: 'Gameweek 8', deadline: '2026-10-17T10:00:00Z', players, best: { xi: players, captainId: 4 }, updatedAt: '2026-10-15T06:00:00Z' });
  assert.match(html, /<title>FPL GW8 Predictions/);
  assert.match(html, /Haaland<\/b> as captain/);
  assert.match(html, /predicted to score <b>36\.0 points<\/b>/, 'XI total with the captain doubled');
  assert.ok(html.includes('Saka &lt;b&gt;') && !html.includes('Saka <b>'));
  assert.ok(ldBlocks(html).length >= 2);
  assert.equal(escapeHtml(`"<'&>`), '&quot;&lt;&#39;&amp;&gt;');
  // Without a saved best squad the page still lists the players.
  assert.match(predictionsPage({ gwName: 'Gameweek 8', players, best: null }), /Top 15 predicted players/);
});

test('every guide page declares the favicon Google shows in search results', () => {
  for (const { path, html } of staticPages()) {
    assert.ok(html.includes('<link rel="icon" href="/favicon-48x48.png" type="image/png" sizes="48x48">'), path);
    assert.ok(html.includes('href="/favicon.ico"'), path);
    assert.ok(html.includes('href="/favicon-96x96.png"'), path);
  }
});
