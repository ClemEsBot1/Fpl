import { useEffect, useState } from 'react';
import { Bell, Bookmark, Check, ChevronRight, FileText, KeyRound, Link2, LogOut, Mail, MessageSquare, ShieldCheck, Trash2, X } from 'lucide-react';
import { TERMS_PATH } from '../lib/terms.js';
import { fetchFplJson } from '../lib/fplClient.js';
import { careerStats } from '../lib/career.js';
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

      <section aria-labelledby="career-title" className="fpl-profile-section">
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

      <section aria-labelledby="settings-title" className="fpl-profile-section">
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
