// The admin page, only in the menu for admins (ADMIN_USERNAMES, see
// src/lib/adminServer.js). Every request goes through /api/auth, which
// checks the session belongs to an admin before doing anything.
import { useCallback, useEffect, useState } from 'react';
import { Activity, BarChart3, BrainCircuit, Camera, Check, Copy, Download, ExternalLink, Megaphone, MessageSquare, RefreshCw, Scale, Search, ShieldCheck, Trash2, TriangleAlert, Undo2, UserX, Users } from 'lucide-react';
import { SkeletonRows } from '../components/common.jsx';
import { fmtPts } from '../lib/format.js';

async function adminCall(op, extra = {}) {
  try {
    const r = await fetch('/api/auth', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'admin', op, ...extra }),
    });
    const data = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, data, error: r.ok ? null : (data && data.error) || `Error ${r.status}` };
  } catch {
    return { ok: false, status: null, data: null, error: 'Network error — please try again.' };
  }
}

function ago(iso) {
  if (!iso) return null;
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

// Fresh within a day and a bit: green; older: amber; missing: red.
function Freshness({ label, at, note, now }) {
  const hours = at ? (now - Date.parse(at)) / 3600e3 : null;
  const tone = hours === null ? 'bad' : hours <= 26 ? 'good' : 'warn';
  return (
    <li className={`fpl-admin-fresh is-${tone}`}>
      <i aria-hidden="true" />
      <span>{label}</span>
      <span className="fpl-mono fpl-meta">{at ? ago(at) : 'missing'}{note ? ` · ${note}` : ''}</span>
    </li>
  );
}

function Health() {
  const [state, setState] = useState({ status: 'loading' });
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const load = useCallback(() => {
    adminCall('health').then(r => setState(r.ok ? { status: 'ready', data: r.data, now: Date.now() } : { status: 'error', error: r.error }));
  }, []);
  useEffect(() => { load(); }, [load]);
  const run = async (op, done) => {
    setBusy(op); setMessage(null);
    const r = await adminCall(op);
    setBusy(null);
    setMessage(r.ok && r.data && r.data.ok ? done : `Failed: ${(r.data && r.data.error) || r.error}`);
    if (r.ok) setTimeout(load, 1500);
  };
  if (state.status === 'loading') return <SkeletonRows rows={6} label="Loading model and data health…" />;
  if (state.status === 'error') return <p role="alert">{state.error}</p>;
  const d = state.data;
  const now = state.now;
  return (
    <div className="fpl-admin-grid">
      <section className="fpl-glass fpl-tool-card" aria-labelledby="adm-ml">
        <h2 id="adm-ml" className="fpl-home-h"><BrainCircuit size={18} aria-hidden="true" /> ML model</h2>
        {d.ml ? (
          <p className="fpl-home-text" style={{ margin: 0 }}>
            Predicting <b>GW{d.ml.gwId}</b> ({d.ml.season}) for {d.ml.players} players, trained on {Number(d.ml.trainedRows || 0).toLocaleString('en-GB')} rows. Last built <b>{ago(d.ml.builtAt)}</b>.
            {d.gameweek && d.ml.gwId !== d.gameweek ? <span className="fpl-admin-warn"> FPL is on GW{d.gameweek}: the predictions are out of date, so the app is using the formula.</span> : null}
          </p>
        ) : <p className="fpl-admin-warn" style={{ margin: 0 }}>No ML predictions deployed yet: the app is using the formula. Run the retraining workflow.</p>}
        {d.mlWeeks.length ? (
          <table className="fpl-admin-table">
            <thead><tr><th scope="col">Gameweek</th><th scope="col">Typical miss</th><th scope="col">Correlation</th><th scope="col">Players</th></tr></thead>
            <tbody>{d.mlWeeks.slice().reverse().map(w => (
              <tr key={`${w.season}-${w.gwId}`}><td>GW{w.gwId}</td><td className="fpl-mono">±{fmtPts(w.meanAbsError)}</td><td className="fpl-mono">{w.correlation.toFixed(2)}</td><td className="fpl-mono">{w.players}</td></tr>
            ))}</tbody>
          </table>
        ) : <p className="fpl-meta" style={{ margin: 0 }}>No finished gameweek scored yet.</p>}
        <div className="fpl-admin-actions">
          {d.retrain.canTrigger ? (
            <button type="button" className="fpl-btn fpl-btn-solid" disabled={!!busy} onClick={() => run('retrain', 'Retraining started on GitHub. New predictions deploy in about 5 minutes.')}>
              <RefreshCw size={15} aria-hidden="true" /> {busy === 'retrain' ? 'Starting…' : 'Retrain now'}
            </button>
          ) : null}
          <a className="fpl-btn" href={d.retrain.actionsUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} aria-hidden="true" /> Workflow on GitHub</a>
        </div>
        {!d.retrain.canTrigger ? (
          <p className="fpl-meta" style={{ margin: 0 }}>To retrain from here, add a <span className="fpl-mono">GITHUB_DISPATCH_TOKEN</span> in Vercel (a fine-grained GitHub token with Actions: read and write on the repo). Until then, use Run workflow on GitHub.</p>
        ) : null}
        {d.retrain.runs ? (
          <ul className="fpl-admin-runs">
            {d.retrain.runs.map(r => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noreferrer">{ago(r.createdAt)}</a>
                <span className={`fpl-mono is-${r.conclusion || r.status}`}>{r.conclusion || r.status}</span>
                <span className="fpl-meta">{r.event === 'schedule' ? 'daily' : r.event === 'workflow_dispatch' ? 'by hand' : r.event}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section className="fpl-glass fpl-tool-card" aria-labelledby="adm-data">
        <h2 id="adm-data" className="fpl-home-h"><Activity size={18} aria-hidden="true" /> Data the app reads</h2>
        <ul className="fpl-admin-freshlist">
          <Freshness now={now} label="ML predictions" at={d.ml && d.ml.builtAt} note="daily" />
          <Freshness now={now} label={`Best squad${d.gameweek ? ` (GW${d.gameweek})` : ''}`} at={d.data.bestSquad && d.data.bestSquad.uploadedAt} note="daily cron" />
          <Freshness now={now} label="Saved predictions for accuracy" at={d.data.savedPredictions && d.data.savedPredictions.uploadedAt} />
          <Freshness now={now} label="Bookmaker odds" at={d.data.odds && d.data.odds.uploadedAt} note="needs ODDS_API_KEY" />
          <Freshness now={now} label="Player history" at={d.data.playerHistory && d.data.playerHistory.uploadedAt} note="by hand, once a season" />
          <Freshness now={now} label="Transfer snapshots" at={d.data.transferSnapshots && d.data.transferSnapshots.latestAt} note={d.data.transferSnapshots ? `${d.data.transferSnapshots.count} kept` : 'every 20 min'} />
        </ul>
        <div className="fpl-admin-actions">
          <button type="button" className="fpl-btn" disabled={!!busy || !d.canRefresh} onClick={() => run('refresh', 'Best squad and saved predictions rebuilt.')}>
            <RefreshCw size={15} aria-hidden="true" /> {busy === 'refresh' ? 'Rebuilding…' : 'Refresh best squad now'}
          </button>
          <button type="button" className="fpl-btn" onClick={load} disabled={!!busy}>Reload</button>
        </div>
        {!d.canRefresh ? <p className="fpl-meta" style={{ margin: 0 }}>CRON_SECRET isn't set, so the best squad can't be rebuilt from here.</p> : null}
      </section>
      <section className="fpl-glass fpl-tool-card" aria-labelledby="adm-errors">
        <h2 id="adm-errors" className="fpl-home-h"><TriangleAlert size={18} aria-hidden="true" /> Recent server errors</h2>
        {d.errors && d.errors.length ? (
          <>
            <ul className="fpl-admin-errlist">
              {d.errors.map((e, i) => (
                <li key={i}>
                  <span className="fpl-admin-err-where">{e.where}</span>
                  <span className="fpl-admin-err-msg fpl-mono">{e.message}</span>
                  <span className="fpl-meta">{ago(e.at)}</span>
                </li>
              ))}
            </ul>
            <div className="fpl-admin-actions">
              <button type="button" className="fpl-btn" disabled={!!busy} onClick={() => run('clear_errors', 'Error log cleared.')}>
                <Trash2 size={15} aria-hidden="true" /> {busy === 'clear_errors' ? 'Clearing…' : 'Clear log'}
              </button>
            </div>
          </>
        ) : <p className="fpl-meta" style={{ margin: 0 }}>No errors logged. Storage failures in sign-in and saved teams show up here.</p>}
      </section>
      {message ? <p className="fpl-admin-msg" role="status">{message}</p> : null}
    </div>
  );
}

function Reports() {
  const [state, setState] = useState({ status: 'loading' });
  const [showDone, setShowDone] = useState(false);
  const load = useCallback(() => {
    adminCall('reports').then(r => setState(r.ok ? { status: 'ready', reports: r.data.reports } : { status: 'error', error: r.error }));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (state.status === 'loading') return <SkeletonRows rows={4} label="Loading screenshot reports…" />;
  if (state.status === 'error') return <p role="alert">{state.error}</p>;
  const update = (id, change) => setState(s => ({ ...s, reports: s.reports.map(r => (r.id === id ? { ...r, ...change } : r)).filter(r => !r.gone) }));
  const shown = state.reports.filter(r => showDone || !r.done);
  const open = state.reports.filter(r => !r.done).length;
  return (
    <div className="fpl-tool">
      <div className="fpl-tool-bar">
        <span className="fpl-meta">{open} to look at · {state.reports.length - open} done</span>
        <label className="fpl-admin-check"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> Show done</label>
      </div>
      {!shown.length ? <p className="fpl-tool-note">Nothing to look at.</p> : null}
      <ul className="fpl-admin-reports">
        {shown.map(r => {
          const slots = (r.report && r.report.slots) || [];
          const fixed = slots.filter(s => s.corrected);
          return (
            <li key={r.id} className={`fpl-glass fpl-admin-report${r.done ? ' is-done' : ''}`}>
              {r.imageUrl ? <a href={r.imageUrl} target="_blank" rel="noreferrer" className="fpl-admin-shot"><img src={r.imageUrl} alt="Screenshot sent with the report" loading="lazy" /></a> : <div className="fpl-admin-shot" />}
              <div className="fpl-admin-report-body">
                <span className="fpl-mono fpl-meta">{r.receivedAt ? new Date(r.receivedAt).toLocaleString('en-GB') : r.id}</span>
                {r.report && r.report.note ? <p style={{ margin: 0 }}>“{r.report.note}”</p> : null}
                <p className="fpl-meta" style={{ margin: 0 }}>{slots.length} players read · {fixed.length} corrected by the person</p>
                {fixed.length ? (
                  <ul className="fpl-admin-fixes">
                    {fixed.map((s, k) => <li key={k}><span className="fpl-mono">{s.read || '—'}</span> → <b>{s.matchedName || '?'}</b></li>)}
                  </ul>
                ) : null}
                <div className="fpl-admin-actions">
                  <button type="button" className="fpl-btn" onClick={async () => { const r2 = await adminCall('report_done', { id: r.id, done: !r.done }); if (r2.ok) update(r.id, { done: !r.done }); }}>
                    {r.done ? <><Undo2 size={15} aria-hidden="true" /> Not done</> : <><Check size={15} aria-hidden="true" /> Mark done</>}
                  </button>
                  <button type="button" className="fpl-btn fpl-btn-danger" onClick={async () => {
                    if (!window.confirm('Delete this screenshot and its details for good?')) return;
                    const r2 = await adminCall('report_delete', { urls: [r.imageUrl, r.jsonUrl].filter(Boolean) });
                    if (r2.ok) update(r.id, { gone: true });
                  }}><Trash2 size={15} aria-hidden="true" /> Delete</button>
                  {r.jsonUrl ? <a className="fpl-link" href={r.jsonUrl} target="_blank" rel="noreferrer">Raw details</a> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// The buttons under a post: Post to Bluesky (sent from the server), Post
// to both (Bluesky, then X's composer with the post filled in), Post on X
// and Copy. `payload` says which post: { text } or { key }.
const xIntent = text => `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
function PostActions({ text, payload, canBluesky, sentToBluesky = false, disabled = false, onSent, onX }) {
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [xLink, setXLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const toBluesky = async () => {
    const r = await adminCall('social_post', { ...payload, channels: ['bluesky'] });
    const result = r.data && r.data.results && r.data.results.bluesky;
    if (!r.ok || (r.data && r.data.error)) return { ok: false, message: `Bluesky failed: ${(r.data && r.data.error) || r.error}` };
    if (result && result.error) return { ok: false, message: `Bluesky failed: ${result.error}` };
    if (result && result.sent) { if (onSent) onSent(); return { ok: true, message: 'Posted to Bluesky.' }; }
    return { ok: true, message: 'Already on Bluesky, so it wasn’t posted again.' };
  };
  const send = async both => {
    setBusy(both ? 'both' : 'bluesky'); setMessage(null); setXLink(null);
    const result = await toBluesky();
    setBusy(null);
    if (!both) { setMessage(result.message); return; }
    // Opened after the Bluesky post, so a blocked pop-up falls back to a link.
    if (onX) onX();
    const tab = window.open(xIntent(text), '_blank');
    if (tab) { tab.opener = null; setMessage(`${result.message} X opened in a new tab: press Post there.`); }
    else { setMessage(`${result.message} Your browser blocked the X tab:`); setXLink(xIntent(text)); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); }
  };
  const off = disabled || !!busy;
  return (
    <>
      <div className="fpl-admin-actions">
        <button type="button" className="fpl-btn fpl-btn-solid" disabled={off || !canBluesky} onClick={() => send(true)}>
          {busy === 'both' ? 'Posting…' : 'Post to both'}
        </button>
        <button type="button" className="fpl-btn" disabled={off || !canBluesky || sentToBluesky} onClick={() => send(false)}>
          {busy === 'bluesky' ? 'Posting…' : sentToBluesky ? 'On Bluesky' : 'Post to Bluesky'}
        </button>
        <a className={`fpl-btn${disabled ? ' is-disabled' : ''}`} aria-disabled={disabled} href={xIntent(text)} target="_blank" rel="noreferrer" onClick={() => { if (!disabled && onX) onX(); }}><ExternalLink size={15} aria-hidden="true" /> Post on X</a>
        <button type="button" className="fpl-btn" disabled={disabled} onClick={copy}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {message ? <p className="fpl-admin-msg" role="status">{message}{xLink ? <> <a href={xLink} target="_blank" rel="noreferrer">Open the X draft</a></> : null}</p> : null}
    </>
  );
}

// A one-off post, written here.
const xLength = text => [...text.replace(/https?:\/\/\S+/g, 'x'.repeat(23))].length;
function Compose({ channels }) {
  const [text, setText] = useState('');
  const clean = text.trim();
  const length = xLength(clean);
  return (
    <section className="fpl-glass fpl-tool-card" aria-labelledby="adm-compose">
      <h2 id="adm-compose" className="fpl-home-h"><Megaphone size={18} aria-hidden="true" /> Write a post</h2>
      <label className="fpl-meta" htmlFor="adm-compose-text">Links count as 23 characters on X.</label>
      <textarea id="adm-compose-text" className="fpl-admin-compose" rows={4} value={text} onChange={e => setText(e.target.value)} placeholder="Check out https://fplchecker.co.uk … #FPL" />
      <span className={`fpl-mono fpl-meta${length > 280 ? ' fpl-admin-warn' : ''}`}>{length}/280</span>
      <PostActions text={clean} payload={{ text: clean }} canBluesky={channels.includes('bluesky')} disabled={!clean || length > 280} />
    </section>
  );
}

// This gameweek's posts as they'd read now (src/lib/social.js). Bluesky
// gets each by itself when it's due, or now from here; X ones are posted
// from here or the email, and ticked off here (by opening X, or the box).
const doneText = (bluesky, x) => (bluesky && x ? 'Done on both' : x ? 'Done on X' : bluesky ? 'Done on Bluesky' : null);
function Social() {
  const [state, setState] = useState({ status: 'loading' });
  const [posted, setPosted] = useState({});
  const [onX, setOnX] = useState({});
  const markX = (key, done) => {
    setOnX(p => ({ ...p, [key]: done }));
    adminCall('social_x_done', { key, done }).then(r => { if (!r.ok) setOnX(p => ({ ...p, [key]: !done })); });
  };
  useEffect(() => {
    adminCall('social').then(r => setState(r.ok && r.data && r.data.ok ? { status: 'ready', data: r.data } : { status: 'error', error: (r.data && r.data.error) || r.error }));
  }, []);
  if (state.status === 'loading') return <SkeletonRows rows={4} label="Loading this week’s posts…" />;
  if (state.status === 'error') return <p role="alert">{state.error === 'not_configured' ? 'CRON_SECRET isn’t set, so the posts can’t be built.' : state.error}</p>;
  const { channels, posts } = state.data;
  return (
    <div className="fpl-admin-grid">
      <Compose channels={channels} />
      <section className="fpl-glass fpl-tool-card" aria-labelledby="adm-social">
        <h2 id="adm-social" className="fpl-home-h"><Megaphone size={18} aria-hidden="true" /> Posts this gameweek</h2>
        <p className="fpl-meta" style={{ margin: 0 }}>
          Bluesky: {channels.includes('bluesky') ? 'posts by itself when each is due, or now with the buttons.' : 'off (set BLUESKY_HANDLE and BLUESKY_APP_PASSWORD).'}{' '}
          X drafts by email: {channels.includes('x-draft') ? 'on.' : 'off (set SOCIAL_DRAFTS_EMAIL and SMTP_*).'}
        </p>
        {posts.length ? posts.map(post => {
          const onBluesky = !!posted[post.key] || (post.sent || []).includes('bluesky');
          const xDone = post.key in onX ? onX[post.key] : (post.sent || []).includes('x');
          const done = doneText(onBluesky, xDone);
          return (
            <article key={post.key} className={`fpl-admin-post${onBluesky && xDone ? ' is-done' : ''}`}>
              <h3 className="fpl-admin-post-h">
                {post.label}
                {post.due ? <span className="fpl-admin-due">Due now</span> : null}
                {done ? <span className="fpl-admin-sent"><Check size={12} aria-hidden="true" /> {done}</span> : null}
                <label className="fpl-admin-xdone">
                  <input type="checkbox" checked={xDone} onChange={e => markX(post.key, e.target.checked)} /> Done on X
                </label>
              </h3>
              <p className="fpl-admin-post-text">{post.text}</p>
              {post.type === 'preview' ? <p className="fpl-meta" style={{ margin: 0 }}>Bluesky gets the best XI picture with it. For X, <a href="/images/best-xi.png" download="best-xi.png" target="_blank" rel="noreferrer">download the picture</a> and add it to the post.</p> : null}
              <PostActions text={post.text} payload={{ key: post.key }} canBluesky={channels.includes('bluesky')} sentToBluesky={onBluesky}
                onSent={() => setPosted(p => ({ ...p, [post.key]: true }))} onX={() => markX(post.key, true)} />
            </article>
          );
        }) : <p className="fpl-meta" style={{ margin: 0 }}>No posts yet: they need this gameweek’s saved predictions.</p>}
      </section>
    </div>
  );
}

function UsersTab({ me }) {
  const [stats, setStats] = useState(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(undefined);
  const [message, setMessage] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState(null);
  const download = async () => {
    setExporting(true);
    setExportMsg(null);
    const r = await adminCall('export_users');
    setExporting(false);
    if (!r.ok || !r.data || typeof r.data.csv !== 'string') { setExportMsg(r.error || 'Couldn’t make the spreadsheet.'); return; }
    // The byte-order mark makes Excel read the file as UTF-8.
    const url = URL.createObjectURL(new Blob(['\uFEFF', r.data.csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `fpl-checker-users-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportMsg(`Downloaded ${r.data.count} account${r.data.count === 1 ? '' : 's'}.`);
  };
  useEffect(() => { adminCall('users').then(r => setStats(r.ok ? r.data : { error: r.error })); }, []);
  const search = async e => {
    e.preventDefault();
    setMessage(null);
    const r = await adminCall('find_user', { query });
    setFound(r.ok ? r.data.user : null);
  };
  const most = stats && stats.signupsByWeek ? Math.max(1, ...stats.signupsByWeek.map(w => w.count)) : 1;
  return (
    <div className="fpl-admin-grid">
      <section className="fpl-glass fpl-tool-card" aria-labelledby="adm-users">
        <h2 id="adm-users" className="fpl-home-h"><Users size={18} aria-hidden="true" /> Accounts</h2>
        {!stats ? <SkeletonRows rows={3} label="Counting accounts…" /> : stats.error ? <p role="alert">{stats.error}</p> : (
          <>
            <div className="fpl-home-facts">
              <div><b>{stats.total}</b><span>accounts</span></div>
              <div><b>{stats.withSavedTeam}</b><span>with a saved team</span></div>
              <div><b>{stats.withEmail}</b><span>with an email</span></div>
            </div>
            <h3 className="fpl-home-sub">Sign-ups, last 8 weeks</h3>
            <ol className="fpl-admin-weeks">
              {stats.signupsByWeek.map(w => (
                <li key={w.weeksAgo} title={`${w.count} sign-ups`}>
                  <i style={{ height: `${(w.count / most) * 100}%` }} />
                  <span className="fpl-mono">{w.count}</span>
                  <small>{w.weeksAgo === 0 ? 'this wk' : `${w.weeksAgo}w`}</small>
                </li>
              ))}
            </ol>
            {stats.undated ? <p className="fpl-meta" style={{ margin: 0 }}>{stats.undated} older accounts have no sign-up date (dates are recorded from now on).</p> : null}
            <div className="fpl-admin-actions">
              <button type="button" className="fpl-btn" onClick={download} disabled={exporting} aria-busy={exporting}>
                <Download size={15} aria-hidden="true" /> {exporting ? 'Preparing…' : 'Download spreadsheet'}
              </button>
            </div>
            <p className="fpl-meta" style={{ margin: 0 }}>Every account with its email, saved teams, deadline email and join date, as a CSV for Excel or Google Sheets. It holds personal data: keep it private.</p>
            {exportMsg ? <p className="fpl-admin-msg" role="status">{exportMsg}</p> : null}
          </>
        )}
      </section>
      <section className="fpl-glass fpl-tool-card" aria-labelledby="adm-find">
        <h2 id="adm-find" className="fpl-home-h"><Search size={18} aria-hidden="true" /> Find an account</h2>
        <form className="fpl-home-tid" onSubmit={search}>
          <input className="fpl-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Username or email" aria-label="Username or email" />
          <button type="submit" className="fpl-btn fpl-btn-solid" disabled={!query.trim()}>Find</button>
        </form>
        {found === null ? <p className="fpl-meta" style={{ margin: 0 }}>No account found.</p> : null}
        {found ? (
          <div className="fpl-admin-user">
            <p style={{ margin: 0 }}><b>{found.username}</b>{found.admin ? <span className="fpl-admin-badge">admin</span> : null}</p>
            <p className="fpl-meta" style={{ margin: 0 }}>
              {found.email || 'No email'} · {found.savedTeams} saved team{found.savedTeams === 1 ? '' : 's'} · {found.createdAt ? `joined ${new Date(found.createdAt).toLocaleDateString('en-GB')}` : 'joined before dates were kept'}
            </p>
            <div className="fpl-admin-actions">
              <button type="button" className="fpl-btn" onClick={async () => {
                const r = await adminCall('sign_out_user', { username: found.username });
                setMessage(r.ok ? `${found.username} is signed out on every device.` : r.error);
              }}><UserX size={15} aria-hidden="true" /> Sign out everywhere</button>
              {found.username.toLowerCase() !== me.toLowerCase() ? (
                <button type="button" className="fpl-btn fpl-btn-danger" onClick={async () => {
                  const typed = window.prompt(`Type ${found.username} to delete this account and its saved teams for good.`);
                  if (typed !== found.username) return;
                  const r = await adminCall('delete_user', { username: found.username });
                  if (r.ok && r.data.ok) { setMessage(`${found.username} was deleted.`); setFound(undefined); } else setMessage(r.error || 'Not deleted.');
                }}><Trash2 size={15} aria-hidden="true" /> Delete account</button>
              ) : null}
            </div>
          </div>
        ) : null}
        {message ? <p className="fpl-admin-msg" role="status">{message}</p> : null}
        <p className="fpl-meta" style={{ margin: 0 }}>Passwords are stored scrambled, so nobody can read them, admins included.</p>
      </section>
    </div>
  );
}

// What people use (src/lib/usage.js) and what they've written in.
function Insights() {
  const [usage, setUsage] = useState(null);
  const [feedback, setFeedback] = useState(null);
  useEffect(() => {
    adminCall('usage').then(r => setUsage(r.ok ? r.data : { error: r.error }));
    adminCall('feedback').then(r => setFeedback(r.ok ? r.data.feedback : { error: r.error }));
  }, []);
  const shownDays = 7;
  return (
    <div className="fpl-admin-grid">
      <section className="fpl-glass fpl-tool-card" aria-labelledby="adm-usage">
        <h2 id="adm-usage" className="fpl-home-h"><BarChart3 size={18} aria-hidden="true" /> What people use</h2>
        {!usage ? <SkeletonRows rows={5} label="Counting…" /> : usage.error ? <p role="alert">{usage.error}</p> : (
          <div className="fpl-admin-usage-wrap">
            <table className="fpl-admin-usage">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  {usage.days.slice(0, shownDays).map((d, i) => <th key={d} scope="col" className="fpl-mono">{i === 0 ? 'Today' : d.slice(5)}</th>)}
                  <th scope="col">14 days</th>
                </tr>
              </thead>
              <tbody>
                {usage.rows.map(row => (
                  <tr key={row.name}>
                    <th scope="row">{row.label}</th>
                    {row.counts.slice(0, shownDays).map((n, i) => <td key={i} className="fpl-mono">{n || '·'}</td>)}
                    <td className="fpl-mono"><b>{row.total}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="fpl-meta" style={{ margin: '8px 0 0' }}>Counted from today on: no cookies, nothing personal. Sign-ups and logins are counted on the server.</p>
          </div>
        )}
      </section>
      <section className="fpl-glass fpl-tool-card" aria-labelledby="adm-feedback">
        <h2 id="adm-feedback" className="fpl-home-h"><MessageSquare size={18} aria-hidden="true" /> Feedback</h2>
        {!feedback ? <SkeletonRows rows={3} label="Loading feedback…" /> : feedback.error ? <p role="alert">{feedback.error}</p> : !feedback.length ? <p className="fpl-tool-note">No feedback yet.</p> : (
          <>
            <ul className="fpl-admin-feedback">
              {feedback.map((f, i) => (
                <li key={`${f.at}-${i}`}>
                  <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{f.text}</p>
                  <span className="fpl-mono fpl-meta">
                    {new Date(f.at).toLocaleString('en-GB')}{f.username ? ` · ${f.username}` : ''}{f.page ? ` · on ${f.page}` : ''}
                    {f.email ? <> · <a className="fpl-link" href={`mailto:${f.email}`}>{f.email}</a></> : null}
                  </span>
                </li>
              ))}
            </ul>
            <button type="button" className="fpl-btn fpl-btn-danger" style={{ marginTop: 10 }} onClick={async () => {
              if (!window.confirm('Delete all feedback?')) return;
              if ((await adminCall('feedback_clear')).ok) setFeedback([]);
            }}><Trash2 size={15} aria-hidden="true" /> Clear all</button>
          </>
        )}
      </section>
    </div>
  );
}

// The measures the head-to-head compares, and which way is better.
const H2H_MEASURES = [
  { key: 'meanAbsError', label: 'Typical miss', fmt: v => `±${fmtPts(v)}`, better: 'low' },
  { key: 'correlation', label: 'Correlation', fmt: v => v.toFixed(2), better: 'high' },
  { key: 'topTenAverageActual', label: 'Top 10 picks scored', fmt: v => fmtPts(v), better: 'high' },
  { key: 'xiPoints', label: 'Best XI scored', fmt: v => String(v), better: 'high' },
];
const h2hWinner = (m, f, ml) => (f === ml ? null : (m.better === 'low' ? ml < f : ml > f) ? 'ml' : 'formula');

// Formula v ML model on the gameweeks that have finished: each one's
// predictions from before the deadline, scored on what players got.
function HeadToHead() {
  const [state, setState] = useState({ status: 'loading' });
  useEffect(() => {
    adminCall('head_to_head').then(r => setState(r.ok && r.data && !r.data.error ? { status: 'ready', data: r.data } : { status: 'error', error: (r.data && r.data.error) || r.error }));
  }, []);
  if (state.status === 'loading') return <SkeletonRows rows={6} label="Scoring both models on finished gameweeks…" />;
  if (state.status === 'error') return <p role="alert">{state.error === 'fpl_unavailable' ? 'FPL isn’t answering right now. Try again in a minute.' : state.error}</p>;
  const scored = state.data.weeks.filter(w => w.formula && w.ml).slice().reverse();
  const missing = state.data.weeks.filter(w => !(w.formula && w.ml));
  const tally = H2H_MEASURES.map(m => {
    const wins = { formula: 0, ml: 0 };
    let f = 0, ml = 0;
    scored.forEach(w => { const who = h2hWinner(m, w.formula[m.key], w.ml[m.key]); if (who) wins[who] += 1; f += w.formula[m.key]; ml += w.ml[m.key]; });
    return { m, wins, f: scored.length ? f / scored.length : null, ml: scored.length ? ml / scored.length : null };
  });
  return (
    <section className="fpl-glass fpl-tool-card" aria-labelledby="adm-h2h">
      <h2 id="adm-h2h" className="fpl-home-h"><Scale size={18} aria-hidden="true" /> Formula v ML model</h2>
      <p className="fpl-home-text" style={{ margin: 0 }}>
        Each model's predictions from before the deadline, against what players scored. The miss, correlation and top 10 count players who played; the best XI is the £100m squad each would have picked (at today's prices), captain doubled.
      </p>
      {scored.length ? (
        <>
          <div className="fpl-h2h-scroll">
            <table className="fpl-admin-table fpl-h2h">
              <thead>
                <tr><th scope="col" rowSpan={2}>Gameweek</th>{H2H_MEASURES.map(m => <th key={m.key} scope="colgroup" colSpan={2}>{m.label}</th>)}</tr>
                <tr>{H2H_MEASURES.map(m => [<th key={`${m.key}-f`} scope="col">Formula</th>, <th key={`${m.key}-m`} scope="col">ML</th>])}</tr>
              </thead>
              <tbody>
                {scored.map(w => (
                  <tr key={w.gwId}>
                    <th scope="row">GW{w.gwId}</th>
                    {H2H_MEASURES.map(m => {
                      const who = h2hWinner(m, w.formula[m.key], w.ml[m.key]);
                      return [
                        <td key={`${m.key}-f`} className={`fpl-mono${who === 'formula' ? ' is-win' : ''}`}>{m.fmt(w.formula[m.key])}</td>,
                        <td key={`${m.key}-m`} className={`fpl-mono${who === 'ml' ? ' is-win' : ''}`}>{m.fmt(w.ml[m.key])}</td>,
                      ];
                    })}
                  </tr>
                ))}
              </tbody>
              {scored.length > 1 ? (
                <tfoot>
                  <tr>
                    <th scope="row">Average</th>
                    {tally.map(({ m, f, ml }) => {
                      const who = h2hWinner(m, Math.round(f * 100), Math.round(ml * 100));
                      return [
                        <td key={`${m.key}-f`} className={`fpl-mono${who === 'formula' ? ' is-win' : ''}`}>{m.fmt(m.key === 'xiPoints' ? Math.round(f) : Math.round(f * 100) / 100)}</td>,
                        <td key={`${m.key}-m`} className={`fpl-mono${who === 'ml' ? ' is-win' : ''}`}>{m.fmt(m.key === 'xiPoints' ? Math.round(ml) : Math.round(ml * 100) / 100)}</td>,
                      ];
                    })}
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
          <ul className="fpl-h2h-tally">
            {tally.map(({ m, wins }) => (
              <li key={m.key}><span>{m.label}</span><span className="fpl-mono">Formula {wins.formula} · ML {wins.ml}</span></li>
            ))}
          </ul>
        </>
      ) : <p className="fpl-meta" style={{ margin: 0 }}>No finished gameweek has predictions saved from both models yet.</p>}
      {missing.length ? (
        <p className="fpl-meta" style={{ margin: 0 }}>
          Not compared: {missing.map(w => `GW${w.gwId} (no ${w.missing.map(x => (x === 'ml' ? 'ML file' : x === 'formula' ? 'saved formula predictions' : 'FPL points')).join(' or ')})`).join(', ')}.
        </p>
      ) : null}
    </section>
  );
}

const TABS = [
  { id: 'health', label: 'Model and data', Icon: Activity },
  { id: 'insights', label: 'Usage and feedback', Icon: BarChart3 },
  { id: 'reports', label: 'Screenshot reports', Icon: Camera },
  { id: 'users', label: 'Users', Icon: Users },
  { id: 'social', label: 'Social', Icon: Megaphone },
  { id: 'h2h', label: 'Formula v ML', Icon: Scale },
];

export function AdminScreen({ session }) {
  const [tab, setTab] = useState('health');
  return (
    <div className="fpl-tool">
      <header className="fpl-tool-head">
        <h1 className="fpl-tool-h"><ShieldCheck size={22} aria-hidden="true" /> Admin</h1>
        <p className="fpl-tool-sub">Signed in as {session.username}. Only admins see this page, and the server checks every request.</p>
      </header>
      <div className="fpl-seg fpl-admin-tabs" role="tablist" aria-label="Admin sections">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>
            <Icon size={14} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      {tab === 'health' ? <Health /> : tab === 'insights' ? <Insights /> : tab === 'reports' ? <Reports /> : tab === 'social' ? <Social /> : tab === 'h2h' ? <HeadToHead /> : <UsersTab me={session.username} />}
    </div>
  );
}
