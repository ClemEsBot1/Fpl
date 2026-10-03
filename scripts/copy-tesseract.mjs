// Copies the Tesseract OCR worker, WASM core and English language data
// out of node_modules into public/tesseract/ so the screenshot reader runs
// entirely from our own origin (the CSP blocks third-party scripts, and
// nothing about a user's screenshot ever leaves their browser).
// Runs automatically before `npm run dev` and `npm run build`.
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const outDir = path.resolve('public/tesseract');
mkdirSync(outDir, { recursive: true });

const tesseractDir = path.dirname(require.resolve('tesseract.js/package.json'));
copyFileSync(path.join(tesseractDir, 'dist/worker.min.js'), path.join(outDir, 'worker.min.js'));

const coreDir = path.dirname(require.resolve('tesseract.js-core/package.json'));
for (const variant of ['', '-simd', '-relaxedsimd']) {
  const file = `tesseract-core${variant}-lstm.wasm.js`;
  copyFileSync(path.join(coreDir, file), path.join(outDir, file));
}

// Stored uncompressed: some static hosts add Content-Encoding to .gz files,
// which makes the browser unzip it before Tesseract tries to unzip it again.
const langOut = path.join(outDir, 'eng.traineddata');
if (!existsSync(langOut)) {
  const langDir = path.dirname(require.resolve('@tesseract.js-data/eng/package.json'));
  writeFileSync(langOut, gunzipSync(readFileSync(path.join(langDir, '4.0.0_best_int/eng.traineddata.gz'))));
}
console.log('Tesseract assets copied to public/tesseract/');
