// Downloads the screenshots people have sent from the review screen
// ("Did we misread something?") into ./screenshot-reports/, each image next
// to a JSON file of what the reader read and what the person corrected.
//
//   BLOB_READ_WRITE_TOKEN=... node scripts/download-screenshot-reports.mjs
//
// To turn one into a regression test: open the app locally, run
// readScreenshotRaw() from src/lib/screenshotOcr.js on the image (see
// test/fixtures/README.md), save the output next to the existing fixture
// and assert the corrected squad in test/screenshotOcr.test.js.
import { list } from '@vercel/blob';
import { mkdir, writeFile } from 'node:fs/promises';

const outDir = 'screenshot-reports';
await mkdir(outDir, { recursive: true });

let cursor;
let count = 0;
do {
  const page = await list({ prefix: 'screenshot-reports/', cursor });
  for (const blob of page.blobs) {
    const name = blob.pathname.split('/').pop();
    const r = await fetch(blob.url);
    if (!r.ok) { console.warn(`skipped ${name}: HTTP ${r.status}`); continue; }
    await writeFile(`${outDir}/${name}`, Buffer.from(await r.arrayBuffer()));
    count++;
  }
  cursor = page.cursor;
} while (cursor);
console.log(`Downloaded ${count} files to ${outDir}/`);
