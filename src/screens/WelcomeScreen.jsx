// The welcome page shown to anyone who isn't logged in (and from "About
// this app" in the menu): what the app does, with text that fades in as
// it scrolls into view and a row of feature panels you swipe sideways.
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarRange, ChartColumn, Clock, TrendingUp } from 'lucide-react';
import { DIFF_COLORS } from '../lib/format.js';
import { AccuracyPanel } from './IntroScreen.jsx';

// Adds `is-in` to each `.fpl-rv` element inside `rootRef` as it scrolls
// into view. Without IntersectionObserver everything simply shows.
function useReveal(rootRef) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return undefined;
    root.classList.add('fpl-reveal-on');
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    root.querySelectorAll('.fpl-rv').forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [rootRef]);
}

/* ---------- Illustrations of real screens (example data) ---------- */

function Fix({ label, difficulty }) {
  const c = DIFF_COLORS[difficulty];
  return <span className="fpl-fixchip" style={{ background: c.bg, color: c.text }}>{label}</span>;
}

function MockRow({ pos, name, club, price, fixture, difficulty, pts, captain }) {
  return (
    <div className="wm-row">
      <span className="wm-pos">{pos}</span>
      <div className="wm-who">
        <b>{name}{captain && <i className="fpl-armband">C</i>}</b>
        <small>{club} · £{price}m</small>
      </div>
      <Fix label={fixture} difficulty={difficulty} />
      <span className="wm-pts">{pts}<small>PTS</small></span>
    </div>
  );
}

function MockTeam() {
  return (
    <div className="wm-card" role="img" aria-label="Example: predicted points for each player">
      <div className="wm-cap"><span>GAMEWEEK 8 · PREDICTED</span><span>XI 58.4</span></div>
      <MockRow pos="FWD" name="Haaland" club="MCI" price="14.6" fixture="ARS H" difficulty={4} pts="7.8" captain />
      <MockRow pos="MID" name="Saka" club="ARS" price="10.2" fixture="MCI A" difficulty={5} pts="6.1" />
      <MockRow pos="MID" name="Semenyo" club="BOU" price="7.6" fixture="BUR H" difficulty={2} pts="5.7" />
      <MockRow pos="DEF" name="Gabriel" club="ARS" price="6.3" fixture="MCI A" difficulty={5} pts="4.2" />
    </div>
  );
}

function MockScreenshot() {
  return (
    <div className="wm-card" role="img" aria-label="Example: a screenshot being read">
      <div className="wm-shot">
        {[1, 4, 4, 2].map((n, r) => (
          <div key={r} className="wm-shot-row">{Array.from({ length: n }, (_, k) => <i key={k} />)}</div>
        ))}
        <span className="wm-scan" />
      </div>
      <span className="wm-chip">15 of 15 players read · Haaland (C)</span>
    </div>
  );
}

function MockTransfer() {
  return (
    <div className="wm-card" role="img" aria-label="Example: a suggested transfer">
      <div className="wm-cap"><span>SUGGESTED TRANSFER</span><span>1 FREE</span></div>
      <div className="wm-swap">
        <div><em>OUT</em><b>Gordon</b><small>NEW · £7.5m · 3.9</small></div>
        <ArrowRight size={18} aria-hidden="true" />
        <div><em>IN</em><b>Mbeumo</b><small>MUN · £8.0m · 6.0</small></div>
      </div>
      <div className="wm-gain"><span>Gain <b>+2.1 pts</b></span><span>£0.2m left in the bank</span></div>
    </div>
  );
}

function MockBestSquad() {
  const rows = [['Raya'], ['Gabriel', 'Virgil', 'Muñoz', 'Gvardiol'], ['Salah', 'Saka', 'Palmer', 'Semenyo'], ['Haaland', 'Watkins']];
  return (
    <div className="wm-card" role="img" aria-label="Example: the best squad for £100m">
      <div className="wm-cap"><span>BEST XI · 4-4-2</span><span>£99.8M</span></div>
      <div className="wm-pitch">
        {rows.map((row, r) => (
          <div key={r} className="wm-pitch-row">{row.map(n => <span key={n} className="wm-pp"><i /><span>{n}</span></span>)}</div>
        ))}
      </div>
    </div>
  );
}

function MockChips() {
  const weeks = [[9, 52], [10, 58], [11, 55], [12, 71, 'TC'], [13, 60], [14, 74, 'BB'], [15, 57], [16, 63]];
  return (
    <div className="wm-card" role="img" aria-label="Example: the best gameweeks for Triple Captain and Bench Boost">
      <div className="wm-cap"><span>SQUAD TOTAL BY GAMEWEEK</span><span>PTS</span></div>
      <div className="wm-bars">
        {weeks.map(([gw, pts, chip]) => (
          <div key={gw} className={`wm-bar${chip === 'TC' ? ' tc' : chip === 'BB' ? ' bb' : ''}`}>
            <b>{chip || ''}</b><i style={{ height: (pts - 40) * 2.4 }} /><span>GW{gw}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MockLookBack() {
  const rows = [['Your team', 54], ['Predicted best', 61], ['Best possible', 87]];
  return (
    <div className="wm-card" role="img" aria-label="Example: a past gameweek compared">
      <div className="wm-cap"><span>GAMEWEEK 7 · ACTUAL POINTS</span><span>FINISHED</span></div>
      <div className="wm-hbars">
        {rows.map(([label, pts]) => (
          <div key={label} className="wm-hbar"><span>{label}</span><span className="wm-track"><i style={{ width: `${(pts / 87) * 100}%` }} /></span><b>{pts}</b></div>
        ))}
      </div>
    </div>
  );
}

const FEATURES = [
  { title: 'Check your team in seconds', body: 'Type your FPL Team ID and every player gets a predicted score for the next gameweek, with fixtures and injury news beside it.', Mock: MockTeam },
  { title: 'Or upload a screenshot', body: 'Take a screenshot of your Pick Team page. The names are read on your own device, and you check them before anything is worked out.', Mock: MockScreenshot },
  { title: 'Transfers and the armband', body: 'Swaps that fit your bank and the three-per-club rule, the best captain, and whether a −4 hit actually pays off.', Mock: MockTransfer },
  { title: 'The best squad for £100m', body: 'The highest-predicted 15 for this gameweek, kept up to date with the latest prices and team news.', Mock: MockBestSquad },
  { title: 'Time your chips', body: 'Triple Captain and Bench Boost, matched to the gameweeks where your squad has its strongest fixtures.', Mock: MockChips },
  { title: 'Look back at any gameweek', body: 'Pick a past gameweek to see what your team really scored, and how it compares with the best possible XI.', Mock: MockLookBack },
];

const HOW = [
  { Icon: ChartColumn, title: 'Form and minutes', text: 'Recent points, expected goals and assists, and how often each player starts.' },
  { Icon: CalendarRange, title: 'Fixtures', text: 'How hard the next four opponents are, home or away.' },
  { Icon: TrendingUp, title: 'Bookmaker odds', text: 'Win and clean-sheet chances for the next match.' },
  { Icon: Clock, title: 'Early-season gaps', text: "Before there's enough of this season, last season's record fills in." },
];

function FeatureCarousel() {
  const trackRef = useRef(null);
  const [current, setCurrent] = useState(0);

  function slides() { return trackRef.current ? [...trackRef.current.children] : []; }
  function onScroll() {
    const list = slides();
    if (!list.length) return;
    const left = trackRef.current.scrollLeft;
    let best = 0;
    list.forEach((s, k) => {
      if (Math.abs(s.offsetLeft - list[0].offsetLeft - left) < Math.abs(list[best].offsetLeft - list[0].offsetLeft - left)) best = k;
    });
    setCurrent(best);
  }
  function go(k) {
    const list = slides();
    const target = list[Math.max(0, Math.min(list.length - 1, k))];
    if (target) trackRef.current.scrollTo({ left: target.offsetLeft - list[0].offsetLeft, behavior: 'smooth' });
  }

  return (
    <div className="fpl-carousel">
      <div className="fpl-carousel-track" ref={trackRef} onScroll={onScroll} tabIndex={0} aria-label="What the app does">
        {FEATURES.map(({ title, body, Mock }) => (
          <article key={title} className="fpl-slide fpl-glass">
            <Mock />
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
        ))}
      </div>
      <div className="fpl-carousel-nav">
        <div className="fpl-dots">
          {FEATURES.map((f, k) => (
            <button key={f.title} type="button" aria-label={`Show: ${f.title}`} aria-current={k === current} onClick={() => go(k)} />
          ))}
        </div>
        <div className="fpl-arrows">
          <button type="button" aria-label="Previous" onClick={() => go(current - 1)}><ArrowLeft size={18} /></button>
          <button type="button" aria-label="Next" onClick={() => go(current + 1)}><ArrowRight size={18} /></button>
        </div>
      </div>
    </div>
  );
}

export function WelcomeScreen({ loggedIn, onStart, onSignUp, onLogIn }) {
  const rootRef = useRef(null);
  useReveal(rootRef);
  const buttons = (
    <div className="fpl-welcome-cta">
      <button type="button" className="fpl-pill fpl-pill-dark" onClick={onStart}>Start <ArrowRight size={18} /></button>
      {!loggedIn && <button type="button" className="fpl-pill fpl-pill-outline" onClick={onSignUp}>Sign up</button>}
    </div>
  );

  return (
    <div className="fpl-welcome" ref={rootRef}>
      <header className="fpl-welcome-hero">
        <div className="fpl-welcome-intro">
          <span className="fpl-kicker">Fantasy Premier League</span>
          <h1 className="fpl-display">Know your points before the deadline.</h1>
          <p>FPL Squad Check predicts what every player in your squad will score, then shows who to transfer in and who should wear the armband.</p>
          {buttons}
          {!loggedIn && (
            <p className="fpl-welcome-login">Already have an account? <button type="button" onClick={onLogIn}>Log in</button></p>
          )}
        </div>
        <div className="fpl-welcome-art"><MockTeam /></div>
      </header>

      <section className="fpl-welcome-sec">
        <span className="fpl-kicker fpl-rv">What it does</span>
        <h2 className="fpl-display fpl-rv">Six ways to get more from your squad</h2>
        <p className="fpl-rv">Swipe through the panels, or use the arrows.</p>
        <div className="fpl-rv"><FeatureCarousel /></div>
      </section>

      <section className="fpl-welcome-sec">
        <span className="fpl-kicker fpl-rv">How the predictions work</span>
        <h2 className="fpl-display fpl-rv">Built from the numbers that move points</h2>
        <ul className="fpl-how fpl-glass fpl-rv">
          {HOW.map(({ Icon, title, text }) => (
            <li key={title}>
              <span className="fpl-how-icon"><Icon size={18} aria-hidden="true" /></span>
              <div><b>{title}</b><span>{text}</span></div>
            </li>
          ))}
        </ul>
        <div className="fpl-rv"><AccuracyPanel /></div>
      </section>

      <section className="fpl-welcome-end fpl-glass fpl-rv">
        <h2 className="fpl-display">Ready for this gameweek?</h2>
        <p>{loggedIn ? 'Your teams are on the home screen.' : 'No account needed to use it. Sign up to save your teams and see them here every time you visit.'}</p>
        {buttons}
      </section>
    </div>
  );
}
