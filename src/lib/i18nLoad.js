// Loads the chosen language's dictionary before the app renders (see
// src/lib/i18n.js). Each language is its own small file, fetched only by the
// people who use it.
import { STORAGE_KEY, isRtl, pickLanguage, setDictionary } from './i18n.js';

const LOCALES = import.meta.glob('../locales/*.json');

function readSaved() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export async function initLanguage() {
  const code = pickLanguage(readSaved(), typeof navigator !== 'undefined' ? navigator.languages : []);
  let dict = null;
  const load = LOCALES[`../locales/${code}.json`];
  if (code !== 'en' && load) {
    try { dict = (await load()).default; } catch { /* offline or missing: English */ }
  }
  setDictionary(dict || code === 'en' ? code : 'en', dict);
  const root = document.documentElement;
  root.lang = dict || code === 'en' ? code : 'en';
  root.dir = dict && isRtl(code) ? 'rtl' : 'ltr';
}

// Saves the choice and reloads so every screen uses it.
export function chooseLanguage(code) {
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* not saved */ }
  window.location.reload();
}
