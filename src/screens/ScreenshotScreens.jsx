// Screenshot import: upload form, review/confirm screen, squad price
// summary, and the opt-in "help improve the reader" report.
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Camera, CheckCircle2, ChevronDown, ChevronLeft, Info, ShieldAlert } from 'lucide-react';
import { PlayerSearchPicker } from '../components/common.jsx';
import { POSITION_LABELS, fmtPrice } from '../lib/format.js';
import { squadProblems } from '../lib/squadLogic.js';

// Loads the file through an object URL (a reference to the file, not a
// multi-megabyte base64 copy of it held in memory as a string).
export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file doesn't look like an image.")); };
    img.src = url;
  });
}

// The image stays at full resolution: small UI text is what OCR finds
// hardest, so we never downscale before reading it. `previewUrl` is the
// object URL behind it, released once the preview is no longer shown.
export async function prepareScreenshot(file) {
  const { img, url } = await loadImageFromFile(file);
  return { img, previewUrl: url };
}

export function ScreenshotForm({ onSubmit, onBack }) {
  const [shot, setShot] = useState(null);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);

  async function acceptFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('That isn\'t an image. Pick a screenshot (PNG or JPEG).'); return; }
    setError('');
    try {
      setShot(await prepareScreenshot(file));
    } catch (e) {
      setError(e.message || "Couldn't load that image.");
    }
  }

  // Release each preview's object URL once it's replaced or the form
  // closes. (The decoded image itself stays usable for reading.)
  useEffect(() => {
    if (!shot) return undefined;
    return () => URL.revokeObjectURL(shot.previewUrl);
  }, [shot]);

  // Start downloading the OCR engine now, while they pick a screenshot, so
  // reading it afterwards doesn't wait on a first-time download.
  useEffect(() => {
    import('../lib/screenshotOcr.js').then(m => m.warmUpOcr()).catch(() => {});
  }, []);

  // Lets people paste a screenshot straight from the clipboard (Ctrl/Cmd+V)
  // instead of saving it to a file first.
  useEffect(() => {
    function onPaste(e) {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          acceptFile(item.getAsFile());
          return;
        }
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  return (
    <div className="fpl-screen">
      <button onClick={onBack} className="fpl-mono fpl-back-btn">
        <ChevronLeft size={14} /> BACK
      </button>
      <h1 className="fpl-display fpl-screen-title">Upload a screenshot</h1>
      <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: 14, lineHeight: 1.5 }}>
        Screenshot your Pick Team or Points page in the FPL app (Pitch View or List View). Your screenshot is read on this device — it's never uploaded — then every player is matched to live FPL data and priced.
      </p>

      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { acceptFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
      <button
        type="button"
        className="fpl-block"
        onClick={() => fileInputRef.current && fileInputRef.current.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); acceptFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}
        style={{ width: '100%', padding: shot ? 8 : 28, marginBottom: 14, cursor: 'pointer', color: 'var(--ink)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, borderStyle: 'dashed', borderWidth: 2, borderColor: dragging ? 'var(--blue)' : 'var(--line)' }}
      >
        {shot ? (
          <>
            <img src={shot.previewUrl} alt="Your squad screenshot" style={{ maxWidth: '100%', maxHeight: 360, borderRadius: 4 }} />
            <span className="fpl-mono fpl-meta">Tap to choose a different screenshot</span>
          </>
        ) : (
          <>
            <Camera size={28} />
            <span className="fpl-display" style={{ fontWeight: 600 }}>Choose a screenshot</span>
            <span className="fpl-mono fpl-meta">or drag it here, or paste it with Ctrl/Cmd+V</span>
          </>
        )}
      </button>

      {error && <div className="fpl-availnote" style={{ marginBottom: 12 }}>{error}</div>}

      <button
        className="fpl-btn fpl-btn-solid"
        style={{ width: '100%', textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
        disabled={!shot}
        onClick={() => onSubmit(shot)}
      >
        Read my squad <ArrowRight size={16} />
      </button>
    </div>
  );
}

export function ReviewSlot({ slot, index, onFix, allPlayers, teamsById, onSetCaptain, onSetViceCaptain, onToggleStarting, takenIds }) {
  const [showSearch, setShowSearch] = useState(false);
  // A slot the person has fixed themselves is settled, whatever the reader's
  // confidence was.
  const needsReview = !slot.matched || (!slot.manuallyFixed && slot.top[0] && slot.top[0].score <= 0.72);
  const canArmband = !!slot.matched && slot.isStarting;
  // Everyone else already in the squad (picking them again would be a duplicate).
  const excludeIds = new Set([...takenIds].filter(id => !(slot.matched && id === slot.matched.id)));

  return (
    <div className="fpl-block" style={{ padding: 12, marginBottom: 8, borderLeft: needsReview ? '3px solid var(--amber)' : '3px solid var(--green)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--ink-dim)', fontFamily: "'IBM Plex Mono',monospace" }}>
            READ AS "{slot.extractedName}"
          </div>
          <div className="fpl-display" style={{ fontWeight: 600, fontSize: '0.95rem' }}>
            {slot.matched ? slot.matched.webName : <span style={{ color: 'var(--amber)' }}>Not matched</span>}
          </div>
          {slot.matched && (
            <div className="fpl-row-sub">
              {POSITION_LABELS[slot.matched.positionId]} · {teamsById[slot.matched.team] ? teamsById[slot.matched.team].short_name : '—'} · {fmtPrice(slot.matched.price)}
              {slot.extractedPrice != null && Math.abs(slot.extractedPrice - slot.matched.price) >= 0.05 && ` (screenshot ${fmtPrice(slot.extractedPrice)})`}
            </div>
          )}
        </div>
        {needsReview
          ? <ShieldAlert size={18} style={{ color: 'var(--amber)', flexShrink: 0 }} />
          : <CheckCircle2 size={18} style={{ color: 'var(--green)', flexShrink: 0 }} />}
      </div>

      {/* Captaincy is read from the screenshot's captain/vice_captain names
          when they matched cleanly, but that match can miss (typo, a name
          that reads ambiguously, etc.) with no other way to fix it — so
          these checkboxes let the person set/correct it directly, the same
          way tapping a player does on the live-squad screens. Disabled
          until the player itself is matched, since toggling captaincy on
          an unresolved slot wouldn't have anywhere to attach to. */}
      <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: canArmband ? 'var(--ink)' : 'var(--ink-dim)', cursor: canArmband ? 'pointer' : 'not-allowed' }}>
          <input
            type="checkbox"
            checked={!!slot.isCaptain}
            disabled={!canArmband}
            onChange={() => onSetCaptain(index)}
          />
          Captain
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: canArmband ? 'var(--ink)' : 'var(--ink-dim)', cursor: canArmband ? 'pointer' : 'not-allowed' }}>
          <input
            type="checkbox"
            checked={!!slot.isViceCaptain}
            disabled={!canArmband}
            onChange={() => onSetViceCaptain(index)}
          />
          Vice-captain
        </label>
        <button type="button" className="fpl-chip-btn" style={{ marginLeft: 'auto' }} onClick={() => onToggleStarting(index)}>
          {slot.isStarting ? 'Starting XI · move to bench' : 'Bench · move to XI'}
        </button>
      </div>

      {slot.top && slot.top.length > 0 && needsReview && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {slot.top.filter(t => t.score > 0.15).map((t, i) => (
            <button key={i} className={`fpl-chip-btn ${slot.matched && slot.matched.id === t.player.id ? 'active' : ''}`} onClick={() => onFix(index, t.player)}>
              {t.player.webName}
            </button>
          ))}
          <button className="fpl-chip-btn" onClick={() => setShowSearch(s => !s)}>Search…</button>
        </div>
      )}
      {!needsReview && (
        <button className="fpl-chip-btn" style={{ marginTop: 8 }} onClick={() => setShowSearch(s => !s)}>Not right? Fix it</button>
      )}
      {showSearch && <PlayerSearchPicker allPlayers={allPlayers} excludeIds={excludeIds} onPick={p => { onFix(index, p); setShowSearch(false); }} />}
    </div>
  );
}

// Prices come from live FPL data (now_cost) once each name is matched. The
// FPL app shows a selling price, which can be a little lower than the
// current price after a rise, so when the screenshot showed every player's
// price we total that too.
export function SquadPriceSummary({ slots, bank, onBankChange }) {
  const matched = slots.filter(s => s.matched);
  const squadCost = matched.reduce((sum, s) => sum + s.matched.price, 0);
  const allShown = matched.length > 0 && matched.every(s => s.extractedPrice != null);
  const sellingValue = allShown ? matched.reduce((sum, s) => sum + s.extractedPrice, 0) : null;
  const bankNum = bank != null && !Number.isNaN(bank) ? bank : 0;
  const row = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', padding: '4px 0' };
  return (
    <div className="fpl-block" style={{ padding: 12, marginBottom: 14 }}>
      <div className="fpl-mono" style={{ fontSize: '0.62rem', color: 'var(--ink-dim)', marginBottom: 6, letterSpacing: '0.03em' }}>SQUAD PRICES</div>
      <div style={row}>
        <span className="fpl-dim">{matched.length} matched players at current prices</span>
        <span className="fpl-mono">{fmtPrice(squadCost)}</span>
      </div>
      {sellingValue != null && Math.abs(sellingValue - squadCost) >= 0.05 && (
        <div style={row}>
          <span className="fpl-dim">Selling value shown in screenshot</span>
          <span className="fpl-mono">{fmtPrice(sellingValue)}</span>
        </div>
      )}
      <div style={row}>
        <label htmlFor="review-bank" className="fpl-dim">In the bank (£m)</label>
        <input
          id="review-bank"
          className="fpl-input"
          type="number"
          inputMode="decimal"
          step="0.1"
          min="0"
          value={bank == null ? '' : bank}
          placeholder="0.0"
          onChange={e => onBankChange(e.target.value === '' ? null : parseFloat(e.target.value))}
          style={{ width: 90, padding: '4px 8px', fontSize: '0.82rem', textAlign: 'right' }}
        />
      </div>
      <div style={{ ...row, borderTop: '1px solid var(--line)', marginTop: 4, paddingTop: 8, fontWeight: 600 }}>
        <span>Team value</span>
        <span className="fpl-mono">{fmtPrice((sellingValue != null ? sellingValue : squadCost) + bankNum)}</span>
      </div>
    </div>
  );
}

// Shrinks the screenshot to a JPEG for upload (kept large enough to
// re-run OCR on later).
export function screenshotToJpegBase64(img, maxSide = 1800) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return url.slice(url.indexOf(',') + 1);
}

// Opt-in: sends this screenshot and what we read from it to the site
// owner, so misreads can be turned into test cases and fixed.
export function ReportScreenshotPanel({ slots, shotImg }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | sent | error
  if (!shotImg) return null;

  async function send() {
    setState('sending');
    try {
      const r = await fetch('/api/screenshot-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: screenshotToJpegBase64(shotImg),
          note,
          userAgent: navigator.userAgent,
          slots: slots.map(s => ({
            read: s.extractedName,
            matchedId: s.matched ? s.matched.id : null,
            matchedName: s.matched ? s.matched.webName : '',
            corrected: !!s.manuallyFixed,
            isStarting: s.isStarting,
            isCaptain: !!s.isCaptain,
            isViceCaptain: !!s.isViceCaptain,
          })),
        }),
      });
      setState(r.ok ? 'sent' : 'error');
    } catch {
      setState('error');
    }
  }

  if (state === 'sent') {
    return <div className="fpl-mono" role="status" style={{ fontSize: '0.72rem', color: 'var(--green)', margin: '14px 0' }}>Thanks — screenshot sent. It'll be used to improve the reader.</div>;
  }
  return (
    <div className="fpl-block" style={{ padding: 12, margin: '14px 0' }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{ background: 'none', border: 'none', color: 'var(--ink)', padding: 0, cursor: 'pointer', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left' }}
      >
        <Info size={14} aria-hidden="true" /> Did we misread something? Help improve the reader
        <ChevronDown size={14} aria-hidden="true" style={{ marginLeft: 'auto', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <p style={{ color: 'var(--ink-dim)', fontSize: '0.78rem', lineHeight: 1.5, margin: '0 0 10px' }}>
            This sends your screenshot, the names we read, and any you corrected to the site's owner, so the reader can be fixed and tested against it. Nothing else is sent. Only send it if you're happy to share the screenshot.
          </p>
          <label htmlFor="report-note" className="fpl-mono" style={{ display: 'block', fontSize: '0.62rem', color: 'var(--ink-dim)', marginBottom: 4 }}>WHAT WENT WRONG? (OPTIONAL)</label>
          <textarea
            id="report-note"
            className="fpl-input"
            maxLength={500}
            value={note}
            onChange={e => setNote(e.target.value)}
            style={{ minHeight: 60, fontSize: '0.8rem', marginBottom: 10 }}
          />
          <button type="button" className="fpl-chip-btn" disabled={state === 'sending'} onClick={send}>
            {state === 'sending' ? 'Sending…' : 'Send screenshot'}
          </button>
          {state === 'error' && <span className="fpl-mono" role="alert" style={{ fontSize: '0.7rem', color: 'var(--red)', marginLeft: 10 }}>Couldn't send it. Try again later.</span>}
        </div>
      )}
    </div>
  );
}

export function ReviewScreen({ slots, allPlayers, teamsById, bank, onBankChange, onFix, onSetCaptain, onSetViceCaptain, onToggleStarting, onConfirm, onBack, shotImg }) {
  const unresolved = slots.filter(s => !s.matched).length;
  const matched = slots.filter(s => s.matched);
  const takenIds = new Set(matched.map(s => s.matched.id));
  // Anything that would make the squad unplayable (a player matched twice,
  // a forward in goal, 12 starters) has to be fixed before carrying on.
  const problems = squadProblems(matched.map(s => s.matched), matched.filter(s => s.isStarting).map(s => s.matched));
  return (
    <div style={{ padding: '20px 16px 100px' }}>
      <button onClick={onBack} className="fpl-mono fpl-back-btn">
        <ChevronLeft size={14} /> BACK
      </button>
      <h1 className="fpl-display fpl-screen-title">Confirm your squad</h1>
      <p style={{ color: 'var(--ink-dim)', fontSize: '0.85rem', marginBottom: 18, lineHeight: 1.5 }}>
        We read these names from your screenshot. Fix anything that's wrong before we crunch the numbers.
      </p>

      <SquadPriceSummary slots={slots} bank={bank} onBankChange={onBankChange} />

      {slots.map((slot, i) => (
        <ReviewSlot key={i} slot={slot} index={i} onFix={onFix} allPlayers={allPlayers} teamsById={teamsById} onSetCaptain={onSetCaptain} onSetViceCaptain={onSetViceCaptain} onToggleStarting={onToggleStarting} takenIds={takenIds} />
      ))}

      {problems.length > 0 && (
        <div role="alert" className="fpl-block" style={{ padding: 12, marginTop: 8, borderLeft: '3px solid var(--amber)', fontSize: '0.8rem', lineHeight: 1.5 }}>
          {problems.map(p => <div key={p}>{p}</div>)}
        </div>
      )}

      <button
        className="fpl-btn fpl-btn-solid"
        style={{ width: '100%', marginTop: 8, textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
        disabled={unresolved > 0 || problems.length > 0 || matched.length < 11}
        onClick={onConfirm}
      >
        {unresolved > 0 ? `Fix ${unresolved} more to continue`
          : problems.length > 0 ? 'Fix the squad to continue'
          : matched.length < 11 ? 'Fewer than 11 players read'
          : 'Looks good — show my results'} <ArrowRight size={16} />
      </button>

      <ReportScreenshotPanel slots={slots} shotImg={shotImg} />
    </div>
  );
}
