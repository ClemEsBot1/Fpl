import { put } from '@vercel/blob';
import { getRedis } from '../src/lib/redis.js';
import { clientIp, bump } from '../src/lib/rateLimit.js';

// Opt-in "help improve the screenshot reader" reports. When someone sends
// one from the review screen, their screenshot and what the reader made of
// it (plus anything they corrected) are stored in Vercel Blob under
// screenshot-reports/. scripts/download-screenshot-reports.mjs pulls them
// down so a misread screenshot can become a test case in test/fixtures/.

const MAX_IMAGE_BASE64 = 3_000_000; // the client sends a downsized JPEG
const MAX_REPORT_JSON = 100_000;
const REPORTS_PER_IP_PER_HOUR = 10;

// Keep only the fields we need, in a fixed shape, rather than storing
// whatever a client sends.
export function sanitizeReport(body) {
  const slots = Array.isArray(body.slots) ? body.slots.slice(0, 20) : [];
  return {
    receivedAt: new Date().toISOString(),
    slots: slots.map(s => ({
      read: String(s.read || '').slice(0, 60),
      matchedId: Number.isInteger(s.matchedId) ? s.matchedId : null,
      matchedName: String(s.matchedName || '').slice(0, 60),
      corrected: !!s.corrected,
      isStarting: !!s.isStarting,
      isCaptain: !!s.isCaptain,
      isViceCaptain: !!s.isViceCaptain,
    })),
    note: String(body.note || '').slice(0, 500),
    userAgent: String(body.userAgent || '').slice(0, 200),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const body = req.body || {};
  const image = typeof body.image === 'string' ? body.image : '';
  if (!image || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 1000))) {
    res.status(400).json({ error: 'bad_image' });
    return;
  }
  if (image.length > MAX_IMAGE_BASE64) {
    res.status(413).json({ error: 'image_too_large' });
    return;
  }
  const report = sanitizeReport(body);
  const reportJson = JSON.stringify(report);
  if (reportJson.length > MAX_REPORT_JSON) {
    res.status(413).json({ error: 'report_too_large' });
    return;
  }

  // Best-effort abuse limit; if Redis isn't available, still accept.
  try {
    const count = await bump(getRedis(), `ratelimit:screenshot-report:${clientIp(req)}`, 3600);
    if (count > REPORTS_PER_IP_PER_HOUR) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
  } catch { /* no limiter */ }

  try {
    const id = `${report.receivedAt.replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
    await put(`screenshot-reports/${id}.jpg`, Buffer.from(image, 'base64'), {
      access: 'public', contentType: 'image/jpeg', addRandomSuffix: true,
    });
    await put(`screenshot-reports/${id}.json`, reportJson, {
      access: 'public', contentType: 'application/json', addRandomSuffix: true,
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: 'storage_failed', detail: String((e && e.message) || e) });
  }
}
