import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Bell, Bookmark, Check, ChevronRight, FileText, KeyRound, Link2, LogOut, Mail, MessageSquare, ShieldCheck, Trash2, X } from 'lucide-react';
import { TERMS_PATH } from '../lib/terms.js';
import { fetchFplJson } from '../lib/fplClient.js';
import { careerStats, rankChartPoints } from '../lib/career.js';
import { parseTeamId } from '../lib/teamIdInput.js';
import { useGoogleEnabled } from '../lib/googleEnabled.js';
import { GoogleMark } from '../components/GoogleMark.jsx';

/* ----------------------------------------------------------------------------
   PROFILE: the account's page. FPL career stats for a Team ID (theirs, or
   any saved one) and every account setting in one place.
---------------------------------------------------------------------------- */
const fmtInt = n => (n === null || n === undefined ? '–' : Number(n).toLocaleString('en-GB'));
const fmtMoney = n => (n === null || n === undefined ? '–' : `£${n.toFixed(1)}m`);
const memberSince = iso => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : null;
};

function StatTile({ label, value, sub }) {
  return (
    <div className="fpl-profile-stat">
      <div className="fpl-mono fpl-profile-stat-label">{label}</div>
      <div className="fpl-profile-stat-value">{value}</div>
      {sub && <div className="fpl-mono fpl-profile-stat-sub">{sub}</div>}
    </div>
  );
}

function SettingRow({ icon: Icon, title, detail, action, onAction, danger = false, href }) {
  const body = (
    <>
      <Icon size={18} aria-hidden="true" className="fpl-profile-row-icon" />
      <span className="fpl-profile-row-text">
        <span className="fpl-profile-row-title">{title}</span>
        {detail && <span className="fpl-mono fpl-profile-row-detail">{detail}</span>}
      </span>
      {action && <span className="fpl-mono fpl-profile-row-action">{action}</span>}
      {(href || onAction) && <ChevronRight size={16} aria-hidden="true" className="fpl-profile-row-chevron" />}
    </>
  );
  const className = `fpl-profile-row${danger ? ' is-danger' : ''}`;
  if (!href && !onAction) return <div className={`${className} is-static`}>{body}</div>;
  return href
    ? <a className={className} href={href}>{body}</a>
    : <button type="button" className={className} onClick={onAction}>{body}</button>;
}

const CHART_W = 600;
const CHART_H = 170;
const BARS_H = 52;

// Overall rank through the season (a line, best rank at the top) over each
// gameweek's points (bars), one gameweek picked at a time: by pointer, by
// tapping, or with the arrow keys once the chart has focus.
function RankChart({ rows }) {
  const [picked, setPicked] = useState(null);
  const boxRef = useRef(null);
  const pts = rankChartPoints(rows, { width: CHART_W, height: CHART_H, pad: 10 });
  if (pts.length < 2) return null;
  const i = picked === null || picked >= pts.length ? pts.length - 1 : picked;
  const cur = pts[i];
  const line = pts.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${CHART_H} L${pts[0].x.toFixed(1)},${CHART_H} Z`;
  const maxPts = Math.max(1, ...pts.map(p => p.points || 0));
  const best = pts.reduce((b, p) => (p.overallRank < b.overallRank ? p : b), pts[0]);
  const barW = Math.max(2, Math.min(18, (CHART_W - 20) / pts.length - 3));
  const pct = v => `${(v / CHART_W) * 100}%`;

  function pickAt(clientX) {
    const box = boxRef.current && boxRef.current.getBoundingClientRect();
    if (!box || !box.width) return;
    const x = ((clientX - box.left) / box.width) * CHART_W;
    let near = 0;
    pts.forEach((p, k) => { if (Math.abs(p.x - x) < Math.abs(pts[near].x - x)) near = k; });
    setPicked(near);
  }
  function onKey(e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); setPicked(Math.max(0, i - 1)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setPicked(Math.min(pts.length - 1, i + 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setPicked(0); }
    else if (e.key === 'End') { e.preventDefault(); setPicked(pts.length - 1); }
  }

  return (
    <div className="fpl-block fpl-rank-chart">
      <div className="fpl-rank-chart-head">
        <div>
          <div className="fpl-mono fpl-profile-stat-label">OVERALL RANK · GW{cur.gw}</div>
          <div className="fpl-rank-chart-value">
            {fmtInt(cur.overallRank)}
            {cur.rankChange ? (
              <span className={`fpl-rank-move ${cur.rankChange > 0 ? 'is-up' : 'is-down'}`}>
                {cur.rankChange > 0 ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
                <span className="fpl-sr-only">{cur.rankChange > 0 ? 'up' : 'down'} </span>{fmtInt(Math.abs(cur.rankChange))}
              </span>
            ) : null}
          </div>
        </div>
        <div className="fpl-rank-chart-side fpl-mono" aria-live="polite">
          <span><b>{cur.points}</b> pts{cur.hit ? ` (−${cur.hit})` : ''}</span>
          {cur.gwRank ? <span>GW rank {fmtInt(cur.gwRank)}</span> : null}
          {cur.chip ? <span className="fpl-rank-chip">{cur.chip}</span> : null}
        </div>
      </div>
      <div
        ref={boxRef}
        className="fpl-rank-chart-plot"
        role="slider"
        tabIndex={0}
        aria-label="Gameweek on the rank chart"
        aria-valuemin={pts[0].gw}
        aria-valuemax={pts[pts.length - 1].gw}
        aria-valuenow={cur.gw}
        aria-valuetext={`Gameweek ${cur.gw}: overall rank ${fmtInt(cur.overallRank)}, ${cur.points} points`}
        onKeyDown={onKey}
        onPointerMove={e => pickAt(e.clientX)}
        onPointerDown={e => pickAt(e.clientX)}
      >
        <div className="fpl-rank-line-wrap">
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" className="fpl-rank-line" aria-hidden="true">
          <defs>
            <linearGradient id="fpl-rank-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--blue)" stopOpacity="0.28" />
              <stop offset="100%" stopColor="var(--blue)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill="url(#fpl-rank-fill)" />
          <path d={line} fill="none" stroke="var(--blue)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <line x1={cur.x} x2={cur.x} y1="0" y2={CHART_H} stroke="rgba(255,255,255,0.28)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="fpl-rank-dot" style={{ left: pct(cur.x), top: `${(cur.y / CHART_H) * 100}%` }} aria-hidden="true" />
        <span className={`fpl-mono fpl-rank-best${best.x < CHART_W * 0.12 ? ' is-start' : best.x > CHART_W * 0.88 ? ' is-end' : ''}`} style={{ left: pct(best.x), top: `${(best.y / CHART_H) * 100}%` }} aria-hidden="true">Best {fmtInt(best.overallRank)}</span>
        </div>
        <svg viewBox={`0 0 ${CHART_W} ${BARS_H}`} preserveAspectRatio="none" className="fpl-rank-bars" aria-hidden="true">
          {pts.map((p, k) => {
            const h = Math.max(2, ((p.points || 0) / maxPts) * (BARS_H - 4));
            return <rect key={p.gw} x={p.x - barW / 2} y={BARS_H - h} width={barW} height={h} rx="2" className={k === i ? 'is-on' : p.chip ? 'is-chip' : ''} />;
          })}
        </svg>
        <div className="fpl-mono fpl-rank-axis" aria-hidden="true"><span>GW{pts[0].gw}</span><span>GW{pts[pts.length - 1].gw}</span></div>
      </div>
    </div>
  );
}

export function ProfileScreen({ session, notice = '', onDismissNotice, savedTeams = [], homeTeamId, onPickTeam, onOpenDialog, onMyTeams, onLogout }) {
  const googleEnabled = useGoogleEnabled();
  const teamIds = [...new Set([homeTeamId, session.digestTeamId, ...savedTeams.filter(t => t.type === 'teamId').map(t => t.teamId)].filter(Boolean).map(String))];
  const [teamId, setTeamId] = useState(teamIds[0] || '');
  const [typed, setTyped] = useState('');
  // The answer for one team; another team's (or none yet) reads as loading.
  const [loaded, setLoaded] = useState({ teamId: null, status: 'idle', data: null });
  const career = !teamId ? { status: 'idle', data: null } : loaded.teamId === teamId ? loaded : { status: 'loading', data: null };

  useEffect(() => {
    if (!teamId) return undefined;
    let live = true;
    Promise.all([fetchFplJson(`entry/${teamId}/`), fetchFplJson(`entry/${teamId}/history/`)])
      .then(([entry, history]) => { if (live) setLoaded({ teamId, status: 'ready', data: careerStats(history, entry) }); })
      .catch(() => { if (live) setLoaded({ teamId, status: 'error', data: null }); });
    return () => { live = false; };
  }, [teamId]);

  const c = career.data;
  const since = memberSince(session.createdAt);
  const initial = (session.username || '?').slice(0, 1).toUpperCase();

  function showTyped(e) {
    e.preventDefault();
    const id = typed.replace(/\D/g, '');
    if (!id) return;
    setTeamId(id);
    onPickTeam(id);
  }

  return (
    <div className="fpl-screen fpl-profile">
      {notice && (
        <div role="status" className="fpl-verify-bar" style={{ margin: 0 }}>
          <span>{notice}</span>
          <button type="button" className="fpl-verify-bar-x" aria-label="Dismiss" onClick={onDismissNotice}><X size={16} aria-hidden="true" /></button>
        </div>
      )}
      <section className="fpl-profile-hero" aria-label="Your account">
        <div className="fpl-profile-avatar" aria-hidden="true">{initial}</div>
        <div style={{ minWidth: 0 }}>
          <h1 className="fpl-display fpl-profile-name">{session.username}</h1>
          <div className="fpl-mono fpl-profile-meta">
            {since ? `Member since ${since}` : 'FPL Checker member'}
            {c && c.managerName ? ` · ${c.managerName}` : ''}
          </div>
          <div className="fpl-profile-badges">
            {session.google && <span className="fpl-profile-badge"><GoogleMark /> Google</span>}
            {session.email && session.emailVerified && <span className="fpl-profile-badge"><Check size={12} aria-hidden="true" /> Email confirmed</span>}
            {session.admin && <span className="fpl-profile-badge">Admin</span>}
          </div>
        </div>
      </section>

      <section aria-labelledby="career-title" className="fpl-profile-section fpl-profile-career">
        <div className="fpl-profile-section-head">
          <h2 id="career-title" className="fpl-display fpl-profile-h2">FPL career</h2>
          {teamIds.length > 1 && (
            <select className="fpl-input fpl-profile-team-select" aria-label="Team" value={teamId} onChange={e => { setTeamId(e.target.value); onPickTeam(e.target.value); }}>
              {teamIds.map(id => <option key={id} value={id}>Team {id}</option>)}
            </select>
          )}
        </div>

        {!teamId && (
          <form onSubmit={showTyped} className="fpl-block" style={{ padding: 14 }}>
            <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: 'var(--ink-dim)', lineHeight: 1.5 }}>Add your FPL Team ID to see every season you’ve played, your best rank and this season so far.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="fpl-input" style={{ flex: 1, minWidth: 0 }} inputMode="numeric" placeholder="e.g. 1234567" aria-label="FPL Team ID" value={typed} onChange={e => setTyped(parseTeamId(e.target.value))} />
              <button type="submit" className="fpl-btn fpl-btn-solid" disabled={!typed}>Show</button>
            </div>
          </form>
        )}

        {career.status === 'loading' && (
          <div className="fpl-profile-stats" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="fpl-profile-stat fpl-skel" />)}
          </div>
        )}
        {career.status === 'error' && (
          <div className="fpl-block" role="alert" style={{ padding: 14, fontSize: '0.85rem' }}>Couldn’t load that team from FPL just now. Check the Team ID, or try again in a minute.</div>
        )}

        {c && (
          <>
            {c.teamName && <div className="fpl-mono fpl-profile-team-name">{c.teamName}</div>}
            <div className="fpl-profile-stats">
              <StatTile label="SEASONS" value={fmtInt(c.seasons)} sub={c.top10kFinishes ? `${c.top10kFinishes} top-10k finish${c.top10kFinishes > 1 ? 'es' : ''}` : null} />
              <StatTile label="BEST FINISH" value={c.bestRank ? fmtInt(c.bestRank) : '–'} sub={c.bestRank ? 'overall rank' : 'no finished season yet'} />
              <StatTile label="BEST SEASON" value={c.bestSeason ? `${fmtInt(c.bestSeason.points)} pts` : '–'} sub={c.bestSeason ? c.bestSeason.season : null} />
              <StatTile label="AVG SEASON" value={c.averageSeasonPoints ? `${fmtInt(c.averageSeasonPoints)} pts` : '–'} />
              {c.thisSeason && (
                <>
                  <StatTile label="THIS SEASON" value={`${fmtInt(c.thisSeason.points)} pts`} sub={`${c.thisSeason.gameweeks} GWs · avg ${c.thisSeason.averageGw}`} />
                  <StatTile label="OVERALL RANK" value={fmtInt(c.thisSeason.overallRank)} />
                  <StatTile label="BEST GAMEWEEK" value={`${c.thisSeason.bestGw.points} pts`} sub={`GW${c.thisSeason.bestGw.gw}`} />
                  <StatTile label="TRANSFERS" value={fmtInt(c.thisSeason.transfers)} sub={c.thisSeason.hitPoints ? `−${c.thisSeason.hitPoints} pts in hits` : 'no hits taken'} />
                  <StatTile label="BENCH POINTS" value={fmtInt(c.thisSeason.benchPoints)} sub="left on the bench" />
                  <StatTile label="TEAM VALUE" value={fmtMoney(c.thisSeason.value)} sub={c.thisSeason.bank !== null ? `${fmtMoney(c.thisSeason.bank)} in the bank` : null} />
                </>
              )}
            </div>

            <RankChart rows={c.gwHistory || []} />

            {c.chips.length > 0 && (
              <div className="fpl-profile-chips" aria-label="Chips played this season">
                {c.chips.map(chip => <span key={`${chip.name}-${chip.gw}`} className="fpl-profile-chip">{chip.name} <span className="fpl-mono">GW{chip.gw}</span></span>)}
              </div>
            )}

            {c.past.length > 0 && (
              <div className="fpl-block fpl-profile-seasons">
                <div className="fpl-mono fpl-profile-seasons-head"><span>SEASON</span><span>POINTS</span><span>RANK</span></div>
                {c.past.map(s => (
                  <div key={s.season} className="fpl-profile-season">
                    <span>{s.season}</span>
                    <span className="fpl-mono">{fmtInt(s.points)}</span>
                    <span className="fpl-mono">{fmtInt(s.rank)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="settings-title" className="fpl-profile-section fpl-profile-settings">
        <h2 id="settings-title" className="fpl-display fpl-profile-h2">Settings</h2>
        <div className="fpl-block fpl-profile-rows">
          <SettingRow icon={Bookmark} title="Saved teams" detail={`${savedTeams.length} saved`} onAction={onMyTeams} />
          <SettingRow
            icon={Mail}
            title="Email"
            detail={session.email ? `${session.email}${session.emailVerified ? '' : ' · not confirmed'}` : 'None: needed for password resets and deadline emails'}
            action={session.email ? 'Change' : 'Add'}
            onAction={() => onOpenDialog('email')}
          />
          {session.email && !session.emailVerified && (
            <SettingRow icon={ShieldCheck} title="Confirm your email" detail="Enter the 6-digit code we emailed you" action="Enter code" onAction={() => onOpenDialog('verify')} />
          )}
          {session.hasPassword
            ? <SettingRow icon={KeyRound} title="Password" detail="Change it; other devices are signed out" action="Change" onAction={() => onOpenDialog('password')} />
            : <SettingRow icon={KeyRound} title="Backup login" detail="Add a username and password, in case you can’t use Google" action="Add" onAction={() => onOpenDialog('backup')} />}
          {googleEnabled && (
            session.google
              ? <SettingRow icon={Link2} title="Google" detail="Connected: you can sign in with Google" />
              : <SettingRow icon={Link2} title="Google" detail="Connect to sign in with one tap" action="Connect" href="/auth/google?link=1" />
          )}
          <SettingRow icon={Bell} title="Deadline emails" detail={session.digestTeamId ? `On for team ${session.digestTeamId}` : 'Off: turn on from your team’s page'} onAction={onMyTeams} />
          <SettingRow icon={MessageSquare} title="Send feedback" detail="Report a problem or suggest something" onAction={() => onOpenDialog('feedback')} />
          <SettingRow icon={FileText} title="Terms and privacy" href={TERMS_PATH} />
          <SettingRow icon={LogOut} title="Log out" onAction={onLogout} />
        </div>

        <div className="fpl-block fpl-profile-rows" style={{ marginTop: 14 }}>
          <SettingRow icon={Trash2} title="Delete account" detail="Removes your account and saved teams for good" danger onAction={() => onOpenDialog('delete')} />
        </div>
      </section>
    </div>
  );
}
