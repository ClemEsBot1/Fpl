// Light or dark: 'system' follows the device, or the choice made in
// Profile, kept on this device. The page's <html> gets data-theme="light"
// or "dark" (src/styles.css styles the light one), set before the app
// draws so it doesn't flash the other one first.

export const THEME_KEY = 'fpl_theme';
export const THEMES = ['system', 'light', 'dark'];

export function readTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return THEMES.includes(saved) ? saved : 'system';
  } catch { return 'system'; }
}

// 'light' or 'dark' for a choice, `prefersLight` being the device's.
export function resolveTheme(choice, prefersLight) {
  if (choice === 'light' || choice === 'dark') return choice;
  return prefersLight ? 'light' : 'dark';
}

const lightQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null);

export function applyTheme(choice = readTheme()) {
  if (typeof document === 'undefined') return 'dark';
  const query = lightQuery();
  const theme = resolveTheme(choice, !!(query && query.matches));
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#EEF1FF' : '#0a081e');
  return theme;
}

export function chooseTheme(choice) {
  try { localStorage.setItem(THEME_KEY, choice); } catch { /* this visit only */ }
  applyTheme(choice);
}

// Follows the device's setting while the choice is 'system'.
export function watchSystemTheme() {
  const query = lightQuery();
  if (!query || !query.addEventListener) return () => {};
  const onChange = () => { if (readTheme() === 'system') applyTheme('system'); };
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
