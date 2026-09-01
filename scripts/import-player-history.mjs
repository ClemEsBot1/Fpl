// ONE-TIME (or once-a-season) import script — NOT part of the deployed app.
// Run manually: `node scripts/import-player-history.mjs`
//
// Pulls every past season's per-player totals from the community-maintained
// vaastav/Fantasy-Premier-League GitHub archive (public, no auth needed),
// aggregates them keyed by FPL's stable per-player `code` (the same field
// FPL's own API uses in element-summary's `history_past` — matches perfectly
// against live bootstrap-static data, no fuzzy name-matching required), and
// uploads the result to Vercel Blob as a single public JSON file. The app
// then just reads that one blob at runtime — no per-player API calls, no
// repeated GitHub fetches.
//
// Requires Blob credentials in the environment — either the modern OIDC
// pair (VERCEL_OIDC_TOKEN + BLOB_STORE_ID, which `vercel env pull` gives you
// automatically for a connected store) or the older static
// BLOB_READ_WRITE_TOKEN. For local use, run `vercel env pull .env.local` in
// the project root first (needs `vercel link` done once beforehand), then
// run this script with `node --env-file=.env.local
// scripts/import-player-history.mjs` so those variables are loaded.
//
// Re-run this whenever you want to add a newly-completed season: add its
// folder name to SEASONS below and run again (allowOverwrite replaces the
// existing blob in place).

import { put } from '@vercel/blob';

const SEASONS = [
  '2016-17', '2017-18', '2018-19', '2019-20', '2020-21',
  '2021-22', '2022-23', '2023-24', '2024-25', '2025-26',
];

const ARCHIVE_BASE = 'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data';
const BLOB_PATHNAME = 'player-history.json';

// Fields we keep per player-season. Not every season's CSV has every column
// (e.g. `defensive_contribution` and `expected_*` only exist from
// 2022-23/2025-26 onward) — missing ones are simply omitted for that season
// rather than defaulted to 0, so downstream code can tell "didn't play" from
// "stat didn't exist yet".
const NUMERIC_FIELDS = [
  'total_points', 'minutes', 'starts', 'goals_scored', 'assists', 'clean_sheets',
  'goals_conceded', 'own_goals', 'bonus', 'bps', 'now_cost',
  'influence', 'creativity', 'threat', 'ict_index',
  'expected_goals', 'expected_assists', 'expected_goal_involvements',
  'defensive_contribution',
];

// Minimal RFC4180-ish CSV parser (quote-aware, handles embedded commas/
// quotes/CRLF) — no dependency needed for a one-off script.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip, \n handles the line break */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseCsvObjects(text) {
  const rows = parseCsv(text);
  const header = rows[0];
  return rows.slice(1).filter(r => r.length === header.length).map(r => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

async function fetchSeasonCsv(season) {
  const url = `${ARCHIVE_BASE}/${season}/players_raw.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${season}: HTTP ${res.status}`);
  return parseCsvObjects(await res.text());
}

async function main() {
  const hasStaticToken = !!process.env.BLOB_READ_WRITE_TOKEN;
  const hasOidc = !!process.env.VERCEL_OIDC_TOKEN && !!process.env.BLOB_STORE_ID;
  if (!hasStaticToken && !hasOidc) {
    console.error('No Blob credentials found. Run `vercel env pull .env.local` in the project root first (and load it, e.g. `node --env-file=.env.local scripts/import-player-history.mjs`) — modern Vercel Blob stores authenticate via OIDC (VERCEL_OIDC_TOKEN + BLOB_STORE_ID) rather than a static BLOB_READ_WRITE_TOKEN, and `vercel env pull` picks up whichever one your store actually issues once the project is linked.');
    process.exit(1);
  }

  const byCode = {}; // code -> { webName, seasons: { [season]: {...} } }
  let totalRows = 0;

  for (const season of SEASONS) {
    console.log(`Fetching ${season}...`);
    let rows;
    try {
      rows = await fetchSeasonCsv(season);
    } catch (e) {
      console.warn(`  skipped ${season}: ${e.message}`);
      continue;
    }
    for (const row of rows) {
      const code = row.code;
      if (!code) continue; // malformed row, skip
      if (!byCode[code]) byCode[code] = { webName: row.web_name || '', seasons: {} };
      byCode[code].webName = row.web_name || byCode[code].webName; // keep the most recent name seen
      const seasonStats = { elementType: Number(row.element_type) || null };
      for (const field of NUMERIC_FIELDS) {
        if (row[field] === undefined || row[field] === '' || row[field] === 'None') continue;
        const n = Number(row[field]);
        if (!Number.isNaN(n)) seasonStats[field] = n;
      }
      byCode[code].seasons[season] = seasonStats;
    }
    totalRows += rows.length;
    console.log(`  ${rows.length} players`);
  }

  const playerCount = Object.keys(byCode).length;
  console.log(`\nAggregated ${playerCount} distinct players across ${totalRows} player-season rows.`);

  const payload = {
    generatedAt: new Date().toISOString(),
    seasons: SEASONS,
    players: byCode,
  };
  const json = JSON.stringify(payload);
  console.log(`Payload size: ${(json.length / 1024 / 1024).toFixed(2)} MB`);

  const { fileURLToPath } = await import('url');
  const path = await import('path');
  const fs = await import('fs');
  const localPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', BLOB_PATHNAME);
  fs.writeFileSync(localPath, json);
  console.log(`Wrote local copy to ${localPath} (for inspection — not read by the app).`);

  console.log('Uploading to Vercel Blob...');
  const result = await put(BLOB_PATHNAME, json, {
    access: 'public',
    contentType: 'application/json',
    allowOverwrite: true,
  });
  console.log(`Done. Blob URL: ${result.url}`);
}

main().catch(e => {
  console.error('Import failed:', e);
  process.exit(1);
});
