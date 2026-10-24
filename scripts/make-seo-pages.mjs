// Writes the guide pages (src/lib/seoPage.js) into public/<path>/index.html,
// and their translations (src/seo-locales) into public/<lang>/..., lists
// them in public/sitemap-pages.xml, and writes public/sitemap.xml as
// the index of that and /sitemap-fpl.xml (the player, club and gameweek
// pages, made on request by api/optimal-squad.js). Run after changing a page:
//   node scripts/make-seo-pages.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DYNAMIC_GUIDES, SEO_LANGS, SEO_PATHS, SITE, TRANSLATED_PATHS, staticPages, translatedPages } from '../src/lib/seoPage.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
// The pages' fonts (public/seo.css), copied from the npm packages the app
// bundles them from.
const modules = path.join(root, '..', 'node_modules');
fs.mkdirSync(path.join(root, 'fonts'), { recursive: true });
for (const sub of ['latin', 'latin-ext']) {
  for (const file of [`@fontsource-variable/inter/files/inter-${sub}-wght-normal.woff2`, `@fontsource-variable/space-grotesk/files/space-grotesk-${sub}-wght-normal.woff2`, `@fontsource/ibm-plex-mono/files/ibm-plex-mono-${sub}-600-normal.woff2`]) {
    fs.copyFileSync(path.join(modules, file), path.join(root, 'fonts', path.basename(file)));
  }
}
const locales = Object.fromEntries(SEO_LANGS.map(lang => [lang, JSON.parse(fs.readFileSync(path.join(root, '..', 'src', 'seo-locales', `${lang}.json`), 'utf8'))]));
for (const page of [...staticPages(), ...translatedPages(locales)]) {
  const dir = path.join(root, page.path.slice(1));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page.html);
  console.log('wrote', page.path);
}
const urls = [...SEO_PATHS, ...TRANSLATED_PATHS].map(p => `  <url>\n    <loc>${SITE}${p === '/' ? '/' : p}</loc>\n    <changefreq>${p === '/' || DYNAMIC_GUIDES.includes(p) ? 'daily' : 'weekly'}</changefreq>\n  </url>`).join('\n');
fs.writeFileSync(path.join(root, 'sitemap-pages.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
const maps = ['/sitemap-pages.xml', '/sitemap-fpl.xml'].map(p => `  <sitemap>\n    <loc>${SITE}${p}</loc>\n  </sitemap>`).join('\n');
fs.writeFileSync(path.join(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${maps}\n</sitemapindex>\n`);
console.log('wrote sitemap.xml, sitemap-pages.xml');
