import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Bell, Bookmark, Check, ChevronRight, Cookie, FileText, KeyRound, Languages, Link2, LogOut, Mail, MessageSquare, SunMoon, ShieldCheck, Trash2, X } from 'lucide-react';
import { TERMS_PATH } from '../lib/terms.js';
import { fetchFplJson } from '../lib/fplClient.js';
import { careerStats, rankChartPoints, valueChartPoints } from '../lib/career.js';
import { rankProjection } from '../lib/rankProjection.js';
import { parseTeamId } from '../lib/teamIdInput.js';
import { useGoogleEnabled } from '../lib/googleEnabled.js';
import { GoogleMark } from '../components/GoogleMark.jsx';
import { LANGUAGES, currentLanguage, fmtDate, fmtNumber, t } from '../lib/i18n.js';
import { chooseLanguage } from '../lib/i18nLoad.js';
import { chooseTheme, readTheme } from '../lib/theme.js';
import { analyticsAllowed, onConsentChange, readConsent, writeConsent } from '../lib/consent.js';

/* ----------------------------------------------------------------------------
   PROFILE: the account's page. FPL career stats for a Team ID (theirs, or
   any saved one) and every account setting in one place.
---------------------------------------------------------------------------- */
const fmtInt = n => (n === null || n === undefined ? '–' : fmtNumber(Number(n)));
const fmtMoney = n => (n === null || n === undefined ? '–' : `£${n.toFixed(1)}m`);
const memberSince = iso => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? fmtDate(d, { month: 'long', year: 'numeric' }) : null;
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

// Where the overall rank would end up at the pace so far (src/lib/rankProjection.js).
const compactRank = n => fmtNumber(n, { notation: 'compact', maximumSignificantDigits: 2 });
function SeasonEnd({ p }) {
  const pace = Math.abs(p.pace).toFixed(1);
  return (
    <div className="fpl-block fpl-profile-proj">
      <div className="fpl-mono fpl-profile-stat-label">{t('Season end, at your pace')}</div>
      <p className="fpl-profile-proj-main">
        <b className="fpl-mono">{t('about {rank}', { rank: compactRank(p.rank) })}</b>
        <span className="fpl-mono">{t('likely {best} to {worst}', { best: compactRank(p.best), worst: compactRank(p.worst) })}</span>
      </p>
      <p className="fpl-home-hint">
        {p.pace > 0 ? t("You've scored {n} pts a week more than the average manager.", { n: pace })
          : p.pace < 0 ? t("You've scored {n} pts a week less than the average manager.", { n: pace })
            : t("You've scored the same as the average manager.")}
        {' '}{t('Keep that up for the {n} gameweeks left and your overall rank would end around here; a good or bad run moves it within the range. A rough guide, not a forecast.', { n: p.weeksLeft })}
      </p>
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

// Visit counts and page-speed measurement (src/lib/consent.js), on or off.
// byDefault: on without a saved choice (the app, outside the EU).
function CookieRow({ byDefault }) {
  const [consent, setConsent] = useState(readConsent);
  useEffect(() => onConsentChange(setConsent), []);
  const on = analyticsAllowed(consent, byDefault);
  return (
    <SettingRow icon={Cookie} title={t('Visit counts and page speed')} detail={on ? t('On: counted with Vercel Analytics, which doesn’t identify you') : t('Off: only the login cookie is used')}
      action={on ? t('Turn off') : t('Turn on')} onAction={() => writeConsent(!on)} />
  );
}

// Light, dark or as the device is set (src/lib/theme.js).
function ThemeRow() {
  const [choice, setChoice] = useState(readTheme);
  const pick = c => { chooseTheme(c); setChoice(c); };
  const labels = { system: t('Device'), light: t('Light'), dark: t('Dark') };
  return (
    <div className="fpl-profile-row is-static">
      <SunMoon size={18} aria-hidden="true" className="fpl-profile-row-icon" />
      <span className="fpl-profile-row-text">
        <span className="fpl-profile-row-title" id="theme-h">{t('Theme')}</span>
      </span>
      <div className="fpl-seg" role="group" aria-labelledby="theme-h">
        {Object.entries(labels).map(([c, label]) => (
          <button key={c} type="button" className={choice === c ? 'is-on' : ''} aria-pressed={choice === c} onClick={() => pick(c)}>{label}</button>
        ))}
      </div>
    </div>
  );
}

// The app's language: picking one saves it and reloads the page in it.
function LanguageRow() {
  return (
    <label className="fpl-profile-row is-static">
      <Languages size={18} aria-hidden="true" className="fpl-profile-row-icon" />
      <span className="fpl-profile-row-text">
        <span className="fpl-profile-row-title">{t('Language')}</span>
      </span>
      <select className="fpl-input fpl-profile-team-select" value={currentLanguage()} onChange={e => chooseLanguage(e.target.value)}>
        {LANGUAGES.map(l => <option key={l.code} value={l.code} lang={l.code}>{l.name}</option>)}
      </select>
    </label>
  );
}

const CHART_W = 600;
const CHART_H = 170;
const BARS_H = 52;

// Overall rank through the season (a line, best rank at the top), or team
// value (highest at the top), over each gameweek's points (bars), one
// gameweek picked at a time: by pointer, by tapping, or with the arrow keys
// once the chart has focus.
function RankChart({ rows }) {
  const [picked, setPicked] = useState(null);
  const [mode, setMode] = useState('rank');
  const boxRef = useRef(null);
  const rankPts = rankChartPoints(rows, { width: CHART_W, height: CHART_H, pad: 10 });
  const valuePts = valueChartPoints(rows, { width: CHART_W, height: CHART_H, pad: 10 });
  const hasValue = valuePts.length >= 2;
  const isValue = mode === 'value' && hasValue;
  const pts = isValue ? valuePts : rankPts;
  if (pts.length < 2) return null;
  const i = picked === null || picked >= pts.length ? pts.length - 1 : picked;
  const cur = pts[i];
  // Places gained, or £m gained, since the gameweek before.
  const change = isValue ? (i ? Math.round((cur.value - pts[i - 1].value) * 10) / 10 : 0) : cur.rankChange;
  const line = pts.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${CHART_H} L${pts[0].x.toFixed(1)},${CHART_H} Z`;
  const maxPts = Math.max(1, ...pts.map(p => p.points || 0));
  const best = pts.reduce((b, p) => ((isValue ? p.value > b.value : p.overallRank < b.overallRank) ? p : b), pts[0]);
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
          <div className="fpl-mono fpl-profile-stat-label">{isValue ? t('Team value') : t('Overall rank')} · GW{cur.gw}</div>
          <div className="fpl-rank-chart-value">
            {isValue ? fmtMoney(cur.value) : fmtInt(cur.overallRank)}
            {change ? (
              <span className={`fpl-rank-move ${change > 0 ? 'is-up' : 'is-down'}`}>
                {change > 0 ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
                <span className="fpl-sr-only">{change > 0 ? t('up') : t('down')} </span>{isValue ? fmtMoney(Math.abs(change)) : fmtInt(Math.abs(change))}
              </span>
            ) : null}
          </div>
        </div>
        <div className="fpl-rank-chart-side fpl-mono" aria-live="polite">
          <span><b>{cur.points}</b> {t('pts')}{cur.hit ? ` (−${cur.hit})` : ''}</span>
          {isValue
            ? (cur.bank !== null ? <span>{t('{money} in the bank', { money: fmtMoney(cur.bank) })}</span> : null)
            : (cur.gwRank ? <span>{t('GW rank {n}', { n: fmtInt(cur.gwRank) })}</span> : null)}
          {cur.chip ? <span className="fpl-rank-chip">{cur.chip}</span> : null}
        </div>
        {hasValue && (
          <div className="fpl-seg fpl-rank-mode" role="group" aria-label={t('Chart')}>
            {[['rank', t('Rank')], ['value', t('Value')]].map(([key, label]) => (
              <button key={key} type="button" className={mode === key ? 'is-on' : ''} aria-pressed={mode === key} onClick={() => setMode(key)}>{label}</button>
            ))}
          </div>
        )}
      </div>
      <div
        ref={boxRef}
        className="fpl-rank-chart-plot"
        role="slider"
        tabIndex={0}
        aria-label={isValue ? t('Gameweek on the value chart') : t('Gameweek on the rank chart')}
        aria-valuemin={pts[0].gw}
        aria-valuemax={pts[pts.length - 1].gw}
        aria-valuenow={cur.gw}
        aria-valuetext={isValue
          ? t('Gameweek {gw}: team value {money}, {n} points', { gw: cur.gw, money: fmtMoney(cur.value), n: cur.points })
          : t('Gameweek {gw}: overall rank {rank}, {n} points', { gw: cur.gw, rank: fmtInt(cur.overallRank), n: cur.points })}
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
        <span className={`fpl-mono fpl-rank-best${best.x < CHART_W * 0.12 ? ' is-start' : best.x > CHART_W * 0.88 ? ' is-end' : ''}`} style={{ left: pct(best.x), top: `${(best.y / CHART_H) * 100}%` }} aria-hidden="true">{isValue ? t('Peak {money}', { money: fmtMoney(best.value) }) : t('Best {n}', { n: fmtInt(best.overallRank) })}</span>
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

export function ProfileScreen({ session, staticData = null, analyticsByDefault = false, notice = '', onDismissNotice, savedTeams = [], homeTeamId, onPickTeam, onOpenDialog, onMyTeams, onLogout }) {
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
      .then(([entry, history]) => { if (live) setLoaded({ teamId, status: 'ready', data: careerStats(history, entry), history }); })
      .catch(() => { if (live) setLoaded({ teamId, status: 'error', data: null }); });
    return () => { live = false; };
  }, [teamId]);

  const c = career.data;
  // Where this season is heading at the pace so far, from the finished
  // gameweeks' average scores.
  const projection = (() => {
    if (!c || !career.history || !staticData || !Array.isArray(staticData.allEvents)) return null;
    const averages = {};
    staticData.allEvents.forEach(e => { if (e.finished && e.average_entry_score > 0) averages[e.id] = e.average_entry_score; });
    return rankProjection(career.history.current, averages, staticData.totalPlayers);
  })();
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
          <button type="button" className="fpl-verify-bar-x" aria-label={t('Dismiss')} onClick={onDismissNotice}><X size={16} aria-hidden="true" /></button>
        </div>
      )}
      <section className="fpl-profile-hero" aria-label={t('Your account')}>
        <div className="fpl-profile-avatar" aria-hidden="true">{initial}</div>
        <div style={{ minWidth: 0 }}>
          <h1 className="fpl-display fpl-profile-name">{session.username}</h1>
          <div className="fpl-mono fpl-profile-meta">
            {since ? t('Member since {date}', { date: since }) : t('FPL Checker member')}
            {c && c.managerName ? ` · ${c.managerName}` : ''}
          </div>
          <div className="fpl-profile-badges">
            {session.google && <span className="fpl-profile-badge"><GoogleMark /> Google</span>}
            {session.email && session.emailVerified && <span className="fpl-profile-badge"><Check size={12} aria-hidden="true" /> {t('Email confirmed')}</span>}
            {session.admin && <span className="fpl-profile-badge">{t('Admin')}</span>}
          </div>
        </div>
      </section>

      <section aria-labelledby="career-title" className="fpl-profile-section fpl-profile-career">
        <div className="fpl-profile-section-head">
          <h2 id="career-title" className="fpl-display fpl-profile-h2">{t('FPL career')}</h2>
          {teamIds.length > 1 && (
            <select className="fpl-input fpl-profile-team-select" aria-label={t('Team')} value={teamId} onChange={e => { setTeamId(e.target.value); onPickTeam(e.target.value); }}>
              {teamIds.map(id => <option key={id} value={id}>{t('Team {id}', { id })}</option>)}
            </select>
          )}
        </div>

        {!teamId && (
          <form onSubmit={showTyped} className="fpl-block" style={{ padding: 14 }}>
            <p style={{ margin: '0 0 10px', fontSize: '0.85rem', color: 'var(--ink-dim)', lineHeight: 1.5 }}>{t('Add your FPL Team ID to see every season you’ve played, your best rank and this season so far.')}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="fpl-input" style={{ flex: 1, minWidth: 0 }} inputMode="numeric" placeholder={t('e.g. 1234567')} aria-label={t('FPL Team ID')} value={typed} onChange={e => setTyped(parseTeamId(e.target.value))} />
              <button type="submit" className="fpl-btn fpl-btn-solid" disabled={!typed}>{t('Show')}</button>
            </div>
          </form>
        )}

        {career.status === 'loading' && (
          <div className="fpl-profile-stats" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="fpl-profile-stat fpl-skel" />)}
          </div>
        )}
        {career.status === 'error' && (
          <div className="fpl-block" role="alert" style={{ padding: 14, fontSize: '0.85rem' }}>{t('Couldn’t load that team from FPL just now. Check the Team ID, or try again in a minute.')}</div>
        )}

        {c && (
          <>
            {c.teamName && <div className="fpl-mono fpl-profile-team-name">{c.teamName}</div>}
            <div className="fpl-profile-stats">
              <StatTile label={t('Seasons')} value={fmtInt(c.seasons)} sub={c.top10kFinishes ? (c.top10kFinishes > 1 ? t('{n} top-10k finishes', { n: c.top10kFinishes }) : t('1 top-10k finish')) : null} />
              <StatTile label={t('Best finish')} value={c.bestRank ? fmtInt(c.bestRank) : '–'} sub={c.bestRank ? t('overall rank') : t('no finished season yet')} />
              <StatTile label={t('Best season')} value={c.bestSeason ? t('{n} pts', { n: fmtInt(c.bestSeason.points) }) : '–'} sub={c.bestSeason ? c.bestSeason.season : null} />
              <StatTile label={t('Avg season')} value={c.averageSeasonPoints ? t('{n} pts', { n: fmtInt(c.averageSeasonPoints) }) : '–'} />
              {c.thisSeason && (
                <>
                  <StatTile label={t('This season')} value={t('{n} pts', { n: fmtInt(c.thisSeason.points) })} sub={t('{n} GWs · avg {avg}', { n: c.thisSeason.gameweeks, avg: c.thisSeason.averageGw })} />
                  <StatTile label={t('Overall rank')} value={fmtInt(c.thisSeason.overallRank)} />
                  <StatTile label={t('Best gameweek')} value={t('{n} pts', { n: c.thisSeason.bestGw.points })} sub={`GW${c.thisSeason.bestGw.gw}`} />
                  <StatTile label={t('Transfers')} value={fmtInt(c.thisSeason.transfers)} sub={c.thisSeason.hitPoints ? t('−{n} pts in hits', { n: c.thisSeason.hitPoints }) : t('no hits taken')} />
                  <StatTile label={t('Bench points')} value={fmtInt(c.thisSeason.benchPoints)} sub={t('left on the bench')} />
                  <StatTile label={t('Team value')} value={fmtMoney(c.thisSeason.value)} sub={c.thisSeason.bank !== null ? t('{money} in the bank', { money: fmtMoney(c.thisSeason.bank) }) : null} />
                </>
              )}
            </div>

            <RankChart rows={c.gwHistory || []} />

            {projection && <SeasonEnd p={projection} />}

            {c.chips.length > 0 && (
              <div className="fpl-profile-chips" aria-label={t('Chips played this season')}>
                {c.chips.map(chip => <span key={`${chip.name}-${chip.gw}`} className="fpl-profile-chip">{chip.name} <span className="fpl-mono">GW{chip.gw}</span></span>)}
              </div>
            )}

            {c.past.length > 0 && (
              <div className="fpl-block fpl-profile-seasons">
                <div className="fpl-mono fpl-profile-seasons-head"><span>{t('Season')}</span><span>{t('Points')}</span><span>{t('Rank')}</span></div>
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
        <h2 id="settings-title" className="fpl-display fpl-profile-h2">{t('Settings')}</h2>
        <div className="fpl-block fpl-profile-rows">
          <SettingRow icon={Bookmark} title={t('Saved teams')} detail={t('{n} saved', { n: savedTeams.length })} onAction={onMyTeams} />
          <SettingRow
            icon={Mail}
            title={t('Email')}
            detail={session.email ? `${session.email}${session.emailVerified ? '' : ` · ${t('not confirmed')}`}` : t('None: needed for password resets and deadline emails')}
            action={session.email ? t('Change') : t('Add')}
            onAction={() => onOpenDialog('email')}
          />
          {session.email && !session.emailVerified && (
            <SettingRow icon={ShieldCheck} title={t('Confirm your email')} detail={t('Enter the 6-digit code we emailed you')} action={t('Enter code')} onAction={() => onOpenDialog('verify')} />
          )}
          {session.hasPassword
            ? <SettingRow icon={KeyRound} title={t('Password')} detail={t('Change it; other devices are signed out')} action={t('Change')} onAction={() => onOpenDialog('password')} />
            : <SettingRow icon={KeyRound} title={t('Backup login')} detail={t('Add a username and password, in case you can’t use Google')} action={t('Add')} onAction={() => onOpenDialog('backup')} />}
          {googleEnabled && (
            session.google
              ? <SettingRow icon={Link2} title="Google" detail={t('Connected: you can sign in with Google')} />
              : <SettingRow icon={Link2} title="Google" detail={t('Connect to sign in with one tap')} action={t('Connect')} href="/auth/google?link=1" />
          )}
          <SettingRow icon={Bell} title={t('Deadline emails')} detail={session.digestTeamId ? t('On for team {id}', { id: session.digestTeamId }) : t('Off: turn on from your team’s page')} onAction={onMyTeams} />
          <SettingRow icon={MessageSquare} title={t('Send feedback')} detail={t('Report a problem or suggest something')} onAction={() => onOpenDialog('feedback')} />
          <LanguageRow />
          <ThemeRow />
          <CookieRow byDefault={analyticsByDefault} />
          <SettingRow icon={FileText} title={t('Terms and privacy')} href={TERMS_PATH} />
          <SettingRow icon={LogOut} title={t('Log out')} onAction={onLogout} />
        </div>

        <div className="fpl-block fpl-profile-rows" style={{ marginTop: 14 }}>
          <SettingRow icon={Trash2} title={t('Delete account')} detail={t('Removes your account and saved teams for good')} danger onAction={() => onOpenDialog('delete')} />
        </div>
      </section>
    </div>
  );
}
