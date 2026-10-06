// The app's menu: a sidebar on a computer and a footer that stays at the
// bottom of the screen on a phone, whose last button opens the rest.
// Which one shows is decided in CSS (see .fpl-sidenav / .fpl-footnav).
import { useEffect, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';

// items: [{ id, label, desc, group, Icon, run, footer }] — the sidebar
// shows them under their group with the description; `footer` items get
// their own button in the phone footer and the rest go under "More".
export function SideNav({ items, active }) {
  const groups = [];
  items.forEach(item => {
    const last = groups[groups.length - 1];
    if (last && last.name === item.group) last.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  });
  const idFor = name => `nav-${name.toLowerCase().replace(/\s+/g, '-')}`;
  return (
    <nav className="fpl-sidenav" aria-label="Menu">
      {groups.map(({ name, items: list }) => (
        <section key={name} aria-labelledby={idFor(name)}>
          <h2 id={idFor(name)} className="fpl-sidenav-group">{name}</h2>
          <ul>
            {list.map(({ id, label, desc, Icon, run }) => (
              <li key={id}>
                <button type="button" onClick={run} aria-current={active === id ? 'page' : undefined}>
                  <Icon size={24} aria-hidden="true" />
                  <span className="fpl-sidenav-label">{label}{desc && <small>{desc}</small>}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
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
