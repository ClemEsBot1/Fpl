import Anthropic from '@anthropic-ai/sdk';
import { getRedis } from '../src/lib/redis.js';

// Reads an FPL squad screenshot with Claude's vision and returns the same
// JSON shape the old "paste from a Claude chat" flow asked people to copy
// by hand. Player matching and pricing still happen in the browser against
// live FPL data — this endpoint only turns pixels into names.

const MODEL = 'claude-opus-5-5';
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// The client downsizes before uploading, so a real screenshot is a few
// hundred KB. This also keeps us under Vercel's 4.5MB request body limit.
const MAX_BASE64_LENGTH = 4_000_000;
// Each read is a paid API call, so cap how many one IP can make.
const RATE_LIMIT_PER_HOUR = 20;

const PLAYER_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    club: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    price_millions: { anyOf: [{ type: 'number' }, { type: 'null' }] },
  },
  required: ['name', 'club', 'price_millions'],
  additionalProperties: false,
};

const SQUAD_SCHEMA = {
  type: 'object',
  properties: {
    not_fpl_screenshot: { type: 'boolean' },
    starting_xi: {
      type: 'object',
      properties: {
        goalkeepers: { type: 'array', items: PLAYER_SCHEMA },
        defenders: { type: 'array', items: PLAYER_SCHEMA },
        midfielders: { type: 'array', items: PLAYER_SCHEMA },
        forwards: { type: 'array', items: PLAYER_SCHEMA },
      },
      required: ['goalkeepers', 'defenders', 'midfielders', 'forwards'],
      additionalProperties: false,
    },
    bench: { type: 'array', items: PLAYER_SCHEMA },
    captain: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    vice_captain: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    bank_millions: { anyOf: [{ type: 'number' }, { type: 'null' }] },
  },
  required: ['not_fpl_screenshot', 'starting_xi', 'bench', 'captain', 'vice_captain', 'bank_millions'],
  additionalProperties: false,
};

const PROMPT = `This is a screenshot of a Fantasy Premier League (FPL) squad screen — usually the Pick Team / Points "Pitch View" or "List View" of a manager's 15-player team.

Read every player in the squad:
- Group the starting XI by the row they appear in on the pitch (goalkeeper, defenders, midfielders, forwards). In List View, use the position headings.
- "bench" is the 4 substitutes shown below or apart from the pitch, in the order shown.
- "name" is the short display name exactly as printed (e.g. "Saka", "B.Fernandes", "Alexander-Arnold").
- "club" is the club's 3-letter FPL abbreviation (e.g. ARS, MCI, LIV) if you can tell it from the shirt or text, otherwise null.
- "price_millions" is the price shown for that player (e.g. 10.2 for "£10.2m"), or null if no price is shown for them.
- "captain" / "vice_captain" are the names of the players wearing the C / V armband badges, or null if not visible.
- "bank_millions" is the money in the bank / ITB figure if visible (e.g. 0.3 for "£0.3m"), otherwise null.

If you cannot read a name confidently, leave that player out rather than guessing. If the image is not an FPL squad screen at all, set "not_fpl_screenshot" to true and return empty lists.`;

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Best-effort: if Redis isn't configured or is down, don't block reads.
async function isRateLimited(req) {
  let redis;
  try { redis = getRedis(); } catch (e) { return false; }
  try {
    const key = `ratelimit:read-screenshot:${clientIp(req)}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 3600);
    return count > RATE_LIMIT_PER_HOUR;
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'server_misconfigured', detail: 'ANTHROPIC_API_KEY is not set' });
    return;
  }

  const body = req.body || {};
  const image = typeof body.image === 'string' ? body.image : '';
  const mediaType = body.mediaType;
  if (!image || !ALLOWED_MEDIA_TYPES.includes(mediaType)) {
    res.status(400).json({ error: 'bad_image', detail: 'Send a PNG, JPEG, WebP or GIF screenshot.' });
    return;
  }
  if (image.length > MAX_BASE64_LENGTH) {
    res.status(413).json({ error: 'image_too_large' });
    return;
  }

  if (await isRateLimited(req)) {
    res.status(429).json({ error: 'rate_limited' });
    return;
  }

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SQUAD_SCHEMA },
      },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: PROMPT },
        ],
      }],
    });

    if (response.stop_reason === 'refusal') {
      res.status(422).json({ error: 'refused' });
      return;
    }
    if (response.stop_reason === 'max_tokens') {
      res.status(502).json({ error: 'truncated' });
      return;
    }
    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock) {
      res.status(502).json({ error: 'empty_response' });
      return;
    }
    res.status(200).json(JSON.parse(textBlock.text));
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      res.status(429).json({ error: 'upstream_busy' });
    } else if (e instanceof Anthropic.APIError) {
      res.status(502).json({ error: 'vision_failed', detail: `${e.status}: ${e.message}` });
    } else {
      res.status(502).json({ error: 'vision_failed', detail: String((e && e.message) || e) });
    }
  }
}
