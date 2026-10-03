// Pieces shared across screens: header, loading/error states, player
// search and fixture-difficulty chips.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bookmark, LogOut, Menu, RotateCcw, Search, User, X } from 'lucide-react';
import { DIFF_COLORS, POSITION_LABELS, fmtPrice, fmtPts, normalize } from '../lib/format.js';
import { isEventLocked } from '../lib/predictions.js';

export function DifficultyChips({ fixtures, teamsById, max = 3 }) {
  const list = (fixtures || []).slice(0, max);
  if (!list.length) return <span className="fpl-mono fpl-meta">TBC</span>;
  return (
    <>
      {list.map((f, i) => {
        const team = teamsById[f.opponent];
        const c = DIFF_COLORS[f.difficulty] || DIFF_COLORS[3];
        return (
          <span key={i} className="fpl-fixchip" style={{ background: c.bg, color: c.text }}>
            {team ? team.short_name : '?'} {f.isHome ? 'H' : 'A'}
          </span>
        );
      })}
    </>
  );
}

export function Header({ summary, gwOptions, selectedGw, onSelectGw, onGoHome, session, onLoginClick, onMyTeamsClick, onLogoutClick }) {
  // One panel open at a time: opening the account panel closes the
  // gameweek panel and vice versa (they share the same corner of the
  // screen and used to stack on top of each other).
  const [openPanel, setOpenPanel] = useState(null); // null | 'account' | 'gameweek'
  const menuOpen = openPanel === 'gameweek';
  const accountMenuOpen = openPanel === 'account';
  const toggle = panel => setOpenPanel(current => (current === panel ? null : panel));
  const headerRef = useRef(null);

  // Close whichever panel is open on Escape or a click/tap outside the header.
  useEffect(() => {
    if (!openPanel) return undefined;
    const onKey = e => { if (e.key === 'Escape') setOpenPanel(null); };
    const onPointer = e => { if (headerRef.current && !headerRef.current.contains(e.target)) setOpenPanel(null); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [openPanel]);

  return (
    <header ref={headerRef} style={{ borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, zIndex: 100, background: 'var(--panel)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' }}>
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 10, height: 10, background: 'var(--lime)', borderRadius: 2, flexShrink: 0 }} />
        <button
          onClick={onGoHome}
          className="fpl-display"
          style={{ fontWeight: 700, fontSize: '1.05rem', letterSpacing: '0.02em', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', fontFamily: 'inherit' }}
        >
          SQUAD CHECK <span style={{ color: 'var(--ink-dim)', fontWeight: 500 }}>· FPL</span>
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
          <button
            onClick={() => { if (session) toggle('account'); else { setOpenPanel(null); onLoginClick(); } }}
            aria-label="Account"
            aria-expanded={session ? accountMenuOpen : undefined}
            className="fpl-mono"
            style={{ background: accountMenuOpen ? 'var(--panel-alt)' : 'none', border: '1px solid var(--line)', color: 'var(--ink)', padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', maxWidth: 140 }}
          >
            <User size={14} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{session ? session.username : 'Log in'}</span>
          </button>
          {accountMenuOpen && session && (
            <div className="fpl-block" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, zIndex: 20, padding: 6, minWidth: 160 }}>
              <button
                onClick={() => { setOpenPanel(null); onMyTeamsClick(); }}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: 'var(--ink)', padding: '8px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem' }}
              >
                <Bookmark size={14} /> My Teams
              </button>
              <button
                onClick={() => { setOpenPanel(null); onLogoutClick(); }}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: 'var(--ink)', padding: '8px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem' }}
              >
                <LogOut size={14} /> Log out
              </button>
            </div>
          )}
          {gwOptions && gwOptions.length > 0 && (
            <button
              onClick={() => toggle('gameweek')}
              aria-label="Menu"
              aria-expanded={menuOpen}
              style={{ background: menuOpen ? 'var(--panel-alt)' : 'none', border: '1px solid var(--line)', color: 'var(--ink)', padding: '6px 9px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
            >
              {menuOpen ? <X size={16} /> : <Menu size={16} />}
            </button>
          )}
        </div>
      </div>
      {menuOpen && gwOptions && gwOptions.length > 0 && (
        <div className="fpl-block" style={{ position: 'absolute', top: '100%', right: 16, zIndex: 20, padding: 12, minWidth: 210 }}>
          <label className="fpl-mono" style={{ display: 'block', fontSize: '0.62rem', color: 'var(--ink-dim)', marginBottom: 6, letterSpacing: '0.04em' }}>
            GAMEWEEK
          </label>
          <select
            aria-label="Gameweek"
            className="fpl-mono"
            value={selectedGw || ''}
            onChange={e => { onSelectGw(Number(e.target.value)); setOpenPanel(null); }}
            style={{ width: '100%', background: 'var(--panel-alt)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 4, padding: '8px 8px', fontSize: '0.8rem' }}
          >
            {gwOptions.map(e => (
              <option key={e.id} value={e.id}>{e.name}{!isEventLocked(e) ? ' (current)' : ''}</option>
            ))}
          </select>
        </div>
      )}
      {summary && (
        <div style={{ background: 'var(--panel-alt)', padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div className="fpl-mono fpl-meta-lg">
            {summary.gwLabel}{summary.countdown ? ` · ${summary.countdown}` : ''}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="fpl-mono" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--blue)' }}>{fmtPts(summary.xiTotal)}</span>
            <span className="fpl-mono" style={{ fontSize: '0.62rem', color: 'var(--ink-dim)', letterSpacing: '0.04em' }}>PREDICTED XI PTS</span>
            {summary.actualXiTotal != null && (
              <>
                <span className="fpl-mono fpl-meta-lg">·</span>
                <span className="fpl-mono" style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--lime)' }}>{fmtPts(summary.actualXiTotal)}</span>
                <span className="fpl-mono" style={{ fontSize: '0.62rem', color: 'var(--ink-dim)', letterSpacing: '0.04em' }}>ACTUAL XI PTS</span>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}

export function LoadingScreen({ message }) {
  return (
    <div style={{ padding: '60px 16px', textAlign: 'center' }}>
      <div className="fpl-pulse-wrap" style={{ justifyContent: 'center', marginBottom: 20 }}>
        <div className="fpl-pulse" style={{ animationDelay: '0s' }} />
        <div className="fpl-pulse" style={{ animationDelay: '0.15s' }} />
        <div className="fpl-pulse" style={{ animationDelay: '0.3s' }} />
        <div className="fpl-pulse" style={{ animationDelay: '0.45s' }} />
      </div>
      <div className="fpl-mono" style={{ fontSize: '0.85rem', color: 'var(--ink-dim)' }}>{message || 'Working…'}</div>
    </div>
  );
}

export function ErrorScreen({ message, onRetry }) {
  return (
    <div style={{ padding: '40px 16px', textAlign: 'center' }}>
      <AlertTriangle size={32} style={{ color: 'var(--red)', margin: '0 auto 14px' }} />
      <p style={{ fontSize: '0.92rem', lineHeight: 1.5, marginBottom: 22, color: 'var(--ink)' }}>{message}</p>
      <button className="fpl-btn fpl-btn-solid" onClick={onRetry} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <RotateCcw size={16} /> Start over
      </button>
    </div>
  );
}

export function PlayerSearchPicker({ allPlayers, onPick }) {
  const [q, setQ] = useState('');
  const nq = normalize(q);
  const results = nq.length < 2 ? [] : allPlayers.filter(p =>
    normalize(p.webName).includes(nq) || normalize(p.secondName).includes(nq)
  ).slice(0, 8);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 9, top: 11, color: 'var(--ink-dim)' }} />
        <input
          className="fpl-input"
          style={{ paddingLeft: 30, fontSize: '0.85rem' }}
          placeholder="Search player name…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>
      {results.length > 0 && (
        <div className="fpl-block" style={{ marginTop: 4 }}>
          {results.map(p => (
            <button type="button" key={p.id} className="fpl-search-item" onClick={() => onPick(p)}>
              <strong>{p.webName}</strong> <span className="fpl-dim">· {POSITION_LABELS[p.positionId]} · {fmtPrice(p.price)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
