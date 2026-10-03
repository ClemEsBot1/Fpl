// Renders public/icons/icon.svg into the PNG sizes the web app manifest
// and iOS need. Run by hand after changing the SVG:
//   node scripts/make-icons.mjs
// Uses Playwright's Chromium (not a project dependency: install it
// globally or with npx if it isn't already available).
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const svg = await readFile(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const sizes = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const [name, size] of sizes) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: new URL(`../public/icons/${name}`, import.meta.url).pathname, omitBackground: false });
    await page.close();
  }
} finally {
  await browser.close();
}
