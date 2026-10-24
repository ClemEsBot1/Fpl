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

test('the translated pages link every language version both ways, in their own language', async () => {
  const { readFileSync } = await import('node:fs');
  const { SEO_LANGS, TRANSLATED_PAGES, alternatesFor, translatedPages } = await import('../src/lib/seoPage.js');
  const read = lang => JSON.parse(readFileSync(new URL(`../src/seo-locales/${lang}.json`, import.meta.url), 'utf8'));
  const en = read('en');
  const shape = d => JSON.stringify(d, (k, v) => (typeof v === 'string' ? '' : v));
  const locales = Object.fromEntries(SEO_LANGS.map(lang => [lang, read(lang)]));
  for (const lang of SEO_LANGS) {
    assert.equal(shape(locales[lang]), shape(en), `${lang}.json has every string en.json has`);
    assert.ok(locales[lang].ui.footer.includes('FPL Checker'), `${lang} footer names the site`);
  }
  const pages = translatedPages(locales);
  assert.equal(pages.length, SEO_LANGS.length * TRANSLATED_PAGES.length);
  const byPath = new Map([...pages, ...staticPages()].map(p => [p.path, p.html]));
  byPath.set('/', readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/ \/>/g, '>'));
  for (const key of TRANSLATED_PAGES) {
    const versions = alternatesFor(key);
    assert.equal(versions.length, SEO_LANGS.length + 1);
    for (const { path } of versions) {
      const html = byPath.get(path);
      assert.ok(html, `${path} exists`);
      for (const v of versions) assert.ok(html.includes(`<link rel="alternate" hreflang="${v.lang}" href="https://fplchecker.co.uk${v.path}">`), `${path} links to ${v.path}`);
      assert.ok(html.includes(`hreflang="x-default" href="https://fplchecker.co.uk${versions[0].path}"`), `${path} has an x-default`);
    }
  }
  const es = byPath.get('/es/fpl-captain-picks');
  assert.match(es, /<html lang="es">/);
  assert.match(es, /href="\/\?lang=es">Abrir FPL Checker</);
  assert.match(es, /<link rel="canonical" href="https:\/\/fplchecker.co.uk\/es\/fpl-captain-picks">/);
  assert.match(byPath.get('/ar/'), /<html lang="ar" dir="rtl">/);
  assert.ok(!/&lt;b&gt;/.test(es) && /<b>/.test(es), 'bold kept, nothing else unescaped');
  const ld = ldBlocks(byPath.get('/fr/')).find(d => d['@type'] === 'BreadcrumbList');
  assert.equal(ld.itemListElement.length, 1, 'a home page is its own only crumb');
});
