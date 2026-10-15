// Draws the browser extension's icons (extension/icons/) from the site's
// icon (public/icons/icon.svg). Run after changing it:
//   node scripts/make-extension-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const svg = fs.readFileSync(path.join(root, 'public/icons/icon.svg'), 'utf8');
const out = path.join(root, 'extension/icons');
fs.mkdirSync(out, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  fs.writeFileSync(path.join(out, `icon-${size}.png`), png);
  console.log('wrote', `icon-${size}.png`);
}
