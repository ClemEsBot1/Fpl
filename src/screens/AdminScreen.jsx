// The admin page, only in the menu for admins (ADMIN_USERNAMES, see
// src/lib/adminServer.js). Every request goes through /api/auth, which
// checks the session belongs to an admin before doing anything.
import { useCallback, useEffect, useState } from 'react';
import { Activity, BrainCircuit, Camera, Check, ExternalLink, RefreshCw, Search, ShieldCheck, Trash2, Undo2, UserX, Users } from 'lucide-react';
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

function UsersTab({ me }) {
  const [stats, setStats] = useState(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(undefined);
  const [message, setMessage] = useState(null);
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

const TABS = [
  { id: 'health', label: 'Model and data', Icon: Activity },
  { id: 'reports', label: 'Screenshot reports', Icon: Camera },
  { id: 'users', label: 'Users', Icon: Users },
];

export function AdminScreen({ session }) {
  const [tab, setTab] = useState('health');
  return (
    <div className="fpl-tool">
      <header className="fpl-tool-head">
        <h1 className="fpl-tool-h"><ShieldCheck size={22} aria-hidden="true" /> Admin</h1>
        <p className="fpl-tool-sub">Signed in as {session.username}. Only admins see this page, and the server checks every request.</p>
      </header>
      <div className="fpl-seg" role="tablist" aria-label="Admin sections">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>
            <Icon size={14} aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      {tab === 'health' ? <Health /> : tab === 'reports' ? <Reports /> : <UsersTab me={session.username} />}
    </div>
  );
}
