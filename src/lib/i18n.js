// Translations. The English text is the key: t('Make your transfers') looks
// the phrase up in the chosen language's dictionary (src/locales/<code>.json)
// and falls back to the English when there's no entry, so untranslated text
// still reads. {name} placeholders are filled from `vars`.
//
// The language is picked once, before the app renders (see initLanguage in
// src/lib/i18nLoad.js): the one saved in Profile, else the browser's, else
// English. Changing it reloads the page, so every screen, memoised value and
// lib-built sentence (alerts, the transfer plan, player insights) picks it up
// without each needing to listen for a change.

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' },
  { code: 'it', name: 'Italiano' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'ar', name: 'العربية', rtl: true },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ko', name: '한국어' },
];
const CODES = new Set(LANGUAGES.map(l => l.code));
export const STORAGE_KEY = 'fpl_lang';

let current = 'en';
let dictionary = null;

// The language to use: a saved choice when it's one we have, else the first
// browser language we have (matching "pt-BR" to "pt"), else English.
export function pickLanguage(saved, browserLanguages = []) {
  if (saved && CODES.has(saved)) return saved;
  for (const tag of browserLanguages || []) {
    const base = String(tag || '').toLowerCase().split('-')[0];
    if (CODES.has(base)) return base;
  }
  return 'en';
}

export function isRtl(code) {
  const lang = LANGUAGES.find(l => l.code === code);
  return !!(lang && lang.rtl);
}

const fill = (text, vars) => (vars
  ? text.replace(/\{(\w+)\}/g, (whole, key) => (Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : whole))
  : text);

// A translator bound to one dictionary, for code that runs for many people at
// once (the push sender translates each subscriber's alerts in their language).
export function makeT(dict) {
  return (text, vars) => fill((dict && dict[text]) || text, vars);
}

export function t(text, vars) {
  return fill((dictionary && dictionary[text]) || text, vars);
}

export function setDictionary(code, dict) {
  current = CODES.has(code) ? code : 'en';
  dictionary = current === 'en' ? null : dict || null;
}

export function currentLanguage() {
  return current;
}

// Numbers and dates in the chosen language's style (1,234 vs 1.234).
// Arabic keeps Western digits, like the numbers inside its phrases.
const intl = () => (current === 'ar' ? 'ar-u-nu-latn' : current);

export function fmtNumber(n, options) {
  return Number(n).toLocaleString(intl(), options);
}

export function fmtDate(value, options) {
  return new Date(value).toLocaleDateString(intl(), options);
}

export function fmtTime(value, options) {
  return new Date(value).toLocaleTimeString(intl(), options);
}

export function fmtDateTime(value, options) {
  return new Date(value).toLocaleString(intl(), options);
}

// "1st", "2e", "3.", "4위": a league position in the chosen language.
const ORDINALS = {
  en: n => `${n}${(n % 100 >= 11 && n % 100 <= 13) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`,
  fr: n => (n === 1 ? '1er' : `${n}e`),
  es: n => `${n}.º`,
  pt: n => `${n}.º`,
  it: n => `${n}º`,
  de: n => `${n}.`,
  nl: n => `${n}e`,
  id: n => `ke-${n}`,
  ko: n => `${n}위`,
};
export function ordinal(n, code = current) {
  return (ORDINALS[code] || (v => String(v)))(n);
}

// One of two phrases by count: plural(n, t('1 goal'), t('{n} goals')).
export function plural(n, one, many) {
  return (n === 1 ? one : many).replace(/\{n\}/g, String(n));
}
