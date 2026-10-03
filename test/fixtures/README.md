# Test fixtures

## `real-pitch-view.raw.json`

The OCR output of a real FPL app Pitch View screenshot (Android, 1440×3120): what `readScreenshotRaw()` in `src/lib/screenshotOcr.js` returns for it. That covers the text it read (whole page and per name label), where the labels are, and the armband badges it found. Replaying it in `test/screenshotOcr.test.js` tests everything after the browser-only OCR step.

## `players-and-fixtures.json`

The player pool and gameweek fixtures those tests match against. See its `about` field.

## Adding a new screenshot as a test

1. Get the screenshot. Reports people send from the review screen can be downloaded with `node scripts/download-screenshot-reports.mjs`.
2. Run `npm run dev`, open the app, and in the browser console run:

   ```js
   const m = await import('/src/lib/screenshotOcr.js');
   const img = new Image(); img.src = '<data URL or same-origin URL of the screenshot>'; await img.decode();
   copy(JSON.stringify(await m.readScreenshotRaw(img)));
   ```

3. Paste the result into a new `test/fixtures/<name>.raw.json`.
4. Add a test in `test/screenshotOcr.test.js` that runs `squadFromRaw()` on it and asserts the correct squad. Add any players it needs to `players-and-fixtures.json`.
