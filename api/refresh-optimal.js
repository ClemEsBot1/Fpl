import { put } from '@vercel/blob';
import { buildStaticDataFromRaw, buildOptimalTeam, SQUAD_BUDGET } from '../src/lib/predictions.js';

const FPL_BASE = 'https://fantasy.premierleague.com/api/';

// One blob per gameweek, e.g. optimal-squad-gw3.json — never a single
// "latest" file. The refresh job always writes to whichever gameweek is
// currently the target, so once a gameweek's deadline passes and the target
// moves on, that gameweek's file simply stops being touched and is
// naturally frozen — no separate "close it" step needed.
export function snapshotPathnameFor(gwId) {
  return `optimal-squad-gw${gwId}.json`;
}

async function fetchFplJsonServer(path) {
  // Runs server-side — no browser involved, so no CORS restriction and no
  // need for the /api/fpl proxy the client uses. Straight to the source.
  const r = await fetch(FPL_BASE + path);
  if (!r.ok) throw new Error(`FPL fetch failed for ${path}: status ${r.status}`);
  return r.json();
}

export default async function handler(req, res) {
  // Authenticate both trigger sources with one check:
  //  - Vercel's own daily cron (see vercel.json) auto-sends this header using
  //    the CRON_SECRET env var Vercel provisions for you once crons exist.
  //  - The hourly GitHub Actions workflow sends the same header, using a
  //    repo secret you copy from that same CRON_SECRET value (not required —
  //    the app works fine on the daily schedule alone).
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!expected || auth !== `Bearer ${expected}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  // Optional manual override: ?gw=1 (re)builds a specific gameweek's
  // snapshot on demand, e.g. to backfill one that closed before this feature
  // existed and so never got saved. IMPORTANT: this necessarily uses
  // TODAY's prices/ep_next, not what was actually available before that
  // gameweek was played — FPL's API only exposes current state, so an
  // authentic historical snapshot isn't recoverable once a gameweek has
  // passed. The snapshot is flagged `backfilled: true` so the app/you can
  // tell it apart from one saved in real time.
  const forceGwId = req.query && req.query.gw ? Number(req.query.gw) : null;

  try {
    const [bootstrap, fixturesRaw] = await Promise.all([
      fetchFplJsonServer('bootstrap-static/'),
      fetchFplJsonServer('fixtures/'),
    ]);
    const staticData = buildStaticDataFromRaw(bootstrap, fixturesRaw, forceGwId ? { forceGwId } : {});
    const gwId = staticData.targetEvent ? staticData.targetEvent.id : 1;

    const built = buildOptimalTeam(staticData, SQUAD_BUDGET);
    const snapshot = {
      playerIds: built.squad.map(s => s.player.id),
      startingIds: built.squad.filter(s => s.isStarting).map(s => s.player.id),
      captainId: built.captainId,
      viceCaptainId: built.viceCaptainId,
      predictedById: Object.fromEntries(built.squad.map(s => [s.player.id, s.nextMatchPredicted])),
      gwId,
      builtAt: new Date().toISOString(),
      backfilled: !!forceGwId,
    };

    await put(snapshotPathnameFor(gwId), JSON.stringify(snapshot), {
      access: 'public',
      contentType: 'application/json',
      allowOverwrite: true,
    });

    res.status(200).json({ ok: true, gwId, builtAt: snapshot.builtAt, backfilled: snapshot.backfilled, playerCount: snapshot.playerIds.length });
  } catch (e) {
    res.status(502).json({ error: 'refresh_failed', detail: String((e && e.message) || e) });
  }
}