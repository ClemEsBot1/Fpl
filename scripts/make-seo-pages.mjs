// Writes the guide pages (src/lib/seoPage.js) into public/<path>/index.html
// and lists every page in public/sitemap.xml. Run after changing a page:
//   node scripts/make-seo-pages.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEO_PATHS, SITE, staticPages } from '../src/lib/seoPage.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
for (const page of staticPages()) {
  const dir = path.join(root, page.path.slice(1));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page.html);
  console.log('wrote', page.path);
}
const urls = SEO_PATHS.map(p => `  <url>\n    <loc>${SITE}${p === '/' ? '/' : p}</loc>\n    <changefreq>${p === '/fpl-predictions' || p === '/' ? 'daily' : 'weekly'}</changefreq>\n  </url>`).join('\n');
fs.writeFileSync(path.join(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
console.log('wrote sitemap.xml');
