// The app's menu: a sidebar on a computer and a footer that stays at the
// bottom of the screen on a phone, whose last button opens the rest.
// Which one shows is decided in CSS (see .fpl-sidenav / .fpl-footnav).
import { useEffect, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';

// items: [{ id, label, Icon, run, footer }] — `footer` items get their own
// button in the phone footer; the rest go under "More".
export function SideNav({ items, active }) {
  return (
    <nav className="fpl-sidenav fpl-glass" aria-label="Menu">
      <div className="fpl-sidenav-brand fpl-display">SQUAD CHECK <span>· FPL</span></div>
      <ul>
        {items.map(({ id, label, Icon, run }) => (
          <li key={id}>
            <button type="button" onClick={run} aria-current={active === id ? 'page' : undefined}>
              <Icon size={18} aria-hidden="true" />{label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function FooterNav({ items, active }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const rootRef = useRef(null);
  const main = items.filter(i => i.footer);
  const more = items.filter(i => !i.footer);
  const moreActive = more.some(i => i.id === active);

  useEffect(() => {
    if (!moreOpen) return undefined;
    const onKey = e => { if (e.key === 'Escape') setMoreOpen(false); };
    const onPointer = e => { if (rootRef.current && !rootRef.current.contains(e.target)) setMoreOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [moreOpen]);

  const pick = run => () => { setMoreOpen(false); run(); };
  return (
    <div className="fpl-footnav-root" ref={rootRef}>
      {moreOpen && (
        <div className="fpl-footnav-more fpl-glass" id="fpl-more-menu">
          {more.map(({ id, label, Icon, run }) => (
            <button key={id} type="button" onClick={pick(run)} aria-current={active === id ? 'page' : undefined}>
              <Icon size={19} aria-hidden="true" />{label}
            </button>
          ))}
        </div>
      )}
      <nav className="fpl-footnav" aria-label="Menu">
        {main.map(({ id, label, Icon, run }) => (
          <button key={id} type="button" onClick={pick(run)} aria-current={active === id ? 'page' : undefined}>
            <Icon size={22} aria-hidden="true" /><span>{label}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen(o => !o)}
          aria-expanded={moreOpen}
          aria-controls="fpl-more-menu"
          className={moreActive ? 'is-active' : undefined}
        >
          <Ellipsis size={22} aria-hidden="true" /><span>More</span>
        </button>
      </nav>
    </div>
  );
}
