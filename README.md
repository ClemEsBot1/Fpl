# FPL Squad Check

A Fantasy Premier League (FPL) squad checker and optimiser. Load your squad, see point predictions for every player, get transfer and captain suggestions, or generate a data-driven "optimal" squad for any gameweek.

**Live app:** https://fplchecker.vercel.app

## Features

- **Three ways to load a squad** — enter an FPL team ID, upload a screenshot of your team (read on your device with OCR — no AI service or upload — then matched to FPL players and priced from live FPL data), or build one from scratch.
- **Point predictions** for every player, with a per-player **"Why?"** breakdown showing exactly which inputs drove the number (FPL's own model, form, set pieces, xG/xA, bookmaker odds, fixture difficulty, availability, rest days).
- **Optimal squad builder** — picks the best 15 within a £100m budget, aware of who actually starts vs. sits on the bench so budget isn't wasted on players who won't play.
- **Transfer suggestions** that account for free transfers vs. the -4 point hit, so a marginal swap isn't recommended if it costs you points.
- **Captain and vice-captain suggestions**, plus click-to-edit captaincy on any squad.
- **Blank and double gameweek handling** in next-gameweek predictions.
- **Past gameweek hindsight view** with FPL's real automatic substitutions and captain-to-vice fallback applied, so completed gameweeks score correctly.
- **Switch gameweek on your team** from the header menu: a Team ID reloads that gameweek's picks, other squads are re-scored, and a past gameweek is predicted using only data from before its deadline (`/api/as-of` sums FPL's per-gameweek stats for the earlier weeks; prices and set-piece takers stay at today's values, which FPL doesn't publish historically).
- **Chip timing analysis** for planning Wildcard, Free Hit, Bench Boost and Triple Captain.
- **Accounts** (username and password) for saving squads, plus JSON export of the optimal squad.
- **Last-season stats** shown at GW1 (marked "LS") when there's no current-season data yet.
- **Prediction accuracy** on the home page: last gameweek's predictions against what players actually scored.
- **Share** a squad's predicted points as an image, and add a **deadline reminder** (calendar event with a 3-hour alert and any injury/captain warnings) from the results page.
- **"Did we misread something?"** — an opt-in button on the screenshot review screen that sends the screenshot to the site owner so misreads can be fixed and added as tests.

## How predictions work

Each player's predicted points blend several signals, all in `src/lib/predictions.js`:

- FPL's own expected-points figure, shrunk toward the position average early in the season and trusted more as games are played
- Season points-per-game and recent form once enough gameweeks have been played
- A career baseline built from up to 10 past seasons of imported data (with a minimum-minutes floor so fringe players don't skew it)
- Set-piece duty, an xG/xA regression nudge, fixture congestion, and a bookmaker-odds adjustment
- Fixture difficulty and availability (injuries, suspensions, doubts)

For squad-building decisions, values are shrunk toward the position average to counter the "winner's curse" (picking players whose predictions are inflated by noise).

The prediction logic is a set of pure functions shared by the browser and the server cron job, so the two can never disagree.

## Tech stack

- **Frontend:** React 19, Vite, TypeScript, lucide-react
- **Backend:** Vercel serverless functions in `api/`
- **Storage:** Vercel Blob (shared snapshots, historical data, cached odds) and Redis (user accounts and saved squads)
- **Auth:** bcrypt password hashing, JWT session cookies
- **Screenshot reading:** [Tesseract.js](https://github.com/naptha/tesseract.js) OCR running in the browser, self-hosted from `public/tesseract/` (copied there by `scripts/copy-tesseract.mjs` before `dev`/`build`)
- **Data:** the public FPL API, a community archive of past seasons ([vaastav/Fantasy-Premier-League](https://github.com/vaastav/Fantasy-Premier-League)), and [The Odds API](https://the-odds-api.com) for bookmaker odds
- **Tooling:** Oxlint

## Project structure

```
api/
  auth.js               Login, signup, session (rate-limited)
  teams.js              Saved squads for logged-in users
  fpl.js                Cached proxy for the FPL endpoints the app uses (allow-listed)
  optimal-squad.js      Serves the latest optimal-squad snapshot
  refresh-optimal.js    Cron job: builds and saves the snapshot and this gameweek's predictions (needs CRON_SECRET)
  accuracy.js           Last gameweek's predictions vs. actual points
  as-of.js              Player stats from before a past gameweek's deadline
  screenshot-report.js  Stores opt-in screenshot reports in Blob
  odds.js               Serves cached bookmaker odds
  player-history.js     Serves imported historical player data
src/
  App.jsx               App shell: state, data loading, which screen is shown
  styles.css            App-wide styles
  screens/              One file per screen (intro, screenshot import, results, squad builder, hindsight, accounts)
  components/common.jsx Header, loading/error states, player search, fixture chips
  lib/
    predictions.js      Prediction and squad-building logic (shared with the server)
    screenshotOcr.js    Screenshot OCR, player/club/armband detection
    squadLogic.js       Formations, captaincy, transfer suggestions, chip timing
    format.js           Name matching and number formatting
    fplClient.js        Browser-side data loading
    accuracy.js, calendar.js, shareCard.js, fplProxy.js, rateLimit.js
    playerHistory.js, oddsAdjustment.js, auth.js, redis.js, teams.js
test/                   node:test suites (npm test) and fixtures, incl. a real screenshot's OCR output
scripts/
  import-player-history.mjs        One-time import of 10 seasons of history into Blob
  calibrate-weights.mjs            Grid-search of formula weights via walk-forward backtest
  copy-tesseract.mjs               Copies the OCR engine into public/tesseract (runs before dev/build)
  download-screenshot-reports.mjs  Downloads screenshots people reported as misread
.github/workflows/
  ci.yml                       Lint, test and build on every pull request
  refresh-after-deploy.yml     Rebuilds the optimal squad after each push to main
```

## Development

```bash
npm install
npm run dev     # local app (the /api functions need `vercel dev` and env vars)
npm test        # unit tests: screenshot reading, predictions, login limits, proxy rules, …
npm run lint
npm run build
```

`test/fixtures/README.md` explains how to turn a screenshot that was read wrongly into a regression test.

## Setup

1. **Install and run locally**
   ```bash
   npm install
   npm run dev
   ```
2. **Deploy to Vercel** and add these environment variables:

   | Variable | Purpose |
   |---|---|
   | `BLOB_READ_WRITE_TOKEN` | Injected automatically when you create a Vercel Blob store |
   | `CRON_SECRET` | Bearer token protecting `/api/refresh-optimal` (Vercel generates one for the cron) |
   | `REDIS_URL` | Redis connection string for accounts and saved squads |
   | `JWT_SECRET` | Secret used to sign session cookies |
   | `ODDS_API_KEY` | Optional. Free key from the-odds-api.com; without it the odds adjustment is skipped |

3. **Import historical data (optional, once):** run `node scripts/import-player-history.mjs` to upload past seasons to Blob. Without it, predictions fall back to the position-average baseline.

## Optimal-squad storage and auto-refresh

The optimal squad is computed once, server-side, and shared by every visitor via Vercel Blob rather than being recomputed in each browser.

- `api/refresh-optimal.js` fetches live FPL data, builds the optimal squad, and saves a small JSON snapshot to Blob. It also fetches and caches bookmaker odds.
- `api/optimal-squad.js` is what the frontend reads. It returns 404 if nothing has been built yet, and the app falls back to building locally.
- A **daily cron** in `vercel.json` refreshes the snapshot at 06:00 UTC (Vercel's Hobby plan only allows once-daily crons).
- `.github/workflows/refresh-after-deploy.yml` also triggers a refresh about 90 seconds after every push to `main`. It needs a `CRON_SECRET` repository secret in GitHub Actions, matching the value in Vercel.

## How screenshot reading works

Everything happens in the browser; the screenshot never leaves the device.

1. The image is scaled so text is large enough for OCR, then turned into two greyscale versions: one with every strongly coloured pixel painted white (leaving the dark-on-white name labels on a clean page, since the pitch and shirts are coloured) and one inverted (for light text on dark panels).
2. FPL's white (or yellow, for a flagged player) name labels are found as solid rectangles, and each is read on its own from a padded greyscale crop — Tesseract reads a small clean label far more reliably than it picks every label out of a busy full screenshot. The whole page is read too, for the bank figure, prices and any label that wasn't found.
3. Every 1–3 word phrase is compared with all FPL player names (accents and punctuation ignored, a couple of misread letters allowed, and names FPL cuts short with "…" matched by prefix). When most labels were found, text outside them must match almost exactly, so shirt sponsors ("CMC MARKETS") aren't taken for players. Matches are capped at a real squad's 2/5/5/3 per position.
4. Each player's club comes from the fixture printed under their name: "CRY (A)" means their team plays away at Crystal Palace, and in that gameweek's real fixture list only one team does (the gameweek is whichever one fits most of the fixtures on screen). Names are then matched within that club's squad, which tells apart players who share a name (two "Muñoz") and resolves names FPL cuts short ("B.Fernan…"). Where fixtures aren't shown, the Pitch View rows still give each starter's position (goalkeeper, then defenders, midfielders, forwards), and a name shared across positions takes whichever position still has room in a 2/5/5/3 squad. The bottom four players on the screen are the bench. Prices printed next to or under a name, and the bank figure, are picked up too.
5. Captain and vice-captain come from the armband badges (a white "C" or "V" on a dark purple or black disc), found without OCR: light letter-sized blobs that aren't part of a word, sit alone, and are surrounded by very dark pixels are classified by shape (a "C" is open on its right at mid-height; a "V" has two top arms and its point at the bottom) and attached to the player whose card they're on.
6. The review screen shows every match with its live FPL price, the squad's total cost and team value, and lets you fix any player or change the captaincy.

## Server-side protections

- `/api/fpl` only forwards the FPL endpoints the app uses, and caches successful responses at Vercel's edge (5 minutes for player and fixture data), so most visitors never wait on FPL's servers.
- Logins are limited to 10 failed attempts per username and 30 per IP address in 15 minutes; sign-ups to 5 per IP per hour. New passwords need at least 8 characters.
- Screenshot reports are limited to 10 per IP per hour and only store a fixed set of fields.

## Security headers

`vercel.json` sets a Content-Security-Policy (with `'wasm-unsafe-eval'` so the OCR engine's WebAssembly can run), X-Frame-Options, X-Content-Type-Options, Referrer-Policy and Permissions-Policy on every route.
