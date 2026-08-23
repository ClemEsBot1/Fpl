# FPL Squad Check

## Optimal-squad storage & auto-refresh

The "Optimal Squad" build used to be cached per-browser in `localStorage`, so
every visitor's device recomputed and stored its own copy. It's now computed
once, server-side, and shared by everyone via [Vercel Blob](https://vercel.com/docs/vercel-blob).
Two new API routes and a scheduled job make this work:

- `api/refresh-optimal.js` — fetches live FPL data directly (no CORS proxy
  needed server-side), builds the optimal squad, and saves a small JSON
  snapshot (`{ playerIds, captainId, viceCaptainId, gwId, builtAt }`) to Blob
  storage. Protected by a `CRON_SECRET` bearer token.
- `api/optimal-squad.js` — the frontend calls this to read the latest
  snapshot. Falls back gracefully (404) if nothing's been built yet.
- `src/lib/predictions.js` — the prediction formula and squad-building logic,
  shared between the browser bundle and the server refresh job so the two
  can never disagree.

### One-time setup

1. **Create a Blob store.** Vercel dashboard → your project → Storage →
   Create Database → Blob. This auto-injects `BLOB_READ_WRITE_TOKEN` into
   your project's environment variables — no manual copying needed.
2. **Deploy** (this repo already includes `vercel.json`, which registers a
   daily cron and causes Vercel to auto-generate a `CRON_SECRET` env var).
3. **Every-hour refresh, for free.** Vercel's Hobby plan only allows cron
   jobs that run once a day — an hourly schedule fails at deploy time on
   that plan. `vercel.json` here uses a safe once-daily schedule so it works
   regardless of plan. To actually get hourly refreshes for free, this repo
   also includes `.github/workflows/refresh-optimal-squad.yml`, which calls
   the same endpoint every hour using GitHub's own scheduler. Follow the
   setup steps in that file's comments (copy `CRON_SECRET` from Vercel into
   a GitHub Actions repo secret, set your deployed URL). If you're on
   **Vercel Pro**, you can skip GitHub Actions entirely and just change the
   schedule in `vercel.json` to `"0 * * * *"`.
4. Everything still works if you skip all of the above — `handleBuildOptimalTeam`
   falls back to this browser's local cache, then to building fresh on the
   spot, exactly as before.

---



This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.