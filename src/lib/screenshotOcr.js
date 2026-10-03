import { createWorker, PSM } from 'tesseract.js';

// Reads an FPL squad screenshot with Tesseract OCR, entirely in the
// browser, then finds real FPL player names in the recognised text with
// plain string matching. Nothing is sent to a server.
//
// Output is the same shape the squad review screen already consumes:
//   { starting_xi: { goalkeepers, defenders, midfielders, forwards },
//     bench, captain, vice_captain, bank_millions, not_fpl_screenshot }
// where each player entry is { id, name, club, price_millions }.

const TESSERACT_BASE = '/tesseract';
const SQUAD_SHAPE = { 1: 2, 2: 5, 3: 5, 4: 3 }; // GKP, DEF, MID, FWD
const POS_KEYS = { 1: 'goalkeepers', 2: 'defenders', 3: 'midfielders', 4: 'forwards' };
const BENCH_SIZE = 4;
const MIN_WORD_CONFIDENCE = 35;

// Screen furniture that could otherwise fuzzy-match a short player name.
const UI_WORDS = new Set([
  'pick', 'team', 'points', 'transfers', 'bank', 'gameweek', 'deadline', 'fixtures', 'captain',
  'vice', 'bench', 'substitutes', 'save', 'reset', 'pitch', 'list', 'view', 'chips', 'wildcard',
  'free', 'hit', 'boost', 'triple', 'my', 'leagues', 'status', 'home', 'stats', 'fantasy',
  'premier', 'league', 'goalkeepers', 'defenders', 'midfielders', 'forwards', 'cost', 'value',
  'average', 'highest', 'total', 'rank', 'transfer', 'made', 'make', 'player', 'players',
]);

/* ---------------------------------------------------------------------------
   Image preparation
--------------------------------------------------------------------------- */

function toCanvas(lum, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < lum.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = lum[i];
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Tesseract reads small UI text best at roughly 30px+ cap height, so small
// screenshots are scaled up. Then we make two greyscale images to read:
//
// 1. "Labels": FPL prints player names in dark text on neutral (white or
//    light grey) labels, while the pitch, shirts and panels are strongly
//    coloured. Painting every saturated pixel white leaves just the label
//    text on a clean white page — Tesseract's single global threshold
//    can't cope with small white labels scattered over a green pitch.
// 2. "Inverted": the plain greyscale image inverted, for light text on
//    dark panels (some screens and the List View header rows).
function prepareCanvases(img) {
  const longSide = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = Math.min(3, Math.max(1, 2400 / longSide));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const ctx = src.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;

  const labels = new Uint8ClampedArray(w * h);
  const inverted = new Uint8ClampedArray(w * h);
  // Near-black and near-white colourless pixels: the captain/vice armband
  // badges are a white letter on a black disc (see findArmbandBadges).
  const dark = new Uint8Array(w * h);
  const light = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const saturation = max === 0 ? 0 : (max - min) / max;
    // Near-black stays (text, even when slightly tinted by anti-aliasing).
    labels[i] = saturation > 0.3 && max > 70 ? 255 : lum;
    inverted[i] = 255 - lum;
    dark[i] = lum < 90 && max - min < 50 ? 1 : 0;
    light[i] = lum > 170 && max - min < 60 ? 1 : 0;
  }
  return { canvases: [toCanvas(labels, w, h), toCanvas(inverted, w, h)], dark, light, width: w, height: h };
}

/* ---------------------------------------------------------------------------
   OCR
--------------------------------------------------------------------------- */

async function ocrWords(canvases, onProgress) {
  let pass = 0;
  const worker = await createWorker('eng', 1, {
    workerPath: `${TESSERACT_BASE}/worker.min.js`,
    corePath: TESSERACT_BASE,
    langPath: TESSERACT_BASE,
    gzip: false,
    // A blob: worker would be blocked by our Content-Security-Policy.
    workerBlobURL: false,
    logger: m => {
      if (onProgress && m.status === 'recognizing text') onProgress((pass + m.progress) / canvases.length);
    },
  });
  try {
    // "Sparse text": names are scattered labels, not paragraphs.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const lines = [];
    for (pass = 0; pass < canvases.length; pass++) {
      const { data } = await worker.recognize(canvases[pass], {}, { blocks: true, text: true });
      for (const block of data.blocks || []) {
        for (const para of block.paragraphs || []) {
          for (const line of para.lines || []) {
            const words = (line.words || [])
              .filter(w => w.text && w.text.trim() && w.confidence >= MIN_WORD_CONFIDENCE)
              .map(w => ({ text: w.text.trim(), bbox: w.bbox, confidence: w.confidence }));
            if (words.length) lines.push(words);
          }
        }
      }
    }
    return lines;
  } finally {
    await worker.terminate();
  }
}

/* ---------------------------------------------------------------------------
   Text → players
--------------------------------------------------------------------------- */

// Lowercase, strip accents, and drop everything but letters so that OCR's
// spacing/punctuation variations ("B.Fernandes", "B. Fernandes",
// "Mac Allister") all compare equal to the FPL web_name.
export function compactKey(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 });
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag : 1 + Math.min(diag, prev[j], prev[j - 1]);
      diag = tmp;
    }
  }
  return prev[b.length];
}

// Short names must match exactly (one wrong letter in "Son" is a
// different word); longer ones tolerate a couple of misread characters
// (OCR commonly turns "ñ" into "fi", "rn" into "m" and so on).
function keyScore(ocrKey, nameKey) {
  if (ocrKey === nameKey) return 1;
  const len = Math.max(ocrKey.length, nameKey.length);
  if (Math.min(ocrKey.length, nameKey.length) < 5) return 0;
  const dist = levenshtein(ocrKey, nameKey);
  const allowed = len >= 6 ? 2 : 1;
  return dist <= allowed ? 1 - dist / len : 0;
}

// FPL cuts long names short with an ellipsis ("Alexander-Ar..."), so a
// truncated read matches any name it is the start of.
const ELLIPSIS_RE = /(\.{2,}|…)$/;

function buildNameIndex(allPlayers) {
  const byKey = new Map();
  const add = (key, player) => {
    if (key.length < 3) return;
    if (!byKey.has(key)) byKey.set(key, []);
    const list = byKey.get(key);
    if (!list.includes(player)) list.push(player);
  };
  allPlayers.forEach(p => {
    add(compactKey(p.webName), p);
    // web_name is what FPL prints, but some screens use the surname.
    add(compactKey(p.secondName), p);
  });
  return byKey;
}

function bestPlayersForKey(key, index, truncated) {
  if (key.length < 3) return { score: 0, players: [] };
  if (truncated && key.length >= 5) {
    const players = [];
    for (const [nameKey, list] of index) {
      if (nameKey.startsWith(key)) list.forEach(p => { if (!players.includes(p)) players.push(p); });
    }
    if (players.length) return { score: 0.95, players };
  }
  const exact = index.get(key);
  if (exact) return { score: 1, players: exact };
  let best = { score: 0, players: [] };
  for (const [nameKey, players] of index) {
    if (Math.abs(nameKey.length - key.length) > 2) continue;
    const score = keyScore(key, nameKey);
    if (score > best.score) best = { score, players };
  }
  return best;
}

function unionBox(words) {
  return {
    x0: Math.min(...words.map(w => w.bbox.x0)),
    y0: Math.min(...words.map(w => w.bbox.y0)),
    x1: Math.max(...words.map(w => w.bbox.x1)),
    y1: Math.max(...words.map(w => w.bbox.y1)),
  };
}

// Finds player-name phrases (1–3 adjacent words) in one OCR line,
// greedily keeping the best-scoring non-overlapping ones.
function findNamesInLine(words, index) {
  const found = [];
  for (let i = 0; i < words.length; i++) {
    for (let len = 1; len <= 3 && i + len <= words.length; len++) {
      const span = words.slice(i, i + len);
      // Don't let a stray symbol (an armband badge read as "©") ride along
      // at either end of a multi-word name.
      const alnum = w => w.text.replace(/[^\p{L}\p{N}]/gu, '').length;
      if (len > 1 && (alnum(span[0]) < 2 || alnum(span[len - 1]) < 2)) continue;
      const text = span.map(w => w.text).join(' ');
      if (len === 1 && UI_WORDS.has(compactKey(text))) continue;
      const key = compactKey(text);
      const { score, players } = bestPlayersForKey(key, index, ELLIPSIS_RE.test(text));
      if (score >= 0.65 && players.length) {
        found.push({ start: i, end: i + len, text, score, players, bbox: unionBox(span) });
      }
    }
  }
  found.sort((a, b) => b.score - a.score || (b.end - b.start) - (a.end - a.start));
  const used = new Set();
  const kept = [];
  for (const f of found) {
    let clash = false;
    for (let k = f.start; k < f.end; k++) if (used.has(k)) clash = true;
    if (clash) continue;
    for (let k = f.start; k < f.end; k++) used.add(k);
    kept.push(f);
  }
  return kept;
}

const PRICE_RE = /^£?(\d{1,2}\.\d)m?$/i;

function findPrices(lines) {
  const prices = [];
  lines.forEach(words => words.forEach(w => {
    const m = w.text.replace(/[,]/g, '.').match(PRICE_RE);
    if (!m) return;
    const value = parseFloat(m[1]);
    if (value >= 3.5 && value <= 16) prices.push({ value, bbox: w.bbox });
  }));
  return prices;
}

// A price belongs to a name if it's on the same row to its right (List
// View) or directly underneath it (Transfers pitch view).
function nearestPrice(det, prices) {
  const b = det.bbox;
  const h = b.y1 - b.y0;
  const cx = (b.x0 + b.x1) / 2;
  let best = null, bestDist = Infinity;
  for (const p of prices) {
    const pcx = (p.bbox.x0 + p.bbox.x1) / 2;
    const pcy = (p.bbox.y0 + p.bbox.y1) / 2;
    const sameRow = pcy > b.y0 - h * 0.5 && pcy < b.y1 + h * 0.5 && p.bbox.x0 >= b.x1 - 2;
    const below = p.bbox.y0 >= b.y1 - 2 && p.bbox.y0 - b.y1 < h * 3 && Math.abs(pcx - cx) < Math.max(b.x1 - b.x0, h * 3);
    if (!sameRow && !below) continue;
    const dist = Math.hypot(pcx - cx, pcy - (b.y0 + b.y1) / 2);
    if (dist < bestDist) { bestDist = dist; best = p; }
  }
  return best ? best.value : null;
}

function findBank(lines) {
  const text = lines.map(words => words.map(w => w.text).join(' ')).join('\n');
  const m = text.match(/(?:bank|itb|money\s+remaining|remaining)[^\d£\n]{0,12}£?\s?(\d{1,3}[.,]\d)/i);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

// Keeps at most a real squad's worth of players per position (2/5/5/3),
// dropping the weakest matches first, and at most one detection per player.
function trimToSquadShape(detections) {
  const byPlayer = new Map();
  detections.forEach(d => {
    const id = d.player.id;
    if (!byPlayer.has(id) || byPlayer.get(id).score < d.score) byPlayer.set(id, d);
  });
  const sorted = [...byPlayer.values()].sort((a, b) => b.score - a.score);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  return sorted.filter(d => {
    const pos = d.player.positionId;
    if (counts[pos] >= SQUAD_SHAPE[pos]) return false;
    counts[pos]++;
    return true;
  });
}

// Pitch View puts the four substitutes in their own row at the bottom;
// List View lists them last. Either way the bench is the bottom-most
// players, so once we've found (nearly) the whole squad, the last four in
// reading order are the bench.
function splitStartersAndBench(detections) {
  const ordered = [...detections].sort((a, b) => {
    const ay = (a.bbox.y0 + a.bbox.y1) / 2, by = (b.bbox.y0 + b.bbox.y1) / 2;
    const rowH = Math.max(a.bbox.y1 - a.bbox.y0, b.bbox.y1 - b.bbox.y0);
    if (Math.abs(ay - by) > rowH) return ay - by;
    return a.bbox.x0 - b.bbox.x0;
  });
  if (ordered.length < 14) return { starters: ordered, bench: [] };
  return { starters: ordered.slice(0, ordered.length - BENCH_SIZE), bench: ordered.slice(-BENCH_SIZE) };
}

/* ---------------------------------------------------------------------------
   Captain / vice-captain armbands
--------------------------------------------------------------------------- */

// FPL marks the captain and vice-captain with a small black circle holding
// a white "C" or "V", next to the player's shirt (Pitch View) or name
// (List View). We find them with plain image analysis, by looking for the
// white letter rather than the black disc (the disc merges into dark
// shirts, the letter doesn't):
//
// 1. Group light, colourless pixels into connected blobs (single letters)
//    of roughly text height.
// 2. Skip any blob that is one letter of a longer word Tesseract read, so
//    the "V" in "Virgil" or a "C" in a fixture never counts.
// 3. Keep blobs whose surroundings are almost entirely near-black — the
//    badge's disc.
// 4. Tell C from V by shape: a "C" is solid on its left and open on its
//    right at mid-height; a "V" has two top arms, an empty top-centre and
//    its point at the bottom.
export function findArmbandBadges(light, dark, w, h, lines) {
  const words = [];
  lines.forEach(ws => ws.forEach(word => words.push(word)));
  if (!words.length) return [];
  const heights = words.map(word => word.bbox.y1 - word.bbox.y0).sort((a, b) => a - b);
  const textH = heights[heights.length >> 1];
  const minH = Math.max(7, textH * 0.35);
  const maxH = textH * 1.8;

  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const badges = [];
  for (let start = 0; start < w * h; start++) {
    if (!light[start] || seen[start]) continue;
    // Flood-fill one blob (8-connected so thin diagonal strokes hold
    // together), tracking its bounding box.
    let top = 0;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[top++] = start; seen[start] = 1;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const j = ny * w + nx;
          if (light[j] && !seen[j]) { seen[j] = 1; stack[top++] = j; }
        }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bh < minH || bh > maxH || bw < bh * 0.4 || bw > bh * 1.4) continue;
    const box = { x0, y0, x1, y1 };
    // A letter inside a longer line of text: the word's box is about one
    // letter tall but much wider. Tesseract also returns junk "words" over
    // shirts and reads the badge itself as e.g. "o" — those are far taller
    // than a letter or only one character, so they don't count.
    const inWord = words.some(word => {
      if (word.text.replace(/[^A-Za-z0-9]/g, '').length < 2) return false;
      const b = word.bbox;
      const inside = b.x0 <= x0 + 1 && b.x1 >= x1 - 1 && b.y0 <= y0 + 2 && b.y1 >= y1 - 2;
      return inside && (b.y1 - b.y0) < bh * 1.5 && (b.x1 - b.x0) > bw * 1.8;
    });
    if (inWord) continue;
    if (surroundDarkness(dark, w, h, box) < 0.8) continue;
    const letter = classifyLetter(light, w, box);
    if (letter) badges.push({ letter, bbox: box });
  }
  return badges;
}

// Fraction of near-black pixels in a frame around the box (the badge disc
// around its letter), excluding the box itself.
function surroundDarkness(dark, w, h, box) {
  const pad = Math.max(2, Math.round((box.y1 - box.y0 + 1) * 0.3));
  const xa = Math.max(0, box.x0 - pad), xb = Math.min(w - 1, box.x1 + pad);
  const ya = Math.max(0, box.y0 - pad), yb = Math.min(h - 1, box.y1 + pad);
  let n = 0, total = 0;
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      if (x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1) continue;
      n += dark[y * w + x]; total++;
    }
  }
  return total ? n / total : 0;
}

// Fraction of mask pixels in a sub-rectangle given in 0–1 box coordinates.
function maskFraction(mask, w, box, fx0, fy0, fx1, fy1) {
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const xa = box.x0 + Math.floor(fx0 * bw), xb = box.x0 + Math.max(Math.floor(fx0 * bw) + 1, Math.ceil(fx1 * bw));
  const ya = box.y0 + Math.floor(fy0 * bh), yb = box.y0 + Math.max(Math.floor(fy0 * bh) + 1, Math.ceil(fy1 * bh));
  let n = 0, total = 0;
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) { n += mask[y * w + x]; total++; }
  }
  return total ? n / total : 0;
}

function classifyLetter(light, w, box) {
  const f = (a, b, c, d) => maskFraction(light, w, box, a, b, c, d);
  const midLeft = f(0, 0.35, 0.3, 0.65);
  const midRight = f(0.65, 0.35, 1, 0.65);
  const topBand = f(0.3, 0, 0.7, 0.2);
  const bottomBand = f(0.3, 0.8, 0.7, 1);
  if (midLeft > 0.4 && midRight < midLeft * 0.4 && topBand > 0.25 && bottomBand > 0.25) return 'C';
  const topLeft = f(0, 0, 0.3, 0.3);
  const topRight = f(0.7, 0, 1, 0.3);
  const topCentre = f(0.38, 0, 0.62, 0.3);
  const bottomCentre = f(0.3, 0.75, 0.7, 1);
  if (topLeft > 0.25 && topRight > 0.25 && topCentre < 0.2 && bottomCentre > 0.3) return 'V';
  return null;
}

// Each badge belongs to the closest player label (it sits beside or just
// above the name), within a few text-heights.
function assignArmbands(badges, squad) {
  const result = { captain: null, viceCaptain: null };
  if (!badges.length || !squad.length) return result;
  const nearest = badge => {
    const bx = (badge.bbox.x0 + badge.bbox.x1) / 2, by = (badge.bbox.y0 + badge.bbox.y1) / 2;
    let best = null, bestDist = Infinity;
    squad.forEach(d => {
      const textH = d.bbox.y1 - d.bbox.y0;
      const nx = Math.max(d.bbox.x0, Math.min(bx, d.bbox.x1));
      const ny = Math.max(d.bbox.y0, Math.min(by, d.bbox.y1));
      const dist = Math.hypot(bx - nx, by - ny);
      if (by > d.bbox.y1 + textH) return; // badges never sit below the name
      if (dist < textH * 8 && dist < bestDist) { bestDist = dist; best = d; }
    });
    return best ? { det: best, dist: bestDist } : null;
  };
  let bestC = null, bestV = null;
  badges.forEach(b => {
    const hit = nearest(b);
    if (!hit) return;
    if (b.letter === 'C' && (!bestC || hit.dist < bestC.dist)) bestC = hit;
    if (b.letter === 'V' && (!bestV || hit.dist < bestV.dist)) bestV = hit;
  });
  result.captain = bestC ? bestC.det : null;
  result.viceCaptain = bestV && (!bestC || bestV.det !== bestC.det) ? bestV.det : null;
  return result;
}

// Pure text → squad step, separate from OCR so it can be tested directly.
export function extractSquadFromOcrLines(lines, allPlayers, badges = []) {
  const index = buildNameIndex(allPlayers);
  const prices = findPrices(lines);
  const detections = [];
  lines.forEach(words => {
    findNamesInLine(words, index).forEach(f => {
      // Several players can share a printed name (two "Gomes"); the review
      // screen offers the alternatives, so pick the priciest — usually the
      // one people actually own — as the starting guess.
      const player = [...f.players].sort((a, b) => b.price - a.price)[0];
      detections.push({ ...f, player, ambiguous: f.players.length > 1 });
    });
  });

  const squad = trimToSquadShape(detections);
  squad.forEach(d => { d.price = nearestPrice(d, prices); });
  const { starters, bench } = splitStartersAndBench(squad);

  const toEntry = d => ({ id: d.player.id, ambiguous: d.ambiguous, name: d.text, club: null, price_millions: d.price });
  const armbands = assignArmbands(badges, squad);
  const startingXi = { goalkeepers: [], defenders: [], midfielders: [], forwards: [] };
  starters.forEach(d => startingXi[POS_KEYS[d.player.positionId]].push(toEntry(d)));

  return {
    not_fpl_screenshot: squad.length < 3,
    starting_xi: startingXi,
    bench: bench.map(toEntry),
    captain: armbands.captain ? armbands.captain.text : null,
    vice_captain: armbands.viceCaptain ? armbands.viceCaptain.text : null,
    bank_millions: findBank(lines),
  };
}

// Raw OCR lines (arrays of { text, bbox, confidence }), useful on its own
// for debugging what Tesseract saw.
export async function readScreenshotText(img, onProgress) {
  return ocrWords(prepareCanvases(img).canvases, onProgress);
}

export async function readSquadFromScreenshot(img, allPlayers, onProgress) {
  const prepared = prepareCanvases(img);
  const lines = await ocrWords(prepared.canvases, onProgress);
  const badges = findArmbandBadges(prepared.light, prepared.dark, prepared.width, prepared.height, lines);
  return extractSquadFromOcrLines(lines, allPlayers, badges);
}
