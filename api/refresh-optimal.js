import { put } from '@vercel/blob';
import { buildStaticDataFromRaw, buildOptimalTeam, SQUAD_BUDGET } from '../src/lib/predictions.js';

const FPL_BASE = 'https://fantasy.premierleague.com/api/';
export const SNAPSHOT_PATHNAME = 'optimal-squad-latest.json';

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
  //    repo secret you copy from that same CRON_SECRET value.
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  if (!expected || auth !== `Bearer ${expected}`) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const [bootstrap, fixturesRaw] = await Promise.all([
      fetchFplJsonServer('bootstrap-static/'),
      fetchFplJsonServer('fixtures/'),
    ]);
    const staticData = buildStaticDataFromRaw(bootstrap, fixturesRaw);
    const gwId = staticData.targetEvent ? staticData.targetEvent.id : 1;

    const built = buildOptimalTeam(staticData, SQUAD_BUDGET);
    const snapshot = {
      playerIds: built.squad.map(s => s.player.id),
      captainId: built.captainId,
      viceCaptainId: built.viceCaptainId,
      gwId,
      builtAt: new Date().toISOString(),
    };

    await put(SNAPSHOT_PATHNAME, JSON.stringify(snapshot), {
      access: 'public',
      contentType: 'application/json',
      allowOverwrite: true,
    });

    res.status(200).json({ ok: true, gwId, builtAt: snapshot.builtAt, playerCount: snapshot.playerIds.length });
  } catch (e) {
    res.status(502).json({ error: 'refresh_failed', detail: String((e && e.message) || e) });
  }
}
