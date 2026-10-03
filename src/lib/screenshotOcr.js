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
  // The captain/vice armband badges are a white letter on a very dark disc
  // (FPL's dark purple, rgb(55,0,60), or black) — see findArmbandBadges.
  // Dark card backgrounds and shirts are noticeably brighter than that.
  const dark = new Uint8Array(w * h);
  const light = new Uint8Array(w * h);
  // Name-label background: white, or the yellow/amber FPL uses to flag a
  // doubtful player — see findLabelBoxes.
  const labelBg = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const saturation = max === 0 ? 0 : (max - min) / max;
    // Near-black stays (text, even when slightly tinted by anti-aliasing).
    labels[i] = saturation > 0.3 && max > 70 ? 255 : lum;
    inverted[i] = 255 - lum;
    dark[i] = lum < 55 ? 1 : 0;
    light[i] = lum > 170 && max - min < 60 ? 1 : 0;
    labelBg[i] = (lum > 215 && max - min < 40) || (r > 215 && g > 170 && b < 170 && r - b > 70) ? 1 : 0;
  }
  return {
    canvases: [toCanvas(labels, w, h), toCanvas(inverted, w, h)],
    source: src,
    dark, light, labelBoxes: findLabelBoxes(labelBg, w, h), width: w, height: h,
  };
}

// Visits each 4-connected blob of set pixels in `mask`, calling
// visit(box, pixelCount) with its bounding box.
function forEachBlob(mask, w, h, visit) {
  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    let top = 0, count = 0;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack[top++] = start; seen[start] = 1;
    while (top) {
      const i = stack[--top];
      const x = i % w, y = (i - x) / w;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && mask[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; stack[top++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; stack[top++] = i + 1; }
      if (y > 0 && mask[i - w] && !seen[i - w]) { seen[i - w] = 1; stack[top++] = i - w; }
      if (y < h - 1 && mask[i + w] && !seen[i + w]) { seen[i + w] = 1; stack[top++] = i + w; }
    }
    visit({ x0, y0, x1, y1 }, count);
  }
}

// FPL prints every player's name on a small solid white (or yellow, for a
// flagged player) label under their shirt. Finding those rectangles lets
// us OCR each name on its own: Tesseract reads a small clean label far
// more reliably than it picks every label out of a busy full screenshot,
// where it silently skips some.
function findLabelBoxes(mask, w, h) {
  const boxes = [];
  forEachBlob(mask, w, h, (b, count) => {
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    if (bw < w * 0.06 || bw > w * 0.35) return;
    if (bh < h * 0.008 || bh > h * 0.07) return;
    if (bw < bh * 1.6) return;
    if (count / (bw * bh) < 0.5) return; // solid box (text makes holes)
    boxes.push(b);
  });
  return boxes;
}

/* ---------------------------------------------------------------------------
   OCR
--------------------------------------------------------------------------- */

function toWords(data, minConfidence = MIN_WORD_CONFIDENCE) {
  const lines = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const words = (line.words || [])
          .filter(w => w.text && w.text.trim() && w.confidence >= minConfidence)
          .map(w => ({ text: w.text.trim(), bbox: w.bbox, confidence: w.confidence }));
        if (words.length) lines.push(words);
      }
    }
  }
  return lines;
}

// Copies one label from the original (colour) image onto its own
// greyscale canvas with a white margin all round — Tesseract often drops
// text that touches the image border, and FPL's name text sits close to
// the label's edge. Measured on a real screenshot this reads every name
// where the whole-page pass skipped several. Returns the canvas and a
// function mapping its word boxes back to page coordinates.
const LABEL_PAD = 24;
// Labels are clean, isolated text, and every candidate still has to match
// a real player's name, so low-confidence words are worth keeping here.
const LABEL_MIN_CONFIDENCE = 15;
function cropLabel(source, b) {
  const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
  const canvas = document.createElement('canvas');
  canvas.width = bw + LABEL_PAD * 2;
  canvas.height = bh + LABEL_PAD * 2;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, b.x0, b.y0, bw, bh, LABEL_PAD, LABEL_PAD, bw, bh);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = lum;
  }
  ctx.putImageData(img, 0, 0);
  const toPage = bb => ({ x0: bb.x0 - LABEL_PAD + b.x0, y0: bb.y0 - LABEL_PAD + b.y0, x1: bb.x1 - LABEL_PAD + b.x0, y1: bb.y1 - LABEL_PAD + b.y0 });
  return { canvas, toPage };
}

// Two kinds of reading: the whole page (both prepared images), and each
// name label on its own. Returns { pageLines, labelLines }, each an array
// of lines of { text, bbox, confidence } words in page coordinates.
// One OCR worker for the whole visit. Loading it means downloading the
// engine and English data (~9 MB the first time, then from the browser
// cache) and starting WebAssembly, which takes a few seconds — so it's
// started as soon as someone opens the upload screen (warmUpOcr) and
// reused for every screenshot after that, instead of being created and
// thrown away per read.
let workerPromise = null;
let reportProgress = null; // the logger below forwards to whichever read is running

function getOcrWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      workerPath: `${TESSERACT_BASE}/worker.min.js`,
      corePath: TESSERACT_BASE,
      langPath: TESSERACT_BASE,
      gzip: false,
      // A blob: worker would be blocked by our Content-Security-Policy.
      workerBlobURL: false,
      logger: m => { if (reportProgress) reportProgress(m); },
    }).catch(err => {
      workerPromise = null; // let the next attempt retry
      throw err;
    });
  }
  return workerPromise;
}

// Starts loading the OCR engine in the background. Safe to call repeatedly.
export function warmUpOcr() {
  getOcrWorker().catch(() => { /* surfaced when a read actually runs */ });
}

// Reads run one at a time on the shared worker.
let queue = Promise.resolve();

async function ocrWords(canvases, onProgress, labelBoxes = [], source = null) {
  const run = queue.then(() => runOcr(canvases, onProgress, labelBoxes, source));
  queue = run.catch(() => {});
  return run;
}

async function runOcr(canvases, onProgress, labelBoxes, source) {
  let pass = 0;
  const totalPasses = canvases.length + (labelBoxes.length ? 1 : 0);
  const worker = await getOcrWorker();
  reportProgress = m => {
    if (onProgress && m.status === 'recognizing text' && pass < canvases.length) onProgress((pass + m.progress) / totalPasses);
  };
  try {
    // "Sparse text": names are scattered labels, not paragraphs.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const pageLines = [];
    for (pass = 0; pass < canvases.length; pass++) {
      const { data } = await worker.recognize(canvases[pass], {}, { blocks: true, text: true });
      pageLines.push(...toWords(data));
    }
    const labelLines = [];
    for (let i = 0; i < labelBoxes.length; i++) {
      const b = labelBoxes[i];
      const { canvas, toPage } = cropLabel(source || canvases[0], b);
      const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
      labelLines.push(...toWords(data, LABEL_MIN_CONFIDENCE).map(line => line.map(w => ({ ...w, bbox: toPage(w.bbox) }))));
      if (onProgress) onProgress((canvases.length + (i + 1) / labelBoxes.length) / totalPasses);
    }
    return { pageLines, labelLines };
  } finally {
    reportProgress = null;
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
      // Drop stray OCR punctuation at the edges ('"De Cuyper'), keeping a
      // trailing ellipsis, which marks a truncated name.
      const text = span.map(w => w.text).join(' ')
        .replace(/^[^\p{L}\p{N}]+/u, '')
        .replace(/[^\p{L}\p{N}.…]+$/u, '');
      if (len === 1 && UI_WORDS.has(compactKey(text))) continue;
      const key = compactKey(text);
      const { score, players } = bestPlayersForKey(key, index, ELLIPSIS_RE.test(text));
      const minScore = Math.max(0.65, ...span.map(w => w.minScore || 0));
      if (score >= minScore && players.length) {
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
  // Names whose possible players are all in one position take their
  // places first; a name shared by players in different positions then
  // takes whichever of them fits a position that still has room, rather
  // than pushing someone else out (two "Munoz": a midfielder and a
  // defender).
  const flexibility = d => new Set(d.candidates.map(p => p.positionId)).size;
  const sorted = [...byPlayer.values()].sort((a, b) =>
    flexibility(a) - flexibility(b) || b.score - a.score);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const hasRoom = p => counts[p.positionId] < SQUAD_SHAPE[p.positionId];
  return sorted.filter(d => {
    if (!hasRoom(d.player)) {
      const fits = d.candidates.filter(hasRoom).sort((a, b) => b.price - a.price);
      if (!fits.length) return false;
      d.player = fits[0];
    }
    counts[d.player.positionId]++;
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
    // The badge letter stands alone in its disc; a "C" or "V" inside a word
    // on a dark bar ("Goalkeepers", "Substitutes") has neighbours right
    // beside it.
    if (sideLightness(light, w, box) > 0.05) continue;
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

// Fraction of light pixels in strips half a letter-height wide immediately
// left and right of the box.
function sideLightness(light, w, box) {
  const bh = box.y1 - box.y0 + 1;
  const gap = Math.max(1, Math.round(bh * 0.06));
  const strip = Math.max(2, Math.round(bh * 0.5));
  let n = 0, total = 0;
  for (let y = box.y0; y <= box.y1; y++) {
    for (let k = gap; k < gap + strip; k++) {
      const xl = box.x0 - k, xr = box.x1 + k;
      if (xl >= 0) { n += light[y * w + xl]; total++; }
      if (xr < w) { n += light[y * w + xr]; total++; }
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

// Each badge belongs to one player: in Pitch View it sits in the top
// corner of that player's card, above the shirt and the name label; in
// List View it sits on the same row as the name. So a candidate player is
// one whose name is below the badge and roughly in line with it
// horizontally (within a card's width), or on the same row; of those the
// closest wins.
function assignArmbands(badges, squad) {
  const result = { captain: null, viceCaptain: null };
  if (!badges.length || !squad.length) return result;
  const nearest = badge => {
    const bx = (badge.bbox.x0 + badge.bbox.x1) / 2, by = (badge.bbox.y0 + badge.bbox.y1) / 2;
    let best = null, bestDist = Infinity;
    squad.forEach(d => {
      const textH = d.bbox.y1 - d.bbox.y0;
      const cx = (d.bbox.x0 + d.bbox.x1) / 2, cy = (d.bbox.y0 + d.bbox.y1) / 2;
      const cardHalfWidth = Math.max(d.bbox.x1 - d.bbox.x0, textH * 5);
      const above = by < d.bbox.y0 && d.bbox.y0 - by < textH * 14 && Math.abs(bx - cx) < cardHalfWidth;
      const sameRow = Math.abs(by - cy) < textH * 1.5 && Math.abs(bx - cx) < textH * 15;
      if (!above && !sameRow) return;
      const dist = Math.hypot(bx - cx, by - cy);
      if (dist < bestDist) { bestDist = dist; best = d; }
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

// The same label is often read twice (whole-page pass and label pass);
// keep one detection per spot on the screen, the best-scoring.
function dedupeByPlace(found) {
  const kept = [];
  [...found].sort((a, b) => b.score - a.score).forEach(f => {
    const h = f.bbox.y1 - f.bbox.y0;
    const cx = (f.bbox.x0 + f.bbox.x1) / 2, cy = (f.bbox.y0 + f.bbox.y1) / 2;
    const clash = kept.some(k => Math.abs((k.bbox.x0 + k.bbox.x1) / 2 - cx) < h * 3 && Math.abs((k.bbox.y0 + k.bbox.y1) / 2 - cy) < h);
    if (!clash) kept.push(f);
  });
  return kept;
}

// In Pitch View the starting XI is laid out in rows: goalkeeper (alone),
// then defenders, midfielders and forwards (2–5 each), then the bench.
// When the detected names fall into rows of that shape, each of the first
// four rows tells us the position of every name in it. Returns a Map from
// each detection in `found` (duplicates included) to a position id.
function pitchRowPositions(unique) {
  const hints = new Map();
  if (unique.length < 8) return hints;
  const byY = [...unique].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const rows = [];
  byY.forEach(f => {
    const h = f.bbox.y1 - f.bbox.y0;
    const cy = (f.bbox.y0 + f.bbox.y1) / 2;
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.cy - cy) < h * 2) row.items.push(f);
    else rows.push({ cy, items: [f] });
  });
  if (rows.length < 4 || rows[0].items.length !== 1) return hints;
  if (!rows.slice(1, 4).every(r => r.items.length >= 2 && r.items.length <= 5)) return hints;
  const rowBands = rows.slice(0, 4).map((r, i) => ({ cy: r.cy, position: i + 1 }));
  return {
    get(f) {
      const h = f.bbox.y1 - f.bbox.y0;
      const cy = (f.bbox.y0 + f.bbox.y1) / 2;
      const band = rowBands.find(b => Math.abs(b.cy - cy) < h * 2);
      return band ? band.position : null;
    },
  };
}

/* ---------------------------------------------------------------------------
   Team detection from fixtures
--------------------------------------------------------------------------- */

// Under every name FPL prints that player's next fixture, e.g. "CRY (A)":
// the opponent's short code and whether the player's team is (H)ome or
// (A)way. Within one gameweek only one team plays away at Crystal Palace,
// so with the real fixture list each label tells us exactly which club the
// player is at — no shirt recognition needed. That separates players who
// share a name (two "Muñoz", two "Gomez") and lets a cut-off name
// ("B.Fernan...") be matched against just that club's squad.

// Finds fixture tokens ("CRY (A)", "MCI(H)") in OCR lines. Returns
// { oppId, home, bbox }: home is true when the player's team is at home.
function findFixtureTokens(lines, codeToId) {
  const tokens = [];
  lines.forEach(words => {
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const m = w.text.match(/^([A-Za-z]{3})\(?([HA])?\)?$/);
      if (!m) continue;
      const oppId = codeToId.get(m[1].toUpperCase());
      if (!oppId) continue;
      let venue = m[2];
      let bbox = w.bbox;
      if (!venue && words[i + 1]) {
        const v = words[i + 1].text.match(/^\(?([HA])\)?$/);
        if (v) { venue = v[1]; bbox = unionBox([w, words[i + 1]]); }
      }
      if (!venue) continue;
      tokens.push({ oppId, home: venue === 'H', bbox });
    }
  });
  return tokens;
}

// The team that plays `oppId` in `event`, at home if `home`, or null.
function teamForFixture(fixturesByTeam, event, oppId, home) {
  const theirs = (fixturesByTeam[oppId] || []).filter(f => f.event === event && f.isHome === !home);
  return theirs.length === 1 ? theirs[0].opponent : null;
}

// Works out which gameweek the screenshot's fixtures belong to (the one
// that explains the most of them) and resolves each token to a team id.
function resolveFixtureTeams(tokens, fixturesByTeam) {
  if (!tokens.length || !fixturesByTeam) return [];
  const events = new Set();
  Object.values(fixturesByTeam).forEach(list => list.forEach(f => events.add(f.event)));
  let bestEvent = null, bestCount = 0;
  [...events].sort((a, b) => a - b).forEach(event => {
    const count = tokens.filter(t => teamForFixture(fixturesByTeam, event, t.oppId, t.home)).length;
    if (count > bestCount) { bestCount = count; bestEvent = event; }
  });
  // Most fixtures on a real squad screen fit one gameweek; if they don't,
  // these probably aren't fixtures (or are misread) — don't guess teams.
  if (bestEvent === null || bestCount < Math.max(2, tokens.length * 0.5)) return [];
  return tokens
    .map(t => ({ ...t, teamId: teamForFixture(fixturesByTeam, bestEvent, t.oppId, t.home) }))
    .filter(t => t.teamId);
}

// The fixture token belonging to a name: directly under it (Pitch View)
// or further along the same row (List View).
function fixtureFor(nameBox, tokens) {
  const h = nameBox.y1 - nameBox.y0;
  const cx = (nameBox.x0 + nameBox.x1) / 2, cy = (nameBox.y0 + nameBox.y1) / 2;
  let best = null, bestDist = Infinity;
  tokens.forEach(t => {
    const tcx = (t.bbox.x0 + t.bbox.x1) / 2, tcy = (t.bbox.y0 + t.bbox.y1) / 2;
    const below = t.bbox.y0 >= cy && t.bbox.y0 - nameBox.y1 < h * 2.5
      && Math.abs(tcx - cx) < Math.max(nameBox.x1 - nameBox.x0, t.bbox.x1 - t.bbox.x0, h * 4);
    const sameRow = Math.abs(tcy - cy) < h && t.bbox.x0 >= nameBox.x1 - 2 && t.bbox.x0 - nameBox.x1 < h * 25;
    if (!below && !sameRow) return;
    const dist = Math.hypot(tcx - cx, tcy - cy);
    if (dist < bestDist) { bestDist = dist; best = t; }
  });
  return best;
}

const TEAM_MATCH_CONFIDENT = 0.75;

// Best player at `teamId` for a read name — a looser match than across
// the whole league, since a club has only ~30 players to choose from.
function bestTeamPlayer(text, teamPlayers) {
  const key = compactKey(text);
  if (key.length < 3) return null;
  const truncated = ELLIPSIS_RE.test(text);
  let best = null;
  teamPlayers.forEach(p => {
    [p.webName, p.secondName].forEach(name => {
      const nameKey = compactKey(name);
      if (!nameKey) return;
      let score;
      if (nameKey === key) score = 1;
      else if (truncated && key.length >= 4 && nameKey.startsWith(key)) score = 0.97;
      else score = 1 - levenshtein(key, nameKey) / Math.max(key.length, nameKey.length);
      if (!best || score > best.score) best = { player: p, score };
    });
  });
  return best && best.score >= 0.55 ? best : null;
}

// Name read from the lines just above a fixture token: the words sitting
// over it on the label (Pitch View) or before it on the row (List View).
function nameTextsFor(token, lines) {
  const h = token.bbox.y1 - token.bbox.y0;
  const tcx = (token.bbox.x0 + token.bbox.x1) / 2;
  const texts = [];
  lines.forEach(words => {
    const above = words.filter(w => {
      const wcx = (w.bbox.x0 + w.bbox.x1) / 2;
      return w.bbox.y1 <= token.bbox.y0 + h * 0.3 && token.bbox.y0 - w.bbox.y1 < h * 2
        && Math.abs(wcx - tcx) < (token.bbox.x1 - token.bbox.x0) * 1.5 + h * 3;
    });
    const before = words.filter(w => Math.abs((w.bbox.y0 + w.bbox.y1) / 2 - (token.bbox.y0 + token.bbox.y1) / 2) < h * 0.8
      && w.bbox.x1 <= token.bbox.x0 + 2 && token.bbox.x0 - w.bbox.x1 < h * 25);
    [above, before].forEach(group => {
      const named = group.filter(w => /\p{L}{2,}/u.test(w.text));
      if (named.length) texts.push({ text: named.map(w => w.text).join(' ').replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}.…]+$/u, ''), bbox: unionBox(named) });
    });
  });
  return texts;
}

// Pure text → squad step, separate from OCR so it can be tested directly.
// `nameLines` (default: all lines) are the ones player names are looked
// for in; prices and the bank figure can come from anywhere.
//
// `context` ({ teamsById, fixturesByTeam }, optional) enables team
// detection from the fixture printed under each name.
export function extractSquadFromOcrLines(lines, allPlayers, badges = [], nameLines = lines, context = {}) {
  const index = buildNameIndex(allPlayers);
  const prices = findPrices(lines);
  const found = [];
  nameLines.forEach(words => found.push(...findNamesInLine(words, index)));

  // Team detection: resolve every fixture token to the player's club.
  const codeToId = new Map(Object.values(context.teamsById || {}).map(t => [String(t.short_name).toUpperCase(), t.id]));
  const teamTokens = resolveFixtureTeams(findFixtureTokens(lines, codeToId), context.fixturesByTeam);
  const playersByTeam = new Map();
  allPlayers.forEach(p => {
    if (!playersByTeam.has(p.team)) playersByTeam.set(p.team, []);
    playersByTeam.get(p.team).push(p);
  });

  // Names read straight above (or beside) each fixture are matched within
  // that club only. This also catches names the league-wide search missed
  // or got wrong, and they take priority over league-wide guesses.
  teamTokens.forEach(t => {
    const teamPlayers = playersByTeam.get(t.teamId) || [];
    let best = null;
    nameTextsFor(t, nameLines).forEach(({ text, bbox }) => {
      const hit = bestTeamPlayer(text, teamPlayers);
      if (hit && (!best || hit.score > best.score)) best = { ...hit, text, bbox };
    });
    if (best) {
      const sameName = teamPlayers.filter(p => compactKey(p.webName) === compactKey(best.player.webName));
      // A clear match within the club outranks any league-wide guess for
      // the same spot; a weak one only competes on equal terms.
      const score = best.score >= TEAM_MATCH_CONFIDENT ? 1 + best.score : best.score;
      found.push({ text: best.text, bbox: best.bbox, score, players: sameName.length ? sameName : [best.player], teamId: t.teamId });
    }
  });

  const unique = dedupeByPlace(found);
  const hints = pitchRowPositions(unique);

  const detections = unique.map(f => {
    // Several players can share a printed name (two "Gomez"). The club
    // from the fixture underneath narrows it first; in Pitch View the row
    // says which position it is; any remaining tie goes to the priciest —
    // usually the one people actually own. The review screen still flags
    // a name it couldn't pin down and offers the others.
    let candidates = f.players;
    const token = f.teamId ? null : fixtureFor(f.bbox, teamTokens);
    const teamId = f.teamId || (token && token.teamId);
    if (teamId) {
      const atTeam = candidates.filter(p => p.team === teamId);
      if (atTeam.length) candidates = atTeam;
    }
    const hint = hints.get(f);
    const inPosition = hint ? candidates.filter(p => p.positionId === hint) : [];
    if (inPosition.length) candidates = inPosition;
    const player = [...candidates].sort((a, b) => b.price - a.price)[0];
    return { ...f, player, candidates, ambiguous: candidates.length > 1 };
  });

  const squad = trimToSquadShape(detections);
  squad.forEach(d => { d.price = nearestPrice(d, prices); });
  const { starters, bench } = splitStartersAndBench(squad);

  const clubOf = d => {
    const team = (context.teamsById || {})[d.player.team];
    return team ? team.short_name : null;
  };
  const toEntry = d => ({ id: d.player.id, ambiguous: d.ambiguous, name: d.text, club: clubOf(d), price_millions: d.price });
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
  const prepared = prepareCanvases(img);
  const { pageLines, labelLines } = await ocrWords(prepared.canvases, onProgress, prepared.labelBoxes, prepared.source);
  return [...pageLines, ...labelLines];
}

// A full pitch has 15 labels. With most of them found, text outside the
// labels has to match a name almost exactly, which keeps shirt sponsors
// ("CMC MARKETS" → "Markelo") and other screen text from being taken for
// players while still allowing a cleanly read name on a label we missed
// (a red "injured" label, say). Otherwise (List View, unusual screens)
// every line is treated alike.
const MIN_LABELS_FOR_LABEL_ONLY = 11;
const STRICT_NAME_SCORE = 0.9;
// ...and be a confidently read word of a few letters, not OCR noise that
// happens to spell a short surname ("mee" → Mee).
const STRICT_MIN_CONFIDENCE = 70;

function insideAnyBox(word, boxes) {
  const cx = (word.bbox.x0 + word.bbox.x1) / 2, cy = (word.bbox.y0 + word.bbox.y1) / 2;
  return boxes.some(b => cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1);
}

// Everything the browser has to produce from the image: the OCR'd text
// (whole page and per label), where the labels are, and the armband
// badges. Plain data, so it can be saved and replayed in tests.
export async function readScreenshotRaw(img, onProgress) {
  const prepared = prepareCanvases(img);
  const { pageLines, labelLines } = await ocrWords(prepared.canvases, onProgress, prepared.labelBoxes, prepared.source);
  const badges = findArmbandBadges(prepared.light, prepared.dark, prepared.width, prepared.height, [...pageLines, ...labelLines]);
  return { pageLines, labelLines, labelBoxes: prepared.labelBoxes, badges };
}

// The pure half: OCR output → squad. No DOM needed.
export function squadFromRaw(raw, allPlayers, context = {}) {
  const { pageLines, labelLines, labelBoxes: boxes, badges } = raw;
  const allLines = [...pageLines, ...labelLines];
  // With most labels found, text outside them (shirt sponsors, banners)
  // only counts as a name on a near-exact match; fuzzy matches must come
  // from inside a label.
  const strictOutside = boxes.length >= MIN_LABELS_FOR_LABEL_ONLY;
  const nameLines = allLines.map(line => line
    .filter(w => !strictOutside || insideAnyBox(w, boxes) || (w.confidence >= STRICT_MIN_CONFIDENCE && w.text.length >= 4))
    .map(w => ({ ...w, minScore: strictOutside && !insideAnyBox(w, boxes) ? STRICT_NAME_SCORE : undefined })))
    .filter(line => line.length);
  return extractSquadFromOcrLines(allLines, allPlayers, badges, nameLines, context);
}

export async function readSquadFromScreenshot(img, allPlayers, onProgress, context = {}) {
  return squadFromRaw(await readScreenshotRaw(img, onProgress), allPlayers, context);
}
